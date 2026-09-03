import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { nowUtc, todayInWorkingZone } from '../dates';
import { openTicket, overdueTicket } from '../ticket-state';
import { activeProject, archivedProject } from '../project-state';
import { mentionsRichField, readRichField } from '../rich-field';
import {
	ApiError,
	oneOf,
	optionalDate,
	optionalText,
	readJsonObject,
	requiredText
} from './validate';
import { PROJECT_PHASES, PROJECT_STATUSES } from '$lib/types';
import type { ProjectPhase, ProjectStatus } from '$lib/types';

export const projects = new Hono<ApiEnv>();

/**
 * A foreign key violation here means the caller named a client that does not
 * exist. That is a bad request, not a server fault, so it gets a 400 and a
 * message that says which field is wrong rather than a generic 500.
 */
function asClientError(err: unknown): unknown {
	if (String(err).includes('FOREIGN KEY constraint failed')) {
		return new ApiError(400, 'That client does not exist. Choose an existing client.');
	}
	return err;
}

/**
 * The next milestone, and where it comes from.
 *
 * `projects.next_milestone` is a free-text column somebody types, and it stays
 * because it is what every existing project has. Once a project has real
 * milestone rows, the earliest undone one is the honest answer and the column
 * is a second place the same fact lives. Rows win, the column is the fallback,
 * and a project with neither says nothing rather than something invented.
 */
const NEXT_MILESTONE = `
  COALESCE(
    (SELECT m.title FROM project_milestones m
     WHERE m.project_id = p.id AND m.done_at IS NULL
     ORDER BY CASE WHEN m.due_date IS NULL THEN 1 ELSE 0 END, m.due_date, m.position
     LIMIT 1),
    p.next_milestone
  )
`;

// Rolls the linked action items up onto every project row, so the list can show
// what is actually outstanding without a second request per project.
const LIST_SELECT = `
  SELECT p.*,
    cl.name AS client_name,
    SUM(CASE WHEN a.id IS NOT NULL AND a.status != 'done' THEN 1 ELSE 0 END) AS open_action_items,
    SUM(CASE WHEN a.id IS NOT NULL AND a.status != 'done'
             AND a.deadline IS NOT NULL AND a.deadline < ?1 THEN 1 ELSE 0 END) AS overdue_action_items,
    SUM(CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END) AS all_action_items,
    SUM(CASE WHEN a.id IS NOT NULL AND a.status = 'done' THEN 1 ELSE 0 END) AS done_action_items,
    /*
     * Progress is counted from the items, never stored.
     *
     * A percentage column is a number maintained by hand that drifts the first
     * time somebody closes an item without remembering to update it. Counting
     * makes it wrong only if the items are wrong, which is the same thing as
     * the project being wrong. D144's argument in a third place.
     *
     * Milestones are the better measure once a project has them, so they win
     * and items are the fallback. A project with neither reports nothing rather
     * than 0%, which would read as "nothing done" instead of "not tracked".
     */
    (SELECT COUNT(*) FROM project_milestones m WHERE m.project_id = p.id) AS milestone_count,
    (SELECT COUNT(*) FROM project_milestones m
     WHERE m.project_id = p.id AND m.done_at IS NOT NULL) AS milestones_done,
    /*
     * Tickets, counted three ways, from one definition.
     *
     * The screen showed only the open count under a heading that read
     * "Tickets", next to a column headed "Open" that was counting action items.
     * Both numbers were right and the pair was unreadable. Sending all three
     * lets the column say "2 of 15" instead of "2".
     */
    (SELECT COUNT(*) FROM tickets t
     WHERE t.project_id = p.id AND ${openTicket()}) AS open_tickets,
    (SELECT COUNT(*) FROM tickets t WHERE t.project_id = p.id) AS all_tickets,
    (SELECT COUNT(*) FROM tickets t
     WHERE t.project_id = p.id AND ${overdueTicket('t', '?1')}) AS overdue_tickets,
    ${NEXT_MILESTONE} AS next_milestone_shown,

    /*
     * Where this project came from, and whether Asana calls it archived.
     *
     * Read through the link table rather than stored on the project, because a
     * copy of the archived flag here would be a second answer that goes stale
     * the next time somebody archives something in Asana. The mirror is the
     * source; this joins to it.
     *
     * The mirrored flag is the marker a write path needs: a projected row is a
     * rendering of what Asana said, and editing it here would be a correction
     * the next projection silently reverts.
     */
    CASE WHEN al.asana_gid IS NOT NULL THEN 1 ELSE 0 END AS mirrored,
    COALESCE(ap.archived, 0) AS archived
  FROM projects p
  LEFT JOIN clients cl ON cl.id = p.client_id
  LEFT JOIN action_items a ON a.project_id = p.id
  LEFT JOIN asana_project_links al ON al.project_id = p.id
  LEFT JOIN asana_projects ap ON ap.gid = al.asana_gid
  GROUP BY p.id
`;

projects.get('/', async (c) => {
	/*
	 * Archived projects are hidden by default and reachable on request.
	 *
	 * 24 of the 66 mirrored projects are archived, and showing them alongside
	 * live work by default would make the screen a worse version of Asana. They
	 * are not dropped: an archived project holds finished work somebody asks
	 * about, which is why they were pulled in the first place. D172.
	 */
	const archived = c.req.query('archived') ?? 'no';
	if (!['no', 'only', 'all'].includes(archived)) {
		throw new ApiError(400, "archived must be one of: no, only, all.");
	}

	/*
	 * The full expression, not the SELECT alias.
	 *
	 * `HAVING archived = 0` binds the bare name to `asana_projects.archived`
	 * rather than to the alias, and that column is NULL for any project with no
	 * Asana link. NULL = 0 is NULL, so the filter returned nothing.
	 *
	 * It looked correct on the real data, where every project has a link, and
	 * emptied the screen on the fixture, where none do. The suite caught it. A
	 * bare alias in HAVING beside a real column of the same name is ambiguous
	 * and SQLite resolves it the other way.
	 */
	const filter =
		archived === 'no'
			? 'HAVING COALESCE(ap.archived, 0) = 0'
			: archived === 'only'
				? 'HAVING COALESCE(ap.archived, 0) = 1'
				: '';

	const { results } = await c.env.DB.prepare(
		`${LIST_SELECT.replace('GROUP BY p.id', `GROUP BY p.id ${filter}`)}
     ORDER BY
       CASE WHEN p.status = 'done' THEN 1 ELSE 0 END,
       CASE p.phase
         WHEN 'initiating' THEN 0
         WHEN 'planning' THEN 1
         WHEN 'executing' THEN 2
         WHEN 'monitoring' THEN 3
         WHEN 'closing' THEN 4
         ELSE 5
       END,
       p.name COLLATE NOCASE`
	)
		.bind(todayInWorkingZone())
		.all();

	// Both counts every time, so the screen can offer the archived view with a
	// number rather than a link into a page that might be empty. D27.
	const counts = await c.env.DB.prepare(
		`SELECT
       (SELECT COUNT(*) FROM projects p WHERE ${archivedProject('p')}) AS archived,
       (SELECT COUNT(*) FROM projects p WHERE ${activeProject('p')}) AS live`
	).first<{ archived: number; live: number }>();

	return c.json({
		projects: results ?? [],
		archived,
		counts: { live: counts?.live ?? 0, archived: counts?.archived ?? 0 }
	});
});

projects.post('/', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const now = nowUtc();
	const id = crypto.randomUUID();
	const description = readRichField(body, 'description', 'Description');

	try {
		await c.env.DB.prepare(
			`INSERT INTO projects
       (id, client_id, name, phase, status, owner_id, start_date, target_close,
        next_milestone, description, description_html, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
			.bind(
			id,
			optionalText(body.client_id, 'client_id', 64),
			requiredText(body.name, 'Name', 200),
			oneOf<ProjectPhase>(body.phase, PROJECT_PHASES, 'phase', 'initiating'),
			oneOf<ProjectStatus>(body.status, PROJECT_STATUSES, 'status', 'on_track'),
			optionalText(body.owner_id, 'owner_id', 64),
			optionalDate(body.start_date, 'Start date'),
			optionalDate(body.target_close, 'Target close'),
			optionalText(body.next_milestone, 'Next milestone', 300),
			description.plain,
			description.html,
				now,
				now
			)
			.run();
	} catch (err) {
		throw asClientError(err);
	}

	const created = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
	return c.json({ project: created }, 201);
});

/**
 * A project and everything currently linked to it.
 *
 * The design's detail screen also panels Meetings, Time and Invoices. Those
 * modules do not exist, so they are not returned and not referenced. See D27.
 */
projects.get('/:id', async (c) => {
	const id = c.req.param('id');

	const project = await c.env.DB.prepare(`${LIST_SELECT} HAVING p.id = ?2`)
		.bind(todayInWorkingZone(), id)
		.first();
	if (!project) throw new ApiError(404, 'Project not found.');

	const { results } = await c.env.DB.prepare(
		`SELECT * FROM action_items
     WHERE project_id = ?
     ORDER BY
       CASE WHEN status = 'done' THEN 1 ELSE 0 END,
       CASE WHEN deadline IS NULL THEN 1 ELSE 0 END,
       deadline ASC,
       created_at DESC`
	)
		.bind(id)
		.all();

	/*
	 * The working day, sent with the project.
	 *
	 * The page decides which tickets are overdue, and it must decide it against
	 * the same day the API does. Reading the browser's clock would put a laptop
	 * in another timezone one day out from every count on the screen, which is
	 * the whole reason the working zone is a server fact.
	 */
	return c.json({ project, action_items: results ?? [], today: todayInWorkingZone() });
});

// Only the fields present in the body are written, so advance-phase and
// set-status are the same route as a full edit.
const UPDATABLE = [
	'name',
	'phase',
	'status',
	'client_id',
	'owner_id',
	'start_date',
	'target_close',
	'next_milestone'
] as const;

projects.patch('/:id', async (c) => {
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw);

	const existing = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
	if (!existing) throw new ApiError(404, 'Project not found.');

	const sets: string[] = [];
	const binds: unknown[] = [];

	// The description writes two columns from one value, so it is handled once
	// below rather than inside a builder whose shape is one name, one bind.
	if (mentionsRichField(body, 'description')) {
		const description = readRichField(body, 'description', 'Description');
		sets.push('description = ?', 'description_html = ?');
		binds.push(description.plain, description.html);
	}

	for (const field of UPDATABLE) {
		if (!(field in body)) continue;
		const raw = body[field];
		let value: string | null;

		switch (field) {
			case 'name':
				value = requiredText(raw, 'Name', 200);
				break;
			case 'phase':
				value = oneOf<ProjectPhase>(raw, PROJECT_PHASES, 'phase', 'initiating');
				break;
			case 'status':
				value = oneOf<ProjectStatus>(raw, PROJECT_STATUSES, 'status', 'on_track');
				break;
			case 'start_date':
				value = optionalDate(raw, 'Start date');
				break;
			case 'target_close':
				value = optionalDate(raw, 'Target close');
				break;
			case 'next_milestone':
				value = optionalText(raw, 'Next milestone', 300);
				break;
			default:
				value = optionalText(raw, field, 64);
		}

		sets.push(`${field} = ?`);
		binds.push(value);
	}

	if (sets.length === 0) throw new ApiError(400, 'Nothing to update.');

	sets.push('updated_at = ?');
	binds.push(nowUtc());
	binds.push(id);

	try {
		await c.env.DB.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`)
			.bind(...binds)
			.run();
	} catch (err) {
		throw asClientError(err);
	}

	const updated = await c.env.DB.prepare(`${LIST_SELECT} HAVING p.id = ?2`)
		.bind(todayInWorkingZone(), id)
		.first();
	return c.json({ project: updated });
});

/**
 * Deleting a project does not delete its action items. The foreign key is
 * ON DELETE SET NULL, so they survive unlinked rather than silently vanishing
 * with the project.
 */
projects.delete('/:id', async (c) => {
	const result = await c.env.DB.prepare('DELETE FROM projects WHERE id = ?')
		.bind(c.req.param('id'))
		.run();
	if (!result.meta.changes) throw new ApiError(404, 'Project not found.');
	return c.json({ ok: true });
});

projects.get('/:id/milestones', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT * FROM project_milestones WHERE project_id = ?
     ORDER BY position, CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date`
	)
		.bind(c.req.param('id'))
		.all();
	return c.json({ milestones: results ?? [] });
});

projects.post('/:id/milestones', async (c) => {
	const db = c.env.DB;
	const projectId = c.req.param('id');
	const project = await db.prepare('SELECT id FROM projects WHERE id = ?').bind(projectId).first();
	if (!project) throw new ApiError(404, 'Project not found.');

	const body = await readJsonObject(c.req.raw);
	const now = nowUtc();
	const id = crypto.randomUUID();

	// Appended, so a new milestone lands at the end of the sequence rather than
	// at an arbitrary place decided by a date it may not have.
	const last = await db
		.prepare('SELECT MAX(position) AS n FROM project_milestones WHERE project_id = ?')
		.bind(projectId)
		.first<{ n: number | null }>();

	await db
		.prepare(
			`INSERT INTO project_milestones
       (id, project_id, title, due_date, done_at, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`
		)
		.bind(
			id,
			projectId,
			requiredText(body.title, 'Title', 300),
			optionalDate(body.due_date, 'Due date'),
			Number(last?.n ?? 0) + 1,
			now,
			now
		)
		.run();

	const created = await db
		.prepare('SELECT * FROM project_milestones WHERE id = ?')
		.bind(id)
		.first();
	return c.json({ milestone: created }, 201);
});

projects.patch('/:id/milestones/:milestoneId', async (c) => {
	const db = c.env.DB;
	// Asserted against the project in the path, not looked up by id alone: a
	// real milestone id reached through the wrong project must not be editable.
	// D108.
	const existing = await db
		.prepare('SELECT id, done_at FROM project_milestones WHERE id = ? AND project_id = ?')
		.bind(c.req.param('milestoneId'), c.req.param('id'))
		.first<{ id: string; done_at: string | null }>();
	if (!existing) throw new ApiError(404, 'No milestone with that id on this project.');

	const body = await readJsonObject(c.req.raw);
	const sets: string[] = [];
	const binds: unknown[] = [];

	if (body.title !== undefined) {
		sets.push('title = ?');
		binds.push(requiredText(body.title, 'Title', 300));
	}
	if (body.due_date !== undefined) {
		sets.push('due_date = ?');
		binds.push(optionalDate(body.due_date, 'Due date'));
	}
	if (body.done !== undefined) {
		/**
		 * Marking one done records when, and marking it undone clears the date
		 * rather than keeping a stale one. Toggling twice must leave no trace of
		 * a completion that was withdrawn.
		 */
		sets.push('done_at = ?');
		binds.push(body.done ? (existing.done_at ?? nowUtc()) : null);
	}

	if (sets.length === 0) throw new ApiError(400, 'Nothing to change.');
	sets.push('updated_at = ?');
	binds.push(nowUtc());

	await db
		.prepare(`UPDATE project_milestones SET ${sets.join(', ')} WHERE id = ?`)
		.bind(...binds, existing.id)
		.run();

	const updated = await db
		.prepare('SELECT * FROM project_milestones WHERE id = ?')
		.bind(existing.id)
		.first();
	return c.json({ milestone: updated });
});

projects.delete('/:id/milestones/:milestoneId', async (c) => {
	const result = await c.env.DB.prepare(
		'DELETE FROM project_milestones WHERE id = ? AND project_id = ?'
	)
		.bind(c.req.param('milestoneId'), c.req.param('id'))
		.run();
	if (!result.meta.changes) throw new ApiError(404, 'No milestone with that id on this project.');
	return c.json({ ok: true });
});

/* -------------------------------------------------------------------------
 * Files
 * ---------------------------------------------------------------------- */

/**
 * Twenty-five megabytes, and no type allowlist.
 *
 * Deliberately unlike the contract and receipt routes, which take only what a
 * signed agreement or a receipt can be. A project file is whatever the work
 * produced: a spreadsheet, an export, an archive, a design somebody sent. An
 * allowlist here would refuse the next legitimate format and teach people to
 * put files somewhere else, which is worse than accepting them.
 *
 * Nothing is ever executed or rendered: the read route serves the bytes with
 * the stored content type and a download disposition, so a file is a file.
 */
const MAX_PROJECT_FILE_BYTES = 25 * 1024 * 1024;

projects.get('/:id/files', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT id, project_id, filename, mime_type, size_bytes, uploaded_at
     FROM project_files WHERE project_id = ? ORDER BY uploaded_at DESC`
	)
		.bind(c.req.param('id'))
		.all();
	return c.json({ files: results ?? [] });
});

projects.post('/:id/files', async (c) => {
	const projectId = c.req.param('id');
	const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?')
		.bind(projectId)
		.first();
	if (!project) throw new ApiError(404, 'Project not found.');

	const form = await c.req.formData().catch(() => null);
	const file = form?.get('file');
	if (!(file instanceof File)) throw new ApiError(400, 'Attach a file as the "file" field.');
	if (file.size === 0) throw new ApiError(400, 'That file is empty.');
	if (file.size > MAX_PROJECT_FILE_BYTES) {
		throw new ApiError(413, 'That file is larger than 25 MB.');
	}

	const id = crypto.randomUUID();
	const key = `projects/${projectId}/${id}`;
	const now = nowUtc();
	const mime = file.type || 'application/octet-stream';

	await c.env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: mime } });

	try {
		await c.env.DB.prepare(
			`INSERT INTO project_files
       (id, project_id, filename, mime_type, size_bytes, r2_key, uploaded_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
			.bind(id, projectId, file.name || 'file', mime, file.size, key, now, now)
			.run();
	} catch (err) {
		// The row is the record. If it did not land, the object is unreachable
		// and is removed rather than left as a file nothing points at.
		await c.env.FILES.delete(key).catch(() => {});
		throw err;
	}

	const created = await c.env.DB.prepare(
		`SELECT id, project_id, filename, mime_type, size_bytes, uploaded_at
     FROM project_files WHERE id = ?`
	)
		.bind(id)
		.first();
	return c.json({ file: created }, 201);
});

projects.get('/:id/files/:fileId', async (c) => {
	const row = await c.env.DB.prepare(
		'SELECT r2_key, filename, mime_type FROM project_files WHERE id = ? AND project_id = ?'
	)
		.bind(c.req.param('fileId'), c.req.param('id'))
		.first<{ r2_key: string; filename: string; mime_type: string | null }>();
	if (!row) throw new ApiError(404, 'No file with that id on this project.');

	const object = await c.env.FILES.get(row.r2_key);
	if (!object) throw new ApiError(404, 'That file is recorded but its contents are missing.');

	const bytes = new Uint8Array(await object.arrayBuffer());
	const safe = row.filename.replace(new RegExp('["' + String.fromCharCode(13, 10) + ']', 'g'), '');

	return new Response(bytes.buffer as ArrayBuffer, {
		headers: {
			/**
			 * Always a download, never rendered inline.
			 *
			 * A project file is arbitrary content this app did not produce, and an
			 * HTML or SVG file served inline would run in the app's own origin.
			 * The contract route can afford `inline` because it takes only PDFs,
			 * Word files and images; this one takes anything.
			 */
			'content-type': row.mime_type ?? 'application/octet-stream',
			'content-disposition': `attachment; filename="${safe}"`,
			'x-content-type-options': 'nosniff',
			'cache-control': 'private, no-store'
		}
	});
});

projects.delete('/:id/files/:fileId', async (c) => {
	const row = await c.env.DB.prepare(
		'SELECT r2_key FROM project_files WHERE id = ? AND project_id = ?'
	)
		.bind(c.req.param('fileId'), c.req.param('id'))
		.first<{ r2_key: string }>();
	if (!row) throw new ApiError(404, 'No file with that id on this project.');

	// The row goes first. An object deleted while its row survived would leave a
	// file on screen that cannot be opened.
	await c.env.DB.prepare('DELETE FROM project_files WHERE id = ?')
		.bind(c.req.param('fileId'))
		.run();
	await c.env.FILES.delete(row.r2_key).catch(() => {});
	return c.json({ ok: true });
});
