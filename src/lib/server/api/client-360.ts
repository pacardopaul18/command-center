import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { nowUtc, todayInWorkingZone } from '../dates';
import { INVOICE_SELECT } from './invoicing';
import { ApiError, oneOf, optionalDate, optionalText, readJsonObject, requiredText } from './validate';
import {
	CONTRACT_BASES,
	CONTRACT_STATUSES,
	parseMoneyToCents,
	type ContractBasis,
	type ContractStatus
} from '$lib/types';

/**
 * Contacts and contracts, and the one read behind the client page.
 *
 * Client 360 looked like a UI job and was not. Projects, invoices, meetings and
 * tickets already existed and only needed filtering by client. These two are
 * genuinely new, and no amount of page work conjures them.
 *
 * Nothing here recomputes money. Invoice figures come from the same queries
 * Invoicing already uses, so the client page cannot disagree with the invoice
 * screen about what is owed. Two places deriving the same number separately is
 * how they drift.
 */

export const client360 = new Hono<ApiEnv>();

function asClientError(err: unknown): unknown {
	const text = String(err);
	// SQLite reports a partial unique index violation by the COLUMN it indexes,
	// never by the index name. A matcher keyed on 'idx_contacts_one_primary'
	// looks right, reads right, and can never fire: the caller gets a 500 for
	// what is plainly their own mistake. Found by hitting the endpoint, not by
	// reading this function.
	if (text.includes('UNIQUE constraint failed: contacts.client_id')) {
		return new ApiError(409, 'That client already has a primary contact.');
	}
	if (text.includes('email')) {
		return new ApiError(400, 'That email address does not look like an address.');
	}
	if (text.includes('end_date')) {
		return new ApiError(400, 'The end date cannot be before the start date.');
	}
	if (text.includes('value_cents')) {
		return new ApiError(400, 'The contract value cannot be negative.');
	}
	if (text.includes('FOREIGN KEY constraint failed')) {
		return new ApiError(400, 'That client does not exist.');
	}
	return err;
}

/* -------------------------------------------------------------------------
 * Contacts
 * ---------------------------------------------------------------------- */

client360.get('/contacts', async (c) => {
	const clientId = c.req.query('client_id');
	const { results } = await c.env.DB.prepare(
		`SELECT ct.*, cl.name AS client_name
     FROM contacts ct JOIN clients cl ON cl.id = ct.client_id
     ${clientId ? 'WHERE ct.client_id = ?' : ''}
     ORDER BY ct.is_primary DESC, ct.name COLLATE NOCASE`
	)
		.bind(...(clientId ? [clientId] : []))
		.all();
	return c.json({ contacts: results ?? [] });
});

function readContact(body: Record<string, unknown>) {
	return {
		name: requiredText(body.name, 'Name', 200),
		email: optionalText(body.email, 'Email', 320),
		phone: optionalText(body.phone, 'Phone', 60),
		role: optionalText(body.role, 'Role', 120),
		notes: optionalText(body.notes, 'Notes', 2000),
		// Checkbox values arrive as booleans from the app and as 0/1 from a
		// direct caller. Both mean the same thing and neither is wrong.
		is_primary: body.is_primary === true || body.is_primary === 1 ? 1 : 0
	};
}

client360.post('/contacts', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const id = crypto.randomUUID();
	const now = nowUtc();
	const fields = readContact(body);

	try {
		await c.env.DB.prepare(
			`INSERT INTO contacts (id, client_id, name, email, phone, role, is_primary, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
			.bind(
				id,
				requiredText(body.client_id, 'Client', 64),
				fields.name,
				fields.email,
				fields.phone,
				fields.role,
				fields.is_primary,
				fields.notes,
				now,
				now
			)
			.run();
	} catch (err) {
		throw asClientError(err);
	}

	const contact = await c.env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first();
	return c.json({ contact }, 201);
});

client360.patch('/contacts/:id', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const id = c.req.param('id');
	const fields = readContact(body);

	try {
		const result = await c.env.DB.prepare(
			`UPDATE contacts
       SET name = ?, email = ?, phone = ?, role = ?, is_primary = ?, notes = ?, updated_at = ?
       WHERE id = ?`
		)
			.bind(
				fields.name,
				fields.email,
				fields.phone,
				fields.role,
				fields.is_primary,
				fields.notes,
				nowUtc(),
				id
			)
			.run();
		if (!result.meta.changes) throw new ApiError(404, 'Contact not found.');
	} catch (err) {
		throw asClientError(err);
	}

	const contact = await c.env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first();
	return c.json({ contact });
});

client360.delete('/contacts/:id', async (c) => {
	// A contact is a person's details, not a record of work. Removing one that
	// was entered by mistake is ordinary, which is why this exists here and
	// deliberately does not exist for clients.
	const result = await c.env.DB.prepare('DELETE FROM contacts WHERE id = ?')
		.bind(c.req.param('id'))
		.run();
	if (!result.meta.changes) throw new ApiError(404, 'Contact not found.');
	return c.json({ ok: true });
});

/* -------------------------------------------------------------------------
 * Contracts
 * ---------------------------------------------------------------------- */

/**
 * Contracts, with invoices raised against the same client shown alongside.
 *
 * The two are deliberately not joined. An invoice is not raised against a
 * contract in this schema, and pretending otherwise would put a number on the
 * screen that nothing in the data supports. Showing them side by side lets Paul
 * make the comparison himself, which is honest, and leaves the door open for
 * `fulfillment_basis` to become 'invoiced' once there is a real link to compute
 * from.
 */
client360.get('/contracts', async (c) => {
	const clientId = c.req.query('client_id');
	const { results } = await c.env.DB.prepare(
		`SELECT k.*, cl.name AS client_name
     FROM contracts k JOIN clients cl ON cl.id = k.client_id
     ${clientId ? 'WHERE k.client_id = ?' : ''}
     ORDER BY
       CASE k.fulfillment_status WHEN 'in_progress' THEN 0 WHEN 'not_started' THEN 1
                                 WHEN 'fulfilled' THEN 2 ELSE 3 END,
       COALESCE(k.end_date, '9999') ASC,
       k.title COLLATE NOCASE`
	)
		.bind(...(clientId ? [clientId] : []))
		.all();
	return c.json({ contracts: results ?? [] });
});

/**
 * Contract value, in cents.
 *
 * Same shape as `readRate` in clients.ts, deliberately. Money entry was solved
 * once and the answer is that a bare number is already cents and a string is an
 * amount to parse. Writing a second parser here would be a second thing to get
 * wrong, and the two would disagree on exactly the inputs nobody tests.
 */
function readValue(raw: unknown): number | null {
	if (raw === null || raw === undefined || raw === '') return null;
	if (typeof raw === 'number') {
		if (!Number.isInteger(raw) || raw < 0) {
			throw new ApiError(400, 'The contract value must be a whole number of cents, or empty.');
		}
		return raw;
	}
	const cents = parseMoneyToCents(String(raw));
	if (cents === null) {
		throw new ApiError(
			400,
			'The contract value must be an amount such as 5000 or 5000.00, or empty.'
		);
	}
	return cents;
}

function readContract(body: Record<string, unknown>) {
	return {
		title: requiredText(body.title, 'Title', 300),
		start_date: optionalDate(body.start_date, 'Start date'),
		end_date: optionalDate(body.end_date, 'End date'),
		value_cents: readValue(body.value_cents ?? body.value),
		fulfillment_status: oneOf<ContractStatus>(
			body.fulfillment_status,
			CONTRACT_STATUSES,
			'fulfillment status',
			'not_started'
		),
		// Hand-set today, always. The column exists so that a computed mode can
		// arrive later without a migration, not so callers can claim one now.
		fulfillment_basis: oneOf<ContractBasis>(
			body.fulfillment_basis,
			CONTRACT_BASES,
			'fulfillment basis',
			'manual'
		),
		notes: optionalText(body.notes, 'Notes', 4000)
	};
}

client360.post('/contracts', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const id = crypto.randomUUID();
	const now = nowUtc();
	const f = readContract(body);

	try {
		await c.env.DB.prepare(
			`INSERT INTO contracts
         (id, client_id, title, start_date, end_date, value_cents,
          fulfillment_status, fulfillment_basis, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
			.bind(
				id,
				requiredText(body.client_id, 'Client', 64),
				f.title,
				f.start_date,
				f.end_date,
				f.value_cents,
				f.fulfillment_status,
				f.fulfillment_basis,
				f.notes,
				now,
				now
			)
			.run();
	} catch (err) {
		throw asClientError(err);
	}

	const contract = await c.env.DB.prepare('SELECT * FROM contracts WHERE id = ?').bind(id).first();
	return c.json({ contract }, 201);
});

client360.patch('/contracts/:id', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const id = c.req.param('id');
	const f = readContract(body);

	try {
		const result = await c.env.DB.prepare(
			`UPDATE contracts
       SET title = ?, start_date = ?, end_date = ?, value_cents = ?,
           fulfillment_status = ?, fulfillment_basis = ?, notes = ?, updated_at = ?
       WHERE id = ?`
		)
			.bind(
				f.title,
				f.start_date,
				f.end_date,
				f.value_cents,
				f.fulfillment_status,
				f.fulfillment_basis,
				f.notes,
				nowUtc(),
				id
			)
			.run();
		if (!result.meta.changes) throw new ApiError(404, 'Contract not found.');
	} catch (err) {
		throw asClientError(err);
	}

	const contract = await c.env.DB.prepare('SELECT * FROM contracts WHERE id = ?').bind(id).first();
	return c.json({ contract });
});

client360.delete('/contracts/:id', async (c) => {
	// 'cancelled' is for an agreement that ended and stays part of the record.
	// Delete is for a row that should never have existed. Nothing else points at
	// a contract, so removing one takes nothing with it.
	const result = await c.env.DB.prepare('DELETE FROM contracts WHERE id = ?')
		.bind(c.req.param('id'))
		.run();
	if (!result.meta.changes) throw new ApiError(404, 'Contract not found.');
	return c.json({ ok: true });
});

/* -------------------------------------------------------------------------
 * The client page
 * ---------------------------------------------------------------------- */

/**
 * Everything about one client, in one request.
 *
 * The page is a set of existing lists filtered by client, plus the two new
 * entities. The one rule it follows without exception: money comes from
 * `INVOICE_SELECT`, the same expression the Invoicing screen uses, imported
 * rather than copied. A second copy of an outstanding-amount calculation is a
 * second thing to keep correct, and the first time they disagree the client
 * page will be the one nobody believes.
 *
 * Aging is deliberately not recomputed here either. It is read off the same
 * bucket the invoice list assigns.
 */
client360.get('/clients/:id/overview', async (c) => {
	const id = c.req.param('id');
	const today = todayInWorkingZone();

	const client = await c.env.DB.prepare(
		`SELECT * FROM clients WHERE id = ?`
	).bind(id).first();
	if (!client) throw new ApiError(404, 'Client not found.');

	const [contacts, contracts, projects, invoices, meetings, tickets] = await Promise.all([
		c.env.DB.prepare(
			`SELECT * FROM contacts WHERE client_id = ?
       ORDER BY is_primary DESC, name COLLATE NOCASE`
		).bind(id).all(),

		c.env.DB.prepare(
			`SELECT * FROM contracts WHERE client_id = ?
       ORDER BY
         CASE fulfillment_status WHEN 'in_progress' THEN 0 WHEN 'not_started' THEN 1
                                 WHEN 'fulfilled' THEN 2 ELSE 3 END,
         COALESCE(end_date, '9999') ASC`
		).bind(id).all(),

		c.env.DB.prepare(
			`SELECT p.*,
         (SELECT COUNT(*) FROM action_items a WHERE a.project_id = p.id AND a.status != 'done')
           AS open_items,
         (SELECT COUNT(*) FROM tickets t
            WHERE t.project_id = p.id AND t.status NOT IN ('done','cancelled')) AS open_tickets
       FROM projects p WHERE p.client_id = ?
       ORDER BY CASE p.status WHEN 'active' THEN 0 ELSE 1 END, p.name COLLATE NOCASE`
		).bind(id).all(),

		c.env.DB.prepare(
			`${INVOICE_SELECT} WHERE i.client_id = ?2 ORDER BY is_overdue DESC, i.due_date ASC`
		).bind(today, id).all(),

		c.env.DB.prepare(
			`SELECT m.id, m.title, m.meeting_date
       FROM meetings m
       JOIN projects p ON p.id = m.project_id
       WHERE p.client_id = ?
       ORDER BY m.meeting_date DESC LIMIT 5`
		).bind(id).all(),

		c.env.DB.prepare(
			`SELECT t.id, t.title, t.status, t.priority, t.due_date, t.estimate_hours,
              p.name AS project_name
       FROM tickets t JOIN projects p ON p.id = t.project_id
       WHERE p.client_id = ? AND t.status NOT IN ('done','cancelled')
       ORDER BY COALESCE(t.due_date, '9999') ASC LIMIT 10`
		).bind(id).all()
	]);

	// Totals summed from the rows above rather than queried again, so the
	// headline figure and the list it sits over cannot disagree.
	const invoiceRows = (invoices.results ?? []) as {
		outstanding_cents: number;
		is_overdue: number;
		amount_cents: number;
	}[];

	const money = {
		invoiced_cents: invoiceRows.reduce((n, i) => n + Number(i.amount_cents), 0),
		outstanding_cents: invoiceRows.reduce((n, i) => n + Number(i.outstanding_cents), 0),
		overdue_cents: invoiceRows
			.filter((i) => i.is_overdue === 1)
			.reduce((n, i) => n + Number(i.outstanding_cents), 0),
		overdue_count: invoiceRows.filter((i) => i.is_overdue === 1).length
	};

	return c.json({
		client,
		today,
		contacts: contacts.results ?? [],
		contracts: contracts.results ?? [],
		projects: projects.results ?? [],
		invoices: invoiceRows,
		meetings: meetings.results ?? [],
		tickets: tickets.results ?? [],
		money
	});
});
