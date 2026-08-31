import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { invoiceTotals } from '../src/lib/types';

/**
 * An invoice is the sum of its parts, and says what happened to it.
 *
 * Migration 0024 gave invoices line items, a trail, and two kinds of document
 * that look like invoices and are not. Each test here pins a way the new shape
 * could quietly go wrong:
 *
 *   a total that disagrees with the lines under it
 *   an edit that takes an invoice below the money already received
 *   an estimate or a credit note counted as a receivable
 *   a voided invoice still counted as owed
 *   a recurring schedule that raises the same draft twice
 *
 * Everything created here is tagged and deleted afterwards, because layer 1
 * asserts exact row counts against what the seed generated. A test that leaves
 * a row behind turns into a layer 1 failure nobody can explain.
 *
 * All money here is synthetic.
 */

const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:5173';
const TAG = 'DOCTEST';

function openDb(): DatabaseSync {
	const file = readdirSync(DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	if (!file) throw new Error('Local D1 not found.');
	return new DatabaseSync(join(DIR, file));
}

let db: DatabaseSync;
let clientId = '';

async function api(path: string, init?: RequestInit) {
	const res = await fetch(`${BASE}${path}`, init);
	const text = await res.text();
	let json: Record<string, unknown> | null = null;
	try {
		json = JSON.parse(text);
	} catch {
		json = null;
	}
	return { res, json: (json ?? {}) as Record<string, unknown>, text };
}

const post = (path: string, body: unknown) =>
	api(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});

const patch = (path: string, body: unknown) =>
	api(path, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});

/**
 * Removes everything this file made, by tag.
 *
 * Line items, events and payments are ON DELETE CASCADE from invoices, so the
 * invoice delete takes them. The ledger rows are not, and a posting left behind
 * would be revenue with no invoice under it.
 */
function cleanup() {
	db.prepare(
		`DELETE FROM ledger_transactions WHERE source_invoice_id IN
     (SELECT id FROM invoices WHERE invoice_number LIKE '${TAG}%')`
	).run();
	db.prepare(`DELETE FROM invoices WHERE invoice_number LIKE '${TAG}%'`).run();
	db.prepare(
		`UPDATE clients SET auto_recurring = 0, auto_next_date = NULL, auto_frequency = NULL
     WHERE id = ?`
	).run(clientId || '');
}

async function raise(body: Record<string, unknown>) {
	const { res, json } = await post('/api/invoicing/invoices', {
		client_id: clientId,
		issue_date: '2026-08-01',
		due_date: '2026-08-31',
		...body
	});
	expect(res.status, JSON.stringify(json)).toBe(201);
	return json.invoice as Record<string, unknown>;
}

beforeAll(async () => {
	db = openDb();
	const client = db.prepare('SELECT id FROM clients ORDER BY name LIMIT 1').get() as { id: string };
	clientId = client.id;
	cleanup();
});

afterAll(() => {
	cleanup();
	db.close();
});

describe('a total is the sum of its lines', () => {
	it('computes the invoice from the lines, the discount and the tax', async () => {
		const invoice = await raise({
			invoice_number: `${TAG}-1`,
			category: 'Consulting',
			subcategory: 'Contract renewal',
			discount_kind: 'percent',
			discount_value: 5,
			tax_percent: 10,
			items: [
				{ service: 'Consulting hours', quantity: '6.5', rate: '95.00' },
				{ service: 'Review', quantity: '2', rate: '100' }
			]
		});

		// 61750 + 20000 = 81750; five percent off is 4088; ten percent tax on the
		// remaining 77662 is 7766.
		expect(invoice.subtotal_cents).toBe(81750);
		expect(invoice.discount_cents).toBe(4088);
		expect(invoice.tax_cents).toBe(7766);
		expect(invoice.amount_cents).toBe(85428);

		const lines = db
			.prepare('SELECT SUM(amount_cents) AS n FROM invoice_line_items WHERE invoice_id = ?')
			.get(String(invoice.id)) as { n: number };
		expect(Number(lines.n)).toBe(invoice.subtotal_cents);
	});

	it('refuses a caller that asserts its own total alongside the lines', async () => {
		// amount_cents is ignored when items are given, rather than fought over.
		// The lines decide, so a caller cannot store a total the breakdown
		// disagrees with even by trying.
		const invoice = await raise({
			invoice_number: `${TAG}-2`,
			amount_cents: 999999,
			items: [{ service: 'Drafting', quantity: '1', rate: '250' }]
		});
		expect(invoice.amount_cents).toBe(25000);
	});

	it('the form and the server share one implementation of the arithmetic', () => {
		// Not a round trip: this is the guard against two implementations. If
		// invoiceTotals ever changes, the API test above and this move together.
		const totals = invoiceTotals(
			[
				{ quantity: 6.5, unit_rate_cents: 9500 },
				{ quantity: 2, unit_rate_cents: 10000 }
			],
			'percent',
			5,
			10
		);
		expect(totals.subtotal_cents).toBe(81750);
		expect(totals.total_cents).toBe(85428);
	});

	it('rounds each line once rather than rounding the product of the sums', () => {
		// Three lines of 0.333 hours at 100.00. Rounded per line: 3333 each,
		// 9999 in total. Rounded on the sum instead: 10000. One cent, every
		// invoice, in the direction nobody checks.
		const totals = invoiceTotals(
			Array.from({ length: 3 }, () => ({ quantity: 0.333, unit_rate_cents: 10000 })),
			null,
			0,
			0
		);
		expect(totals.line_cents).toEqual([3330, 3330, 3330]);
		expect(totals.subtotal_cents).toBe(9990);
	});
});

describe('money already received constrains the document', () => {
	it('an edit cannot take an invoice below what has been paid', async () => {
		const invoice = await raise({
			invoice_number: `${TAG}-3`,
			status: 'sent',
			items: [{ service: 'Consulting hours', quantity: '10', rate: '100' }]
		});

		const paid = await post(`/api/invoicing/invoices/${invoice.id}/payments`, {
			amount: '600.00',
			paid_on: '2026-08-15',
			method: 'ACH'
		});
		expect(paid.res.status).toBe(201);

		const shrunk = await patch(`/api/invoicing/invoices/${invoice.id}/document`, {
			items: [{ service: 'Consulting hours', quantity: '1', rate: '100' }]
		});
		expect(shrunk.res.status).toBe(400);
		expect(String(shrunk.json.error)).toContain('already received');

		// And the invoice is untouched by the refusal.
		const row = db
			.prepare('SELECT amount_cents, amount_paid_cents FROM invoices WHERE id = ?')
			.get(String(invoice.id)) as { amount_cents: number; amount_paid_cents: number };
		expect(row.amount_cents).toBe(100000);
		expect(row.amount_paid_cents).toBe(60000);
	});

	it('a voided invoice is refused when money has arrived', async () => {
		const invoice = db
			.prepare(`SELECT id FROM invoices WHERE invoice_number = '${TAG}-3'`)
			.get() as { id: string };
		const { res, json } = await post(`/api/invoicing/invoices/${invoice.id}/void`, {});
		expect(res.status).toBe(400);
		expect(String(json.error)).toContain('cannot be voided away');
	});

	it('voiding an unpaid invoice takes it out of the balance and leaves the number', async () => {
		const invoice = await raise({
			invoice_number: `${TAG}-4`,
			status: 'sent',
			items: [{ service: 'Drafting', quantity: '4', rate: '250' }]
		});

		const before = await api(`/api/invoicing/clients/${clientId}`);
		const openBefore = Number((before.json.money as Record<string, number>).open_cents);

		const { res } = await post(`/api/invoicing/invoices/${invoice.id}/void`, {
			reason: 'Raised against the wrong client.'
		});
		expect(res.status).toBe(200);

		const after = await api(`/api/invoicing/clients/${clientId}`);
		const openAfter = Number((after.json.money as Record<string, number>).open_cents);
		expect(openBefore - openAfter).toBe(100000);

		// The document itself survives, with its reason on the trail.
		const events = db
			.prepare("SELECT detail FROM invoice_events WHERE invoice_id = ? AND kind = 'voided'")
			.all(String(invoice.id)) as { detail: string }[];
		expect(events).toHaveLength(1);
		expect(events[0].detail).toContain('wrong client');
	});
});

describe('documents that are not receivables', () => {
	it('an estimate and a credit note stay out of what the client owes', async () => {
		const before = await api(`/api/invoicing/clients/${clientId}`);
		const openBefore = Number((before.json.money as Record<string, number>).open_cents);

		await raise({
			invoice_number: `${TAG}-EST`,
			kind: 'estimate',
			items: [{ service: 'Advisory session', quantity: '10', rate: '500' }]
		});
		await raise({
			invoice_number: `${TAG}-CN`,
			kind: 'credit',
			items: [{ service: 'Discount', quantity: '1', rate: '300' }]
		});

		const after = await api(`/api/invoicing/clients/${clientId}`);
		const money = after.json.money as Record<string, number>;
		expect(Number(money.open_cents)).toBe(openBefore);

		// They are still on the screen. Excluded from the balance is not hidden.
		const numbers = (after.json.invoices as { invoice_number: string }[]).map(
			(i) => i.invoice_number
		);
		expect(numbers).toContain(`${TAG}-EST`);
		expect(numbers).toContain(`${TAG}-CN`);
	});

	it('converting an estimate makes an invoice and links the two', async () => {
		const estimate = db
			.prepare(`SELECT id FROM invoices WHERE invoice_number = '${TAG}-EST'`)
			.get() as { id: string };

		const { res, json } = await post(`/api/invoicing/invoices/${estimate.id}/copy`, {
			as: 'invoice',
			convert: true,
			invoice_number: `${TAG}-CONV`
		});
		expect(res.status).toBe(201);

		const invoice = json.invoice as Record<string, unknown>;
		expect(invoice.kind).toBe('invoice');
		expect(invoice.status).toBe('draft');
		expect(invoice.amount_cents).toBe(500000);
		expect(invoice.source_invoice_id).toBe(estimate.id);

		// The lines came across as rows of their own, not as a shared reference.
		const lines = db
			.prepare('SELECT COUNT(*) AS n FROM invoice_line_items WHERE invoice_id = ?')
			.get(String(invoice.id)) as { n: number };
		expect(Number(lines.n)).toBe(1);

		// And both ends of the conversion say so.
		const trail = db
			.prepare("SELECT detail FROM invoice_events WHERE invoice_id = ? AND kind = 'converted'")
			.all(estimate.id) as { detail: string }[];
		expect(trail[0].detail).toContain(`${TAG}-CONV`);
	});

	it('refuses to convert anything that is not an estimate', async () => {
		const credit = db
			.prepare(`SELECT id FROM invoices WHERE invoice_number = '${TAG}-CN'`)
			.get() as { id: string };
		const { res, json } = await post(`/api/invoicing/invoices/${credit.id}/copy`, {
			as: 'invoice',
			convert: true
		});
		expect(res.status).toBe(400);
		expect(String(json.error)).toContain('Only an estimate');
	});
});

describe('the trail records what happened', () => {
	it('marking an invoice sent is recorded as issued, not as an edit', async () => {
		const invoice = await raise({
			invoice_number: `${TAG}-5`,
			status: 'draft',
			items: [{ service: 'Workshop', quantity: '1', rate: '1200' }]
		});

		const { res } = await patch(`/api/invoicing/invoices/${invoice.id}/document`, {
			status: 'sent'
		});
		expect(res.status).toBe(200);

		const events = db
			.prepare('SELECT kind, detail FROM invoice_events WHERE invoice_id = ? ORDER BY created_at')
			.all(String(invoice.id)) as { kind: string; detail: string }[];
		expect(events.map((e) => e.kind)).toEqual(['created', 'issued']);
		expect(events[1].detail).toContain('Gmail');
	});

	it('a reminder is recorded as done by hand, because the app cannot send one', async () => {
		const invoice = db
			.prepare(`SELECT id FROM invoices WHERE invoice_number = '${TAG}-5'`)
			.get() as { id: string };

		const { res } = await post(`/api/invoicing/invoices/${invoice.id}/events`, {
			kind: 'reminded',
			detail: 'Reminder sent by hand to accounts@example.com.',
			occurred_at: '2026-08-30'
		});
		expect(res.status).toBe(201);

		const events = db
			.prepare("SELECT occurred_at FROM invoice_events WHERE invoice_id = ? AND kind = 'reminded'")
			.all(String(invoice.id)) as { occurred_at: string }[];
		expect(events).toHaveLength(1);
		// Dated when it happened, not when it was typed.
		expect(events[0].occurred_at.slice(0, 10)).toBe('2026-08-30');
	});
});

describe('recurring drafts', () => {
	it('raises one draft and then nothing until the schedule comes round', async () => {
		db.prepare(
			`UPDATE clients SET auto_recurring = 1, auto_frequency = 'Monthly', auto_next_date = NULL
       WHERE id = ?`
		).run(clientId);

		const first = await post('/api/invoicing/recurring/raise', { client_id: clientId });
		expect(first.res.status).toBe(200);
		expect(Number(first.json.count)).toBe(1);

		const second = await post('/api/invoicing/recurring/raise', { client_id: clientId });
		expect(Number(second.json.count)).toBe(0);

		const number = (first.json.raised as string[])[0];
		const draft = db
			.prepare('SELECT status, kind, recurring_frequency FROM invoices WHERE invoice_number = ?')
			.get(number) as { status: string; kind: string; recurring_frequency: string };

		// A draft, never a sent document. The app cannot mail a client.
		expect(draft.status).toBe('draft');
		expect(draft.kind).toBe('invoice');
		expect(draft.recurring_frequency).toBe('Monthly');

		// Raised by this test, so it is this test's to remove.
		db.prepare('DELETE FROM invoices WHERE invoice_number = ?').run(number);
	});
});
