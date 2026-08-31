import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Receipts: the two things E3 promises.
 *
 * A receipt cannot outlive the transaction it belongs to, and bytes are never
 * served without the row that explains them. The second is the one that would
 * be easy to get wrong by adding a convenient by-id route later, so it is
 * asserted by asking for a real receipt through the wrong transaction.
 */

const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const BASE = 'http://localhost:5173';
const TAG = 'receipt-test';

function openDb(): DatabaseSync {
	const file = readdirSync(DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	if (!file) throw new Error('Local D1 not found.');
	return new DatabaseSync(join(DIR, file));
}

let db: DatabaseSync;
let categoryId = '';
let txnA = '';
let txnB = '';
let receiptId = '';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2]);

function cleanup() {
	db.prepare(
		"DELETE FROM expense_receipts WHERE transaction_id IN (SELECT id FROM ledger_transactions WHERE notes LIKE ?)"
	).run(`%${TAG}%`);
	db.prepare('DELETE FROM ledger_transactions WHERE notes LIKE ?').run(`%${TAG}%`);
	db.prepare('DELETE FROM ledger_categories WHERE name LIKE ?').run(`%${TAG}%`);
}

beforeAll(async () => {
	db = openDb();
	cleanup();
	const now = '2026-08-31T00:00:00Z';
	categoryId = `cat-${TAG}`;
	db.prepare(
		`INSERT INTO ledger_categories (id, name, kind, parent_id, created_at, updated_at)
     VALUES (?, ?, 'expense', NULL, ?, ?)`
	).run(categoryId, `Travel ${TAG}`, now, now);

	for (const id of [`txn-${TAG}-a`, `txn-${TAG}-b`]) {
		db.prepare(
			`INSERT INTO ledger_transactions
       (id, category_id, client_id, project_id, txn_date, amount_cents, currency,
        provenance, notes, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, '2026-08-15', 4200, 'USD', 'manual', ?, ?, ?)`
		).run(id, categoryId, `${TAG} line`, now, now);
	}
	txnA = `txn-${TAG}-a`;
	txnB = `txn-${TAG}-b`;

	const form = new FormData();
	form.append('file', new File([PDF], 'taxi.pdf', { type: 'application/pdf' }));
	const res = await fetch(`${BASE}/api/ledger/transactions/${txnA}/receipts`, {
		method: 'POST',
		body: form
	});
	expect(res.status, 'uploading a receipt failed').toBe(201);
	receiptId = ((await res.json()) as { receipt: { id: string } }).receipt.id;
});

afterAll(() => {
	cleanup();
	db.close();
});

describe('receipts belong to their transaction', () => {
	it('serves the bytes through the transaction that owns them', async () => {
		const res = await fetch(`${BASE}/api/ledger/transactions/${txnA}/receipts/${receiptId}`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('application/pdf');
		// Private, never in a shared cache: this is somebody's financial record.
		expect(res.headers.get('cache-control')).toContain('no-store');
		const bytes = new Uint8Array(await res.arrayBuffer());
		expect(bytes.length).toBe(PDF.length);
	});

	it('refuses the same receipt through a different transaction', async () => {
		const res = await fetch(`${BASE}/api/ledger/transactions/${txnB}/receipts/${receiptId}`);
		expect(res.status, 'a receipt was served through the wrong transaction').toBe(404);
	});

	it('refuses a file that is not a receipt', async () => {
		const form = new FormData();
		form.append('file', new File([new Uint8Array([1, 2, 3])], 'notes.exe', {
			type: 'application/x-msdownload'
		}));
		const res = await fetch(`${BASE}/api/ledger/transactions/${txnA}/receipts`, {
			method: 'POST',
			body: form
		});
		expect(res.status).toBe(415);
	});

	/**
	 * A receipt cannot outlive its transaction.
	 *
	 * Enforced by the foreign key rather than by whatever deletes the row, so a
	 * transaction removed by any route or by hand takes its receipts with it
	 * instead of leaving records pointing at nothing.
	 */
	it('goes when the transaction goes', () => {
		const before = (
			db
				.prepare('SELECT COUNT(*) AS n FROM expense_receipts WHERE transaction_id = ?')
				.get(txnA) as { n: number }
		).n;
		expect(before).toBeGreaterThan(0);

		db.exec('PRAGMA foreign_keys=ON');
		db.prepare('DELETE FROM ledger_transactions WHERE id = ?').run(txnA);

		const after = (
			db
				.prepare('SELECT COUNT(*) AS n FROM expense_receipts WHERE transaction_id = ?')
				.get(txnA) as { n: number }
		).n;
		expect(after, 'a receipt outlived its transaction').toBe(0);
	});
});
