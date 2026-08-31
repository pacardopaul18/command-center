import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { monthWindow, previousMonth, nextMonth, monthKey } from '../src/lib/ledger';

/**
 * Correcting a ledger line, exporting a month, and the month arithmetic.
 *
 * The rule worth pinning is which lines may be changed. A line this app posted
 * from an invoice payment is the ledger's copy of a fact that lives on the
 * invoice; editing it here would make the two disagree about money that has
 * already arrived, and the disagreement would be invisible from either screen.
 * So the routes refuse by provenance and say where the change belongs. D156.
 *
 * The CSV is checked for the two things that make an export dangerous rather
 * than merely wrong: a note containing a comma or a quote must not shift the
 * columns, and a note beginning with = must not be handed to a spreadsheet as a
 * formula.
 *
 * All fixture content is invented.
 */

const BASE = 'http://localhost:5173';
const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const NOW = '2026-09-01T00:00:00Z';

const CATEGORY = 'lc-fixture-expense';
const MANUAL = 'lt-fixture-manual';
const POSTED = 'lt-fixture-posted';
const IMPORTED = 'lt-fixture-imported';
const AWKWARD = 'lt-fixture-awkward';

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

const patch = (id: string, body: Record<string, unknown>) =>
	api(`/api/ledger/transactions/${id}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});

function wipe() {
	for (const id of [MANUAL, POSTED, IMPORTED, AWKWARD]) {
		db.prepare('DELETE FROM ledger_transactions WHERE id = ?').run(id);
	}
	db.prepare('DELETE FROM ledger_categories WHERE id = ?').run(CATEGORY);
}

/** A date inside a month nothing else in the fixture writes to. */
const WHEN = '2027-03-11';

beforeAll(() => {
	db = openDb();
	wipe();

	db.prepare(
		`INSERT INTO ledger_categories (id, name, kind, parent_id, created_at, updated_at)
     VALUES (?, 'FIXTURE COSTS', 'expense', NULL, ?, ?)`
	).run(CATEGORY, NOW, NOW);

	const line = (id: string, provenance: string, notes: string) =>
		db
			.prepare(
				`INSERT INTO ledger_transactions
         (id, category_id, client_id, project_id, txn_date, amount_cents, currency,
          provenance, source_invoice_id, source_payment_id, notes, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, ?, 4200, 'USD', ?, NULL, NULL, ?, ?, ?)`
			)
			.run(id, CATEGORY, WHEN, provenance, notes, NOW, NOW);

	line(MANUAL, 'manual', 'FIXTURE typed by hand');
	line(POSTED, 'invoice', 'FIXTURE posted from an invoice');
	line(IMPORTED, 'import', 'FIXTURE read from a statement');
	// A note that would break a naive CSV and a naive spreadsheet at once.
	line(AWKWARD, 'manual', '=SUM(A1:A9), "quoted", and a comma');
});

afterAll(() => {
	wipe();
	db.close();
});

describe('which ledger lines may be corrected', () => {
	it('a line typed by hand can be changed', async () => {
		const { res, json } = await patch(MANUAL, { amount: '99.50', notes: 'FIXTURE corrected' });
		expect(res.status, JSON.stringify(json)).toBe(200);

		const row = db
			.prepare('SELECT amount_cents, notes FROM ledger_transactions WHERE id = ?')
			.get(MANUAL) as { amount_cents: number; notes: string };
		expect(row.amount_cents).toBe(9950);
		expect(row.notes).toBe('FIXTURE corrected');
	});

	it('a line posted from an invoice is refused, and says where to change it', async () => {
		const { res, json } = await patch(POSTED, { amount: '1.00' });
		expect(res.status).toBe(409);
		expect(String(json?.error)).toMatch(/invoice/i);

		// D108 again: the refusal must not have written anything.
		const row = db
			.prepare('SELECT amount_cents FROM ledger_transactions WHERE id = ?')
			.get(POSTED) as { amount_cents: number };
		expect(row.amount_cents, 'the refusal changed the line anyway').toBe(4200);
	});

	it('an imported line is refused, and points at a correcting line', async () => {
		const { res, json } = await patch(IMPORTED, { amount: '1.00' });
		expect(res.status).toBe(409);
		expect(String(json?.error)).toMatch(/correcting line/i);
	});

	it('an amount of zero or a negative is refused, whatever the category says', async () => {
		// The sign lives on the category, never on the figure. A stored -40
		// expense would subtract twice once the totals apply the kind.
		for (const amount of ['0', '0.00', '-40']) {
			const { res } = await patch(MANUAL, { amount });
			expect(res.status, `${amount} was accepted`).toBe(400);
		}
	});

	it('a change to nothing is refused rather than bumping updated_at', async () => {
		const { res } = await patch(MANUAL, {});
		expect(res.status).toBe(400);
	});

	it('deleting refuses the posted line and allows the typed one', async () => {
		const posted = await api(`/api/ledger/transactions/${POSTED}`, { method: 'DELETE' });
		expect(posted.res.status).toBe(409);
		expect(
			db.prepare('SELECT COUNT(*) AS n FROM ledger_transactions WHERE id = ?').get(POSTED),
			'a refused delete removed the row'
		).toEqual({ n: 1 });

		const manual = await api(`/api/ledger/transactions/${MANUAL}`, { method: 'DELETE' });
		expect(manual.res.ok).toBe(true);
		expect(
			db.prepare('SELECT COUNT(*) AS n FROM ledger_transactions WHERE id = ?').get(MANUAL)
		).toEqual({ n: 0 });
	});
});

describe('exporting a month', () => {
	it('returns a CSV of exactly the window asked for', async () => {
		const { res, text } = await api(`/api/ledger/export?from=${WHEN}&to=${WHEN}`);
		expect(res.ok).toBe(true);
		expect(res.headers.get('content-type')).toContain('text/csv');
		expect(res.headers.get('content-disposition')).toContain(`ledger-${WHEN}-to-${WHEN}.csv`);

		const lines = text.trim().split('\r\n');
		expect(lines[0]).toBe(
			'"date","category","kind","client","project","amount","currency","provenance","notes"'
		);
		// Three fixture lines are dated in that window; the manual one was deleted
		// by the test above, so two remain plus the awkward one.
		expect(lines.length, 'the export leaked rows outside the window').toBe(4);
		for (const row of lines.slice(1)) expect(row).toContain(`"${WHEN}"`);
	});

	it('a note with a comma and a quote does not shift the columns', async () => {
		const { text } = await api(`/api/ledger/export?from=${WHEN}&to=${WHEN}`);
		const row = text.split('\r\n').find((l) => l.includes('SUM(A1:A9)'));
		expect(row, 'the awkward line is missing from the export').toBeTruthy();

		// Every field quoted, and an embedded quote doubled, so the count of
		// separators between fields is the same on every row.
		expect(row).toContain('""quoted""');
		expect((row as string).startsWith(`"${WHEN}"`)).toBe(true);
	});

	it('a note beginning with = is not handed over as a formula', async () => {
		const { text } = await api(`/api/ledger/export?from=${WHEN}&to=${WHEN}`);
		const row = text.split('\r\n').find((l) => l.includes('SUM(A1:A9)')) as string;

		// The well-known way a CSV export becomes a problem in somebody else's
		// application. A leading quote makes the spreadsheet read it as text.
		expect(row, 'a formula was exported unescaped').toContain('"\'=SUM(A1:A9)');
	});

	it('amounts are plain decimals, because a column of text does not add up', async () => {
		const { text } = await api(`/api/ledger/export?from=${WHEN}&to=${WHEN}`);
		for (const row of text.trim().split('\r\n').slice(1)) {
			const amount = row.split('","')[5];
			expect(amount, `${amount} is not a plain decimal`).toMatch(/^\d+\.\d{2}$/);
		}
	});
});

describe('the month the ledger is showing', () => {
	it('a month window is its first and last day', () => {
		expect(monthWindow('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
		// A leap year, because day-zero-of-next-month is the spelling that needs
		// no special case and this is the case that proves it.
		expect(monthWindow('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
		expect(monthWindow('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
	});

	it('stepping back and forward crosses a year correctly', () => {
		expect(previousMonth('2026-01')).toBe('2025-12');
		expect(nextMonth('2026-12')).toBe('2027-01');
		expect(nextMonth(previousMonth('2026-07'))).toBe('2026-07');
	});

	it('a month is read in UTC, not on whatever clock the reader is on', () => {
		// The first of the month at midnight UTC. Read locally west of Greenwich
		// this is the last day of the previous month, and the whole page would be
		// a month out with nothing on screen to show it.
		expect(monthKey(new Date('2026-03-01T00:00:00Z'))).toBe('2026-03');
		expect(monthKey(new Date('2026-03-31T23:59:59Z'))).toBe('2026-03');
	});
});
