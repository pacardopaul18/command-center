import type { D1Database } from '@cloudflare/workers-types';
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
	/**
	 * Use is counted, never stored on the template.
	 *
	 * A counter column is a number maintained by hand, and a number maintained
	 * by hand eventually disagrees with reality with no way to check it. These
	 * are subqueries over `template_uses`, so they are recomputed on every read
	 * and cannot be wrong. Migration 0028.
	 */
	const { results } = await c.env.DB.prepare(
		`SELECT t.*,
        (SELECT COUNT(*) FROM template_uses u WHERE u.template_id = t.id) AS use_count,
        (SELECT MAX(created_at) FROM template_uses u WHERE u.template_id = t.id) AS last_used_at
     FROM templates t ${where.length ? `WHERE ${where.map((w) => `t.${w}`).join(' AND ')}` : ''}
     ORDER BY t.type, t.name COLLATE NOCASE`
	)
		.bind(...binds)
		.all();

	const counts = await c.env.DB.prepare(
		`SELECT
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived,
       SUM(CASE WHEN status = 'active' AND type = 'email' THEN 1 ELSE 0 END) AS email,
       SUM(CASE WHEN status = 'active' AND type = 'doc' THEN 1 ELSE 0 END) AS doc
     FROM templates`
	).first<Record<string, number | null>>();

	/**
	 * Drafts this month, and the template used most, both over every template
	 * rather than over the filtered list. A headline that changed when you
	 * pressed a tab would be describing the tab, not the library.
	 */
	const since = new Date();
	since.setUTCDate(1);
	const monthStart = `${since.toISOString().slice(0, 8)}01T00:00:00Z`;

	const drafted = await c.env.DB.prepare(
		'SELECT COUNT(*) AS n FROM template_uses WHERE created_at >= ?'
	)
		.bind(monthStart)
		.first<{ n: number }>();

	const mostUsed = await c.env.DB.prepare(
		`SELECT t.id, t.name, COUNT(u.id) AS uses
     FROM templates t JOIN template_uses u ON u.template_id = t.id
     GROUP BY t.id ORDER BY uses DESC, t.name COLLATE NOCASE LIMIT 1`
	).first<{ id: string; name: string; uses: number }>();

	return c.json({
		templates: results ?? [],
		counts: {
			active: counts?.active ?? 0,
			archived: counts?.archived ?? 0,
			email: counts?.email ?? 0,
			doc: counts?.doc ?? 0
		},
		drafted_this_month: Number(drafted?.n ?? 0),
		most_used: mostUsed ?? null,
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
/**
 * Records that a template was used, without recording what it produced.
 *
 * A generated draft is client-facing writing that nobody has read yet, and
 * keeping every one would make this table a silent archive of unreviewed text
 * in Paul's voice. The length says whether generation worked; the context says
 * what it was for. D158.
 */
async function recordUse(
	db: D1Database,
	templateId: string,
	context: string | null,
	chars: number | null,
	model: string | null
) {
	await db
		.prepare(
			`INSERT INTO template_uses (id, template_id, context, drafted_chars, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
		)
		.bind(
			crypto.randomUUID(),
			templateId,
			// One line, so the list reads. A whole situation pasted in would make
			// this column a transcript.
			context ? context.slice(0, 200) : null,
			chars,
			model,
			nowUtc()
		)
		.run();
}

/**
 * Copying is a use too, and is recorded as one.
 *
 * Without it the Most used tile answers a narrower question than it appears to:
 * "most drafted by the model", on a library where the common action is to copy
 * the text and edit it by hand. No model, no draft length, because neither
 * happened.
 */
templates.post('/:id/used', async (c) => {
	const id = c.req.param('id');
	const exists = await c.env.DB.prepare('SELECT id FROM templates WHERE id = ?').bind(id).first();
	if (!exists) throw new ApiError(404, 'Template not found.');

	const body = await readJsonObject(c.req.raw).catch(() => ({}) as Record<string, unknown>);
	await recordUse(c.env.DB, id, optionalText(body.context, 'context', 200), null, null);
	return c.json({ ok: true }, 201);
});

/** What a template has been used for lately, newest first. */
templates.get('/:id/uses', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT id, context, drafted_chars, model, created_at
     FROM template_uses WHERE template_id = ? ORDER BY created_at DESC LIMIT 20`
	)
		.bind(c.req.param('id'))
		.all();
	return c.json({ uses: results ?? [] });
});

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
		await recordUse(c.env.DB, id, situation, draft.length, model);
		return c.json({ draft, model, template_id: id });
	} catch (err) {
		if (err instanceof AiError) throw new ApiError(err.status, err.message);
		throw err;
	}
});
