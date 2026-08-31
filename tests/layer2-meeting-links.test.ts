import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Filing a meeting record against the call it was.
 *
 * Two things are being pinned. The link is a write that names a calendar event,
 * so it is account scoped and the scoping is asserted in both directions: an
 * event belonging to another connection is refused rather than accepted, and
 * refused rather than quietly ignored. D108.
 *
 * The second is the state reading behind the tabs, which was wrong first time
 * in a way that looked fine: asking about the transcript before the review
 * filed every hand-written summary under "needs a transcript". A reading that
 * is only ever exercised through a screen is a reading nobody checks.
 *
 * All fixture content is invented.
 */

const BASE = 'http://localhost:5173';
const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';

const A = 'mtg-a';
const B = 'mtg-b';
const NOW = '2026-08-31T00:00:00Z';

function openDb(): DatabaseSync {
	const f = readdirSync(DIR).find((x) => x.endsWith('.sqlite') && x !== 'metadata.sqlite');
	if (!f) throw new Error('Local D1 not found.');
	return new DatabaseSync(join(DIR, f));
}

let db: DatabaseSync;

async function api(path: string, init?: RequestInit) {
	const res = await fetch(`${BASE}${path}`, init);
	const text = await res.text();
	let json: Record<string, unknown> | null = null;
	try {
		json = JSON.parse(text) as Record<string, unknown>;
	} catch {
		json = null;
	}
	return { res, json, text };
}

const link = (meeting: string, account: string, eventId: string) =>
	api(`/api/meetings/${meeting}/link?account=${account}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ event_id: eventId })
	});

/** Meetings the fixture owns. Everything else in the table is left alone. */
const MEETINGS = ['mtg-fix-1', 'mtg-fix-2'];

function wipe() {
	for (const id of MEETINGS) {
		db.prepare('UPDATE calendar_events SET meeting_id = NULL WHERE meeting_id = ?').run(id);
		db.prepare('DELETE FROM meetings WHERE id = ?').run(id);
	}
	for (const acc of [A, B]) {
		db.prepare('DELETE FROM calendar_events WHERE connection_id = ?').run(acc);
		db.prepare('DELETE FROM calendars WHERE connection_id = ?').run(acc);
		db.prepare('DELETE FROM connections WHERE id = ?').run(acc);
	}
}

beforeAll(() => {
	db = openDb();
	wipe();

	for (const [id, email] of [
		[A, 'mtg-alpha@linktest.invalid'],
		[B, 'mtg-bravo@linktest.invalid']
	]) {
		db.prepare(
			`INSERT INTO connections (id, provider, account_email, status, connected_at, created_at, updated_at)
       VALUES (?, 'google', ?, 'connected', ?, ?, ?)`
		).run(id, email, NOW, NOW, NOW);

		db.prepare(
			`INSERT INTO calendars (id, connection_id, provider_calendar_id, summary, sync_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
		).run(`${id}-cal`, id, `${id}-pc`, `LINK CALENDAR ${id}`, NOW, NOW);

		db.prepare(
			`INSERT INTO calendar_events
       (id, connection_id, calendar_id, provider_event_id, summary, starts_at, ends_at,
        all_day, attendee_count, fetched_at)
       VALUES (?, ?, ?, ?, ?, '2026-09-02T15:00:00Z', '2026-09-02T16:00:00Z', 0, 2, ?)`
		).run(`${id}-evt`, id, `${id}-cal`, `${id}-pe`, `LINK EVENT ${id}`, NOW);
	}

	// Two records: one to file, one to compete for the same event.
	for (const id of MEETINGS) {
		db.prepare(
			`INSERT INTO meetings (id, title, meeting_date, created_at, updated_at)
       VALUES (?, ?, '2026-09-02', ?, ?)`
		).run(id, `LINK RECORD ${id}`, NOW, NOW);
	}
});

afterAll(() => {
	wipe();
	db.close();
});

describe('filing a meeting against a call', () => {
	it('refuses an event belonging to another account, and changes nothing', async () => {
		const { res } = await link(MEETINGS[0], A, `${B}-evt`);
		expect(res.status, "account A filed against account B's call").toBe(404);

		const row = db
			.prepare('SELECT meeting_id FROM calendar_events WHERE id = ?')
			.get(`${B}-evt`) as { meeting_id: string | null };
		expect(row.meeting_id, 'the refusal wrote the link anyway').toBeNull();
	});

	it('files against its own account and the event says so', async () => {
		const { res } = await link(MEETINGS[0], A, `${A}-evt`);
		expect(res.ok).toBe(true);

		const row = db
			.prepare('SELECT meeting_id FROM calendar_events WHERE id = ?')
			.get(`${A}-evt`) as { meeting_id: string | null };
		expect(row.meeting_id).toBe(MEETINGS[0]);
	});

	it('names the record already holding a call rather than failing on a constraint', async () => {
		const { res, json } = await link(MEETINGS[1], A, `${A}-evt`);
		expect(res.status).toBe(409);
		expect(String(json?.error), 'the refusal does not say which record has it').toContain(
			`LINK RECORD ${MEETINGS[0]}`
		);
	});

	it('a record is about one call, so refiling clears the old one', async () => {
		// A second event on the same account to move to.
		db.prepare(
			`INSERT INTO calendar_events
       (id, connection_id, calendar_id, provider_event_id, summary, starts_at, ends_at,
        all_day, attendee_count, fetched_at)
       VALUES (?, ?, ?, ?, 'LINK EVENT ALPHA SECOND', '2026-09-03T15:00:00Z',
               '2026-09-03T16:00:00Z', 0, 1, ?)`
		).run(`${A}-evt2`, A, `${A}-cal`, `${A}-pe2`, NOW);

		const { res } = await link(MEETINGS[0], A, `${A}-evt2`);
		expect(res.ok).toBe(true);

		const rows = db
			.prepare('SELECT id FROM calendar_events WHERE meeting_id = ?')
			.all(MEETINGS[0]) as { id: string }[];
		expect(rows.map((r) => r.id), 'the record is filed against two calls at once').toEqual([
			`${A}-evt2`
		]);
	});

	it('unfiling reports whether there was anything to unfile', async () => {
		const first = await api(`/api/meetings/${MEETINGS[0]}/link`, { method: 'DELETE' });
		expect(first.res.ok).toBe(true);

		// D27 again in a smaller way: a second delete that cheerfully reports
		// success would tell the screen a link was removed that never existed.
		const second = await api(`/api/meetings/${MEETINGS[0]}/link`, { method: 'DELETE' });
		expect(second.res.status).toBe(404);
	});

	it('a refresh of the calendar does not drop the link', async () => {
		await link(MEETINGS[0], A, `${A}-evt`);

		/**
		 * The upsert the sync runs, replayed. It lists its columns explicitly and
		 * meeting_id is not among them, which is the property this asserts: the
		 * link is set by a person and no automatic read may clear it.
		 */
		db.prepare(
			`INSERT INTO calendar_events
       (id, connection_id, calendar_id, provider_event_id, summary, starts_at, ends_at,
        all_day, attendee_count, fetched_at)
       VALUES (?, ?, ?, ?, 'LINK EVENT ALPHA REFRESHED', '2026-09-02T15:00:00Z',
               '2026-09-02T16:00:00Z', 0, 2, ?)
       ON CONFLICT(connection_id, provider_event_id) DO UPDATE SET
         summary = excluded.summary,
         starts_at = excluded.starts_at,
         ends_at = excluded.ends_at,
         attendee_count = excluded.attendee_count,
         fetched_at = excluded.fetched_at`
		).run(crypto.randomUUID(), A, `${A}-cal`, `${A}-pe`, NOW);

		const row = db
			.prepare('SELECT meeting_id, summary FROM calendar_events WHERE id = ?')
			.get(`${A}-evt`) as { meeting_id: string | null; summary: string };
		expect(row.summary, 'the fixture did not actually refresh the row').toContain('REFRESHED');
		expect(row.meeting_id, 'a calendar refresh cleared the link').toBe(MEETINGS[0]);
	});
});

describe('which tab a meeting sits under', () => {
	/** Reads the state the route computes, through the route. */
	async function stateOf(id: string): Promise<string | null> {
		for (const view of ['reviewed', 'to_review', 'needs_transcript']) {
			const { json } = await api(`/api/meetings?view=${view}&q=LINK RECORD ${id}`);
			const rows = (json?.meetings ?? []) as { id: string }[];
			if (rows.some((m) => m.id === id)) return view;
		}
		return null;
	}

	it('a reviewed summary is reviewed, even with no transcript', async () => {
		// The defect this pins. A summary can be written by hand, and asking
		// about the transcript first filed all of them under needs a transcript.
		db.prepare('UPDATE meetings SET summary = ?, summary_reviewed_at = ? WHERE id = ?').run(
			'Decided the thing.',
			NOW,
			MEETINGS[0]
		);
		expect(await stateOf(MEETINGS[0])).toBe('reviewed');
	});

	it('a drafted summary nobody has read is waiting for review', async () => {
		db.prepare(
			'UPDATE meetings SET summary = ?, summary_reviewed_at = NULL WHERE id = ?'
		).run('Drafted, unread.', MEETINGS[0]);
		expect(await stateOf(MEETINGS[0])).toBe('to_review');
	});

	it('nothing to read at all is the third bucket', async () => {
		db.prepare(
			'UPDATE meetings SET summary = NULL, summary_reviewed_at = NULL WHERE id = ?'
		).run(MEETINGS[0]);
		expect(await stateOf(MEETINGS[0])).toBe('needs_transcript');
	});

	it('every meeting is in exactly one bucket, so the tabs add up', async () => {
		const { json } = await api('/api/meetings');
		const counts = json?.counts as Record<string, number>;
		expect(
			counts.needs_transcript + counts.to_review + counts.reviewed,
			'the three tabs do not add up to the whole log'
		).toBe(counts.all);
	});
});
