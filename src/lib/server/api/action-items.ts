import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { ACTION_SOURCES, ACTION_STATUSES, ACTION_VIEWS } from '$lib/types';
import type { ActionSource, ActionStatus, ActionView } from '$lib/types';
import { nowUtc, todayInWorkingZone } from '../dates';
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

	const { results } = await db
		.prepare(`${SELECT} WHERE ${where.join(' AND ')} ${ORDER_BY}`)
		.bind(...binds)
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
