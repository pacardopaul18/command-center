import { Hono } from 'hono';
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
import { INVOICE_STATUSES, PERIOD_STATUSES } from '$lib/types';
import { PAGE_SIZES, readPaging } from './action-items';
import type { InvoiceStatus, PeriodStatus } from '$lib/types';

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

export const invoicing = new Hono<ApiEnv>();

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
		.prepare('SELECT COUNT(*) AS n FROM invoices')
		.first<{ n: number }>();
	const total = Number(totalRow?.n ?? 0);
	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const safePage = Math.min(page, pageCount);

	const invoices = await db
		.prepare(`${INVOICE_SELECT} ORDER BY is_overdue DESC, i.due_date ASC LIMIT ? OFFSET ?`)
		.bind(day, pageSize, (safePage - 1) * pageSize)
		.all();

	// Band totals come from the same derivation as the rows, in one query, so
	// the bands and the list can never disagree.
	const bands = await db
		.prepare(
			`SELECT aging_bucket,
              COUNT(*) AS invoice_count,
              SUM(outstanding_cents) AS outstanding_cents
       FROM (${INVOICE_SELECT})
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

invoicing.post('/invoices', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const now = nowUtc();
	const id = crypto.randomUUID();

	const issue = optionalDate(body.issue_date, 'Issue date');
	const due = optionalDate(body.due_date, 'Due date');
	if (!issue || !due) throw new ApiError(400, 'An invoice needs an issue date and a due date.');
	if (due < issue) throw new ApiError(400, 'The due date cannot be before the issue date.');

	const amount = Number(body.amount_cents);
	if (!Number.isInteger(amount) || amount < 0) {
		throw new ApiError(400, 'The amount must be a whole number of cents, zero or more.');
	}

	const periodId = optionalText(body.billing_period_id, 'billing_period_id', 64);
	let clientId = optionalText(body.client_id, 'client_id', 64);

	if (periodId) {
		const period = await c.env.DB.prepare('SELECT client_id FROM billing_periods WHERE id = ?')
			.bind(periodId)
			.first<{ client_id: string }>();
		if (!period) throw new ApiError(404, 'Billing period not found.');
		clientId = period.client_id;
	}
	if (!clientId) throw new ApiError(400, 'An invoice needs a client.');

	try {
		await c.env.DB.prepare(
			`INSERT INTO invoices
         (id, client_id, billing_period_id, invoice_number, issue_date, due_date,
          amount_cents, amount_paid_cents, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
		)
			.bind(
				id,
				clientId,
				periodId,
				requiredText(body.invoice_number, 'Invoice number', 64),
				issue,
				due,
				amount,
				oneOf<InvoiceStatus>(body.status, INVOICE_STATUSES, 'status', 'sent'),
				now,
				now
			)
			.run();
	} catch (err) {
		throw asClientError(err);
	}

	const created = await c.env.DB.prepare(`${INVOICE_SELECT} WHERE i.id = ?2`)
		.bind(todayInWorkingZone(), id)
		.first();
	return c.json({ invoice: created }, 201);
});

/**
 * Recording a payment sets the status from the numbers rather than trusting a
 * caller to keep the two in step. Paid, part paid and sent are all derivable
 * from amount_paid_cents against amount_cents.
 */
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
		const paid = Number(body.amount_paid_cents);
		if (!Number.isInteger(paid) || paid < 0) {
			throw new ApiError(400, 'The paid amount must be a whole number of cents, zero or more.');
		}
		if (paid > existing.amount_cents) {
			throw new ApiError(400, 'The paid amount cannot exceed the invoice amount.');
		}
		sets.push('amount_paid_cents = ?');
		binds.push(paid);
		sets.push('status = ?');
		binds.push(paid >= existing.amount_cents ? 'paid' : paid > 0 ? 'partial' : 'sent');
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
