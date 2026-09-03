import type { D1Database } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { nowUtc, todayInWorkingZone } from '../dates';
import { ApiError, oneOf, optionalDate, optionalText, readJsonObject, requiredText } from './validate';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '$lib/types';
import type { TicketPriority, TicketStatus } from '$lib/types';
import { FINISHED_TICKET_STATUSES, finishedTicket, openTicket } from '../ticket-state';
import { mentionsRichField, readRichField } from '../rich-field';

/**
 * Tickets: the worked unit under a project.
 *
 * Action items stay the capture layer, a thing written down in ten seconds
 * during a call. A ticket is what one becomes when somebody is going to work
 * it. They are deliberately different shapes rather than one table with
 * optional columns, which is the entity fork PM confirmed.
 *
 * Actual hours are never stored. They are summed from `time_entries` through
 * `ticket_id`, so the estimate and the actual cannot disagree with each other.
 * A stored actual is a second copy of a number that already exists somewhere,
 * and second copies drift.
 */

export const tickets = new Hono<ApiEnv>();

/**
 * Every read joins the project and sums the time booked against the ticket, so
 * a row can show estimate against actual without a second query per ticket.
 */
const SELECT = `
  SELECT t.*,
    p.name AS project_name,
    p.client_id AS client_id,
    cl.name AS client_name,
    COALESCE((SELECT ROUND(SUM(te.hours), 2) FROM time_entries te WHERE te.ticket_id = t.id), 0)
      AS actual_hours,
    COALESCE((SELECT SUM(te.hours * te.rate_cents) FROM time_entries te
               WHERE te.ticket_id = t.id AND te.rate_cents IS NOT NULL), 0)
      AS computed_value_cents,
    (SELECT COUNT(*) FROM time_entries te WHERE te.ticket_id = t.id) AS entry_count
  FROM tickets t
  JOIN projects p ON p.id = t.project_id
  LEFT JOIN clients cl ON cl.id = p.client_id
`;

/** Live first, then soonest due, undated last, newest as the tie break. */
const ORDER_BY = `
  ORDER BY
    CASE WHEN ${finishedTicket()} THEN 1 ELSE 0 END,
    CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
    t.due_date ASC,
    CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
    t.created_at DESC
`;

/**
 * Database rules surfaced as caller mistakes rather than server faults, so the
 * screen names the rule that was broken. Same treatment Invoicing already has.
 */
function asClientError(err: unknown): unknown {
	const text = String(err);
	if (text.includes('due_date >= start_date')) {
		return new ApiError(400, 'The due date cannot be before the start date.');
	}
	if (text.includes('estimate_hours')) {
		return new ApiError(400, 'The estimate must be greater than zero, or left empty.');
	}
	if (text.includes('completed_at')) {
		return new ApiError(
			400,
			'A finished ticket must record when it finished, and an unfinished one must not.'
		);
	}
	if (text.includes('FOREIGN KEY constraint failed')) {
		return new ApiError(400, 'That project, user or action item does not exist.');
	}
	// By column, not by index name: SQLite never names a partial unique index in
	// the violation message, so the obvious matcher is silently dead code. The
	// convert route checks first and returns its own 409, so this is only the
	// backstop for two conversions racing each other. It was worth fixing anyway,
	// because a backstop that cannot fire is not a backstop.
	if (text.includes('UNIQUE constraint failed: tickets.converted_from_action_item_id')) {
		return new ApiError(409, 'That action item has already been converted to a ticket.');
	}
	return err;
}

tickets.get('/', async (c) => {
	const where: string[] = [];
	const binds: unknown[] = [];

	const projectId = c.req.query('project_id');
	if (projectId) {
		where.push('t.project_id = ?');
		binds.push(projectId);
	}

	const status = c.req.query('status');
	if (status && status !== 'all') {
		where.push('t.status = ?');
		binds.push(oneOf<TicketStatus>(status, TICKET_STATUSES, 'status', 'open'));
	} else if (!status) {
		// The default view is work that is still live. Finished tickets are
		// reachable, they are just not what the screen is for.
		where.push(openTicket());
	}

	const q = c.req.query('q')?.trim();
	if (q) {
		where.push('(t.title LIKE ? OR t.description LIKE ? OR t.assignee LIKE ?)');
		const like = `%${q}%`;
		binds.push(like, like, like);
	}

	const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
	const { results } = await c.env.DB.prepare(`${SELECT} ${clause} ${ORDER_BY}`)
		.bind(...binds)
		.all();

	const counts = await c.env.DB.prepare(
		`SELECT status, COUNT(*) AS n FROM tickets ${projectId ? 'WHERE project_id = ?' : ''} GROUP BY status`
	)
		.bind(...(projectId ? [projectId] : []))
		.all<{ status: string; n: number }>();

	return c.json({
		tickets: results ?? [],
		counts: Object.fromEntries((counts.results ?? []).map((r) => [r.status, Number(r.n)]))
	});
});

tickets.get('/:id', async (c) => {
	const id = c.req.param('id');
	const ticket = await c.env.DB.prepare(`${SELECT} WHERE t.id = ?`).bind(id).first();
	if (!ticket) throw new ApiError(404, 'Ticket not found.');

	const entries = await c.env.DB.prepare(
		`SELECT te.*, p.name AS project_name FROM time_entries te
     LEFT JOIN projects p ON p.id = te.project_id
     WHERE te.ticket_id = ? ORDER BY te.entry_date DESC`
	)
		.bind(id)
		.all();

	/*
	 * Where this ticket came from, and what Asana calls its status.
	 *
	 * The section name is the verbatim provenance. The app's own status is
	 * coarse on purpose, because Asana's real vocabulary is 103 section names
	 * across 66 projects and mapping those now would be guessing the answer
	 * Thursday's reconciliation exists to ask. Showing both puts the guess next
	 * to the fact rather than in place of it. D171.
	 */
	const source = await c.env.DB.prepare(
		`SELECT l.asana_gid, l.linked_at, t.section_name, t.completed,
            t.modified_at AS source_modified_at, u.name AS asana_assignee
     FROM asana_task_links l
     JOIN asana_tasks t ON t.gid = l.asana_gid
     LEFT JOIN asana_users u ON u.gid = t.assignee_gid
     WHERE l.ticket_id = ?`
	)
		.bind(id)
		.first();

	/*
	 * The activity trail: Asana's stories, which are comments and system events.
	 *
	 * Deliberately not projected into action items. Ten thousand comments are
	 * not ten thousand commitments, and putting them there would bury the one
	 * screen that says what Paul owes people. Read straight from the mirror, so
	 * a re-pull updates the trail with nothing to reconcile.
	 */
	const activity = source
		? await c.env.DB.prepare(
				`SELECT s.gid, s.created_at, s.type, s.text, u.name AS author
         FROM asana_stories s
         LEFT JOIN asana_users u ON u.gid = s.created_by_gid
         WHERE s.task_gid = ?
         ORDER BY s.created_at DESC
         LIMIT 200`
			)
				.bind((source as { asana_gid: string }).asana_gid)
				.all()
		: { results: [] };

	/** Subtasks, through the parent table the projection writes. */
	const subtasks = await c.env.DB.prepare(
		`SELECT t.id, t.title, t.status, t.due_date, t.assignee
     FROM ticket_parents tp
     JOIN tickets t ON t.id = tp.child_ticket_id
     WHERE tp.parent_ticket_id = ?
     ORDER BY t.title COLLATE NOCASE`
	)
		.bind(id)
		.all();

	const parent = await c.env.DB.prepare(
		`SELECT t.id, t.title FROM ticket_parents tp
     JOIN tickets t ON t.id = tp.parent_ticket_id
     WHERE tp.child_ticket_id = ?`
	)
		.bind(id)
		.first();

	/** Everything migration 0038 gave a home to, read back for the detail view. */
	const tags = await c.env.DB.prepare(
		'SELECT tag, source FROM ticket_tags WHERE ticket_id = ? ORDER BY tag'
	)
		.bind(id)
		.all();

	const followers = await c.env.DB.prepare(
		'SELECT name, person_gid, source FROM ticket_followers WHERE ticket_id = ? ORDER BY name'
	)
		.bind(id)
		.all();

	const customValues = await c.env.DB.prepare(
		`SELECT field_gid, field_name, field_type, display_value
     FROM ticket_custom_values WHERE ticket_id = ? ORDER BY field_name`
	)
		.bind(id)
		.all();

	return c.json({
		ticket,
		entries: entries.results ?? [],
		tags: tags.results ?? [],
		followers: followers.results ?? [],
		custom_values: customValues.results ?? [],
		today: todayInWorkingZone(),
		source: source ?? null,
		mirrored: Boolean(source),
		activity: activity.results ?? [],
		subtasks: subtasks.results ?? [],
		parent: parent ?? null
	});
});

/** Fields a caller may set, on create and on patch alike. */
const WRITABLE = [
	'title',
	'start_date',
	'due_date',
	'estimate_hours',
	'status',
	'priority',
	'assignee',
	'reporter'
] as const;

function readField(field: (typeof WRITABLE)[number], raw: unknown): string | number | null {
	switch (field) {
		case 'title':
			return requiredText(raw, 'Title', 300);
		case 'start_date':
			return optionalDate(raw, 'Start date');
		case 'due_date':
			return optionalDate(raw, 'Due date');
		case 'estimate_hours': {
			if (raw === null || raw === undefined || raw === '') return null;
			const n = Number(raw);
			if (!Number.isFinite(n) || n <= 0) {
				throw new ApiError(400, 'The estimate must be a number greater than zero.');
			}
			return n;
		}
		case 'status':
			return oneOf<TicketStatus>(raw, TICKET_STATUSES, 'status', 'open');
		case 'priority':
			return oneOf<TicketPriority>(raw, TICKET_PRIORITIES, 'priority', 'normal');
		default:
			return optionalText(raw, field, 200);
	}
}

/** Finished statuses carry a timestamp; unfinished ones must not. */
const FINISHED: readonly string[] = FINISHED_TICKET_STATUSES;

tickets.post('/', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const id = crypto.randomUUID();
	const now = nowUtc();

	const projectId = requiredText(body.project_id, 'Project', 64);
	const status = oneOf<TicketStatus>(body.status, TICKET_STATUSES, 'status', 'open');
	// One call produces both columns, so the markup and the text search reads
	// can never say different things about the same description.
	const description = readRichField(body, 'description', 'Description');

	try {
		await c.env.DB.prepare(
			`INSERT INTO tickets
         (id, project_id, title, description, description_html, start_date, due_date,
          estimate_hours, status, priority, assignee, reporter, completed_at,
          converted_from_action_item_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
			.bind(
				id,
				projectId,
				readField('title', body.title),
				description.plain,
				description.html,
				readField('start_date', body.start_date),
				readField('due_date', body.due_date),
				readField('estimate_hours', body.estimate_hours),
				status,
				readField('priority', body.priority),
				readField('assignee', body.assignee),
				readField('reporter', body.reporter),
				FINISHED.includes(status) ? now : null,
				optionalText(body.converted_from_action_item_id, 'action item', 64),
				now,
				now
			)
			.run();
	} catch (err) {
		throw asClientError(err);
	}

	const created = await c.env.DB.prepare(`${SELECT} WHERE t.id = ?`).bind(id).first();
	return c.json({ ticket: created }, 201);
});

tickets.patch('/:id', async (c) => {
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw);

	const existing = await c.env.DB.prepare('SELECT status FROM tickets WHERE id = ?')
		.bind(id)
		.first<{ status: string }>();
	if (!existing) throw new ApiError(404, 'Ticket not found.');

	const sets: string[] = [];
	const binds: unknown[] = [];

	for (const field of WRITABLE) {
		if (!(field in body)) continue;
		sets.push(`${field} = ?`);
		binds.push(readField(field, body[field]));
	}

	// The description writes two columns from one value. Left out of the loop
	// above rather than special cased inside it, because a field that sets two
	// columns does not fit a builder whose whole shape is one name, one bind.
	if (mentionsRichField(body, 'description')) {
		const description = readRichField(body, 'description', 'Description');
		sets.push('description = ?', 'description_html = ?');
		binds.push(description.plain, description.html);
	}

	if (sets.length === 0) throw new ApiError(400, 'Nothing to update.');

	const now = nowUtc();
	sets.push('updated_at = ?');
	binds.push(now);

	// completed_at follows the status in both directions, because the database
	// requires them to agree and a caller should not have to know that.
	if ('status' in body) {
		const next = oneOf<TicketStatus>(body.status, TICKET_STATUSES, 'status', 'open');
		const wasFinished = FINISHED.includes(existing.status);
		const isFinished = FINISHED.includes(next);
		if (isFinished && !wasFinished) {
			sets.push('completed_at = ?');
			binds.push(now);
		} else if (!isFinished && wasFinished) {
			sets.push('completed_at = NULL');
		}
	}

	binds.push(id);

	try {
		await c.env.DB.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`)
			.bind(...binds)
			.run();
	} catch (err) {
		throw asClientError(err);
	}

	const updated = await c.env.DB.prepare(`${SELECT} WHERE t.id = ?`).bind(id).first();

	/**
	 * The change is written to the ticket's history after the row is updated,
	 * never before. A history line describing an update that then failed would
	 * be a record of something that did not happen, which is worse than no
	 * record at all.
	 *
	 * Only the fields somebody reading the ticket would want explained. A
	 * description edit is not news; a status change, a reassignment or a moved
	 * deadline is exactly what the question "why is this still open" is about.
	 */
	if ('status' in body && body.status !== existing.status) {
		await logTicket(
			c.env.DB,
			id,
			'status',
			`Status changed from ${existing.status} to ${body.status}.`
		);
	}
	if ('priority' in body) {
		await logTicket(c.env.DB, id, 'priority', `Priority set to ${body.priority}.`);
	}
	if ('assignee' in body) {
		await logTicket(
			c.env.DB,
			id,
			'assignee',
			body.assignee ? `Assigned to ${body.assignee}.` : 'Unassigned.'
		);
	}
	if ('due_date' in body) {
		await logTicket(
			c.env.DB,
			id,
			'due',
			body.due_date ? `Due date moved to ${body.due_date}.` : 'Due date cleared.'
		);
	}

	return c.json({ ticket: updated });
});

/**
 * Converts an action item into a ticket.
 *
 * One direction only, and once. The link is stored on the ticket, which makes
 * it queryable both ways from a single column; a matching column on the action
 * item would be a copy that can fall out of step. A second attempt is a 409
 * rather than a second ticket, for the same reason the Asana push refuses a
 * second push: one commitment, one worked unit.
 *
 * The action item is left alone. It is the record that the commitment was made,
 * and deleting or closing it here would destroy the capture history to tidy up
 * a list.
 */
tickets.post('/convert/:actionItemId', async (c) => {
	const actionItemId = c.req.param('actionItemId');
	const body = await readJsonObject(c.req.raw).catch(() => ({}) as Record<string, unknown>);

	const item = await c.env.DB.prepare(
		'SELECT id, title, context, owner, deadline, project_id FROM action_items WHERE id = ?'
	)
		.bind(actionItemId)
		.first<{
			id: string;
			title: string;
			context: string | null;
			owner: string | null;
			deadline: string | null;
			project_id: string | null;
		}>();
	if (!item) throw new ApiError(404, 'Action item not found.');

	const already = await c.env.DB.prepare(
		'SELECT id FROM tickets WHERE converted_from_action_item_id = ?'
	)
		.bind(actionItemId)
		.first<{ id: string }>();
	if (already) {
		throw new ApiError(409, `That action item is already ticket ${already.id}.`);
	}

	// A ticket needs a project and an action item may not have one, so the caller
	// supplies it when the item cannot.
	const projectId = optionalText(body.project_id, 'Project', 64) ?? item.project_id;
	if (!projectId) {
		throw new ApiError(
			400,
			'This action item has no project, and a ticket must belong to one. Choose a project.'
		);
	}

	const id = crypto.randomUUID();
	const now = nowUtc();

	try {
		await c.env.DB.prepare(
			`INSERT INTO tickets
         (id, project_id, title, description, due_date, status, priority,
          assignee, converted_from_action_item_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`
		)
			.bind(
				id,
				projectId,
				item.title,
				item.context,
				item.deadline,
				oneOf<TicketPriority>(body.priority, TICKET_PRIORITIES, 'priority', 'normal'),
				item.owner,
				actionItemId,
				now,
				now
			)
			.run();
	} catch (err) {
		throw asClientError(err);
	}

	const created = await c.env.DB.prepare(`${SELECT} WHERE t.id = ?`).bind(id).first();
	return c.json({ ticket: created }, 201);
});

/**
 * Deletes a ticket.
 *
 * `cancelled` is for work that will not be done and is part of the record.
 * Delete is for a row that should never have existed. Time already booked
 * against it is not destroyed: `time_entries.ticket_id` is ON DELETE SET NULL,
 * so the hours survive and simply stop pointing at a ticket. Losing recorded
 * time to tidy a list would be the worse outcome by far.
 */
tickets.delete('/:id', async (c) => {
	const result = await c.env.DB.prepare('DELETE FROM tickets WHERE id = ?')
		.bind(c.req.param('id'))
		.run();
	if (!result.meta.changes) throw new ApiError(404, 'Ticket not found.');
	return c.json({ ok: true });
});

/* -------------------------------------------------------------------------
 * What happened on a ticket: comments, links and time
 * ---------------------------------------------------------------------- */

/**
 * Records a line on a ticket's history.
 *
 * One table for a person's comment and for the app's own note about a status
 * change, because on screen they are one list read in one order. Two tables
 * would mean merging by timestamp in the Worker to rebuild the thing the reader
 * was always going to see.
 */
async function logTicket(
	db: D1Database,
	ticketId: string,
	kind: string,
	detail: string,
	author: string | null = null
) {
	await db
		.prepare(
			`INSERT INTO ticket_events (id, ticket_id, kind, detail, author, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
		)
		.bind(crypto.randomUUID(), ticketId, kind, detail, author, nowUtc())
		.run();
}

tickets.get('/:id/events', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT id, kind, detail, author, created_at FROM ticket_events
     WHERE ticket_id = ? ORDER BY created_at ASC, id ASC`
	)
		.bind(c.req.param('id'))
		.all();
	return c.json({ events: results ?? [] });
});

tickets.post('/:id/events', async (c) => {
	const id = c.req.param('id');
	const exists = await c.env.DB.prepare('SELECT id FROM tickets WHERE id = ?').bind(id).first();
	if (!exists) throw new ApiError(404, 'Ticket not found.');

	const body = await readJsonObject(c.req.raw);
	// Only comments are accepted through the door. Every other kind is written
	// by the code that made the change, and a route that let a caller post a
	// 'status' line would let the history claim something that never happened.
	await logTicket(
		c.env.DB,
		id,
		'comment',
		requiredText(body.detail, 'Comment', 4000),
		optionalText(body.author, 'author', 120)
	);
	return c.json({ ok: true }, 201);
});

/**
 * Links, read in both directions from rows stored in one.
 *
 * A row saying A blocks B is the same fact as B is blocked by A. Writing both
 * would mean two rows that can be deleted separately and disagree, so the read
 * looks the other way as well and inverts the kind. Arithmetic, not storage.
 */
const INVERSE: Record<string, string> = {
	blocks: 'is blocked by',
	relates: 'relates to',
	duplicates: 'is duplicated by'
};

const FORWARD: Record<string, string> = {
	blocks: 'blocks',
	relates: 'relates to',
	duplicates: 'duplicates'
};

tickets.get('/:id/links', async (c) => {
	const id = c.req.param('id');

	const { results } = await c.env.DB.prepare(
		`SELECT l.id, l.kind, 'forward' AS direction, t.id AS other_id, t.title, t.status, t.priority
     FROM ticket_links l JOIN tickets t ON t.id = l.to_ticket_id
     WHERE l.from_ticket_id = ?1
     UNION ALL
     SELECT l.id, l.kind, 'reverse' AS direction, t.id AS other_id, t.title, t.status, t.priority
     FROM ticket_links l JOIN tickets t ON t.id = l.from_ticket_id
     WHERE l.to_ticket_id = ?1
     ORDER BY title COLLATE NOCASE`
	)
		.bind(id)
		.all<{ kind: string; direction: string }>();

	const links = (results ?? []).map((row) => ({
		...row,
		relation: row.direction === 'forward' ? FORWARD[row.kind] : INVERSE[row.kind]
	}));

	return c.json({ links });
});

tickets.post('/:id/links', async (c) => {
	const db = c.env.DB;
	const from = c.req.param('id');
	const body = await readJsonObject(c.req.raw);
	const to = requiredText(body.to_ticket_id, 'to_ticket_id', 64);
	const kind = oneOf<'blocks' | 'relates' | 'duplicates'>(
		body.kind,
		['blocks', 'relates', 'duplicates'],
		'kind',
		'relates'
	);

	if (from === to) throw new ApiError(400, 'A ticket cannot be linked to itself.');

	for (const id of [from, to]) {
		const exists = await db.prepare('SELECT id FROM tickets WHERE id = ?').bind(id).first();
		if (!exists) throw new ApiError(404, 'One of those tickets does not exist.');
	}

	/**
	 * A link in either direction already means these two are related, so a
	 * second one is refused by name rather than by a constraint. The unique
	 * index covers one ordered pair; this covers the other.
	 */
	const already = await db
		.prepare(
			`SELECT id FROM ticket_links
       WHERE (from_ticket_id = ?1 AND to_ticket_id = ?2)
          OR (from_ticket_id = ?2 AND to_ticket_id = ?1)`
		)
		.bind(from, to)
		.first();
	if (already) throw new ApiError(409, 'Those two tickets are already linked.');

	await db
		.prepare(
			`INSERT INTO ticket_links (id, from_ticket_id, to_ticket_id, kind, created_at)
       VALUES (?, ?, ?, ?, ?)`
		)
		.bind(crypto.randomUUID(), from, to, kind, nowUtc())
		.run();

	const other = await db
		.prepare('SELECT title FROM tickets WHERE id = ?')
		.bind(to)
		.first<{ title: string }>();
	await logTicket(db, from, 'linked', `Linked: ${FORWARD[kind]} "${other?.title ?? to}".`);

	return c.json({ ok: true }, 201);
});

tickets.delete('/:id/links/:linkId', async (c) => {
	// Removable from either end, because the link belongs to both tickets and a
	// reader looking at the reverse view has no idea which row is the stored one.
	const result = await c.env.DB.prepare(
		`DELETE FROM ticket_links
     WHERE id = ?1 AND (from_ticket_id = ?2 OR to_ticket_id = ?2)`
	)
		.bind(c.req.param('linkId'), c.req.param('id'))
		.run();
	if (!result.meta.changes) throw new ApiError(404, 'No link with that id on this ticket.');
	return c.json({ ok: true });
});

/* -------------------------------------------------------------------------
 * Time
 * ---------------------------------------------------------------------- */

/**
 * Effort against a ticket, which is not billable time.
 *
 * `time_entries` is time against a client and a billing period and feeds an
 * invoice. This answers a different question for a different reader: not "what
 * do we bill" but "what did this actually take". Merging them would mean every
 * logged hour needing a client and a rate before anyone could record that a bug
 * took an afternoon.
 *
 * Stored in minutes. Hours as a float means 0.1 + 0.2 and a total ending in
 * 0.30000000000000004, and rounding for display hides the drift rather than
 * removing it. The same argument money makes for cents.
 */
tickets.get('/:id/time', async (c) => {
	const db = c.env.DB;
	const id = c.req.param('id');

	const { results } = await db
		.prepare(
			`SELECT id, minutes, logged_on, who, note, created_at FROM ticket_time
       WHERE ticket_id = ? ORDER BY logged_on DESC, created_at DESC`
		)
		.bind(id)
		.all();

	const total = await db
		.prepare('SELECT COALESCE(SUM(minutes), 0) AS n FROM ticket_time WHERE ticket_id = ?')
		.bind(id)
		.first<{ n: number }>();

	return c.json({ entries: results ?? [], total_minutes: Number(total?.n ?? 0) });
});

tickets.post('/:id/time', async (c) => {
	const db = c.env.DB;
	const id = c.req.param('id');
	const ticket = await db
		.prepare('SELECT id, title FROM tickets WHERE id = ?')
		.bind(id)
		.first<{ id: string; title: string }>();
	if (!ticket) throw new ApiError(404, 'Ticket not found.');

	const body = await readJsonObject(c.req.raw);

	/**
	 * Accepted as hours and stored as minutes, because hours is what a person
	 * has. The conversion rounds once, here, rather than at every read.
	 */
	const hours = Number(requiredText(body.hours, 'Hours', 12));
	if (!Number.isFinite(hours) || hours <= 0) {
		throw new ApiError(400, 'Hours must be a positive number, like 1.5.');
	}
	if (hours > 24) throw new ApiError(400, 'That is more than a day. Log it as separate entries.');

	const minutes = Math.round(hours * 60);
	if (minutes < 1) throw new ApiError(400, 'That rounds to no time at all.');

	const loggedOn = optionalDate(body.logged_on, 'Logged on') ?? todayInWorkingZone();
	const who = optionalText(body.who, 'who', 120);

	await db
		.prepare(
			`INSERT INTO ticket_time (id, ticket_id, minutes, logged_on, who, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			crypto.randomUUID(),
			id,
			minutes,
			loggedOn,
			who,
			optionalText(body.note, 'note', 500),
			nowUtc()
		)
		.run();

	await logTicket(
		db,
		id,
		'time',
		`${(minutes / 60).toFixed(2).replace(/\.?0+$/, '')} hours logged for ${loggedOn}.`,
		who
	);

	const total = await db
		.prepare('SELECT COALESCE(SUM(minutes), 0) AS n FROM ticket_time WHERE ticket_id = ?')
		.bind(id)
		.first<{ n: number }>();

	return c.json({ ok: true, total_minutes: Number(total?.n ?? 0) }, 201);
});

tickets.delete('/:id/time/:entryId', async (c) => {
	const result = await c.env.DB.prepare(
		'DELETE FROM ticket_time WHERE id = ? AND ticket_id = ?'
	)
		.bind(c.req.param('entryId'), c.req.param('id'))
		.run();
	if (!result.meta.changes) throw new ApiError(404, 'No time entry with that id on this ticket.');
	return c.json({ ok: true });
});
