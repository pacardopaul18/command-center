import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ApiEnv } from './env';
import { nowUtc } from '../dates';
import {
	ApiError,
	oneOf,
	optionalDate,
	optionalText,
	readJsonObject,
	requiredText
} from './validate';
import { SOP_STATUSES } from '$lib/types';
import type { SopStatus } from '$lib/types';

/**
 * SOP library with version history.
 *
 * Three rulings govern this module and are enforced by triggers in migration
 * 0002, not merely by the code here. See D32, D33 and D34.
 *
 *   D32 versions are immutable and undeletable
 *   D33 SOPs archive, never delete. There is deliberately no DELETE route
 *   D34 current_version_id moves forward only. Restore writes a new version
 *
 * The code still validates all three, so a caller gets a clear 400 rather than a
 * raw SQLITE_CONSTRAINT. The triggers are the backstop, not the error message.
 */

const LIST_SELECT = `
  SELECT s.*,
    v.version_number AS current_version_number,
    v.created_at     AS current_version_created_at,
    v.change_note    AS current_change_note,
    (SELECT COUNT(*) FROM sop_versions WHERE sop_id = s.id) AS version_count
  FROM sops s
  LEFT JOIN sop_versions v ON v.id = s.current_version_id
`;

export const sops = new Hono<ApiEnv>();

/** Defaults to active only, so archiving genuinely drops a SOP from the list. */
sops.get('/', async (c) => {
	const rawStatus = c.req.query('status') ?? 'active';
	const status = rawStatus === 'all' ? null : oneOf<SopStatus>(rawStatus, SOP_STATUSES, 'status', 'active');

	const where: string[] = [];
	const binds: unknown[] = [];

	if (status) {
		where.push('s.status = ?');
		binds.push(status);
	}

	const category = c.req.query('category')?.trim();
	if (category) {
		where.push('s.category = ?');
		binds.push(category);
	}

	// Search covers the title, the category and the current version's body, so
	// looking for a step inside an SOP finds the SOP.
	const q = c.req.query('q')?.trim();
	if (q) {
		where.push('(s.title LIKE ? OR s.category LIKE ? OR v.body LIKE ?)');
		const like = `%${q}%`;
		binds.push(like, like, like);
	}

	const { results } = await c.env.DB.prepare(
		`${LIST_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY s.status ASC, s.category COLLATE NOCASE, s.title COLLATE NOCASE`
	)
		.bind(...binds)
		.all();

	const categories = await c.env.DB.prepare(
		`SELECT category, COUNT(*) AS count
     FROM sops
     WHERE category IS NOT NULL AND status = 'active'
     GROUP BY category
     ORDER BY category COLLATE NOCASE`
	).all();

	const counts = await c.env.DB.prepare(
		`SELECT
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived
     FROM sops`
	).first<Record<string, number | null>>();

	return c.json({
		sops: results ?? [],
		categories: categories.results ?? [],
		counts: { active: counts?.active ?? 0, archived: counts?.archived ?? 0 }
	});
});

/**
 * A SOP, its history, and exactly one body.
 *
 * The history panel needs version numbers, dates and change notes, not bodies.
 * Returning every body would ship the SOP's entire revision history to the
 * browser on every page load, which for a long procedure is most of the payload
 * and none of the value. `?version=N` selects which single body comes back;
 * without it, the current one does.
 */
sops.get('/:id', async (c) => {
	const id = c.req.param('id');

	const sop = await c.env.DB.prepare(`${LIST_SELECT} WHERE s.id = ?`)
		.bind(id)
		.first<{ current_version_id: string | null }>();
	if (!sop) throw new ApiError(404, 'SOP not found.');

	const { results } = await c.env.DB.prepare(
		`SELECT id, sop_id, version_number, change_note, author_id, created_at
     FROM sop_versions WHERE sop_id = ? ORDER BY version_number DESC`
	)
		.bind(id)
		.all();

	const requested = c.req.query('version');
	const viewing = requested
		? await c.env.DB.prepare(
				'SELECT * FROM sop_versions WHERE sop_id = ? AND version_number = ?'
			)
				.bind(id, Number(requested))
				.first()
		: await c.env.DB.prepare('SELECT * FROM sop_versions WHERE id = ?')
				.bind(sop.current_version_id)
				.first();

	if (!viewing) throw new ApiError(404, 'Version not found for this SOP.');

	return c.json({ sop, versions: results ?? [], viewing });
});

/**
 * Authoring a SOP writes the record and version 1 together. current_version_id
 * is null for the instant between the two statements, which is why the whole
 * thing goes through a batch: a SOP with no current version is a half-written
 * record, never a valid state at rest.
 */
sops.post('/', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const now = nowUtc();
	const sopId = crypto.randomUUID();
	const versionId = crypto.randomUUID();

	const title = requiredText(body.title, 'Title', 300);
	const versionBody = requiredText(body.body, 'Body', 200_000);
	const category = optionalText(body.category, 'Category', 120);
	const reviewDue = optionalDate(body.review_due, 'Review due');
	const ownerId = optionalText(body.owner_id, 'owner_id', 64);
	const changeNote = optionalText(body.change_note, 'Change note', 500) ?? 'Initial version';

	await c.env.DB.batch([
		c.env.DB.prepare(
			`INSERT INTO sops (id, title, category, current_version_id, owner_id, review_due, status, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, 'active', ?, ?)`
		).bind(sopId, title, category, ownerId, reviewDue, now, now),
		c.env.DB.prepare(
			`INSERT INTO sop_versions (id, sop_id, version_number, body, change_note, author_id, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?)`
		).bind(versionId, sopId, versionBody, changeNote, ownerId, now),
		c.env.DB.prepare('UPDATE sops SET current_version_id = ? WHERE id = ?').bind(versionId, sopId)
	]);

	const created = await c.env.DB.prepare(`${LIST_SELECT} WHERE s.id = ?`).bind(sopId).first();
	return c.json({ sop: created }, 201);
});

/**
 * Metadata only. The body is never edited here, because editing a body means
 * writing a new version. That is the whole point of the module.
 */
const UPDATABLE = ['title', 'category', 'review_due', 'owner_id', 'status'] as const;

sops.patch('/:id', async (c) => {
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw);

	if ('body' in body) {
		throw new ApiError(400, 'Editing a SOP body creates a new version. Post to /versions instead.');
	}
	if ('current_version_id' in body) {
		throw new ApiError(400, 'The current version is set by adding or restoring a version.');
	}

	const existing = await c.env.DB.prepare('SELECT id FROM sops WHERE id = ?').bind(id).first();
	if (!existing) throw new ApiError(404, 'SOP not found.');

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
			case 'category':
				value = optionalText(raw, 'Category', 120);
				break;
			case 'review_due':
				value = optionalDate(raw, 'Review due');
				break;
			case 'status':
				value = oneOf<SopStatus>(raw, SOP_STATUSES, 'status', 'active');
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

	await c.env.DB.prepare(`UPDATE sops SET ${sets.join(', ')} WHERE id = ?`)
		.bind(...binds)
		.run();

	const updated = await c.env.DB.prepare(`${LIST_SELECT} WHERE s.id = ?`).bind(id).first();
	return c.json({ sop: updated });
});

/** Editing a SOP means adding a version. Nothing rewrites what came before. */
sops.post('/:id/versions', async (c) => {
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw);
	return addVersion(
		c,
		id,
		requiredText(body.body, 'Body', 200_000),
		optionalText(body.change_note, 'Change note', 500),
		optionalText(body.author_id, 'author_id', 64)
	);
});

/**
 * Restore carries an old body forward as a new version. It never repoints the
 * SOP at an earlier row, so history stays linear and nothing is lost. D34.
 */
sops.post('/:id/versions/:versionId/restore', async (c) => {
	const id = c.req.param('id');
	const versionId = c.req.param('versionId');

	const source = await c.env.DB.prepare(
		'SELECT body, version_number FROM sop_versions WHERE id = ? AND sop_id = ?'
	)
		.bind(versionId, id)
		.first<{ body: string; version_number: number }>();
	if (!source) throw new ApiError(404, 'Version not found for this SOP.');

	const body = await readJsonObject(c.req.raw).catch(() => ({}) as Record<string, unknown>);
	const note =
		optionalText(body.change_note, 'Change note', 500) ??
		`Restored the content of version ${source.version_number}`;

	return addVersion(c, id, source.body, note, optionalText(body.author_id, 'author_id', 64));
});

async function addVersion(
	c: Context<ApiEnv>,
	sopId: string,
	body: string,
	changeNote: string | null,
	authorId: string | null
) {
	const sop = await c.env.DB.prepare('SELECT id, status FROM sops WHERE id = ?')
		.bind(sopId)
		.first<{ id: string; status: SopStatus }>();
	if (!sop) throw new ApiError(404, 'SOP not found.');
	if (sop.status === 'archived') {
		throw new ApiError(400, 'This SOP is archived. Restore it to active before editing.');
	}

	const latest = await c.env.DB.prepare(
		'SELECT MAX(version_number) AS n FROM sop_versions WHERE sop_id = ?'
	)
		.bind(sopId)
		.first<{ n: number | null }>();

	const nextNumber = (latest?.n ?? 0) + 1;
	const versionId = crypto.randomUUID();
	const now = nowUtc();

	await c.env.DB.batch([
		c.env.DB.prepare(
			`INSERT INTO sop_versions (id, sop_id, version_number, body, change_note, author_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
		).bind(versionId, sopId, nextNumber, body, changeNote, authorId, now),
		c.env.DB.prepare('UPDATE sops SET current_version_id = ?, updated_at = ? WHERE id = ?').bind(
			versionId,
			now,
			sopId
		)
	]);

	const updated = await c.env.DB.prepare(`${LIST_SELECT} WHERE s.id = ?`).bind(sopId).first();
	return c.json({ sop: updated, version_number: nextNumber }, 201);
}

// D33. There is deliberately no DELETE route. Archiving is the only way to
// retire a SOP, and it is reversible.
