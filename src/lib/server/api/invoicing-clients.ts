import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { nowUtc, todayInWorkingZone } from '../dates';
import { ApiError, oneOf, optionalText, readJsonObject, requiredText } from './validate';
import { CLIENT_STATUSES, parseMoneyToCents } from '$lib/types';
import type { ClientStatus } from '$lib/types';

/**
 * The client side of invoicing: who is billed, what they owe, and how.
 *
 * The invoicing screen was rebuilt around the client rather than the invoice,
 * so the questions it asks are "what does this client owe" and "what has this
 * client been billed", not "list every invoice". Those are different queries
 * with different totals, and mounting them beside the document routes in
 * invoicing.ts rather than inside it keeps the two readable: this file reads
 * money, that one writes documents.
 *
 * Three rules hold everywhere below and are not repeated at each query:
 *
 *   kind = 'invoice'      an estimate has not been agreed and a credit note is
 *                         money owed the other way. Counting either as a
 *                         receivable overstates what the firm is owed.
 *   voided_at IS NULL     a voided document keeps its number and its trail and
 *                         counts toward nothing.
 *   today in Mountain     overdue and aging are questions about today, decided
 *                         against the working calendar, never UTC. Migration
 *                         0004 and D-dates.
 */

export const invoicingClients = new Hono<ApiEnv>();

/** The filter every money figure on this screen agrees on. */
const RECEIVABLE = `i.kind = 'invoice' AND i.voided_at IS NULL`;

/** The first day of the month and of the year, in the working calendar. */
function periodStarts(today: string) {
	return { month: `${today.slice(0, 7)}-01`, year: `${today.slice(0, 4)}-01-01` };
}

const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

function monthLabel(today: string) {
	const month = Number(today.slice(5, 7));
	return `${MONTH_NAMES[month - 1]} ${today.slice(0, 4)}`;
}

/**
 * The four headline figures and one row per client.
 *
 * Everything the rail and the tiles need, in one round trip, computed over
 * every invoice rather than over a page of them. A total that only counts the
 * rows on screen is a different number wearing the same label; the same
 * reasoning the aging bands were written with.
 */
invoicingClients.get('/overview', async (c) => {
	const db = c.env.DB;
	const day = todayInWorkingZone();
	const { month, year } = periodStarts(day);

	const headline = await db
		.prepare(
			`SELECT
         COUNT(*) AS invoice_count,
         COALESCE(SUM(i.amount_cents), 0) AS invoiced_cents,
         COALESCE(SUM(CASE WHEN i.amount_paid_cents < i.amount_cents
                           THEN i.amount_cents - i.amount_paid_cents ELSE 0 END), 0)
           AS collectable_cents,
         COALESCE(SUM(CASE WHEN i.amount_paid_cents < i.amount_cents THEN 1 ELSE 0 END), 0)
           AS open_count,
         COALESCE(SUM(CASE WHEN i.amount_paid_cents < i.amount_cents
                            AND julianday(?1) > julianday(i.due_date)
                           THEN i.amount_cents - i.amount_paid_cents ELSE 0 END), 0)
           AS overdue_cents,
         COALESCE(SUM(CASE WHEN i.amount_paid_cents < i.amount_cents
                            AND julianday(?1) > julianday(i.due_date) THEN 1 ELSE 0 END), 0)
           AS overdue_count
       FROM invoices i WHERE ${RECEIVABLE}`
		)
		.bind(day)
		.first<Record<string, number>>();

	/**
	 * Collected this month, from the payments rather than from the invoices.
	 *
	 * An invoice marked paid says nothing about when the money arrived, and
	 * under cash basis that date is the whole question. Invoices settled before
	 * payments were recorded as events have no payment row, so they are not
	 * counted here and the tile says how many payments it is reporting.
	 */
	const collected = await db
		.prepare(
			`SELECT COALESCE(SUM(p.amount_cents), 0) AS cents, COUNT(*) AS n
       FROM invoice_payments p
       JOIN invoices i ON i.id = p.invoice_id
       WHERE ${RECEIVABLE} AND p.paid_on >= ?1 AND p.paid_on <= ?2`
		)
		.bind(month, day)
		.first<{ cents: number; n: number }>();

	const rows = await db
		.prepare(
			`SELECT c.id, c.name, c.status,
         COALESCE(SUM(CASE WHEN i.amount_paid_cents < i.amount_cents
                           THEN i.amount_cents - i.amount_paid_cents ELSE 0 END), 0) AS open_cents,
         COALESCE(SUM(CASE WHEN i.amount_paid_cents < i.amount_cents
                            AND julianday(?1) > julianday(i.due_date)
                           THEN i.amount_cents - i.amount_paid_cents ELSE 0 END), 0) AS overdue_cents,
         COALESCE(SUM(i.amount_paid_cents), 0) AS paid_cents,
         COUNT(i.id) AS invoice_count,
         COALESCE(SUM(CASE WHEN i.amount_paid_cents < i.amount_cents
                            AND julianday(?1) > julianday(i.due_date) THEN 1 ELSE 0 END), 0)
           AS overdue_count,
         MAX(i.issue_date) AS last_activity
       FROM clients c
       LEFT JOIN invoices i ON i.client_id = c.id AND ${RECEIVABLE}
       GROUP BY c.id, c.name, c.status
       ORDER BY c.name COLLATE NOCASE`
		)
		.bind(day)
		.all<Record<string, string | number | null>>();

	/**
	 * Mean days from issue to settled, per client.
	 *
	 * MAX(paid_on) per invoice, not every payment: an invoice paid in three
	 * instalments was settled on the last one, and averaging the three would
	 * flatter the client by counting the early money twice.
	 */
	const speed = await db
		.prepare(
			`SELECT client_id, AVG(days) AS avg_days FROM (
         SELECT i.client_id AS client_id,
                julianday(MAX(p.paid_on)) - julianday(i.issue_date) AS days
         FROM invoices i
         JOIN invoice_payments p ON p.invoice_id = i.id
         WHERE ${RECEIVABLE} AND i.amount_paid_cents >= i.amount_cents
         GROUP BY i.id
       ) GROUP BY client_id`
		)
		.all<{ client_id: string; avg_days: number }>();

	const avgByClient = new Map<string, number>();
	for (const r of speed.results ?? []) avgByClient.set(r.client_id, Math.round(r.avg_days));

	return c.json({
		today: day,
		headline: {
			invoiced_cents: Number(headline?.invoiced_cents ?? 0),
			invoice_count: Number(headline?.invoice_count ?? 0),
			collectable_cents: Number(headline?.collectable_cents ?? 0),
			open_count: Number(headline?.open_count ?? 0),
			overdue_cents: Number(headline?.overdue_cents ?? 0),
			overdue_count: Number(headline?.overdue_count ?? 0),
			collected_month_cents: Number(collected?.cents ?? 0),
			collected_month_count: Number(collected?.n ?? 0),
			month_label: monthLabel(day)
		},
		clients: (rows.results ?? []).map((r) => ({
			id: String(r.id),
			name: String(r.name),
			status: String(r.status) as ClientStatus,
			open_cents: Number(r.open_cents ?? 0),
			overdue_cents: Number(r.overdue_cents ?? 0),
			paid_cents: Number(r.paid_cents ?? 0),
			invoice_count: Number(r.invoice_count ?? 0),
			overdue_count: Number(r.overdue_count ?? 0),
			avg_days_to_pay: avgByClient.get(String(r.id)) ?? null,
			last_activity: r.last_activity ? String(r.last_activity) : null
		})),
		year_start: year
	});
});

/**
 * One client, with every document raised against them.
 *
 * Line items and trail come back with the invoices rather than on expansion.
 * The billing period entries did the opposite and were right to: 3,200 entries
 * hang off 320 periods, so shipping them all would put the timesheet into every
 * page load. A client has fifteen invoices with two lines each, and a second
 * round trip per row to fetch thirty rows is a worse trade.
 */
invoicingClients.get('/clients/:id', async (c) => {
	const db = c.env.DB;
	const id = c.req.param('id');
	const day = todayInWorkingZone();
	const { year } = periodStarts(day);

	const client = await db
		.prepare(
			`SELECT c.*,
         ct.id AS contact_id, ct.name AS contact_name,
         ct.email AS contact_email, ct.phone AS contact_phone
       FROM clients c
       LEFT JOIN contacts ct ON ct.client_id = c.id AND ct.is_primary = 1
       WHERE c.id = ?`
		)
		.bind(id)
		.first();
	if (!client) throw new ApiError(404, 'Client not found.');

	const money = await db
		.prepare(
			`SELECT
         COALESCE(SUM(CASE WHEN i.amount_paid_cents < i.amount_cents
                           THEN i.amount_cents - i.amount_paid_cents ELSE 0 END), 0) AS open_cents,
         COALESCE(SUM(CASE WHEN i.amount_paid_cents < i.amount_cents
                            AND julianday(?1) > julianday(i.due_date)
                           THEN i.amount_cents - i.amount_paid_cents ELSE 0 END), 0) AS overdue_cents,
         COUNT(*) AS invoice_count
       FROM invoices i WHERE ${RECEIVABLE} AND i.client_id = ?2`
		)
		.bind(day, id)
		.first<Record<string, number>>();

	const collectedYear = await db
		.prepare(
			`SELECT COALESCE(SUM(p.amount_cents), 0) AS cents, COUNT(*) AS n
       FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
       WHERE ${RECEIVABLE} AND i.client_id = ?1 AND p.paid_on >= ?2 AND p.paid_on <= ?3`
		)
		.bind(id, year, day)
		.first<{ cents: number; n: number }>();

	const speed = await db
		.prepare(
			`SELECT AVG(days) AS avg_days FROM (
         SELECT julianday(MAX(p.paid_on)) - julianday(i.issue_date) AS days
         FROM invoices i JOIN invoice_payments p ON p.invoice_id = i.id
         WHERE ${RECEIVABLE} AND i.client_id = ?1 AND i.amount_paid_cents >= i.amount_cents
         GROUP BY i.id
       )`
		)
		.bind(id)
		.first<{ avg_days: number | null }>();

	// Every document, not only receivables: the screen shows estimates, credit
	// notes and voided invoices too, and marks each for what it is.
	const invoices = await db
		.prepare(
			`SELECT i.*,
         (i.amount_cents - i.amount_paid_cents) AS outstanding_cents,
         CAST(julianday(?1) - julianday(i.due_date) AS INTEGER) AS days_overdue,
         CASE
           WHEN i.kind <> 'invoice' OR i.voided_at IS NOT NULL THEN 0
           WHEN i.amount_paid_cents < i.amount_cents AND julianday(?1) > julianday(i.due_date)
           THEN 1 ELSE 0
         END AS is_overdue,
         bp.note AS period_note,
         (SELECT COALESCE(SUM(hours), 0) FROM time_entries
           WHERE billing_period_id = i.billing_period_id AND billable = 1) AS period_hours
       FROM invoices i
       LEFT JOIN billing_periods bp ON bp.id = i.billing_period_id
       WHERE i.client_id = ?2
       ORDER BY i.issue_date DESC, i.invoice_number DESC`
		)
		.bind(day, id)
		.all<Record<string, unknown>>();

	const invoiceRows = invoices.results ?? [];
	const ids = invoiceRows.map((r) => String(r.id));

	// One query for the lines and one for the trail, keyed by invoice, rather
	// than one pair per invoice. An empty client short circuits both.
	let items: Record<string, unknown>[] = [];
	let events: Record<string, unknown>[] = [];
	if (ids.length > 0) {
		const marks = ids.map(() => '?').join(', ');
		const itemRows = await db
			.prepare(
				`SELECT * FROM invoice_line_items WHERE invoice_id IN (${marks})
         ORDER BY invoice_id, position`
			)
			.bind(...ids)
			.all<Record<string, unknown>>();
		items = itemRows.results ?? [];

		const eventRows = await db
			.prepare(
				`SELECT * FROM invoice_events WHERE invoice_id IN (${marks})
         ORDER BY occurred_at DESC, created_at DESC`
			)
			.bind(...ids)
			.all<Record<string, unknown>>();
		events = eventRows.results ?? [];
	}

	const itemsByInvoice = new Map<string, Record<string, unknown>[]>();
	for (const row of items) {
		const key = String(row.invoice_id);
		if (!itemsByInvoice.has(key)) itemsByInvoice.set(key, []);
		itemsByInvoice.get(key)!.push(row);
	}
	const eventsByInvoice = new Map<string, Record<string, unknown>[]>();
	for (const row of events) {
		const key = String(row.invoice_id);
		if (!eventsByInvoice.has(key)) eventsByInvoice.set(key, []);
		eventsByInvoice.get(key)!.push(row);
	}

	// The client's billing periods, so the hours behind an invoice stay one
	// click away rather than moving to another screen when this one was rebuilt.
	const periods = await db
		.prepare(
			`SELECT bp.*,
         (SELECT COUNT(*) FROM time_entries WHERE billing_period_id = bp.id) AS entry_count,
         COALESCE((SELECT SUM(hours) FROM time_entries WHERE billing_period_id = bp.id), 0)
           AS total_hours,
         COALESCE((SELECT SUM(hours) FROM time_entries
                    WHERE billing_period_id = bp.id AND billable = 1), 0) AS billable_hours,
         (SELECT invoice_number FROM invoices WHERE billing_period_id = bp.id LIMIT 1)
           AS invoice_number
       FROM billing_periods bp
       WHERE bp.client_id = ?
       ORDER BY bp.period_end DESC
       LIMIT 40`
		)
		.bind(id)
		.all();

	return c.json({
		today: day,
		client,
		money: {
			open_cents: Number(money?.open_cents ?? 0),
			overdue_cents: Number(money?.overdue_cents ?? 0),
			invoice_count: Number(money?.invoice_count ?? 0),
			collected_year_cents: Number(collectedYear?.cents ?? 0),
			collected_year_count: Number(collectedYear?.n ?? 0),
			avg_days_to_pay:
				speed?.avg_days === null || speed?.avg_days === undefined
					? null
					: Math.round(Number(speed.avg_days))
		},
		invoices: invoiceRows.map((row) => ({
			...row,
			items: itemsByInvoice.get(String(row.id)) ?? [],
			events: eventsByInvoice.get(String(row.id)) ?? []
		})),
		periods: periods.results ?? []
	});
});

/**
 * The billing profile: how this client is addressed, on what terms, and what
 * the app is allowed to do on its own.
 *
 * Contact name, email and phone are written through to `contacts`, not onto
 * `clients`. One primary contact per client is enforced by a partial unique
 * index, so this upserts that row rather than inserting a second one, and a
 * client with no contact yet gets one created on first save.
 */
invoicingClients.patch('/clients/:id/billing', async (c) => {
	const db = c.env.DB;
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw);
	const now = nowUtc();

	const existing = await db
		.prepare('SELECT id, name FROM clients WHERE id = ?')
		.bind(id)
		.first<{ id: string; name: string }>();
	if (!existing) throw new ApiError(404, 'Client not found.');

	const sets: string[] = [];
	const binds: unknown[] = [];
	const push = (column: string, value: unknown) => {
		sets.push(`${column} = ?`);
		binds.push(value);
	};

	if ('name' in body) push('name', requiredText(body.name, 'Name', 200));
	if ('billing_terms' in body) push('billing_terms', optionalText(body.billing_terms, 'Payment terms', 120));
	if ('billing_address' in body)
		push('billing_address', optionalText(body.billing_address, 'Billing address', 500));
	if ('billing_schedule' in body)
		push('billing_schedule', optionalText(body.billing_schedule, 'Billing schedule', 60));
	if ('billing_cc' in body) push('billing_cc', optionalText(body.billing_cc, 'CC addresses', 300));
	if ('notes' in body) push('notes', optionalText(body.notes, 'Notes', 4000));
	if ('status' in body)
		push('status', oneOf<ClientStatus>(body.status, CLIENT_STATUSES, 'status', 'active'));

	if ('default_rate_cents' in body) {
		const raw = body.default_rate_cents;
		if (raw === null || raw === undefined || raw === '') push('default_rate_cents', null);
		else {
			const cents = typeof raw === 'number' ? Math.round(raw) : parseMoneyToCents(String(raw));
			if (cents === null || cents < 0) {
				throw new ApiError(400, 'The hourly rate must be an amount such as 150 or 150.00, or empty.');
			}
			push('default_rate_cents', cents);
		}
	}

	// Automation. Booleans are stored as 0 and 1 by CHECK, so anything truthy is
	// normalised here rather than trusted through.
	if ('auto_recurring' in body) push('auto_recurring', body.auto_recurring ? 1 : 0);
	if ('auto_frequency' in body)
		push('auto_frequency', optionalText(body.auto_frequency, 'Frequency', 40));
	if ('auto_next_date' in body) {
		const raw = optionalText(body.auto_next_date, 'Next date', 10);
		push('auto_next_date', raw);
	}
	if ('digest_reminders' in body) push('digest_reminders', body.digest_reminders ? 1 : 0);
	if ('reminder_cadence' in body)
		push('reminder_cadence', optionalText(body.reminder_cadence, 'Reminder cadence', 60));

	if (sets.length > 0) {
		sets.push('updated_at = ?');
		binds.push(now, id);
		try {
			await db.prepare(`UPDATE clients SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
		} catch (err) {
			if (String(err).includes('UNIQUE')) {
				throw new ApiError(409, 'A client with that name already exists.');
			}
			throw err;
		}
	}

	const touchesContact =
		'contact_name' in body || 'contact_email' in body || 'contact_phone' in body;
	if (touchesContact) {
		const contact = await db
			.prepare('SELECT * FROM contacts WHERE client_id = ? AND is_primary = 1')
			.bind(id)
			.first<Record<string, string | null>>();

		const name = 'contact_name' in body
			? optionalText(body.contact_name, 'Contact name', 200)
			: (contact?.name ?? null);
		const email = 'contact_email' in body
			? optionalText(body.contact_email, 'Contact email', 200)
			: (contact?.email ?? null);
		const phone = 'contact_phone' in body
			? optionalText(body.contact_phone, 'Contact phone', 60)
			: (contact?.phone ?? null);

		// A contact row with no name is not a person. Clearing every field
		// removes the primary contact rather than leaving an empty row behind.
		const empty = !name && !email && !phone;

		try {
			if (contact && empty) {
				await db.prepare('DELETE FROM contacts WHERE id = ?').bind(contact.id).run();
			} else if (contact) {
				await db
					.prepare(
						'UPDATE contacts SET name = ?, email = ?, phone = ?, updated_at = ? WHERE id = ?'
					)
					.bind(name ?? existing.name, email, phone, now, contact.id)
					.run();
			} else if (!empty) {
				await db
					.prepare(
						`INSERT INTO contacts (id, client_id, name, email, phone, role, is_primary,
             notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'Billing', 1, NULL, ?, ?)`
					)
					.bind(crypto.randomUUID(), id, name ?? existing.name, email, phone, now, now)
					.run();
			}
		} catch (err) {
			// The contacts table checks the shape of an email address. A typo is
			// a caller mistake and deserves to say so.
			if (String(err).includes('email')) {
				throw new ApiError(400, 'That email address does not look like an address.');
			}
			throw err;
		}
	}

	if (sets.length === 0 && !touchesContact) throw new ApiError(400, 'Nothing to update.');

	const updated = await db
		.prepare(
			`SELECT c.*, ct.id AS contact_id, ct.name AS contact_name,
         ct.email AS contact_email, ct.phone AS contact_phone
       FROM clients c
       LEFT JOIN contacts ct ON ct.client_id = c.id AND ct.is_primary = 1
       WHERE c.id = ?`
		)
		.bind(id)
		.first();
	return c.json({ client: updated });
});

/**
 * A new client, created from the invoicing screen with its billing profile
 * already filled in.
 *
 * POST /api/clients exists and stays: it creates the thin record the Clients
 * screen needs. This one exists because the invoicing form asks for the billing
 * profile and the primary contact in the same breath, and doing that as three
 * requests from the browser means a client can be created with no contact when
 * the second request fails.
 */
invoicingClients.post('/clients', async (c) => {
	const db = c.env.DB;
	const body = await readJsonObject(c.req.raw);
	const now = nowUtc();
	const id = crypto.randomUUID();

	const name = requiredText(body.name, 'Client name', 200);
	const rateRaw = body.default_rate_cents ?? body.rate;
	let rate: number | null = null;
	if (rateRaw !== null && rateRaw !== undefined && rateRaw !== '') {
		rate = typeof rateRaw === 'number' ? Math.round(rateRaw) : parseMoneyToCents(String(rateRaw));
		if (rate === null || rate < 0) {
			throw new ApiError(400, 'The hourly rate must be an amount such as 150 or 150.00, or empty.');
		}
	}

	try {
		await db
			.prepare(
				`INSERT INTO clients
         (id, name, billing_terms, status, notes, default_rate_cents,
          billing_address, billing_schedule, billing_cc, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				id,
				name,
				optionalText(body.billing_terms, 'Payment terms', 120),
				optionalText(body.notes, 'Notes', 4000),
				rate,
				optionalText(body.billing_address, 'Billing address', 500),
				optionalText(body.billing_schedule, 'Billing schedule', 60),
				optionalText(body.billing_cc, 'CC addresses', 300),
				now,
				now
			)
			.run();
	} catch (err) {
		if (String(err).includes('UNIQUE')) {
			throw new ApiError(409, 'A client with that name already exists.');
		}
		throw err;
	}

	const contactName = optionalText(body.contact_name, 'Contact name', 200);
	const contactEmail = optionalText(body.contact_email, 'Contact email', 200);
	const contactPhone = optionalText(body.contact_phone, 'Contact phone', 60);
	if (contactName || contactEmail || contactPhone) {
		try {
			await db
				.prepare(
					`INSERT INTO contacts (id, client_id, name, email, phone, role, is_primary,
           notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'Billing', 1, NULL, ?, ?)`
				)
				.bind(crypto.randomUUID(), id, contactName ?? name, contactEmail, contactPhone, now, now)
				.run();
		} catch (err) {
			if (String(err).includes('email')) {
				throw new ApiError(400, 'That email address does not look like an address.');
			}
			throw err;
		}
	}

	const created = await db
		.prepare(
			`SELECT c.*, ct.id AS contact_id, ct.name AS contact_name,
         ct.email AS contact_email, ct.phone AS contact_phone
       FROM clients c
       LEFT JOIN contacts ct ON ct.client_id = c.id AND ct.is_primary = 1
       WHERE c.id = ?`
		)
		.bind(id)
		.first();
	return c.json({ client: created }, 201);
});
