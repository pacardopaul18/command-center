import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Payments post to the ledger once, as deltas, and the invoice agrees.
 *
 * Written before the migration. Each of these pins a way of getting silent
 * revenue: a payment counted twice, a partial payment posted as the running
 * total instead of the amount received, and an invoice whose paid figure has
 * drifted from the payments that produced it.
 *
 * The second one is the reason this epic exists. `amount_paid_cents` is
 * cumulative, so posting "the paid amount" on every payment posts 500, then
 * 1200, then 2000 for an invoice that received 500, 700 and 800. Every figure
 * is a real number that appears on a real invoice, which is what makes it hard
 * to see.
 *
 * All money here is synthetic.
 */

const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const BASE = 'http://localhost:5173';
const TAG = 'pay-test';

function openDb(): DatabaseSync {
	const file = readdirSync(DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	if (!file) throw new Error('Local D1 not found.');
	return new DatabaseSync(join(DIR, file));
}

let db: DatabaseSync;
let clientId = '';
let invoiceId = '';

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

const post = (path: string, body: unknown) =>
	api(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});

function cleanup() {
	db.prepare(
		`DELETE FROM ledger_transactions WHERE source_payment_id IN
     (SELECT id FROM invoice_payments WHERE invoice_id = ?)`
	).run(invoiceId || '');
	db.prepare('DELETE FROM invoice_payments WHERE invoice_id = ?').run(invoiceId || '');
	db.prepare('DELETE FROM invoices WHERE id = ?').run(invoiceId || '');
}

/** The invoice under test: 2,000.00 in USD, nothing paid yet. */
const INVOICE_CENTS = 200000;

beforeAll(() => {
	db = openDb();
	const client = db.prepare('SELECT id FROM clients ORDER BY created_at LIMIT 1').get() as {
		id: string;
	};
	clientId = client.id;
	invoiceId = `inv-${TAG}`;
	cleanup();

	const now = '2026-08-31T00:00:00Z';
	db.prepare(
		`INSERT INTO invoices
     (id, client_id, invoice_number, issue_date, due_date, amount_cents, amount_paid_cents,
      status, created_at, updated_at)
     VALUES (?, ?, ?, '2026-08-01', '2026-08-31', ?, 0, 'sent', ?, ?)`
	).run(invoiceId, clientId, `${TAG}-001`, INVOICE_CENTS, now, now);
});

afterAll(() => {
	cleanup();
	db.close();
});

function ledgerRowsForInvoice() {
	return db
		.prepare(
			`SELECT t.id, t.amount_cents, t.currency, t.client_id, t.source_payment_id
       FROM ledger_transactions t
       JOIN invoice_payments p ON p.id = t.source_payment_id
       WHERE p.invoice_id = ?
       ORDER BY t.created_at`
		)
		.all(invoiceId) as { amount_cents: number; currency: string; client_id: string | null }[];
}

describe('a payment posts once, as what was received', () => {
	it('posts the amount received, never the running total', async () => {
		// Three partial payments on one invoice. The running total after each is
		// 500, 1200, 2000; the amounts received are 500, 700, 800.
		for (const [paidOn, amount] of [
			['2026-08-10', '500.00'],
			['2026-08-20', '700.00'],
			['2026-08-28', '800.00']
		]) {
			const { res } = await post(`/api/invoicing/invoices/${invoiceId}/payments`, {
				paid_on: paidOn,
				amount
			});
			expect(res.status, 'recording a payment failed').toBe(201);
		}

		const rows = ledgerRowsForInvoice();
		expect(rows.map((r) => r.amount_cents), 'the ledger posted running totals').toEqual([
			50000, 70000, 80000
		]);

		// And they add to the invoice, not to more than it.
		const total = rows.reduce((n, r) => n + r.amount_cents, 0);
		expect(total).toBe(INVOICE_CENTS);
	});

	it('carries the currency and the client from the invoice', () => {
		const rows = ledgerRowsForInvoice();
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) {
			expect(row.currency, 'a posted row has no currency').toBeTruthy();
			expect(row.client_id, 'the posting lost the client').toBe(clientId);
		}
	});

	/**
	 * The invoice's paid figure is derived, so it cannot drift.
	 *
	 * It used to be set directly by a PATCH, which is how a paid total and its
	 * payments come to disagree with nothing reporting it.
	 */
	it('keeps amount_paid_cents equal to the sum of its payments', () => {
		const invoice = db
			.prepare('SELECT amount_paid_cents, status FROM invoices WHERE id = ?')
			.get(invoiceId) as { amount_paid_cents: number; status: string };
		const summed = (
			db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS n FROM invoice_payments WHERE invoice_id = ?').get(
				invoiceId
			) as { n: number }
		).n;

		expect(invoice.amount_paid_cents).toBe(summed);
		expect(invoice.amount_paid_cents).toBe(INVOICE_CENTS);
		expect(invoice.status, 'a fully paid invoice is not marked paid').toBe('paid');
	});

	/**
	 * The idempotency guard is keyed on the payment, which is the event it
	 * guards. Keying it on the invoice was the E1 mistake: it made the second
	 * partial payment impossible rather than making a retry safe.
	 */
	it('refuses a second posting of the same payment', () => {
		const payment = db
			.prepare('SELECT id FROM invoice_payments WHERE invoice_id = ? LIMIT 1')
			.get(invoiceId) as { id: string };
		const existing = db
			.prepare('SELECT category_id FROM ledger_transactions WHERE source_payment_id = ?')
			.get(payment.id) as { category_id: string } | undefined;
		expect(existing, 'the payment never posted').toBeTruthy();

		const now = '2026-08-31T00:00:00Z';
		expect(() =>
			db
				.prepare(
					`INSERT INTO ledger_transactions
           (id, category_id, client_id, project_id, txn_date, amount_cents, currency,
            provenance, source_invoice_id, source_payment_id, notes, created_at, updated_at)
           VALUES (?, ?, NULL, NULL, '2026-08-10', 50000, 'USD', 'invoice', NULL, ?, NULL, ?, ?)`
				)
				.run(`dup-${TAG}`, existing?.category_id ?? '', payment.id, now, now)
		).toThrow();
	});

	/** Two partial payments must both post, which the old index forbade. */
	it('allows more than one posting per invoice', () => {
		expect(ledgerRowsForInvoice().length).toBeGreaterThan(1);
	});
});
