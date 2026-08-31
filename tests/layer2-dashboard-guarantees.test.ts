import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The dashboard shows mail, so the dashboard is an account scoped surface.
 *
 * Written before the card it guards, and it failed before the card existed,
 * which is the point of writing it first: a guarantee added after the feature
 * is a guarantee that has never seen the failure it claims to catch.
 *
 * D127 is why this asserts against the rendered page rather than the route
 * underneath it. E1 shipped a thirteen case segregation suite that passed while
 * the thread detail page never passed the account through at all, because the
 * suite tested routes and the defect was in the caller. A correctly scoped
 * route reached by a loader that never names the account is still a broken
 * surface, so the assertion is made at the layer the reader actually meets.
 *
 * Two accounts, each with one distinguishable thread, and the page asked for
 * each in turn. Content belonging to the other account may never appear.
 *
 * Fixture content is synthetic. No real subject, sender or snippet is read or
 * printed here, per D89.
 */

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:5173';
const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';

const A = 'dash-a';
const B = 'dash-b';

/**
 * Dated ahead of everything else in the local database so the fixture threads
 * sort to the top of a list ordered by last_at.
 *
 * The presence half of this test depends on it. A test that only asserts the
 * other account is absent passes just as happily when the card renders nothing
 * at all, and a card that renders nothing leaks nothing.
 */
const LATER = '2026-12-31T12:00:00Z';

function openDb(): DatabaseSync {
	const file = readdirSync(DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	if (!file) throw new Error('Local D1 not found.');
	return new DatabaseSync(join(DIR, file));
}

let db: DatabaseSync;

async function page(path: string) {
	const res = await fetch(`${BASE}${path}`);
	return { res, html: await res.text() };
}

function cleanup() {
	for (const id of [A, B]) {
		db.prepare('DELETE FROM email_messages WHERE connection_id = ?').run(id);
		db.prepare('DELETE FROM email_threads WHERE connection_id = ?').run(id);
		db.prepare('DELETE FROM email_ingest_state WHERE connection_id = ?').run(id);
		db.prepare('DELETE FROM connections WHERE id = ?').run(id);
	}
}

function seed() {
	cleanup();
	const now = '2026-08-31T00:00:00Z';

	for (const id of [A, B]) {
		const mark = id.toUpperCase();
		db.prepare(
			`INSERT INTO connections (id, provider, account_email, status, connected_at, created_at, updated_at)
       VALUES (?, 'google', ?, 'connected', ?, ?, ?)`
		).run(id, `owner-${id}@dashboard.test`, now, now, now);

		// Urgent, and the last message is not the owner's, which is what makes a
		// thread "needs you" rather than merely unread.
		db.prepare(
			`INSERT INTO email_threads
         (id, connection_id, provider_thread_id, subject, message_count, first_at, last_at,
          severity, category, gist, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, 'urgent', 'correspondence', ?, ?, ?)`
		).run(
			`${id}-thread`,
			id,
			`${id}-pt`,
			`DASHBOARD SUBJECT ONLY ON ${mark}`,
			now,
			LATER,
			`DASHBOARD GIST ONLY ON ${mark}`,
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
			`DASHBOARD SUBJECT ONLY ON ${mark}`,
			`sender-${id}@dashboard.test`,
			LATER,
			`DASHBOARD SNIPPET ONLY ON ${mark}`,
			now
		);

		db.prepare(
			`INSERT INTO email_ingest_state (connection_id, status, window_days, discovered, fetched)
       VALUES (?, 'idle', 30, 0, 0)`
		).run(id);
	}
}

const contentOf = (id: string) => [
	`DASHBOARD SUBJECT ONLY ON ${id.toUpperCase()}`,
	`DASHBOARD GIST ONLY ON ${id.toUpperCase()}`,
	`DASHBOARD SNIPPET ONLY ON ${id.toUpperCase()}`,
	`sender-${id}@dashboard.test`
];

beforeAll(() => {
	db = openDb();
	seed();
});

afterAll(() => {
	cleanup();
	db.close();
});

describe('layer 2: the dashboard is scoped to one account', () => {
	it('the fixture really did create two accounts with distinct mail', () => {
		// A segregation test against one account proves nothing.
		const n = db
			.prepare(`SELECT COUNT(*) AS n FROM connections WHERE id IN ('${A}', '${B}')`)
			.get() as { n: number };
		expect(Number(n.n)).toBe(2);
	});

	it('asked for account A, it shows A and never B', async () => {
		const { res, html } = await page(`/?account=${A}`);
		expect(res.status).toBe(200);

		// Presence first. Without it the absence below is satisfied by a card
		// that renders nothing.
		expect(html, 'the mail card did not render the account it was asked for').toContain(
			contentOf(A)[0]
		);

		const leaked = contentOf(B).filter((marker) => html.includes(marker));
		expect(leaked, `the dashboard rendered account B content: ${leaked.join(', ')}`).toEqual([]);
	});

	it('asked for account B, it shows B and never A', async () => {
		const { html } = await page(`/?account=${B}`);
		expect(html).toContain(contentOf(B)[0]);

		const leaked = contentOf(A).filter((marker) => html.includes(marker));
		expect(leaked, `the dashboard rendered account A content: ${leaked.join(', ')}`).toEqual([]);
	});

	it('never unions accounts by omission', async () => {
		// D111: crossing accounts on request is a feature, crossing them by
		// leaving a parameter off is the defect. The dashboard has no picker and
		// never asks for the union, so an unscoped load must land on exactly one
		// account, whichever the preference resolves to.
		const { html } = await page('/');
		const bothPresent =
			html.includes(contentOf(A)[0]) && html.includes(contentOf(B)[0]);
		expect(bothPresent, 'an unscoped dashboard load showed two accounts at once').toBe(false);
	});

	it('names the account whose mail it is showing', async () => {
		// Attribution, D111. A card of somebody's mail with nothing saying whose
		// is worse than no card: two clients' correspondence looks identical.
		const { html } = await page(`/?account=${A}`);
		expect(html).toContain(`owner-${A}@dashboard.test`);
	});

	it('names no other account anywhere on the page', async () => {
		// D109: identity may be listed on the roster endpoint and nowhere else.
		const { html } = await page(`/?account=${A}`);
		expect(html).not.toContain(`owner-${B}@dashboard.test`);
	});
});
