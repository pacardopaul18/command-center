import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { nowUtc } from '../dates';
import { ApiError, oneOf, optionalDate, optionalText, readJsonObject, requiredText } from './validate';

// Stage 1 only needs enough of Projects for an action item to be linked to one.
// The full five-phase Projects module lands in the MVP stage.
const PHASES = ['initiating', 'planning', 'executing', 'monitoring', 'closing'] as const;
const STATUSES = ['on_track', 'at_risk', 'blocked', 'done'] as const;

export const projects = new Hono<ApiEnv>();

projects.get('/', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT p.*, SUM(CASE WHEN a.id IS NOT NULL AND a.status != 'done' THEN 1 ELSE 0 END) AS open_action_items
     FROM projects p
     LEFT JOIN action_items a ON a.project_id = p.id
     GROUP BY p.id
     ORDER BY CASE WHEN p.status = 'done' THEN 1 ELSE 0 END, p.name COLLATE NOCASE`
	).all();
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
			oneOf(body.phase, PHASES, 'phase', 'initiating'),
			oneOf(body.status, STATUSES, 'status', 'on_track'),
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

projects.get('/:id', async (c) => {
	const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?')
		.bind(c.req.param('id'))
		.first();
	if (!project) throw new ApiError(404, 'Project not found.');
	return c.json({ project });
});
