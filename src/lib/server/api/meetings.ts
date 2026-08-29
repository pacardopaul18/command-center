import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { nowUtc } from '../dates';
import { ApiError, optionalDate, optionalText, readJsonObject, requiredText } from './validate';
import { meetingAi } from './meeting-ai';

/**
 * Meetings, with transcript import.
 *
 * A transcript lives in two places on purpose. The file goes to R2 under
 * transcript_ref, because it is the artefact and may be large. The text also
 * goes to D1 under transcript_text, because search has to work without a round
 * trip to object storage for every meeting.
 *
 * Nothing here calls an AI. Summary and extraction are the next step and are
 * kept separate so that importing a transcript never silently spends money or
 * produces content nobody asked for.
 */

const LIST_SELECT = `
  SELECT m.id, m.client_id, m.project_id, m.title, m.meeting_date, m.attendees,
         m.recording_url, m.transcript_ref, m.summary, m.summary_reviewed_at,
         m.created_at, m.updated_at,
         cl.name AS client_name,
         p.name  AS project_name,
         CASE WHEN m.transcript_text IS NULL THEN 0 ELSE LENGTH(m.transcript_text) END AS transcript_chars,
         (SELECT COUNT(*) FROM action_items WHERE meeting_id = m.id) AS action_item_count
  FROM meetings m
  LEFT JOIN clients cl ON cl.id = m.client_id
  LEFT JOIN projects p ON p.id = m.project_id
`;

/** R2 keys are namespaced by meeting so a listing is browsable. */
function transcriptKey(meetingId: string): string {
	return `transcripts/${meetingId}.txt`;
}

export const meetings = new Hono<ApiEnv>();

// Summary, extraction and proposal review live in their own module because the
// human-in-the-loop rules are the whole substance of them. See meeting-ai.ts.
meetings.route('/', meetingAi);

/**
 * The list never returns transcript_text. A meetings log with ten transcripts
 * would otherwise ship a megabyte of prose to render a table of ten rows, the
 * same mistake caught on the SOP detail screen.
 */
meetings.get('/', async (c) => {
	const where: string[] = [];
	const binds: unknown[] = [];

	const projectId = c.req.query('project_id');
	if (projectId) {
		where.push('m.project_id = ?');
		binds.push(projectId);
	}

	const q = c.req.query('q')?.trim();
	if (q) {
		where.push('(m.title LIKE ? OR m.attendees LIKE ? OR m.transcript_text LIKE ?)');
		const like = `%${q}%`;
		binds.push(like, like, like);
	}

	const { results } = await c.env.DB.prepare(
		`${LIST_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY m.meeting_date DESC, m.created_at DESC`
	)
		.bind(...binds)
		.all();

	return c.json({ meetings: results ?? [] });
});

meetings.get('/:id', async (c) => {
	const id = c.req.param('id');

	const meeting = await c.env.DB.prepare(`${LIST_SELECT} WHERE m.id = ?`).bind(id).first();
	if (!meeting) throw new ApiError(404, 'Meeting not found.');

	const items = await c.env.DB.prepare(
		`SELECT * FROM action_items WHERE meeting_id = ?
     ORDER BY CASE WHEN status = 'done' THEN 1 ELSE 0 END,
              CASE WHEN deadline IS NULL THEN 1 ELSE 0 END,
              deadline ASC, created_at ASC`
	)
		.bind(id)
		.all();

	return c.json({ meeting, action_items: items.results ?? [] });
});

/** The transcript text, fetched only when it is actually going to be read. */
meetings.get('/:id/transcript', async (c) => {
	const row = await c.env.DB.prepare(
		'SELECT transcript_text, transcript_ref FROM meetings WHERE id = ?'
	)
		.bind(c.req.param('id'))
		.first<{ transcript_text: string | null; transcript_ref: string | null }>();
	if (!row) throw new ApiError(404, 'Meeting not found.');
	return c.json({ text: row.transcript_text, ref: row.transcript_ref });
});

meetings.post('/', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const now = nowUtc();
	const id = crypto.randomUUID();

	const meetingDate = optionalDate(body.meeting_date, 'Meeting date');
	if (!meetingDate) throw new ApiError(400, 'A meeting needs a date.');

	try {
		await c.env.DB.prepare(
			`INSERT INTO meetings
         (id, client_id, project_id, title, meeting_date, attendees, recording_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
			.bind(
				id,
				optionalText(body.client_id, 'client_id', 64),
				optionalText(body.project_id, 'project_id', 64),
				requiredText(body.title, 'Title', 300),
				meetingDate,
				optionalText(body.attendees, 'Attendees', 1000),
				optionalText(body.recording_url, 'Recording link', 1000),
				now,
				now
			)
			.run();
	} catch (err) {
		if (String(err).includes('FOREIGN KEY')) {
			throw new ApiError(400, 'That client or project does not exist.');
		}
		throw err;
	}

	const created = await c.env.DB.prepare(`${LIST_SELECT} WHERE m.id = ?`).bind(id).first();
	return c.json({ meeting: created }, 201);
});

const UPDATABLE = [
	'title',
	'client_id',
	'project_id',
	'meeting_date',
	'attendees',
	'recording_url',
	'summary'
] as const;

meetings.patch('/:id', async (c) => {
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw);

	const existing = await c.env.DB.prepare('SELECT id FROM meetings WHERE id = ?').bind(id).first();
	if (!existing) throw new ApiError(404, 'Meeting not found.');

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
			case 'meeting_date':
				value = optionalDate(raw, 'Meeting date');
				if (!value) throw new ApiError(400, 'A meeting needs a date.');
				break;
			case 'attendees':
				value = optionalText(raw, 'Attendees', 1000);
				break;
			case 'recording_url':
				value = optionalText(raw, 'Recording link', 1000);
				break;
			case 'summary':
				value = optionalText(raw, 'Summary', 100_000);
				break;
			default:
				value = optionalText(raw, field, 64);
		}

		sets.push(`${field} = ?`);
		binds.push(value);
	}

	// Editing the summary by hand is itself a review, so it clears the pending
	// state rather than leaving a human-edited summary flagged as unreviewed.
	if ('summary' in body) {
		sets.push('summary_reviewed_at = ?');
		binds.push(nowUtc());
	}

	if (sets.length === 0) throw new ApiError(400, 'Nothing to update.');

	sets.push('updated_at = ?');
	binds.push(nowUtc());
	binds.push(id);

	try {
		await c.env.DB.prepare(`UPDATE meetings SET ${sets.join(', ')} WHERE id = ?`)
			.bind(...binds)
			.run();
	} catch (err) {
		if (String(err).includes('FOREIGN KEY')) {
			throw new ApiError(400, 'That client or project does not exist.');
		}
		throw err;
	}

	const updated = await c.env.DB.prepare(`${LIST_SELECT} WHERE m.id = ?`).bind(id).first();
	return c.json({ meeting: updated });
});

/**
 * Transcript import. Accepts the raw text as the request body so a paste and a
 * file upload are the same code path.
 *
 * R2 first, then D1. If R2 fails nothing is recorded, which is the honest
 * outcome: a transcript_ref pointing at an object that does not exist would be
 * worse than no import at all.
 */
meetings.put('/:id/transcript', async (c) => {
	const id = c.req.param('id');

	const meeting = await c.env.DB.prepare('SELECT id FROM meetings WHERE id = ?').bind(id).first();
	if (!meeting) throw new ApiError(404, 'Meeting not found.');

	const text = await c.req.text();
	if (!text || text.trim().length === 0) {
		throw new ApiError(400, 'The transcript is empty.');
	}
	// D1 rows have a practical ceiling and a transcript this large is a sign
	// something other than a transcript was pasted.
	if (text.length > 800_000) {
		throw new ApiError(413, 'That transcript is too large. Split it by agenda topic and import each part.');
	}

	const key = transcriptKey(id);
	await c.env.FILES.put(key, text, {
		httpMetadata: { contentType: 'text/plain; charset=utf-8' },
		customMetadata: { meeting_id: id, imported_at: nowUtc() }
	});

	await c.env.DB.prepare(
		'UPDATE meetings SET transcript_ref = ?, transcript_text = ?, updated_at = ? WHERE id = ?'
	)
		.bind(key, text, nowUtc(), id)
		.run();

	const updated = await c.env.DB.prepare(`${LIST_SELECT} WHERE m.id = ?`).bind(id).first();
	return c.json({ meeting: updated, transcript_ref: key, characters: text.length });
});
