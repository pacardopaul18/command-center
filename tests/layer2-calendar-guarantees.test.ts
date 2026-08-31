import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCOPES } from '../src/lib/server/google';

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
