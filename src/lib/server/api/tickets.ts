import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { nowUtc } from '../dates';
import { ApiError, oneOf, optionalDate, optionalText, readJsonObject, requiredText } from './validate';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '$lib/types';
import type { TicketPriority, TicketStatus } from '$lib/types';

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
    CASE WHEN t.status IN ('done','cancelled') THEN 1 ELSE 0 END,
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
		where.push("t.status NOT IN ('done','cancelled')");
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

	return c.json({ ticket, entries: entries.results ?? [] });
});

/** Fields a caller may set, on create and on patch alike. */
const WRITABLE = [
	'title',
	'description',
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
		case 'description':
			return optionalText(raw, 'Description', 8000);
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
const FINISHED: readonly string[] = ['done', 'cancelled'];

tickets.post('/', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const id = crypto.randomUUID();
	const now = nowUtc();

	const projectId = requiredText(body.project_id, 'Project', 64);
	const status = oneOf<TicketStatus>(body.status, TICKET_STATUSES, 'status', 'open');

	try {
		await c.env.DB.prepare(
			`INSERT INTO tickets
         (id, project_id, title, description, start_date, due_date, estimate_hours,
          status, priority, assignee, reporter, completed_at,
          converted_from_action_item_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
			.bind(
				id,
				projectId,
				readField('title', body.title),
				readField('description', body.description),
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
