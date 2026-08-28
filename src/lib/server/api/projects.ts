import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { nowUtc, todayInWorkingZone } from '../dates';
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

// Rolls the linked action items up onto every project row, so the list can show
// what is actually outstanding without a second request per project.
const LIST_SELECT = `
  SELECT p.*,
    SUM(CASE WHEN a.id IS NOT NULL AND a.status != 'done' THEN 1 ELSE 0 END) AS open_action_items,
    SUM(CASE WHEN a.id IS NOT NULL AND a.status != 'done'
             AND a.deadline IS NOT NULL AND a.deadline < ?1 THEN 1 ELSE 0 END) AS overdue_action_items
  FROM projects p
  LEFT JOIN action_items a ON a.project_id = p.id
  GROUP BY p.id
`;

projects.get('/', async (c) => {
	const { results } = await c.env.DB.prepare(
		`${LIST_SELECT}
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
	return c.json({ projects: results ?? [] });
});

projects.post('/', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const now = nowUtc();
	const id = crypto.randomUUID();

	await c.env.DB.prepare(
		`INSERT INTO projects
       (id, client_id, name, phase, status, owner_id, start_date, target_close,
        next_milestone, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
			optionalText(body.description, 'Description', 4000),
			now,
			now
		)
		.run();

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

	return c.json({ project, action_items: results ?? [] });
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
	'next_milestone',
	'description'
] as const;

projects.patch('/:id', async (c) => {
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw);

	const existing = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
	if (!existing) throw new ApiError(404, 'Project not found.');

	const sets: string[] = [];
	const binds: unknown[] = [];

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
			case 'description':
				value = optionalText(raw, 'Description', 4000);
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

	await c.env.DB.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`)
		.bind(...binds)
		.run();

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
