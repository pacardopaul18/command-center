import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Hard segregation: no route may return another account's rows.
 *
 * This is the guarantee E1 exists to provide, so it is asserted rather than
 * described. Under house rules a claimed guarantee with no test that can fail
 * on its violation is not a guarantee, which is D80 at route scale: an error
 * matcher is verified by causing the error, and a segregation promise is
 * verified by asking for one account and looking for the other one's rows.
 *
 * The fixture builds two accounts with deliberately distinguishable rows, walks
 * every route that takes or infers an account, and fails on any leak. It is
 * written to fail on the unconverted code, and it did: that is what makes it
 * worth having while the conversion is in progress, because a route missed
 * halfway through shows up here rather than in production.
 */

const BASE = 'http://localhost:5173';
const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';

/** Marks every fixture row so cleanup is exact and layer 1 stays happy. */
const A = 'seg-a';
const B = 'seg-b';

function openDb(): DatabaseSync {
	const file = readdirSync(DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	if (!file) throw new Error('Local D1 not found.');
	return new DatabaseSync(join(DIR, file));
}

let db: DatabaseSync;

async function api(path: string, init?: RequestInit) {
	const res = await fetch(`${BASE}${path}`, init);
	const text = await res.text();
	let json: unknown = null;
	try {
		json = JSON.parse(text);
	} catch {
		json = null;
	}
	return { res, json: json as Record<string, unknown>, text };
}

/** Every string in a response, so a leak cannot hide inside a nested shape. */
function bodyOf(text: string): string {
	return text;
}

function seed() {
	cleanup();
	const now = '2026-08-31T00:00:00Z';

	for (const [id, email] of [
		[A, 'account-a@segregation.test'],
		[B, 'account-b@segregation.test']
	]) {
		db.prepare(
			`INSERT INTO connections (id, provider, account_email, status, connected_at, created_at, updated_at)
       VALUES (?, 'google', ?, 'connected', ?, ?, ?)`
		).run(id, email, now, now, now);

		db.prepare(
			`INSERT INTO email_threads
         (id, connection_id, provider_thread_id, subject, message_count, first_at, last_at,
          severity, category, gist, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, 'urgent', 'correspondence', ?, ?, ?)`
		).run(
			`${id}-thread`,
			id,
			`${id}-pt`,
			`SUBJECT ONLY ON ${id.toUpperCase()}`,
			now,
			now,
			`GIST ONLY ON ${id.toUpperCase()}`,
			now,
			now
		);

		db.prepare(
			`INSERT INTO email_messages
         (id, connection_id, thread_id, provider_message_id, provider_thread_id,
          subject, from_email, sent_at, snippet, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).run(
			`${id}-msg`,
			id,
			`${id}-thread`,
			`${id}-pm`,
			`${id}-pt`,
			`SUBJECT ONLY ON ${id.toUpperCase()}`,
			`sender-${id}@segregation.test`,
			now,
			`SNIPPET ONLY ON ${id.toUpperCase()}`,
			now
		);

		db.prepare(
			`INSERT INTO calendars (id, connection_id, provider_calendar_id, summary, sync_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
		).run(`${id}-cal`, id, `${id}-pc`, `CALENDAR ONLY ON ${id.toUpperCase()}`, now, now);

		db.prepare(
			`INSERT INTO calendar_events
         (id, connection_id, calendar_id, provider_event_id, summary, starts_at, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run(`${id}-evt`, id, `${id}-cal`, `${id}-pe`, `EVENT ONLY ON ${id.toUpperCase()}`, now, now);

		db.prepare(
			`INSERT INTO email_ingest_state (connection_id, status, window_days, discovered, fetched)
       VALUES (?, 'idle', 30, 0, 0)`
		).run(id);
	}
}

function cleanup() {
	// Children first: the fixture runs against a live database and must leave
	// nothing behind, or layer 1's leak guards fail on the next run.
	for (const id of [A, B]) {
		db.prepare('DELETE FROM calendar_events WHERE connection_id = ?').run(id);
		db.prepare('DELETE FROM calendars WHERE connection_id = ?').run(id);
		db.prepare('DELETE FROM email_messages WHERE connection_id = ?').run(id);
		db.prepare('DELETE FROM email_threads WHERE connection_id = ?').run(id);
		db.prepare('DELETE FROM email_ingest_state WHERE connection_id = ?').run(id);
		db.prepare('DELETE FROM connections WHERE id = ?').run(id);
	}
}

beforeAll(() => {
	db = openDb();
	seed();
});

afterAll(() => {
	cleanup();
	db.close();
});

/**
 * The markers that must never appear in a response scoped to the other account.
 *
 * Distinctive strings rather than ids, because a leak that returns a row
 * without its id is still a leak.
 */
/**
 * Content belonging to account B. None of this may ever appear in a response
 * scoped to account A, on any route without exception.
 */
const B_CONTENT = [
	'SUBJECT ONLY ON SEG-B',
	'GIST ONLY ON SEG-B',
	'SNIPPET ONLY ON SEG-B',
	'CALENDAR ONLY ON SEG-B',
	'EVENT ONLY ON SEG-B',
	'sender-seg-b@segregation.test'
];

/**
 * B's identity, which is a different thing from B's content.
 *
 * The account roster is legitimately global: every account belongs to Paul, and
 * a picker cannot offer a choice it is not allowed to name. So `/api/connections`
 * lists all of them by design.
 *
 * The line drawn here is the one that actually protects anything: identity may
 * be listed on the roster endpoint and nowhere else, and content may cross
 * nowhere at all. Weakening the whole test to let the roster pass would have
 * been the easy fix and would have removed the guarantee along with the
 * failure.
 */
const B_IDENTITY = ['account-b@segregation.test'];

const ROSTER_ROUTE = '/api/connections?account=seg-a';

const B_MARKERS = B_CONTENT;

/** Routes that take an account explicitly. Asked for A, must never show B. */
const SCOPED_ROUTES = [
	'/api/email/threads?account=seg-a',
	'/api/email/threads?account=seg-a&severity=all',
	'/api/email/ingest?account=seg-a',
	'/api/email/summarise?account=seg-a',
	'/api/connections?account=seg-a',
	'/api/connections/google/calendar?account=seg-a',
	'/api/connections/google/calendars?account=seg-a'
];

describe('layer 2: no route returns another account rows', () => {
	it('the fixture really did create two accounts with distinct rows', () => {
		// A segregation test against one account proves nothing. This asserts the
		// setup before the assertions that depend on it, the same reason the
		// pre-hydration test asserts its own setup.
		const n = db.prepare("SELECT COUNT(*) AS n FROM connections WHERE id IN ('seg-a','seg-b')").get() as { n: number };
		expect(Number(n.n)).toBe(2);
		const threads = db
			.prepare("SELECT COUNT(*) AS n FROM email_threads WHERE connection_id IN ('seg-a','seg-b')")
			.get() as { n: number };
		expect(Number(threads.n)).toBe(2);
	});

	for (const route of SCOPED_ROUTES) {
		it(`${route} shows no content belonging to the other account`, async () => {
			const { res, text } = await api(route);
			expect(res.status, `${route} did not answer`).toBeLessThan(500);

			const leaked = B_CONTENT.filter((marker) => bodyOf(text).includes(marker));
			expect(
				leaked,
				`${route} returned content belonging to account B: ${leaked.join(', ')}`
			).toEqual([]);

			// Identity may appear on the roster and nowhere else.
			if (route !== ROSTER_ROUTE) {
				const named = B_IDENTITY.filter((marker) => bodyOf(text).includes(marker));
				expect(named, `${route} named account B, which only the roster may do`).toEqual([]);
			}
		});
	}

	it('the roster lists accounts and carries none of their content', async () => {
		// The one endpoint allowed to name every account is also the one most
		// worth checking, because it is where a content field would be least
		// noticed among legitimate identity fields.
		const { json, text } = await api(ROSTER_ROUTE);
		const accounts = (json.accounts ?? []) as { id: string; account_email: string }[];
		expect(accounts.length, 'the roster should list both accounts').toBeGreaterThanOrEqual(2);

		// Deliberately an exact set rather than a subset check. A new field on the
		// roster should fail here until somebody has decided it is identity and
		// not content, which is the whole job of this assertion. `reauth` is an
		// expiry clock about the account itself, not anything inside the mailbox.
		const fields = new Set(accounts.flatMap((a) => Object.keys(a)));
		expect(
			[...fields].sort(),
			'the roster carries a field that has not been classified as identity'
		).toEqual(['account_email', 'id', 'provider', 'reauth', 'status']);

		expect(B_CONTENT.filter((m) => text.includes(m))).toEqual([]);
	});

	it('a thread belonging to B cannot be read while scoped to A', async () => {
		// The derived bucket: the account follows the row rather than a
		// parameter, so the check is that asking for B's thread as A is refused
		// rather than silently answered.
		const { res, text } = await api('/api/email/threads/seg-b-thread?account=seg-a');
		if (res.status === 200) {
			const leaked = B_MARKERS.filter((m) => text.includes(m));
			expect(
				leaked,
				'a thread from account B was served while scoped to account A'
			).toEqual([]);
		} else {
			expect([403, 404]).toContain(res.status);
		}
	});

	it('a message body belonging to B cannot be read while scoped to A', async () => {
		const { res, text } = await api('/api/email/messages/seg-b-msg/body?account=seg-a');
		if (res.status === 200) {
			expect(B_MARKERS.filter((m) => text.includes(m))).toEqual([]);
		} else {
			expect([403, 404]).toContain(res.status);
		}
	});

	it('writing to a thread belonging to B is refused while scoped to A', async () => {
		const { res } = await api('/api/email/threads/seg-b-thread/archive?account=seg-a', {
			method: 'POST'
		});
		// A write that crosses accounts is the worst case: it changes somebody
		// else's records rather than merely showing them.
		expect([403, 404], 'a cross-account write was accepted').toContain(res.status);

		const still = db
			.prepare("SELECT archived_at FROM email_threads WHERE id = 'seg-b-thread'")
			.get() as { archived_at: string | null };
		expect(still.archived_at, 'account B thread was modified from account A').toBeNull();
	});

	it('the unified scope must be asked for by name, never arrived at', async () => {
		// `all` is the one place data crosses accounts. It is a feature rather
		// than a hole because it has to be typed and because every row it returns
		// says which account it came from. A default that quietly meant `all`
		// would turn the feature back into the defect.
		const scoped = await api('/api/email/threads?account=seg-a&severity=all');
		expect((scoped.json as { scope?: string }).scope).toBe('one');
		expect(scoped.text.includes('SUBJECT ONLY ON SEG-B')).toBe(false);

		const unified = await api('/api/email/threads?account=all&severity=all');
		expect((unified.json as { scope?: string }).scope).toBe('all');
		expect(unified.text).toContain('SUBJECT ONLY ON SEG-A');
		expect(unified.text).toContain('SUBJECT ONLY ON SEG-B');
	});

	it('every row in the unified view names the account it came from', async () => {
		// A unified inbox that does not attribute is worse than no unified
		// inbox: it puts one client's correspondence next to another's with
		// nothing on screen saying which is which.
		const { json } = await api('/api/email/threads?account=all&severity=all');
		const threads = (json.threads ?? []) as { id: string; account_id?: string; account_email?: string }[];
		const fixture = threads.filter((t) => t.id === 'seg-a-thread' || t.id === 'seg-b-thread');
		expect(fixture.length, 'both fixture threads should be in the union').toBe(2);
		for (const t of fixture) {
			expect(t.account_id, `${t.id} has no account attribution`).toBeTruthy();
			expect(t.account_email, `${t.id} has no account email`).toBeTruthy();
		}
		// And the attribution must be correct, not merely present.
		expect(fixture.find((t) => t.id === 'seg-a-thread')?.account_id).toBe('seg-a');
		expect(fixture.find((t) => t.id === 'seg-b-thread')?.account_id).toBe('seg-b');
	});

	it('the calendar segregates and attributes the same way', async () => {
		const scoped = await api('/api/connections/google/calendar?account=seg-a&days=60');
		expect(scoped.text.includes('EVENT ONLY ON SEG-B')).toBe(false);

		const unified = await api('/api/connections/google/calendar?account=all&days=60');
		const events = ((unified.json.events ?? []) as { id: string; account_id?: string }[]).filter(
			(e) => e.id === 'seg-a-evt' || e.id === 'seg-b-evt'
		);
		expect(events.length).toBe(2);
		for (const e of events) expect(e.account_id, `${e.id} unattributed`).toBeTruthy();
	});

	it('each account carries its own re-auth clock', async () => {
		// Google's Testing-mode expiry runs per account. One number for the app
		// would be wrong for every account but the most recently connected.
		const { json } = await api('/api/connections?account=seg-a');
		const accounts = (json.accounts ?? []) as { id: string; reauth?: { days_left: number | null } }[];
		expect(accounts.length).toBeGreaterThanOrEqual(2);
		for (const a of accounts) {
			expect(a.reauth, `${a.id} has no re-auth clock`).toBeTruthy();
		}
	});

	it('an unknown account is refused rather than defaulted away', async () => {
		// Falling back to "the" connection when the named one does not exist is
		// how a scoping bug turns into a leak that looks like it works.
		const { res } = await api('/api/email/threads?account=does-not-exist');
		expect([400, 403, 404]).toContain(res.status);
	});
});
