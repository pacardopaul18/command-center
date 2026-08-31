import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The three things the ledger must not do, asserted before it exists.
 *
 * Written first, so they describe what P3-E1 has to be rather than what it
 * turned out to be. Each one is a mistake that produces a plausible number:
 * a total nobody can tell is wrong, a link nobody notices is inconsistent, and
 * a scoping column that would quietly turn Paul's own books into somebody
 * else's records.
 *
 * All fixture money is synthetic.
 */

const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const BASE = 'http://localhost:5173';
const TAG = 'ledger-test';

function openDb(): DatabaseSync {
	const file = readdirSync(DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	if (!file) throw new Error('Local D1 not found.');
	return new DatabaseSync(join(DIR, file));
}

let db: DatabaseSync;
let clientA = '';
let clientB = '';
let projectOfA = '';
let categoryId = '';

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

function cleanup() {
	db.prepare("DELETE FROM ledger_transactions WHERE notes LIKE ?").run(`%${TAG}%`);
	db.prepare("DELETE FROM ledger_categories WHERE name LIKE ?").run(`%${TAG}%`);
}

beforeAll(() => {
	db = openDb();

	// Two real clients and a project belonging to the first, so the
	// disagreement case can be built out of rows that actually exist.
	const clients = db.prepare('SELECT id FROM clients ORDER BY created_at LIMIT 2').all() as {
		id: string;
	}[];
	clientA = clients[0].id;
	clientB = clients[1].id;
	const project = db
		.prepare('SELECT id FROM projects WHERE client_id = ? LIMIT 1')
		.get(clientA) as { id: string } | undefined;
	projectOfA = project?.id ?? '';

	cleanup();
	const now = '2026-08-31T00:00:00Z';
	categoryId = `cat-${TAG}`;
	db.prepare(
		`INSERT INTO ledger_categories (id, name, kind, parent_id, created_at, updated_at)
     VALUES (?, ?, 'income', NULL, ?, ?)`
	).run(categoryId, `Consulting ${TAG}`, now, now);
});

afterAll(() => {
	cleanup();
	db.close();
});

describe('the ledger cannot produce a number nobody can check', () => {
	/**
	 * Two amounts in different currencies are two facts, not one.
	 *
	 * Adding 100 USD to 100 PHP gives 200 of nothing. It is the most inviting
	 * mistake in the whole pillar, because the result is a number and numbers
	 * look finished.
	 */
	it('never adds amounts of different currencies into one total', async () => {
		const now = '2026-08-31T00:00:00Z';
		for (const [i, currency] of ['USD', 'PHP', 'USD'].entries()) {
			db.prepare(
				`INSERT INTO ledger_transactions
         (id, category_id, client_id, project_id, txn_date, amount_cents, currency,
          provenance, notes, created_at, updated_at)
         VALUES (?, ?, NULL, NULL, '2026-08-20', 10000, ?, 'manual', ?, ?, ?)`
			).run(`txn-${TAG}-${i}`, categoryId, currency, `${TAG} total case`, now, now);
		}

		const { res, json } = await api('/api/ledger/totals?from=2026-08-01&to=2026-08-31');
		expect(res.ok).toBe(true);

		const totals = json.totals as { currency: string; amount_cents: number }[];
		expect(Array.isArray(totals), 'totals is not a per-currency list').toBe(true);

		// Every entry names its currency, and no entry merges two.
		const currencies = totals.map((t) => t.currency);
		expect(new Set(currencies).size, 'a currency appears twice in the totals').toBe(
			currencies.length
		);
		for (const t of totals) {
			expect(t.currency, 'a total exists with no currency on it').toBeTruthy();
		}

		// And the shape offers no single grand total to misread.
		expect(json.total_cents, 'the response offers one combined total').toBeUndefined();
	});

	/**
	 * A project belongs to a client. A transaction naming both must agree.
	 *
	 * Refused at the database rather than in a route, because a second writer
	 * that skips the route would otherwise write a row no report could explain.
	 */
	it('refuses a transaction whose client and project disagree', () => {
		expect(projectOfA, 'fixture found no project to test with').toBeTruthy();
		const now = '2026-08-31T00:00:00Z';

		expect(() =>
			db
				.prepare(
					`INSERT INTO ledger_transactions
           (id, category_id, client_id, project_id, txn_date, amount_cents, currency,
            provenance, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, '2026-08-20', 5000, 'USD', 'manual', ?, ?, ?)`
				)
				.run(`txn-${TAG}-bad`, categoryId, clientB, projectOfA, `${TAG} mismatch`, now, now)
		).toThrow();

		// The same row with the matching client is accepted, so the guard is
		// refusing the disagreement rather than the shape.
		expect(() =>
			db
				.prepare(
					`INSERT INTO ledger_transactions
           (id, category_id, client_id, project_id, txn_date, amount_cents, currency,
            provenance, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, '2026-08-20', 5000, 'USD', 'manual', ?, ?, ?)`
				)
				.run(`txn-${TAG}-good`, categoryId, clientA, projectOfA, `${TAG} match`, now, now)
		).not.toThrow();
	});

	/**
	 * The ledger is Paul's own books, not a per-mailbox record.
	 *
	 * E1's audit called this out as a category error waiting to happen: every
	 * table added since multi-account has carried a connection_id, and copying
	 * that habit here would scope the firm's finances to a Google account.
	 */
	it('has no account scoping on it, in either table', () => {
		for (const table of ['ledger_transactions', 'ledger_categories']) {
			const columns = (
				db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as { name: string }[]
			).map((c) => c.name);
			expect(columns.length, `${table} does not exist`).toBeGreaterThan(0);
			expect(columns, `${table} is scoped to a connection`).not.toContain('connection_id');
			expect(columns, `${table} is scoped to an account`).not.toContain('account_id');
		}
	});

	/** Minor units, matching the convention already in use everywhere else. */
	it('stores money in minor units under the existing name', () => {
		const columns = (
			db.prepare('SELECT name FROM pragma_table_info(?)').all('ledger_transactions') as {
				name: string;
			}[]
		).map((c) => c.name);
		expect(columns).toContain('amount_cents');
		expect(columns, 'a second money convention was introduced').not.toContain('amount');
		expect(columns, 'a second money convention was introduced').not.toContain('amount_minor');
	});
});
