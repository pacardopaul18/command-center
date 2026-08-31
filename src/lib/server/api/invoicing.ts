import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { ApiEnv } from './env';
import { nowUtc, todayInWorkingZone } from '../dates';
import {
	ApiError,
	oneOf,
	optionalDate,
	optionalText,
	readJsonObject,
	requiredText
} from './validate';
import {
	DISCOUNT_KINDS,
	INVOICE_EVENT_KINDS,
	INVOICE_KINDS,
	INVOICE_STATUSES,
	PERIOD_STATUSES,
	formatMoney,
	formatUsd,
	invoiceTotals,
	parseMoneyToCents
} from '$lib/types';
import { PAGE_SIZES, readPaging } from './action-items';
import type {
	DiscountKind,
	InvoiceEventKind,
	InvoiceKind,
	InvoiceStatus,
	PeriodStatus
} from '$lib/types';
import { invoicingClients } from './invoicing-clients';
import { nextInvoiceNumber, raiseRecurringDrafts } from '../recurring';

/**
 * Billing periods, time entries and invoices.
 *
 * Aging is computed at read time from the due date against today in Mountain
 * Time. It is never stored, because a stored bucket is wrong the morning after
 * it is written. Same reasoning for "overdue", which is not an invoice status:
 * an invoice is overdue when it is unpaid and its due date has passed, which is
 * a question about today rather than about the row.
 */

const PERIOD_SELECT = `
  SELECT bp.*,
    cl.name AS client_name,
    (SELECT COUNT(*) FROM time_entries WHERE billing_period_id = bp.id) AS entry_count,
    COALESCE((SELECT SUM(hours) FROM time_entries WHERE billing_period_id = bp.id), 0) AS total_hours,
    COALESCE((SELECT SUM(hours) FROM time_entries WHERE billing_period_id = bp.id AND billable = 1), 0) AS billable_hours,
    (SELECT id FROM invoices WHERE billing_period_id = bp.id LIMIT 1) AS invoice_id,
    (SELECT invoice_number FROM invoices WHERE billing_period_id = bp.id LIMIT 1) AS invoice_number
  FROM billing_periods bp
  JOIN clients cl ON cl.id = bp.client_id
`;

/**
 * ?1 is today. Everything derived hangs off it.
 * days_overdue is negative while an invoice is still within terms; the 0 to 30
 * bucket deliberately catches that case as well as the first month past due.
 */
export const INVOICE_SELECT = `
  SELECT i.*,
    cl.name AS client_name,
    (i.amount_cents - i.amount_paid_cents) AS outstanding_cents,
    CAST(julianday(?1) - julianday(i.due_date) AS INTEGER) AS days_overdue,
    CASE
      WHEN i.amount_paid_cents >= i.amount_cents THEN NULL
      WHEN julianday(?1) - julianday(i.due_date) <= 30 THEN 'b0_30'
      WHEN julianday(?1) - julianday(i.due_date) <= 60 THEN 'b31_60'
      WHEN julianday(?1) - julianday(i.due_date) <= 90 THEN 'b61_90'
      ELSE 'b90_plus'
    END AS aging_bucket,
    CASE
      WHEN i.amount_paid_cents < i.amount_cents AND julianday(?1) > julianday(i.due_date)
      THEN 1 ELSE 0
    END AS is_overdue
  FROM invoices i
  JOIN clients cl ON cl.id = i.client_id
`;

/**
 * What counts as money owed.
 *
 * Migration 0024 put three things in `invoices` that are not receivables: an
 * estimate that has not been agreed, a credit note that is owed the other way,
 * and a voided document that counts toward nothing. Every total, band and
 * balance in the app filters on this, and it is exported rather than retyped so
 * that a screen cannot quietly disagree with a report about what the firm is
 * owed.
 *
 * Written as a fragment against the alias `i`, which every query here uses.
 */
export const RECEIVABLE = `i.kind = 'invoice' AND i.voided_at IS NULL`;

export const invoicing = new Hono<ApiEnv>();

/**
 * The client side of the screen: the headline figures, the rail, one client's
 * documents, and the billing profile. Mounted here so everything invoicing
 * still answers under /api/invoicing, split into its own file because reading
 * money and writing documents are different jobs.
 *
 * Registered before the routes below because Hono matches in order and
 * /clients/:id must not be swallowed by anything more general added later.
 */
invoicing.route('/', invoicingClients);

// --- Line items, totals and the trail ---------------------------------------

interface DraftLine {
	service: string;
	description: string | null;
	quantity: number;
	unit_rate_cents: number;
}

/**
 * Reads the line items off a request body.
 *
 * Quantities arrive as strings from a form and rates as money strings, because
 * that is what a person types. Both are parsed here, once, and anything that
 * does not parse is refused rather than coerced: a line silently read as zero
 * hours is an invoice that is wrong by exactly the work it was raised for.
 */
function readLineItems(raw: unknown): DraftLine[] {
	if (!Array.isArray(raw)) throw new ApiError(400, 'The line items must be a list.');
	if (raw.length === 0) throw new ApiError(400, 'An invoice needs at least one line item.');
	if (raw.length > 60) throw new ApiError(400, 'An invoice can carry at most 60 line items.');

	return raw.map((entry, index) => {
		const line = (entry ?? {}) as Record<string, unknown>;
		const at = `Line ${index + 1}`;

		const quantity = Number(
			typeof line.quantity === 'string' ? line.quantity.trim() : line.quantity
		);
		if (!Number.isFinite(quantity) || quantity <= 0) {
			throw new ApiError(400, `${at}: the quantity must be a number greater than zero.`);
		}

		const rateRaw = line.unit_rate_cents ?? line.rate;
		const rateCents =
			typeof rateRaw === 'number'
				? Math.round(rateRaw)
				: parseMoneyToCents(String(rateRaw ?? ''));
		if (rateCents === null || rateCents < 0) {
			throw new ApiError(400, `${at}: the rate must be an amount such as 95 or 95.00.`);
		}

		return {
			service: requiredText(line.service, `${at} product or service`, 120),
			description: optionalText(line.description, `${at} description`, 500),
			quantity,
			unit_rate_cents: rateCents
		};
	});
}

/** The discount instruction, as asked for rather than as applied. */
function readDiscount(body: Record<string, unknown>): { kind: DiscountKind | null; value: number } {
	const rawKind = body.discount_kind;
	if (rawKind === null || rawKind === undefined || rawKind === '') return { kind: null, value: 0 };
	const kind = oneOf<DiscountKind>(rawKind, DISCOUNT_KINDS, 'discount_kind', 'percent');

	const rawValue = body.discount_value;
	if (kind === 'amount') {
		const cents =
			typeof rawValue === 'number'
				? Math.round(rawValue)
				: parseMoneyToCents(String(rawValue ?? '0'));
		if (cents === null || cents < 0) {
			throw new ApiError(400, 'The discount must be an amount such as 250 or 250.00.');
		}
		return { kind, value: cents };
	}

	const percent = Number(rawValue ?? 0);
	if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
		throw new ApiError(400, 'A percentage discount must be between 0 and 100.');
	}
	return { kind, value: percent };
}

function readTaxPercent(raw: unknown): number {
	const percent = Number(raw ?? 0);
	if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
		throw new ApiError(400, 'Tax must be a percentage between 0 and 100.');
	}
	return percent;
}

/**
 * Appends to the trail.
 *
 * Never throws into the caller's path on its own account. A failed history
 * write must not undo a payment that was recorded, so the failure is returned
 * and the caller decides. Every route below reports it in the response rather
 * than swallowing it, the same shape the ledger posting uses.
 */
async function logEvent(
	db: D1Database,
	invoiceId: string,
	kind: InvoiceEventKind,
	detail: string,
	occurredAt?: string
): Promise<string | null> {
	const now = nowUtc();
	try {
		await db
			.prepare(
				`INSERT INTO invoice_events (id, invoice_id, occurred_at, kind, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
			)
			.bind(crypto.randomUUID(), invoiceId, occurredAt ?? now, kind, detail, now)
			.run();
		return null;
	} catch {
		return 'The change was saved but did not reach the invoice trail.';
	}
}

/** Replaces every line on an invoice, in order, and returns what they came to. */
async function writeLineItems(db: D1Database, invoiceId: string, lines: DraftLine[]) {
	const now = nowUtc();
	const totals = invoiceTotals(lines, null, 0, 0);

	await db.prepare('DELETE FROM invoice_line_items WHERE invoice_id = ?').bind(invoiceId).run();

	const statements = lines.map((line, index) =>
		db
			.prepare(
				`INSERT INTO invoice_line_items
         (id, invoice_id, position, service, description, quantity, unit_rate_cents,
          amount_cents, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				crypto.randomUUID(),
				invoiceId,
				index + 1,
				line.service,
				line.description,
				line.quantity,
				line.unit_rate_cents,
				totals.line_cents[index],
				now,
				now
			)
	);
	if (statements.length > 0) await db.batch(statements);
	return totals;
}

/** A one line summary of a document, for the trail. */
function describeDocument(kind: InvoiceKind, lines: DraftLine[], totalCents: number) {
	const noun = kind === 'estimate' ? 'Estimate' : kind === 'credit' ? 'Credit note' : 'Invoice';
	const count = `${lines.length} line item${lines.length === 1 ? '' : 's'}`;
	return `${noun}: ${count}, total ${formatUsd(totalCents)}.`;
}

/**
 * Database CHECK and FOREIGN KEY failures here are caller mistakes, not server
 * faults. Translating them means the user sees which rule they broke instead of
 * "Something went wrong on the server."
 */
function asClientError(err: unknown): unknown {
	const text = String(err);
	if (text.includes('due_date >= issue_date')) {
		return new ApiError(400, 'The due date cannot be before the issue date.');
	}
	if (text.includes('amount_paid_cents <= amount_cents')) {
		return new ApiError(400, 'The paid amount cannot exceed the invoice amount.');
	}
	if (text.includes('period_end >= period_start')) {
		return new ApiError(400, 'The period end cannot be before the period start.');
	}
	if (text.includes('hours > 0')) {
		return new ApiError(400, 'Hours must be greater than zero.');
	}
	if (text.includes('FOREIGN KEY constraint failed')) {
		return new ApiError(400, 'That client, project or period does not exist.');
	}
	if (text.includes('UNIQUE')) {
		return new ApiError(409, 'That invoice number already exists.');
	}
	return err;
}

/** Everything the Invoicing screen needs, in one round trip. */
invoicing.get('/', async (c) => {
	const db = c.env.DB;
	const day = todayInWorkingZone();

	const periods = await db
		.prepare(
			`${PERIOD_SELECT}
       ORDER BY
         CASE bp.status WHEN 'open' THEN 0 WHEN 'reconciled' THEN 1 WHEN 'invoiced' THEN 2 ELSE 3 END,
         bp.period_end DESC`
		)
		.all();

	// Invoices paginate. Billing periods do not: there are a few hundred at most
	// and the screen groups by them, so splitting them across pages would break
	// the grouping to save nothing.
	const { page, pageSize } = readPaging(c);
	const totalRow = await db
		.prepare("SELECT COUNT(*) AS n FROM invoices i WHERE " + RECEIVABLE)
		.first<{ n: number }>();
	const total = Number(totalRow?.n ?? 0);
	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const safePage = Math.min(page, pageCount);

	const invoices = await db
		.prepare(
			`${INVOICE_SELECT} WHERE ${RECEIVABLE} ORDER BY is_overdue DESC, i.due_date ASC LIMIT ? OFFSET ?`
		)
		.bind(day, pageSize, (safePage - 1) * pageSize)
		.all();

	// Band totals come from the same derivation as the rows, in one query, so
	// the bands and the list can never disagree.
	const bands = await db
		.prepare(
			`SELECT aging_bucket,
              COUNT(*) AS invoice_count,
              SUM(outstanding_cents) AS outstanding_cents
       FROM (${INVOICE_SELECT} WHERE ${RECEIVABLE})
       WHERE aging_bucket IS NOT NULL
       GROUP BY aging_bucket`
		)
		.bind(day)
		.all();

	return c.json({
		today: day,
		periods: periods.results ?? [],
		invoices: invoices.results ?? [],
		// The bands are deliberately computed over every invoice, not the page.
		// A total that only counts the rows on screen is a different number
		// wearing the same label.
		bands: bands.results ?? [],
		paging: { page: safePage, page_size: pageSize, total, page_count: pageCount, sizes: PAGE_SIZES }
	});
});

// --- Billing periods ---

invoicing.post('/periods', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const now = nowUtc();
	const id = crypto.randomUUID();

	const start = optionalDate(body.period_start, 'Period start');
	const end = optionalDate(body.period_end, 'Period end');
	if (!start || !end) throw new ApiError(400, 'A billing period needs a start and an end date.');
	if (end < start) throw new ApiError(400, 'The period end cannot be before the period start.');

	try {
		await c.env.DB.prepare(
			`INSERT INTO billing_periods (id, client_id, period_start, period_end, status, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`
		)
			.bind(
			id,
			requiredText(body.client_id, 'Client', 64),
			start,
			end,
				optionalText(body.note, 'Note', 500),
				now,
				now
			)
			.run();
	} catch (err) {
		throw asClientError(err);
	}

	const created = await c.env.DB.prepare(`${PERIOD_SELECT} WHERE bp.id = ?`).bind(id).first();
	return c.json({ period: created }, 201);
});

/**
 * Reconciling and invoicing are status moves on the period, so they share this
 * route. The lifecycle is linear and only moves forward: open, reconciled,
 * invoiced, paid. Going backwards would make the invoice that already exists
 * against a period meaningless.
 */
invoicing.patch('/periods/:id', async (c) => {
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw);

	const existing = await c.env.DB.prepare('SELECT status FROM billing_periods WHERE id = ?')
		.bind(id)
		.first<{ status: PeriodStatus }>();
	if (!existing) throw new ApiError(404, 'Billing period not found.');

	const sets: string[] = [];
	const binds: unknown[] = [];

	if ('status' in body) {
		const next = oneOf<PeriodStatus>(body.status, PERIOD_STATUSES, 'status', 'open');
		const from = PERIOD_STATUSES.indexOf(existing.status);
		const to = PERIOD_STATUSES.indexOf(next);
		if (to < from) {
			throw new ApiError(
				400,
				`A billing period moves forward only. It is already ${existing.status}.`
			);
		}
		if (next === 'reconciled') {
			const entries = await c.env.DB.prepare(
				'SELECT COUNT(*) AS n FROM time_entries WHERE billing_period_id = ?'
			)
				.bind(id)
				.first<{ n: number }>();
			if (!entries?.n) {
				throw new ApiError(400, 'Add at least one time entry before reconciling the period.');
			}
		}
		sets.push('status = ?');
		binds.push(next);
	}

	if ('note' in body) {
		sets.push('note = ?');
		binds.push(optionalText(body.note, 'Note', 500));
	}

	if (sets.length === 0) throw new ApiError(400, 'Nothing to update.');

	sets.push('updated_at = ?');
	binds.push(nowUtc());
	binds.push(id);

	await c.env.DB.prepare(`UPDATE billing_periods SET ${sets.join(', ')} WHERE id = ?`)
		.bind(...binds)
		.run();

	const updated = await c.env.DB.prepare(`${PERIOD_SELECT} WHERE bp.id = ?`).bind(id).first();
	return c.json({ period: updated });
});

invoicing.get('/periods/:id/entries', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT te.*, p.name AS project_name
     FROM time_entries te
     LEFT JOIN projects p ON p.id = te.project_id
     WHERE te.billing_period_id = ?
     ORDER BY te.entry_date ASC, te.created_at ASC`
	)
		.bind(c.req.param('id'))
		.all();
	return c.json({ entries: results ?? [] });
});

// --- Time entries ---

invoicing.post('/entries', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const id = crypto.randomUUID();

	const periodId = requiredText(body.billing_period_id, 'Billing period', 64);
	const period = await c.env.DB.prepare(
		'SELECT client_id, status FROM billing_periods WHERE id = ?'
	)
		.bind(periodId)
		.first<{ client_id: string; status: PeriodStatus }>();
	if (!period) throw new ApiError(404, 'Billing period not found.');
	if (period.status !== 'open') {
		throw new ApiError(400, 'This period is no longer open. Time entries can only be added while it is open.');
	}

	const hours = Number(body.hours);
	if (!Number.isFinite(hours) || hours <= 0) {
		throw new ApiError(400, 'Hours must be a number greater than zero.');
	}

	const entryDate = optionalDate(body.entry_date, 'Entry date');
	if (!entryDate) throw new ApiError(400, 'A time entry needs a date.');

	try {
		await c.env.DB.prepare(
			`INSERT INTO time_entries
       (id, client_id, project_id, billing_period_id, entry_date, hours, description, billable, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
			.bind(
			id,
			period.client_id,
			optionalText(body.project_id, 'project_id', 64),
			periodId,
			entryDate,
			hours,
			optionalText(body.description, 'Description', 500),
			body.billable === false || body.billable === 0 ? 0 : 1,
				oneOf(body.source, ['clockify', 'manual'], 'source', 'manual'),
				nowUtc()
			)
			.run();
	} catch (err) {
		throw asClientError(err);
	}

	const created = await c.env.DB.prepare('SELECT * FROM time_entries WHERE id = ?')
		.bind(id)
		.first();
	return c.json({ entry: created }, 201);
});

// --- Invoices ---

/**
 * Creates an invoice, an estimate or a credit note.
 *
 * Two shapes are accepted, and the difference is which one decides the money:
 *
 *   with `items`        the total is computed from the lines, the discount and
 *                       the tax, and amount_cents is whatever that came to. The
 *                       caller cannot assert a total that disagrees with the
 *                       breakdown, because it never gets to state one.
 *   with amount_cents   the pre-0024 shape, one figure and no parts. Kept
 *                       working: 900 invoices were raised this way and a route
 *                       that stopped accepting it would strand every caller
 *                       that predates line items.
 */
invoicing.post('/invoices', async (c) => {
	const db = c.env.DB;
	const body = await readJsonObject(c.req.raw);
	const now = nowUtc();
	const id = crypto.randomUUID();

	const issue = optionalDate(body.issue_date, 'Issue date');
	const due = optionalDate(body.due_date, 'Due date');
	if (!issue || !due) throw new ApiError(400, 'An invoice needs an issue date and a due date.');
	if (due < issue) throw new ApiError(400, 'The due date cannot be before the issue date.');

	const kind = oneOf<InvoiceKind>(body.kind, INVOICE_KINDS, 'kind', 'invoice');
	const hasItems = 'items' in body && body.items !== null && body.items !== undefined;

	let lines: DraftLine[] = [];
	let amount: number;
	let subtotal: number | null = null;
	let discount = { kind: null as DiscountKind | null, value: 0 };
	let discountCents = 0;
	let taxPercent = 0;
	let taxCents = 0;

	if (hasItems) {
		lines = readLineItems(body.items);
		discount = readDiscount(body);
		taxPercent = readTaxPercent(body.tax_percent);
		const totals = invoiceTotals(lines, discount.kind, discount.value, taxPercent);
		amount = totals.total_cents;
		subtotal = totals.subtotal_cents;
		discountCents = totals.discount_cents;
		taxCents = totals.tax_cents;
	} else {
		amount = Number(body.amount_cents);
		if (!Number.isInteger(amount) || amount < 0) {
			throw new ApiError(400, 'The amount must be a whole number of cents, zero or more.');
		}
	}

	const periodId = optionalText(body.billing_period_id, 'billing_period_id', 64);
	let clientId = optionalText(body.client_id, 'client_id', 64);

	if (periodId) {
		const period = await db
			.prepare('SELECT client_id FROM billing_periods WHERE id = ?')
			.bind(periodId)
			.first<{ client_id: string }>();
		if (!period) throw new ApiError(404, 'Billing period not found.');
		clientId = period.client_id;
	}
	if (!clientId) throw new ApiError(400, 'An invoice needs a client.');

	// An estimate is not a receivable and a credit note is owed the other way,
	// so neither carries a payment status. Both sit as drafts until something
	// happens to them, which for an estimate is being converted.
	const status =
		kind === 'invoice'
			? oneOf<InvoiceStatus>(body.status, INVOICE_STATUSES, 'status', 'sent')
			: 'draft';

	try {
		await db
			.prepare(
				`INSERT INTO invoices
         (id, client_id, billing_period_id, invoice_number, issue_date, due_date,
          amount_cents, amount_paid_cents, status, kind, category, subcategory, message,
          discount_kind, discount_value, discount_cents, tax_percent, tax_cents,
          subtotal_cents, recurring_frequency, source_invoice_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				id,
				clientId,
				periodId,
				requiredText(body.invoice_number, 'Invoice number', 64),
				issue,
				due,
				amount,
				status,
				kind,
				optionalText(body.category, 'Category', 80),
				optionalText(body.subcategory, 'Subcategory', 120),
				optionalText(body.message, 'Message', 1000),
				discount.kind,
				discount.value,
				discountCents,
				taxPercent,
				taxCents,
				subtotal,
				optionalText(body.recurring_frequency, 'Frequency', 40),
				optionalText(body.source_invoice_id, 'source_invoice_id', 64),
				now,
				now
			)
			.run();
	} catch (err) {
		throw asClientError(err);
	}

	if (lines.length > 0) await writeLineItems(db, id, lines);

	const trailError = await logEvent(
		db,
		id,
		'created',
		hasItems
			? describeDocument(kind, lines, amount)
			: `Raised for ${formatUsd(amount)}, without a line breakdown.`
	);

	const created = await db
		.prepare(`${INVOICE_SELECT} WHERE i.id = ?2`)
		.bind(todayInWorkingZone(), id)
		.first();
	return c.json({ invoice: created, trail_error: trailError }, 201);
});

/**
 * Rewrites a document: its dates, its categories, its message, and its lines.
 *
 * Editing the lines rewrites the total, which is the one operation that can
 * collide with money already received. The database refuses an amount below
 * what has been paid, and that refusal is turned into a sentence naming the
 * figure rather than a constraint name.
 */
invoicing.patch('/invoices/:id/document', async (c) => {
	const db = c.env.DB;
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw);
	const now = nowUtc();

	const existing = await db
		.prepare('SELECT * FROM invoices WHERE id = ?')
		.bind(id)
		.first<Record<string, unknown>>();
	if (!existing) throw new ApiError(404, 'Invoice not found.');
	if (existing.voided_at) throw new ApiError(400, 'A voided document cannot be edited.');

	const sets: string[] = [];
	const binds: unknown[] = [];
	const push = (column: string, value: unknown) => {
		sets.push(`${column} = ?`);
		binds.push(value);
	};

	if ('invoice_number' in body) push('invoice_number', requiredText(body.invoice_number, 'Number', 64));
	if ('issue_date' in body) {
		const issue = optionalDate(body.issue_date, 'Issue date');
		if (!issue) throw new ApiError(400, 'The issue date cannot be empty.');
		push('issue_date', issue);
	}
	if ('due_date' in body) {
		const due = optionalDate(body.due_date, 'Due date');
		if (!due) throw new ApiError(400, 'The due date cannot be empty.');
		push('due_date', due);
	}
	if ('category' in body) push('category', optionalText(body.category, 'Category', 80));
	if ('subcategory' in body) push('subcategory', optionalText(body.subcategory, 'Subcategory', 120));
	if ('message' in body) push('message', optionalText(body.message, 'Message', 1000));
	if ('recurring_frequency' in body)
		push('recurring_frequency', optionalText(body.recurring_frequency, 'Frequency', 40));
	if ('status' in body && existing.kind === 'invoice') {
		push('status', oneOf<InvoiceStatus>(body.status, INVOICE_STATUSES, 'status', 'sent'));
	}

	let lines: DraftLine[] | null = null;
	let total = Number(existing.amount_cents);
	if ('items' in body && body.items !== null && body.items !== undefined) {
		lines = readLineItems(body.items);
		const discount = readDiscount(body);
		const taxPercent = readTaxPercent(body.tax_percent);
		const totals = invoiceTotals(lines, discount.kind, discount.value, taxPercent);
		total = totals.total_cents;

		const paid = Number(existing.amount_paid_cents ?? 0);
		if (total < paid) {
			throw new ApiError(
				400,
				`That comes to ${formatUsd(total)}, which is less than the ${formatUsd(paid)} ` +
					'already received on this invoice. Record a refund or void it instead.'
			);
		}

		push('amount_cents', total);
		push('subtotal_cents', totals.subtotal_cents);
		push('discount_kind', discount.kind);
		push('discount_value', discount.value);
		push('discount_cents', totals.discount_cents);
		push('tax_percent', taxPercent);
		push('tax_cents', totals.tax_cents);
	}

	if (sets.length === 0) throw new ApiError(400, 'Nothing to update.');

	sets.push('updated_at = ?');
	binds.push(now, id);

	try {
		await db.prepare(`UPDATE invoices SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
	} catch (err) {
		throw asClientError(err);
	}

	if (lines) await writeLineItems(db, id, lines);

	/**
	 * What the trail says depends on what changed.
	 *
	 * A status move to sent is the moment the document left, which is the event
	 * worth finding later. Calling that "details edited" would bury it among the
	 * typo fixes, so it is recorded as what it is.
	 */
	const becameSent = !lines && body.status === 'sent' && existing.status !== 'sent';
	const trailError = await logEvent(
		db,
		id,
		becameSent ? 'issued' : 'edited',
		lines
			? describeDocument((existing.kind as InvoiceKind) ?? 'invoice', lines, total)
			: becameSent
				? 'Marked as sent. The message itself goes out from Gmail.'
				: 'Details edited.'
	);

	const updated = await db
		.prepare(`${INVOICE_SELECT} WHERE i.id = ?2`)
		.bind(todayInWorkingZone(), id)
		.first();
	return c.json({ invoice: updated, trail_error: trailError });
});

/**
 * One document, with its lines, its trail and the client it is addressed to.
 *
 * What the printable sheet reads. It is a separate route rather than a filter
 * over the client payload because a printed invoice is one document and should
 * not depend on loading every other document the client has.
 */
invoicing.get('/invoices/:id/document', async (c) => {
	const db = c.env.DB;
	const id = c.req.param('id');

	const invoice = await db
		.prepare(`${INVOICE_SELECT} WHERE i.id = ?2`)
		.bind(todayInWorkingZone(), id)
		.first();
	if (!invoice) throw new ApiError(404, 'Invoice not found.');

	const client = await db
		.prepare(
			`SELECT c.*, ct.name AS contact_name, ct.email AS contact_email, ct.phone AS contact_phone
       FROM clients c
       LEFT JOIN contacts ct ON ct.client_id = c.id AND ct.is_primary = 1
       WHERE c.id = ?`
		)
		.bind((invoice as { client_id: string }).client_id)
		.first();

	const items = await db
		.prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY position')
		.bind(id)
		.all();

	const events = await db
		.prepare(
			'SELECT * FROM invoice_events WHERE invoice_id = ? ORDER BY occurred_at DESC, created_at DESC'
		)
		.bind(id)
		.all();

	const payments = await db
		.prepare('SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_on')
		.bind(id)
		.all();

	return c.json({
		invoice: { ...invoice, items: items.results ?? [], events: events.results ?? [] },
		client,
		payments: payments.results ?? []
	});
});

/** Everything that happened to one document, newest first. */
invoicing.get('/invoices/:id/events', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT * FROM invoice_events WHERE invoice_id = ?
     ORDER BY occurred_at DESC, created_at DESC`
	)
		.bind(c.req.param('id'))
		.all();
	return c.json({ events: results ?? [] });
});

/**
 * Adds a line to the trail by hand.
 *
 * This is how a reminder gets recorded. The app cannot mail a client, asserted
 * by tests/layer2-no-send-surface.test.ts, so a chase happens in Gmail and is
 * noted here. Recording what was done outside the app is the honest half of
 * that boundary: the alternative is a screen that knows nothing about the
 * chasing that actually pays the bills.
 */
invoicing.post('/invoices/:id/events', async (c) => {
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw);

	const exists = await c.env.DB.prepare('SELECT id FROM invoices WHERE id = ?').bind(id).first();
	if (!exists) throw new ApiError(404, 'Invoice not found.');

	const kind = oneOf<InvoiceEventKind>(body.kind, INVOICE_EVENT_KINDS, 'kind', 'note');
	const detail = requiredText(body.detail, 'Detail', 500);
	const occurredAt = optionalDate(body.occurred_at, 'Date');

	const error = await logEvent(
		c.env.DB,
		id,
		kind,
		detail,
		occurredAt ? `${occurredAt}T12:00:00Z` : undefined
	);
	if (error) throw new ApiError(500, error);

	const { results } = await c.env.DB.prepare(
		`SELECT * FROM invoice_events WHERE invoice_id = ?
     ORDER BY occurred_at DESC, created_at DESC`
	)
		.bind(id)
		.all();
	return c.json({ events: results ?? [] }, 201);
});

/**
 * Voids a document.
 *
 * Not a delete and not a status. The number stays, the trail stays, and every
 * total stops counting it. An invoice with money against it cannot be voided:
 * that is a refund, which is a different event with a different ledger
 * consequence, and pretending otherwise would leave revenue posted against a
 * document that claims it never existed.
 */
invoicing.post('/invoices/:id/void', async (c) => {
	const db = c.env.DB;
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw).catch(() => ({}) as Record<string, unknown>);

	const existing = await db
		.prepare('SELECT id, amount_paid_cents, voided_at FROM invoices WHERE id = ?')
		.bind(id)
		.first<{ id: string; amount_paid_cents: number; voided_at: string | null }>();
	if (!existing) throw new ApiError(404, 'Invoice not found.');
	if (existing.voided_at) throw new ApiError(400, 'This document is already void.');
	if (Number(existing.amount_paid_cents) > 0) {
		throw new ApiError(
			400,
			`This invoice has ${formatUsd(Number(existing.amount_paid_cents))} against it. ` +
				'Money that arrived cannot be voided away.'
		);
	}

	const now = nowUtc();
	await db
		.prepare('UPDATE invoices SET voided_at = ?, updated_at = ? WHERE id = ?')
		.bind(now, now, id)
		.run();

	const reason = optionalText(body.reason, 'Reason', 300);
	const trailError = await logEvent(
		db,
		id,
		'voided',
		reason ? `Voided. ${reason}` : 'Voided. It no longer counts toward any balance.'
	);

	const updated = await db
		.prepare(`${INVOICE_SELECT} WHERE i.id = ?2`)
		.bind(todayInWorkingZone(), id)
		.first();
	return c.json({ invoice: updated, trail_error: trailError });
});

/** Proposes the next free number, so the form opens with one already in it. */
invoicing.get('/next-number', async (c) => {
	const kind = oneOf<InvoiceKind>(c.req.query('kind'), INVOICE_KINDS, 'kind', 'invoice');
	const prefix = kind === 'estimate' ? 'EST' : kind === 'credit' ? 'CN' : 'INV';
	return c.json({ kind, invoice_number: await nextInvoiceNumber(c.env.DB, prefix) });
});

/**
 * Copies a document, or turns an estimate into an invoice.
 *
 * One route for both, because they are the same operation with a different
 * target kind and a different sentence in the trail. The copy carries the lines
 * and the money instruction, never the payments or the history: a duplicate
 * that inherited a payment would be revenue counted twice.
 */
invoicing.post('/invoices/:id/copy', async (c) => {
	const db = c.env.DB;
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw).catch(() => ({}) as Record<string, unknown>);
	const asKind = oneOf<InvoiceKind>(body.as, INVOICE_KINDS, 'as', 'invoice');
	const converting = body.convert === true;

	const source = await db
		.prepare('SELECT * FROM invoices WHERE id = ?')
		.bind(id)
		.first<Record<string, unknown>>();
	if (!source) throw new ApiError(404, 'Invoice not found.');
	if (converting && source.kind !== 'estimate') {
		throw new ApiError(400, 'Only an estimate is converted. Duplicate anything else.');
	}

	const prefix = asKind === 'estimate' ? 'EST' : asKind === 'credit' ? 'CN' : 'INV';
	const number = optionalText(body.invoice_number, 'Number', 64) ?? (await nextInvoiceNumber(db, prefix));
	const today = todayInWorkingZone();
	const issue = optionalDate(body.issue_date, 'Issue date') ?? today;
	const due = optionalDate(body.due_date, 'Due date') ?? String(source.due_date);
	const newId = crypto.randomUUID();
	const now = nowUtc();

	try {
		await db
			.prepare(
				`INSERT INTO invoices
         (id, client_id, billing_period_id, invoice_number, issue_date, due_date,
          amount_cents, amount_paid_cents, status, kind, category, subcategory, message,
          discount_kind, discount_value, discount_cents, tax_percent, tax_cents,
          subtotal_cents, recurring_frequency, source_invoice_id, created_at, updated_at)
         SELECT ?1, client_id, billing_period_id, ?2, ?3, ?4,
          amount_cents, 0, 'draft', ?5, category, subcategory, message,
          discount_kind, discount_value, discount_cents, tax_percent, tax_cents,
          subtotal_cents, recurring_frequency, ?6, ?7, ?7
         FROM invoices WHERE id = ?6`
			)
			.bind(newId, number, issue, due < issue ? issue : due, asKind, id, now)
			.run();
	} catch (err) {
		throw asClientError(err);
	}

	// The lines come across as new rows rather than as a reference, because two
	// documents sharing one set of lines is one edit away from changing an
	// invoice that has already been sent.
	const lineRows = await db
		.prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY position')
		.bind(id)
		.all<Record<string, unknown>>();
	const lines = lineRows.results ?? [];
	if (lines.length > 0) {
		await db.batch(
			lines.map((line) =>
				db
					.prepare(
						`INSERT INTO invoice_line_items
             (id, invoice_id, position, service, description, quantity, unit_rate_cents,
              amount_cents, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
					)
					.bind(
						crypto.randomUUID(),
						newId,
						line.position,
						line.service,
						line.description,
						line.quantity,
						line.unit_rate_cents,
						line.amount_cents,
						now,
						now
					)
			)
		);
	}

	const sourceNumber = String(source.invoice_number);
	await logEvent(
		db,
		newId,
		converting ? 'converted' : 'duplicated',
		converting ? `Converted from estimate ${sourceNumber}.` : `Copied from ${sourceNumber}.`
	);
	const trailError = await logEvent(
		db,
		id,
		converting ? 'converted' : 'duplicated',
		converting ? `Converted into invoice ${number}.` : `Copied to ${number}.`
	);

	const created = await db
		.prepare(`${INVOICE_SELECT} WHERE i.id = ?2`)
		.bind(today, newId)
		.first();
	return c.json({ invoice: created, trail_error: trailError }, 201);
});

/**
 * Raises the drafts that recurring clients are due.
 *
 * The work is in src/lib/server/recurring.ts because the daily cron calls the
 * same function. One implementation, so a screen and a scheduled job cannot
 * disagree about what has already been raised.
 */
invoicing.post('/recurring/raise', async (c) => {
	const body = await readJsonObject(c.req.raw).catch(() => ({}) as Record<string, unknown>);
	const clientId = optionalText(body.client_id, 'client_id', 64);
	const result = await raiseRecurringDrafts(c.env.DB, { clientId });
	return c.json({
		today: result.today,
		raised: result.raised.map((r) => r.invoice_number),
		detail: result.raised,
		skipped: result.skipped,
		count: result.raised.length
	});
});
/**
 * Recording a payment sets the status from the numbers rather than trusting a
 * caller to keep the two in step. Paid, part paid and sent are all derivable
 * from amount_paid_cents against amount_cents.
 */
/**
 * Records a payment, and posts it to the ledger.
 *
 * One row per payment received, which is the record that did not exist: the
 * invoice carried a cumulative figure with no history, so there was no date
 * money arrived and nothing a ledger entry could be keyed to.
 *
 * The posting is the amount received, never the running total. Posting the
 * total on every payment would book 500, then 1200, then 2000 for an invoice
 * that received 500, 700 and 800, and every one of those is a real figure off a
 * real invoice, which is what makes it hard to see.
 *
 * Cash basis, per ruling: this is the moment revenue exists. The invoice being
 * issued created a receivable and nothing else.
 */
invoicing.post('/invoices/:id/payments', async (c) => {
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw);

	const invoice = await c.env.DB.prepare(
		'SELECT id, client_id, amount_cents, amount_paid_cents FROM invoices WHERE id = ?'
	)
		.bind(id)
		.first<{ id: string; client_id: string; amount_cents: number; amount_paid_cents: number }>();
	if (!invoice) throw new ApiError(404, 'Invoice not found.');

	const paidOn = optionalDate(body.paid_on, 'Payment date');
	if (!paidOn) throw new ApiError(400, 'A payment needs the date the money arrived.');

	const rawAmount = typeof body.amount === 'string' ? body.amount : String(body.amount ?? '');
	const amountCents = parseMoneyToCents(rawAmount);
	if (amountCents === null || amountCents <= 0) {
		throw new ApiError(400, 'The payment amount must be a positive figure, like 500 or 500.00.');
	}

	const outstanding = invoice.amount_cents - invoice.amount_paid_cents;
	if (amountCents > outstanding) {
		throw new ApiError(
			400,
			`That is more than the ${formatMoney(outstanding)} still outstanding on this invoice.`
		);
	}

	const method = optionalText(body.method, 'method', 40);
	const reference = optionalText(body.reference, 'reference', 120);
	const notes = optionalText(body.notes, 'notes', 500);
	const now = nowUtc();
	const paymentId = crypto.randomUUID();

	// The invoice's paid figure and status follow from this insert, recomputed
	// by trigger rather than set here, so the two cannot drift apart.
	try {
		await c.env.DB.prepare(
			`INSERT INTO invoice_payments
       (id, invoice_id, paid_on, amount_cents, method, reference, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
			.bind(paymentId, id, paidOn, amountCents, method, reference, notes, now, now)
			.run();
	} catch (err) {
		const message = err instanceof Error ? err.message : '';
		if (message.includes('exceed the invoice amount')) {
			throw new ApiError(400, 'That payment would take the invoice past its total.');
		}
		throw asClientError(err);
	}

	/**
	 * The ledger entry, keyed to the payment.
	 *
	 * A unique partial index on source_payment_id makes a retried post a
	 * refusal rather than a second entry. It replaced an index keyed on the
	 * invoice, which guarded the wrong thing: it made a retry safe in a world
	 * where an invoice could only ever be paid once.
	 *
	 * Currency is USD, matching the invoice, which has no currency column of its
	 * own. That is recorded rather than inferred: when invoices gain a currency
	 * this line is where it is read from.
	 */
	let posted: Record<string, unknown> | null = null;
	let postingError: string | null = null;
	try {
		const txnId = crypto.randomUUID();
		await c.env.DB.prepare(
			`INSERT INTO ledger_transactions
       (id, category_id, client_id, project_id, txn_date, amount_cents, currency,
        provenance, source_invoice_id, source_payment_id, notes, created_at, updated_at)
       VALUES (?, 'ledger-cat-client-payments', ?, NULL, ?, ?, 'USD', 'invoice', ?, ?, ?, ?, ?)`
		)
			.bind(
				txnId,
				invoice.client_id,
				paidOn,
				amountCents,
				id,
				paymentId,
				notes,
				now,
				now
			)
			.run();
		posted = await c.env.DB.prepare('SELECT * FROM ledger_transactions WHERE id = ?')
			.bind(txnId)
			.first();
	} catch (err) {
		// The payment is recorded either way. A posting that failed is reported
		// rather than swallowed, because an invoice that says paid with no
		// revenue behind it is exactly the drift this epic exists to remove.
		const message = err instanceof Error ? err.message : '';
		postingError = message.includes('UNIQUE')
			? 'This payment is already in the ledger.'
			: 'The payment was recorded but did not reach the ledger.';
	}

	// The trail, so the invoice can say when money arrived without anyone
	// opening the ledger. Written after the posting, and its failure is
	// reported separately: a history that did not save must not take a recorded
	// payment down with it.
	const trailError = await logEvent(
		c.env.DB,
		id,
		'payment',
		// The method is printed as it was given. Lowercasing it turns ACH into
		// ach, which is a different thing wearing the same letters.
		`Payment recorded, ${formatUsd(amountCents)}` +
			`${method ? `, ${method}` : ''}. ` +
			(amountCents >= outstanding ? 'Paid in full.' : `${formatUsd(outstanding - amountCents)} left.`),
		`${paidOn}T12:00:00Z`
	);

	const updated = await c.env.DB.prepare(`${INVOICE_SELECT} WHERE i.id = ?2`)
		.bind(todayInWorkingZone(), id)
		.first();

	return c.json(
		{
			payment_id: paymentId,
			invoice: updated,
			posted,
			posting_error: postingError,
			trail_error: trailError
		},
		201
	);
});

/** Every payment against one invoice, newest first. */
invoicing.get('/invoices/:id/payments', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT p.*, (SELECT t.id FROM ledger_transactions t WHERE t.source_payment_id = p.id) AS ledger_id
     FROM invoice_payments p WHERE p.invoice_id = ? ORDER BY p.paid_on DESC, p.created_at DESC`
	)
		.bind(c.req.param('id'))
		.all();
	return c.json({ payments: results ?? [] });
});

invoicing.patch('/invoices/:id', async (c) => {
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw);

	const existing = await c.env.DB.prepare(
		'SELECT amount_cents, amount_paid_cents, status FROM invoices WHERE id = ?'
	)
		.bind(id)
		.first<{ amount_cents: number; amount_paid_cents: number; status: InvoiceStatus }>();
	if (!existing) throw new ApiError(404, 'Invoice not found.');

	const sets: string[] = [];
	const binds: unknown[] = [];

	if ('amount_paid_cents' in body) {
		/**
		 * Retired. The paid figure is derived from the payments now.
		 *
		 * Setting it directly is how a paid total and the payments behind it
		 * come to disagree with nothing reporting it, and under cash basis it
		 * also destroys the only record of when money arrived. Refused with the
		 * route that replaces it rather than ignored, so a caller still on the
		 * old shape is told what to call instead.
		 */
		throw new ApiError(
			400,
			'The paid amount is worked out from the payments on the invoice. ' +
				`Record one with POST /api/invoicing/invoices/${id}/payments instead.`
		);
	} else if ('status' in body) {
		sets.push('status = ?');
		binds.push(oneOf<InvoiceStatus>(body.status, INVOICE_STATUSES, 'status', 'sent'));
	}

	if ('due_date' in body) {
		const due = optionalDate(body.due_date, 'Due date');
		if (!due) throw new ApiError(400, 'The due date cannot be empty.');
		sets.push('due_date = ?');
		binds.push(due);
	}

	if (sets.length === 0) throw new ApiError(400, 'Nothing to update.');

	sets.push('updated_at = ?');
	binds.push(nowUtc());
	binds.push(id);

	try {
		await c.env.DB.prepare(`UPDATE invoices SET ${sets.join(', ')} WHERE id = ?`)
			.bind(...binds)
			.run();
	} catch (err) {
		throw asClientError(err);
	}

	const updated = await c.env.DB.prepare(`${INVOICE_SELECT} WHERE i.id = ?2`)
		.bind(todayInWorkingZone(), id)
		.first();
	return c.json({ invoice: updated });
});
