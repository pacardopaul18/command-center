import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The two things these reports must not do.
 *
 * They must not add one currency to another, and they must not report unknown
 * labour cost as zero. Both produce a number that looks finished: a net figure
 * across currencies, and a margin that omits the largest cost in a services
 * firm. Neither is visible as wrong on the page.
 *
 * Money here is synthetic.
 */

const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const BASE = 'http://localhost:5173';
const TAG = 'rep-test';
const FROM = '2026-07-01';
const TO = '2026-07-31';

function openDb(): DatabaseSync {
	const file = readdirSync(DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	if (!file) throw new Error('Local D1 not found.');
	return new DatabaseSync(join(DIR, file));
}

let db: DatabaseSync;
let clientId = '';

/**
 * What the window already held before this fixture wrote to it.
 *
 * These assertions used to be absolute, on the reasoning that nothing else put
 * ledger rows in July. That stopped being true the moment the volume seed grew
 * a ledger, and the test failed with figures that were entirely correct.
 *
 * Measuring the baseline first and asserting the difference makes the check
 * about what this fixture contributes, which is what it was always trying to
 * say. It is also immune to the fixture growing again.
 */
const baseline: Record<string, number> = {};

function cleanup() {
	db.prepare('DELETE FROM ledger_transactions WHERE notes LIKE ?').run(`%${TAG}%`);
	db.prepare('DELETE FROM ledger_categories WHERE name LIKE ?').run(`%${TAG}%`);
}

beforeAll(async () => {
	db = openDb();
	cleanup();

	const before = await report('pnl');
	for (const row of (before.data.currencies ?? []) as {
		currency: string;
		income_cents: number;
		net_cents: number;
	}[]) {
		baseline[`${row.currency}.income`] = row.income_cents;
		baseline[`${row.currency}.net`] = row.net_cents;
	}

	const beforeExpenses = await report('expenses');
	for (const row of (beforeExpenses.data.totals ?? []) as {
		currency: string;
		amount_cents: number;
	}[]) {
		baseline[`${row.currency}.expense`] = row.amount_cents;
	}

	const now = '2026-07-15T00:00:00Z';
	clientId = (db.prepare('SELECT id FROM clients ORDER BY created_at LIMIT 1').get() as {
		id: string;
	}).id;

	for (const [id, name, kind] of [
		[`inc-${TAG}`, `Fees ${TAG}`, 'income'],
		[`exp-${TAG}`, `Travel ${TAG}`, 'expense']
	]) {
		db.prepare(
			`INSERT INTO ledger_categories (id, name, kind, parent_id, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)`
		).run(id, name, kind, now, now);
	}

	// Equal numbers in two currencies. If anything sums across them the total is
	// 200000, which is a number that cannot be right in either currency.
	const rows: [string, string, number, string][] = [
		[`t1-${TAG}`, `inc-${TAG}`, 100000, 'USD'],
		[`t2-${TAG}`, `inc-${TAG}`, 100000, 'PHP'],
		[`t3-${TAG}`, `exp-${TAG}`, 25000, 'USD']
	];
	for (const [id, cat, amount, currency] of rows) {
		db.prepare(
			`INSERT INTO ledger_transactions
       (id, category_id, client_id, project_id, txn_date, amount_cents, currency,
        provenance, notes, created_at, updated_at)
       VALUES (?, ?, ?, NULL, '2026-07-10', ?, ?, 'manual', ?, ?, ?)`
		).run(id, cat, clientId, amount, currency, `${TAG} line`, now, now);
	}
});

afterAll(() => {
	cleanup();
	db.close();
});

async function report(type: string) {
	const res = await fetch(`${BASE}/api/reports/${type}?from=${FROM}&to=${TO}`);
	expect(res.ok, `${type} did not run`).toBe(true);
	return (await res.json()) as { data: Record<string, unknown> };
}

describe('the ledger reports', () => {
	it('profit and loss keeps currencies apart and offers no combined net', async () => {
		const { data } = await report('pnl');
		const currencies = data.currencies as { currency: string; income_cents: number; net_cents: number }[];

		const usd = currencies.find((c) => c.currency === 'USD');
		const php = currencies.find((c) => c.currency === 'PHP');

		// Equal amounts in two currencies. Anything summing across them would
		// have to produce 200000, a number that cannot be right in either.
		expect(Number(usd?.income_cents) - (baseline['USD.income'] ?? 0)).toBe(100000);
		expect(Number(php?.income_cents) - (baseline['PHP.income'] ?? 0)).toBe(100000);
		expect(
			Number(usd?.net_cents) - (baseline['USD.net'] ?? 0),
			'the USD net ignored the USD expense'
		).toBe(75000);

		// The shape offers nothing to misread as a grand total.
		expect(data.net_cents, 'a combined net was returned').toBeUndefined();
		expect(data.total_cents, 'a combined total was returned').toBeUndefined();
	});

	it('expenses report totals per currency and never across', async () => {
		const { data } = await report('expenses');
		const totals = data.totals as { currency: string; amount_cents: number }[];
		for (const t of totals) expect(t.currency).toBeTruthy();
		const usd = totals.find((t) => t.currency === 'USD');
		expect(Number(usd?.amount_cents) - (baseline['USD.expense'] ?? 0)).toBe(25000);
		// Income must not appear in an expenses report.
		const lines = data.lines as { kind: string }[];
		for (const l of lines) expect(['expense', 'overhead']).toContain(l.kind);
	});

	/**
	 * The one that would flatter. Every rate is NULL, so labour cost is unknown
	 * rather than nil, and the report has to say which.
	 */
	it('profitability declares that labour is uncosted rather than showing zero', async () => {
		const { data } = await report('profitability');
		const labour = data.labour as { no_rates_set: boolean; uncosted_hours: number };
		expect(labour.no_rates_set, 'the report claims rates exist').toBe(true);

		const lines = data.lines as { currency: string; revenue_cents: number; margin_cents: number }[];
		// PHP appears in this window only because this fixture put it there, so
		// its presence is the check that the fixture's own lines are reported.
		const mine = lines.filter((l) => l.currency === 'PHP');
		expect(mine.length, 'the client lines are missing').toBeGreaterThan(0);
		// Each line is one currency. A margin is only ever within one.
		for (const l of lines) expect(l.currency).toBeTruthy();
	});
});
