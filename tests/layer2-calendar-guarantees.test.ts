import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCOPES } from '../src/lib/server/google';
import { buildDraftInviteUrl, googleStamp } from '../src/lib/calendar-draft';

/**
 * What the Calendar module must not do.
 *
 * Segregation and attribution are the same guarantees Mail holds, restated here
 * because a new module is exactly where they get forgotten. The cancelled case
 * is this module's own: an event called off in Google used to stay on screen
 * forever, because the fetch filtered it out and nothing ever removed the row.
 *
 * All fixture content is invented.
 */

const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const BASE = 'http://localhost:5173';
const A = 'cal-a';
const B = 'cal-b';
const NOW = '2026-08-31T00:00:00Z';

function openDb(): DatabaseSync {
	const f = readdirSync(DIR).find((x) => x.endsWith('.sqlite') && x !== 'metadata.sqlite');
	if (!f) throw new Error('Local D1 not found.');
	return new DatabaseSync(join(DIR, f));
}

let db: DatabaseSync;

async function api(path: string) {
	const res = await fetch(`${BASE}${path}`);
	const text = await res.text();
	let json: unknown = null;
	try {
		json = JSON.parse(text);
	} catch {
		json = null;
	}
	return { res, json: json as Record<string, unknown>, text };
}

function wipe() {
	for (const acc of [A, B]) {
		db.prepare(
			`DELETE FROM calendar_event_attendees WHERE event_id IN
       (SELECT id FROM calendar_events WHERE connection_id = ?)`
		).run(acc);
		db.prepare(
			`DELETE FROM calendar_event_state WHERE event_id IN
       (SELECT id FROM calendar_events WHERE connection_id = ?)`
		).run(acc);
		db.prepare('DELETE FROM followed_calendars WHERE connection_id = ?').run(acc);
		db.prepare('DELETE FROM calendar_events WHERE connection_id = ?').run(acc);
		db.prepare('DELETE FROM calendars WHERE connection_id = ?').run(acc);
		db.prepare('DELETE FROM connections WHERE id = ?').run(acc);
	}
}

beforeAll(() => {
	db = openDb();
	wipe();

	for (const [id, email, tag] of [
		[A, 'cal-alpha@viewtest.invalid', 'ALPHA'],
		[B, 'cal-bravo@viewtest.invalid', 'BRAVO']
	]) {
		db.prepare(
			`INSERT INTO connections (id, provider, account_email, status, connected_at, created_at, updated_at)
       VALUES (?, 'google', ?, 'connected', ?, ?, ?)`
		).run(id, email, NOW, NOW, NOW);

		db.prepare(
			`INSERT INTO calendars (id, connection_id, provider_calendar_id, summary, sync_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
		).run(`${id}-cal`, id, `${id}-pc`, `CALENDAR ${tag}`, NOW, NOW);

		db.prepare(
			`INSERT INTO calendar_events
       (id, connection_id, calendar_id, provider_event_id, summary, starts_at, ends_at,
        all_day, attendee_count, html_link, fetched_at)
       VALUES (?, ?, ?, ?, ?, '2026-09-01T09:00:00Z', '2026-09-01T10:00:00Z', 0, 1, ?, ?)`
		).run(
			`${id}-evt`,
			id,
			`${id}-cal`,
			`${id}-pe`,
			`ZULU EVENT ${tag}`,
			`https://calendar.google.com/x/${id}`,
			NOW
		);
	}

	// One cancelled event on A, which must never appear in a view.
	db.prepare(
		`INSERT INTO calendar_events
     (id, connection_id, calendar_id, provider_event_id, summary, starts_at, ends_at,
      all_day, attendee_count, fetched_at)
     VALUES (?, ?, ?, ?, 'ZULU CALLED OFF ALPHA', '2026-09-01T14:00:00Z', '2026-09-01T15:00:00Z', 0, 2, ?)`
	).run(`${A}-dead`, A, `${A}-cal`, `${A}-pdead`, NOW);
	db.prepare(
		`INSERT INTO calendar_event_state (event_id, cancelled_at, own_response, updated_at)
     VALUES (?, ?, NULL, ?)`
	).run(`${A}-dead`, NOW, NOW);
});

afterAll(() => {
	wipe();
	db.close();
});

const WINDOW = 'from=2026-08-01T00:00:00Z&to=2026-09-30T00:00:00Z';

describe('the calendar module', () => {
	it('shows one account nothing belonging to the other', async () => {
		const { res, text } = await api(`/api/connections/google/calendar?account=${A}&${WINDOW}`);
		expect(res.ok).toBe(true);
		expect(text).toContain('ZULU EVENT ALPHA');
		expect(text, 'account B events were served while scoped to A').not.toContain(
			'ZULU EVENT BRAVO'
		);
	});

	it('names the account on every row of the unified view, per D111', async () => {
		const { res, json, text } = await api(`/api/connections/google/calendar?account=all&${WINDOW}`);
		expect(res.ok).toBe(true);
		expect(text).toContain('ZULU EVENT ALPHA');
		expect(text).toContain('ZULU EVENT BRAVO');

		const events = json.events as { account_email: string | null }[];
		for (const e of events) {
			expect(e.account_email, 'an event in the union does not name its account').toBeTruthy();
		}
	});

	/** This module's own defect, pinned. */
	it('a cancelled event leaves the view but stays on the record', async () => {
		const { text } = await api(`/api/connections/google/calendar?account=${A}&${WINDOW}`);
		expect(text, 'a cancelled meeting is still on the calendar').not.toContain(
			'ZULU CALLED OFF ALPHA'
		);

		// Still there, because a cancellation is information rather than an
		// absence. Asked for explicitly, it comes back.
		const shown = await api(
			`/api/connections/google/calendar?account=${A}&${WINDOW}&include_cancelled=true`
		);
		expect(shown.text).toContain('ZULU CALLED OFF ALPHA');

		const row = db
			.prepare('SELECT cancelled_at FROM calendar_event_state WHERE event_id = ?')
			.get(`${A}-dead`) as { cancelled_at: string | null };
		expect(row.cancelled_at, 'the cancellation was not recorded').toBeTruthy();
	});

	it('refuses an event belonging to another account rather than returning nothing', async () => {
		const { res } = await api(`/api/connections/google/calendar/events/${B}-evt?account=${A}`);
		expect(res.status, 'another account event was readable').toBe(404);

		const own = await api(`/api/connections/google/calendar/events/${A}-evt?account=${A}`);
		expect(own.res.ok, 'the account cannot read its own event').toBe(true);
	});

	/**
	 * Read only, still. A calendar screen with buttons is exactly where a write
	 * would get added, so the boundary is asserted here as it is for mail.
	 */
	it('holds no scope that could change a calendar', () => {
		const calendarScopes = SCOPES.filter((s) => s.includes('calendar'));
		expect(calendarScopes.length).toBeGreaterThan(0);
		for (const scope of calendarScopes) expect(scope).toMatch(/\.readonly$/);

		const source = readFileSync('src/lib/server/google.ts', 'utf8');
		// Nothing may create, patch or delete an event.
		expect(source).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'[\s\S]{0,400}calendars\//);
	});
});

/**
 * The follow list, which is this app's own and not Google's.
 *
 * Following is the redesign's Follow button after the D70 translation: it
 * changes what this screen shows and never touches the user's CalendarList.
 * Being local does not make it unscoped. A followed address is a person one
 * account works with, and leaking the list across accounts would put a client's
 * contacts in front of another client's screen, which is D110 again in a new
 * table.
 */
describe('the follow list belongs to one account', () => {
	const ADDRESS = 'zulu-followed@viewtest.invalid';

	it('a follow made on one account is invisible to the other', async () => {
		const made = await fetch(`${BASE}/api/connections/google/calendar/follows?account=${A}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email: ADDRESS, display_name: 'ZULU FOLLOWED PERSON' })
		});
		expect(made.ok, await made.text()).toBe(true);

		const mine = await api(`/api/connections/google/calendar/follows?account=${A}`);
		expect(mine.text, 'the account cannot see its own follow').toContain(ADDRESS);

		const theirs = await api(`/api/connections/google/calendar/follows?account=${B}`);
		expect(theirs.text, "account B was shown account A's follow list").not.toContain(ADDRESS);
	});

	it("refuses to unfollow another account's row rather than silently doing nothing", async () => {
		const row = db
			.prepare('SELECT id FROM followed_calendars WHERE connection_id = ? AND email = ?')
			.get(A, ADDRESS) as { id: string };
		expect(row?.id, 'the follow was never written').toBeTruthy();

		const wrong = await fetch(
			`${BASE}/api/connections/google/calendar/follows/${row.id}?account=${B}`,
			{ method: 'DELETE' }
		);
		expect(wrong.status, "one account deleted another's follow").toBe(404);

		// D108: still there, because a refusal that deleted the row anyway would
		// pass a status check and fail the promise.
		const still = db
			.prepare('SELECT COUNT(*) AS n FROM followed_calendars WHERE id = ?')
			.get(row.id) as { n: number };
		expect(Number(still.n)).toBe(1);

		const right = await fetch(
			`${BASE}/api/connections/google/calendar/follows/${row.id}?account=${A}`,
			{ method: 'DELETE' }
		);
		expect(right.ok, 'the owning account could not unfollow').toBe(true);
	});

	it('the same address followed twice stays one row', async () => {
		for (let i = 0; i < 2; i++) {
			await fetch(`${BASE}/api/connections/google/calendar/follows?account=${A}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email: ADDRESS.toUpperCase() })
			});
		}
		const n = db
			.prepare('SELECT COUNT(*) AS n FROM followed_calendars WHERE connection_id = ?')
			.get(A) as { n: number };
		expect(Number(n.n), 'one address became two people').toBe(1);
	});
});

/**
 * Draft invite is a link, asserted the way the mail compose link is.
 *
 * This is the control most likely to grow a convenient endpoint behind it
 * later, because it is a dialog with a button that produces an event. The
 * assertion is that the produced thing is a URL into Google's own form and that
 * no route exists that could create one here.
 */
describe('an invite is drafted, never sent', () => {
	const FIELDS = {
		authuser: 'zulu-drafter@viewtest.invalid',
		title: 'ZULU DRAFT SUBJECT',
		startsAt: new Date('2026-09-02T15:00:00Z'),
		endsAt: new Date('2026-09-02T15:30:00Z'),
		guests: ['zulu-one@viewtest.invalid', 'zulu-two@viewtest.invalid'],
		location: 'Room 2',
		description: 'Agenda and context.'
	};

	it('produces a Google event form URL and nothing else', () => {
		const url = buildDraftInviteUrl(FIELDS);
		expect(url.startsWith('https://calendar.google.com/calendar/'), url).toBe(true);
		expect(url).toContain('action=TEMPLATE');
		expect(url).toContain(`dates=${googleStamp(FIELDS.startsAt)}/${googleStamp(FIELDS.endsAt)}`);
	});

	it('carries every guest, not just the first', () => {
		const url = buildDraftInviteUrl(FIELDS);
		for (const guest of FIELDS.guests) {
			expect(url, `${guest} was dropped from the draft`).toContain(encodeURIComponent(guest));
		}
	});

	it('writes a space as %20, never as a plus', () => {
		const url = buildDraftInviteUrl(FIELDS);
		expect(url).toContain('ZULU%20DRAFT%20SUBJECT');
		expect(url, 'a space was encoded as a plus and will arrive as one').not.toMatch(
			/text=[^&]*\+/
		);
	});

	it('registers no route that could create an event in Google', () => {
		/**
		 * Calendar paths only. An invoice has a trail of events and a meeting
		 * has follow-ups, and a rule broad enough to catch the word `event`
		 * anywhere catches those, which is how a guard gets deleted for being
		 * noisy rather than fixed for being wrong.
		 */
		const dir = 'src/lib/server/api';
		for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
			const source = readFileSync(join(dir, file), 'utf8');
			expect(
				source.match(/\.(post|put|patch|delete)\(\s*'[^']*calendar[^']*(invite|event)/i)?.[0],
				`${file} registers a route that could write to a calendar`
			).toBeUndefined();
		}
	});
});
