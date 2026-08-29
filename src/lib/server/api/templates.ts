import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { nowUtc } from '../dates';
import { ApiError, oneOf, optionalText, readJsonObject, requiredText } from './validate';
import { AiError, draftFromTemplate } from '../ai';
import { TEMPLATE_STATUSES, TEMPLATE_TYPES } from '$lib/types';
import type { TemplateStatus, TemplateType } from '$lib/types';

/**
 * Templates, and AI drafting from them.
 *
 * The architecture's goal for this module is to reduce what reaches the partners
 * by answering lower-complexity requests in their voice. That only works if the
 * draft sounds like Paul and not like a model, which is why the template body is
 * passed as an exemplar to imitate rather than as instructions to follow.
 *
 * Drafting returns a draft. It does not store one, does not send anything, and
 * does not modify the template. Every draft goes past a human before it goes
 * anywhere, for the same reason meeting extraction produces proposals: this is
 * client-facing writing, and the cost of a confident wrong one is high.
 */

export const templates = new Hono<ApiEnv>();

templates.get('/', async (c) => {
	const raw = c.req.query('status') ?? 'active';
	const status =
		raw === 'all' ? null : oneOf<TemplateStatus>(raw, TEMPLATE_STATUSES, 'status', 'active');

	const where: string[] = [];
	const binds: unknown[] = [];

	if (status) {
		where.push('status = ?');
		binds.push(status);
	}

	const type = c.req.query('type');
	if (type) {
		where.push('type = ?');
		binds.push(oneOf<TemplateType>(type, TEMPLATE_TYPES, 'type', 'email'));
	}

	const q = c.req.query('q')?.trim();
	if (q) {
		where.push('(name LIKE ? OR scenario LIKE ? OR body LIKE ?)');
		const like = `%${q}%`;
		binds.push(like, like, like);
	}

	// The list carries the body, unlike SOPs and meetings. A template body is a
	// short reply pattern, not a transcript or a procedure, and the library is
	// only useful if you can see what each one actually says.
	const { results } = await c.env.DB.prepare(
		`SELECT * FROM templates ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY type, name COLLATE NOCASE`
	)
		.bind(...binds)
		.all();

	const counts = await c.env.DB.prepare(
		`SELECT
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived
     FROM templates`
	).first<Record<string, number | null>>();

	return c.json({
		templates: results ?? [],
		counts: { active: counts?.active ?? 0, archived: counts?.archived ?? 0 },
		status: raw
	});
});

templates.post('/', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const now = nowUtc();
	const id = crypto.randomUUID();

	await c.env.DB.prepare(
		`INSERT INTO templates (id, name, scenario, body, type, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
	)
		.bind(
			id,
			requiredText(body.name, 'Name', 200),
			optionalText(body.scenario, 'Scenario', 500),
			requiredText(body.body, 'Body', 20_000),
			oneOf<TemplateType>(body.type, TEMPLATE_TYPES, 'type', 'email'),
			now,
			now
		)
		.run();

	const created = await c.env.DB.prepare('SELECT * FROM templates WHERE id = ?').bind(id).first();
	return c.json({ template: created }, 201);
});

const UPDATABLE = ['name', 'scenario', 'body', 'type', 'status'] as const;

templates.patch('/:id', async (c) => {
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw);

	const existing = await c.env.DB.prepare('SELECT id FROM templates WHERE id = ?')
		.bind(id)
		.first();
	if (!existing) throw new ApiError(404, 'Template not found.');

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
			case 'body':
				value = requiredText(raw, 'Body', 20_000);
				break;
			case 'scenario':
				value = optionalText(raw, 'Scenario', 500);
				break;
			case 'type':
				value = oneOf<TemplateType>(raw, TEMPLATE_TYPES, 'type', 'email');
				break;
			default:
				value = oneOf<TemplateStatus>(raw, TEMPLATE_STATUSES, 'status', 'active');
		}

		sets.push(`${field} = ?`);
		binds.push(value);
	}

	if (sets.length === 0) throw new ApiError(400, 'Nothing to update.');

	sets.push('updated_at = ?');
	binds.push(nowUtc());
	binds.push(id);

	await c.env.DB.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ?`)
		.bind(...binds)
		.run();

	const updated = await c.env.DB.prepare('SELECT * FROM templates WHERE id = ?').bind(id).first();
	return c.json({ template: updated });
});

/**
 * Drafts a reply from a template.
 *
 * Returns the draft. Stores nothing, sends nothing, changes nothing. The caller
 * reads it, edits it, and copies it out.
 */
templates.post('/:id/draft', async (c) => {
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw);

	const template = await c.env.DB.prepare(
		'SELECT name, scenario, body, type, status FROM templates WHERE id = ?'
	)
		.bind(id)
		.first<{
			name: string;
			scenario: string | null;
			body: string;
			type: TemplateType;
			status: TemplateStatus;
		}>();

	if (!template) throw new ApiError(404, 'Template not found.');
	if (template.status === 'archived') {
		throw new ApiError(400, 'This template is archived. Restore it to active before drafting.');
	}

	const situation = requiredText(body.situation, 'Situation', 8000);

	const key = c.env.ANTHROPIC_API_KEY;
	if (!key) {
		throw new ApiError(
			503,
			'No Anthropic API key is configured. Set it with `wrangler secret put ANTHROPIC_API_KEY`.'
		);
	}

	try {
		const { draft, model } = await draftFromTemplate(key, {
			templateName: template.name,
			scenario: template.scenario,
			exemplar: template.body,
			type: template.type,
			situation,
			recipient: optionalText(body.recipient, 'Recipient', 200) ?? undefined
		});
		return c.json({ draft, model, template_id: id });
	} catch (err) {
		if (err instanceof AiError) throw new ApiError(err.status, err.message);
		throw err;
	}
});
