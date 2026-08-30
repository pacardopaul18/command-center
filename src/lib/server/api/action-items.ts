import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { ACTION_SOURCES, ACTION_STATUSES, ACTION_VIEWS } from '$lib/types';
import type { ActionSource, ActionStatus, ActionView } from '$lib/types';
import { nowUtc, todayInWorkingZone } from '../dates';
import { createTask, effectiveAssignee, readSettings } from '../asana';
import { asApiError } from './asana';
import {
	ApiError,
	oneOf,
	optionalDate,
	optionalText,
	readJsonObject,
	requiredText
} from './validate';

// Every read joins the project so a row can link back to its project in one click.
const SELECT = `
  SELECT a.*, p.name AS project_name
  FROM action_items a
  LEFT JOIN projects p ON p.id = a.project_id
`;

/**
 * SQL for each saved view. "Open" means anything still live, which includes
 * waiting, blocked and ambiguous, because all of them can still slip.
 */
function viewClause(view: ActionView, today: string): { sql: string; binds: unknown[] } {
	switch (view) {
		case 'open':
			return { sql: "a.status != 'done'", binds: [] };
		case 'overdue':
			return {
				sql: "a.status != 'done' AND a.deadline IS NOT NULL AND a.deadline < ?",
				binds: [today]
			};
		case 'today':
			return { sql: "a.status != 'done' AND a.deadline = ?", binds: [today] };
		case 'waiting':
			return { sql: "a.status = 'waiting'", binds: [] };
		case 'done':
			return { sql: "a.status = 'done'", binds: [] };
		case 'all':
		default:
			return { sql: '1 = 1', binds: [] };
	}
}

// Live items first, then nearest deadline, undated last, newest first as the tie break.
const ORDER_BY = `
  ORDER BY
    CASE WHEN a.status = 'done' THEN 1 ELSE 0 END,
    CASE WHEN a.deadline IS NULL THEN 1 ELSE 0 END,
    a.deadline ASC,
    a.created_at DESC
`;

/**
 * Page sizes the UI offers. Anything else is rejected rather than silently
 * clamped, so a caller asking for 5000 rows learns that it did not happen.
 */
export const PAGE_SIZES = [10, 50, 100, 200, 500] as const;
export const DEFAULT_PAGE_SIZE = 50;

export function readPaging(c: { req: { query(name: string): string | undefined } }): {
	page: number;
	pageSize: number;
} {
	const rawSize = c.req.query('page_size');
	let pageSize: number = DEFAULT_PAGE_SIZE;
	if (rawSize !== undefined) {
		const n = Number(rawSize);
		if (!(PAGE_SIZES as readonly number[]).includes(n)) {
			throw new ApiError(400, `page_size must be one of ${PAGE_SIZES.join(', ')}.`);
		}
		pageSize = n;
	}

	const rawPage = c.req.query('page');
	let page = 1;
	if (rawPage !== undefined) {
		const n = Number(rawPage);
		if (!Number.isInteger(n) || n < 1) throw new ApiError(400, 'page must be a positive whole number.');
		page = n;
	}

	return { page, pageSize };
}

export const actionItems = new Hono<ApiEnv>();

actionItems.get('/', async (c) => {
	const db = c.env.DB;
	const today = todayInWorkingZone();

	const rawView = c.req.query('view') ?? 'open';
	const view: ActionView = (ACTION_VIEWS as readonly string[]).includes(rawView)
		? (rawView as ActionView)
		: 'open';

	const where: string[] = [];
	const binds: unknown[] = [];

	const clause = viewClause(view, today);
	where.push(clause.sql);
	binds.push(...clause.binds);

	// Filters that scope both the list and the chip counts. The list query joins
	// projects so it needs the "a." prefix; the counts query does not.
	const scoped: { list: string; counts: string }[] = [];
	const scopedBinds: unknown[] = [];

	const projectId = c.req.query('project_id');
	if (projectId) {
		scoped.push({ list: 'a.project_id = ?', counts: 'project_id = ?' });
		scopedBinds.push(projectId);
	}

	const q = c.req.query('q')?.trim();
	if (q) {
		scoped.push({
			list: '(a.title LIKE ? OR a.context LIKE ? OR a.owner LIKE ?)',
			counts: '(title LIKE ? OR context LIKE ? OR owner LIKE ?)'
		});
		const like = `%${q}%`;
		scopedBinds.push(like, like, like);
	}

	for (const fragment of scoped) where.push(fragment.list);
	binds.push(...scopedBinds);

	// Pagination. Profiled before it was built, and the profile moved the target:
	// 3000 rows is a 1.2 MB payload, but it renders as 9.3 MB of HTML across
	// 130,000 DOM nodes, because D22's two layouts put every row in the document
	// twice. The payload was the smaller half of the problem. Limiting rows fixes
	// both halves at once, which is why this is the performance fix as well as
	// the usability one.
	const { page, pageSize } = readPaging(c);

	const totalRow = await db
		.prepare(`SELECT COUNT(*) AS n FROM action_items a WHERE ${where.join(' AND ')}`)
		.bind(...binds)
		.first<{ n: number }>();
	const total = Number(totalRow?.n ?? 0);
	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	// A filter change can leave the caller past the end. Clamp rather than
	// return an empty page, which reads as "no results" and is a different claim.
	const safePage = Math.min(page, pageCount);

	const { results } = await db
		.prepare(`${SELECT} WHERE ${where.join(' AND ')} ${ORDER_BY} LIMIT ? OFFSET ?`)
		.bind(...binds, pageSize, (safePage - 1) * pageSize)
		.all();

	// The counts feed the filter chips, so they ignore the active view but keep
	// the project and search scope.
	const scopeSql = scoped.length
		? `WHERE ${scoped.map((fragment) => fragment.counts).join(' AND ')}`
		: '';
	const counts = await db
		.prepare(
			`SELECT
         COUNT(*) AS all_count,
         SUM(CASE WHEN status != 'done' THEN 1 ELSE 0 END) AS open_count,
         SUM(CASE WHEN status != 'done' AND deadline IS NOT NULL AND deadline < ?1 THEN 1 ELSE 0 END) AS overdue_count,
         SUM(CASE WHEN status != 'done' AND deadline = ?1 THEN 1 ELSE 0 END) AS today_count,
         SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) AS waiting_count,
         SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done_count
       FROM action_items ${scopeSql}`
		)
		.bind(today, ...scopedBinds)
		.first<Record<string, number | null>>();

	return c.json({
		today,
		view,
		items: results ?? [],
		paging: { page: safePage, page_size: pageSize, total, page_count: pageCount, sizes: PAGE_SIZES },
		counts: {
			all: counts?.all_count ?? 0,
			open: counts?.open_count ?? 0,
			overdue: counts?.overdue_count ?? 0,
			today: counts?.today_count ?? 0,
			waiting: counts?.waiting_count ?? 0,
			done: counts?.done_count ?? 0
		}
	});
});

actionItems.get('/:id', async (c) => {
	const row = await c.env.DB.prepare(`${SELECT} WHERE a.id = ?`).bind(c.req.param('id')).first();
	if (!row) throw new ApiError(404, 'Action item not found.');
	return c.json({ item: row });
});

actionItems.post('/', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const now = nowUtc();
	const id = crypto.randomUUID();

	const status = oneOf<ActionStatus>(body.status, ACTION_STATUSES, 'status', 'open');
	const source = oneOf<ActionSource>(body.source, ACTION_SOURCES, 'source', 'manual');

	await c.env.DB.prepare(
		`INSERT INTO action_items
       (id, title, context, owner, owner_id, deadline, status, source,
        meeting_id, project_id, asana_task_gid, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	)
		.bind(
			id,
			requiredText(body.title, 'Title', 300),
			optionalText(body.context, 'Context', 4000),
			optionalText(body.owner, 'Owner', 200),
			optionalText(body.owner_id, 'owner_id', 64),
			optionalDate(body.deadline, 'Deadline'),
			status,
			source,
			optionalText(body.meeting_id, 'meeting_id', 64),
			optionalText(body.project_id, 'project_id', 64),
			optionalText(body.asana_task_gid, 'asana_task_gid', 64),
			now,
			now,
			status === 'done' ? now : null
		)
		.run();

	const created = await c.env.DB.prepare(`${SELECT} WHERE a.id = ?`).bind(id).first();
	return c.json({ item: created }, 201);
});

// Only the fields present in the body are written, so the edit form and the
// one-click "mark done" button can share this route.
const UPDATABLE = [
	'title',
	'context',
	'owner',
	'owner_id',
	'deadline',
	'status',
	'source',
	'meeting_id',
	'project_id',
	'asana_task_gid'
] as const;

actionItems.patch('/:id', async (c) => {
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw);

	const existing = await c.env.DB.prepare('SELECT status FROM action_items WHERE id = ?')
		.bind(id)
		.first<{ status: ActionStatus }>();
	if (!existing) throw new ApiError(404, 'Action item not found.');

	const sets: string[] = [];
	const binds: unknown[] = [];

	for (const field of UPDATABLE) {
		if (!(field in body)) continue;
		const raw = body[field];
		let value: string | null;

		switch (field) {
			case 'title':
				value = requiredText(raw, 'Title', 300);
				break;
			case 'deadline':
				value = optionalDate(raw, 'Deadline');
				break;
			case 'status':
				value = oneOf<ActionStatus>(raw, ACTION_STATUSES, 'status', 'open');
				break;
			case 'source':
				value = oneOf<ActionSource>(raw, ACTION_SOURCES, 'source', 'manual');
				break;
			case 'context':
				value = optionalText(raw, 'Context', 4000);
				break;
			case 'owner':
				value = optionalText(raw, 'Owner', 200);
				break;
			default:
				value = optionalText(raw, field, 64);
		}

		sets.push(`${field} = ?`);
		binds.push(value);
	}

	if (sets.length === 0) throw new ApiError(400, 'Nothing to update.');

	const now = nowUtc();
	sets.push('updated_at = ?');
	binds.push(now);

	// completed_at follows the status transition in both directions so the
	// completion report can measure time to resolution later.
	if ('status' in body) {
		const next = oneOf<ActionStatus>(body.status, ACTION_STATUSES, 'status', 'open');
		if (next === 'done' && existing.status !== 'done') {
			sets.push('completed_at = ?');
			binds.push(now);
		} else if (next !== 'done' && existing.status === 'done') {
			sets.push('completed_at = NULL');
		}
	}

	binds.push(id);
	await c.env.DB.prepare(`UPDATE action_items SET ${sets.join(', ')} WHERE id = ?`)
		.bind(...binds)
		.run();

	const updated = await c.env.DB.prepare(`${SELECT} WHERE a.id = ?`).bind(id).first();
	return c.json({ item: updated });
});

actionItems.delete('/:id', async (c) => {
	const result = await c.env.DB.prepare('DELETE FROM action_items WHERE id = ?')
		.bind(c.req.param('id'))
		.run();
	if (!result.meta.changes) throw new ApiError(404, 'Action item not found.');
	return c.json({ ok: true });
});

/**
 * Pushes one action item to Asana, per D4.
 *
 * Three properties this route exists to hold:
 *
 * **Explicit, per item.** There is no hook on create, no hook on extraction
 * acceptance, and no batch endpoint. Asana is the firm's shared system of
 * record, and a personal capture tool that silently posts into it would put
 * Paul's half-formed notes in front of the partners. A push happens because he
 * clicked push on that item.
 *
 * **Never blocks local tracking.** This route only ever writes
 * `asana_task_gid`, and only after Asana has accepted the task. Every failure
 * path returns before touching D1, so a broken token, a deleted workspace or an
 * Asana outage leaves the item exactly as it was and the command center keeps
 * working. That is the same rule the digests follow with their sent marker.
 *
 * **Legible failure.** Every distinct cause gets its own sentence naming what to
 * do about it, and Asana's own message rides along when it had one, because on
 * a 400 it names the offending field better than any wording here could.
 *
 * Pushing twice is a 409 rather than a second task. Asana has no idea the two
 * would be duplicates, so nothing but this check prevents them.
 */
actionItems.post('/:id/asana', async (c) => {
	const id = c.req.param('id');

	const item = await c.env.DB.prepare(
		`SELECT a.id, a.title, a.context, a.owner, a.deadline, a.status, a.asana_task_gid,
            p.name AS project_name, m.title AS meeting_title
     FROM action_items a
     LEFT JOIN projects p ON p.id = a.project_id
     LEFT JOIN meetings m ON m.id = a.meeting_id
     WHERE a.id = ?`
	)
		.bind(id)
		.first<{
			id: string;
			title: string;
			context: string | null;
			owner: string | null;
			deadline: string | null;
			status: ActionStatus;
			asana_task_gid: string | null;
			project_name: string | null;
			meeting_title: string | null;
		}>();

	if (!item) throw new ApiError(404, 'Action item not found.');

	if (item.asana_task_gid) {
		throw new ApiError(
			409,
			`This item is already in Asana as task ${item.asana_task_gid}. Pushing again would create a duplicate.`
		);
	}

	const token = c.env.ASANA_TOKEN;
	if (!token) {
		throw new ApiError(
			503,
			'No Asana token is configured. Set it with `wrangler secret put ASANA_TOKEN`.'
		);
	}

	const settings = await readSettings(c.env.SESSIONS);
	if (!settings.workspace_gid) {
		throw new ApiError(
			400,
			'No Asana workspace has been chosen. Pick one on the Asana settings screen first.'
		);
	}

	// The notes carry the provenance. An item that arrives in the partners'
	// Asana with no context is a task somebody has to come back and ask about.
	const notes = [
		item.context?.trim() || null,
		item.project_name ? `Project: ${item.project_name}` : null,
		item.meeting_title ? `From meeting: ${item.meeting_title}` : null,
		item.owner ? `Owner as captured: ${item.owner}` : null,
		'Pushed from Command Center.'
	]
		.filter(Boolean)
		.join('\n\n');

	let created;
	try {
		created = await createTask(token, {
			name: item.title,
			notes,
			dueOn: item.deadline,
			workspaceGid: settings.workspace_gid,
			projectGid: settings.project_gid,
			// Never null. See DEFAULT_ASSIGNEE and D-asana-1: an unassigned task
			// does not appear in My Tasks and is invisible in normal use.
			assignee: effectiveAssignee(settings)
		});
	} catch (err) {
		// Nothing has been written at this point and nothing will be.
		throw asApiError(err);
	}

	await c.env.DB.prepare('UPDATE action_items SET asana_task_gid = ?, updated_at = ? WHERE id = ?')
		.bind(created.gid, nowUtc(), id)
		.run();

	const updated = await c.env.DB.prepare(`${SELECT} WHERE a.id = ?`).bind(id).first();

	// Logged because the response is the only place this has ever existed. D4
	// stores the gid and nothing else, so whether Asana returned its own
	// permalink was visible once, in a notice on screen, and then gone. Workers
	// Logs is enabled now, so the next push records it where it can be read back
	// three days later instead of depending on somebody having noticed.
	console.log(
		`asana push: item=${id} gid=${created.gid} ` +
			`url_from_asana=${created.url_from_asana} ` +
			`assignee=${effectiveAssignee(settings)} ` +
			`project=${settings.project_gid ?? 'none'}`
	);

	return c.json({
		item: updated,
		asana: {
			gid: created.gid,
			url: created.url,
			// Reported so a live push settles whether Asana returns a permalink,
			// which the docs were truncated on. See the note in asana.ts.
			url_from_asana: created.url_from_asana,
			// Echoed back so the UI can say where the task landed. A task with no
			// project is harder to find even when it is assigned.
			assignee: effectiveAssignee(settings),
			project_gid: settings.project_gid,
			project_name: settings.project_name
		}
	});
});
