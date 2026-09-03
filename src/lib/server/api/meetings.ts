import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { nowUtc, todayInWorkingZone } from '../dates';
import { ApiError, optionalDate, optionalText, readJsonObject, requiredText } from './validate';
import { meetingAi } from './meeting-ai';
import { PAGE_SIZES, readPaging } from './action-items';
import { resolveAccount } from '../accounts';
import { getSettings } from '../settings';

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
         m.recording_url, m.notes, m.transcript_ref, m.summary, m.summary_reviewed_at,
         m.created_at, m.updated_at,
         cl.name AS client_name,
         p.name  AS project_name,
         CASE WHEN m.transcript_text IS NULL THEN 0 ELSE LENGTH(m.transcript_text) END AS transcript_chars,
         (SELECT COUNT(*) FROM action_items WHERE meeting_id = m.id) AS action_item_count
  FROM meetings m
  LEFT JOIN clients cl ON cl.id = m.client_id
  LEFT JOIN projects p ON p.id = m.project_id
`;

/**
 * Which tab a meeting sits under, expressed once.
 *
 * The redesign's three states are not stored anywhere and must not be: they are
 * a reading of two columns that already exist, and a `state` column would be a
 * fourth place the truth lives. Same argument as aging on an invoice, D144.
 *
 * The order is by what is left to do, and getting it wrong was the first
 * version of this: asking about the transcript first filed every meeting whose
 * summary Paul had already read under "needs a transcript", because a summary
 * can be written by hand and four hundred and fifty of them were. A record
 * whose summary has been reviewed is finished with, whatever route it took to
 * get there, and whether a transcript exists is a separate fact the Details
 * panel already states.
 */
const STATE_SQL = `
  CASE
    WHEN m.summary_reviewed_at IS NOT NULL THEN 'reviewed'
    WHEN m.summary IS NOT NULL AND LENGTH(m.summary) > 0 THEN 'to_review'
    ELSE 'needs_transcript'
  END
`;

const VIEWS = ['all', 'needs_transcript', 'to_review', 'reviewed'] as const;
type MeetingView = (typeof VIEWS)[number];

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
	/**
	 * This week means Monday to Sunday of the week containing today, on the
	 * firm's clock. Not "the last seven days": a reader looking at a tile
	 * labelled THIS WEEK on a Friday means the week they are in, and a rolling
	 * window would put last Saturday in it.
	 */
	const today = todayInWorkingZone();
	const anchor = new Date(`${today}T00:00:00Z`);

	/**
	 * Which day the week starts on is a setting, because a Sunday start moves
	 * what "this week" means by a day at both ends. It is not cosmetic: the
	 * count on the tile is a different number.
	 */
	const settings = await getSettings(c.env.SESSIONS);
	const offset = settings.week_starts_on === 'sunday' ? 0 : 1;

	const first = new Date(anchor);
	first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() - offset + 7) % 7));
	const last = new Date(first);
	last.setUTCDate(last.getUTCDate() + 6);
	const weekStart = first.toISOString().slice(0, 10);
	const weekEnd = last.toISOString().slice(0, 10);

	/**
	 * The narrowing every query shares, kept apart from the tab.
	 *
	 * The counts under the tabs are computed over this and not over the tab, so
	 * the two sets of conditions have to be separable. Building one array and
	 * then trying to subtract the last condition from it is the version of this
	 * that breaks the day a second condition is added after the tab.
	 */
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

	/**
	 * The tab, applied after the search rather than instead of it.
	 *
	 * Both narrow the same list, and a filter that quietly replaced the search
	 * would make the tabs look broken to anyone who typed first.
	 */
	const askedView = c.req.query('view') ?? 'all';
	const view: MeetingView = (VIEWS as readonly string[]).includes(askedView)
		? (askedView as MeetingView)
		: 'all';
	const listWhere = view === 'all' ? where : [...where, `${STATE_SQL} = ?`];
	const listBinds = view === 'all' ? binds : [...binds, view];

	/**
	 * Paged, because the log is every call ever held.
	 *
	 * It was unpaged and rendered four hundred and fifty rows into a card. That
	 * is not a list anyone reads; it is a list that hides the tabs above it
	 * behind a scrollbar and makes the page slow on a phone.
	 */
	const { page, pageSize } = readPaging(c);
	const listClause = listWhere.length ? `WHERE ${listWhere.join(' AND ')}` : '';

	const totalRow = await c.env.DB.prepare(
		`SELECT COUNT(*) AS n FROM meetings m
     LEFT JOIN clients cl ON cl.id = m.client_id
     LEFT JOIN projects p ON p.id = m.project_id
     ${listClause}`
	)
		.bind(...listBinds)
		.first<{ n: number }>();

	const total = Number(totalRow?.n ?? 0);
	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	// A page beyond the end is corrected rather than answered with nothing: a
	// reader who narrows a filter while on page nine should land on the last
	// page, not on a blank one.
	const safePage = Math.min(page, pageCount);

	const { results } = await c.env.DB.prepare(
		`${LIST_SELECT} ${listClause}
     ORDER BY m.meeting_date DESC, m.created_at DESC
     LIMIT ? OFFSET ?`
	)
		.bind(...listBinds, pageSize, (safePage - 1) * pageSize)
		.all();

	/**
	 * The counts are computed over the search, not over the tab.
	 *
	 * A tab labelled with the number of rows it would show is only useful if the
	 * number is right before you press it. Counting the filtered list would make
	 * every tab read the same number as the one you are already on.
	 */
	const counts = await c.env.DB.prepare(
		`SELECT
       COUNT(*) AS all_meetings,
       SUM(CASE WHEN ${STATE_SQL} = 'needs_transcript' THEN 1 ELSE 0 END) AS needs_transcript,
       SUM(CASE WHEN ${STATE_SQL} = 'to_review' THEN 1 ELSE 0 END) AS to_review,
       SUM(CASE WHEN ${STATE_SQL} = 'reviewed' THEN 1 ELSE 0 END) AS reviewed,
       SUM(CASE WHEN m.meeting_date >= ? AND m.meeting_date <= ? THEN 1 ELSE 0 END) AS this_week,
       SUM(CASE WHEN m.meeting_date = ? THEN 1 ELSE 0 END) AS today
     FROM meetings m
     LEFT JOIN clients cl ON cl.id = m.client_id
     LEFT JOIN projects p ON p.id = m.project_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`
	)
		.bind(weekStart, weekEnd, today, ...binds)
		.first<Record<string, number>>();

	/**
	 * Items raised by meetings this week, counted from the items rather than
	 * from the meetings. A meeting held last week that produced an item on
	 * Monday belongs in this week's number, because the number is about what
	 * landed on Paul, not about when the call happened.
	 */
	const fromMeetings = await c.env.DB.prepare(
		`SELECT COUNT(*) AS n FROM action_items
     WHERE meeting_id IS NOT NULL AND created_at >= ?`
	)
		.bind(`${weekStart}T00:00:00Z`)
		.first<{ n: number }>();

	return c.json({
		meetings: results ?? [],
		view,
		paging: { page: safePage, page_size: pageSize, total, page_count: pageCount, sizes: PAGE_SIZES },
		counts: {
			all: Number(counts?.all_meetings ?? 0),
			needs_transcript: Number(counts?.needs_transcript ?? 0),
			to_review: Number(counts?.to_review ?? 0),
			reviewed: Number(counts?.reviewed ?? 0),
			this_week: Number(counts?.this_week ?? 0),
			today: Number(counts?.today ?? 0),
			items_from_meetings: Number(fromMeetings?.n ?? 0)
		}
	});
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

	/**
	 * The call this record is about, when there is one.
	 *
	 * Not required. Most meetings are created by hand for a call that was never
	 * on a connected calendar, and a detail page that treated the link as
	 * missing data rather than as an optional fact would nag about every one of
	 * them.
	 */
	const call = await c.env.DB.prepare(
		`SELECT e.id, e.summary, e.starts_at, e.ends_at, e.all_day, e.html_link,
        e.location, e.organizer, e.attendee_count,
        conn.account_email AS account_email, e.connection_id AS account_id
     FROM calendar_events e
     LEFT JOIN connections conn ON conn.id = e.connection_id
     WHERE e.meeting_id = ?`
	)
		.bind(id)
		.first();

	/**
	 * Who was on it, from the calendar rather than from the text field.
	 *
	 * `meetings.attendees` is a line of prose someone typed. The calendar knows
	 * addresses, who organised it and who accepted, and that is a better answer
	 * whenever the link exists. The typed line stays and is shown when it does
	 * not: two sources, never merged, and the screen says which one it is
	 * reading.
	 */
	const attendees = call
		? await c.env.DB.prepare(
				`SELECT email, display_name, response_status, is_organizer, is_self
         FROM calendar_event_attendees WHERE event_id = ?
         ORDER BY is_organizer DESC, is_self DESC, COALESCE(display_name, email)`
			)
				.bind((call as { id: string }).id)
				.all()
				.then((r) => r.results ?? [])
		: [];

	return c.json({ meeting, action_items: items.results ?? [], call, attendees });
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

/* -------------------------------------------------------------------------
 * The link between a meeting record and the calendar event it is about
 * ---------------------------------------------------------------------- */

/**
 * Links a meeting to an event, or moves the link to a different event.
 *
 * `calendar_events.meeting_id` has existed since 0011 and was put there for
 * exactly this, with a comment saying nothing sets it automatically because
 * guessing which calendar entry became which record would be wrong often enough
 * to be worse than not guessing. This is the route that lets a person set it.
 * A side table was written first and thrown away: the column is already the
 * right shape, the sync's upsert lists its columns explicitly and never touches
 * this one, so the link survives every refresh.
 *
 * The account is asserted, not filtered, and it is asserted against the event
 * rather than inferred from it: linking a meeting to an event belonging to
 * another connection is a write across accounts, which is worse than a read
 * across them. D108.
 *
 * Relinking is allowed and replacing is the whole point. A record filed against
 * the wrong call is corrected by pointing it at the right one, not by deleting
 * it and losing its transcript.
 */
meetings.post('/:id/link', async (c) => {
	const db = c.env.DB;
	const meetingId = c.req.param('id');
	const body = await readJsonObject(c.req.raw);
	const eventId = requiredText(body.event_id, 'event_id', 200);

	const meeting = await db
		.prepare('SELECT id FROM meetings WHERE id = ?')
		.bind(meetingId)
		.first<{ id: string }>();
	if (!meeting) throw new ApiError(404, 'Meeting not found.');

	const account = await resolveAccount(db, c.req.query('account'));

	const event = await db
		.prepare('SELECT id, connection_id FROM calendar_events WHERE id = ?')
		.bind(eventId)
		.first<{ id: string; connection_id: string }>();
	if (!event || event.connection_id !== account.id) {
		throw new ApiError(404, 'No event with that id in this calendar.');
	}

	/**
	 * One record per call, and one call per record.
	 *
	 * There is no constraint saying so, because the column predates the feature.
	 * Refusing here, by name, is better than a constraint anyway: "that call is
	 * already filed under X" is an answer, and a unique index violation reaches
	 * the screen as "the request failed".
	 */
	const taken = await db
		.prepare(
			`SELECT m.id, m.title FROM calendar_events e
       JOIN meetings m ON m.id = e.meeting_id
       WHERE e.id = ? AND e.meeting_id != ?`
		)
		.bind(eventId, meetingId)
		.first<{ id: string; title: string }>();
	if (taken) {
		throw new ApiError(409, `That call is already filed under "${taken.title}".`);
	}

	// Moving the link clears wherever it was, so a meeting is never about two
	// calls at once.
	await db
		.prepare('UPDATE calendar_events SET meeting_id = NULL WHERE meeting_id = ?')
		.bind(meetingId)
		.run();

	await db
		.prepare('UPDATE calendar_events SET meeting_id = ? WHERE id = ?')
		.bind(meetingId, eventId)
		.run();

	return c.json({ ok: true, meeting_id: meetingId, event_id: eventId });
});

meetings.delete('/:id/link', async (c) => {
	const result = await c.env.DB.prepare(
		'UPDATE calendar_events SET meeting_id = NULL WHERE meeting_id = ?'
	)
		.bind(c.req.param('id'))
		.run();
	if (!result.meta.changes) throw new ApiError(404, 'That meeting is not linked to a call.');
	return c.json({ ok: true });
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
         (id, client_id, project_id, title, meeting_date, attendees, recording_url,
          notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
			.bind(
				id,
				optionalText(body.client_id, 'client_id', 64),
				optionalText(body.project_id, 'project_id', 64),
				requiredText(body.title, 'Title', 300),
				meetingDate,
				optionalText(body.attendees, 'Attendees', 1000),
				optionalText(body.recording_url, 'Recording link', 1000),
				// The Quick Add form has always sent this and it has always been
				// dropped: no column, no route field, and a 200 either way.
				optionalText(body.notes, 'Notes', 8000),
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
	'notes',
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
