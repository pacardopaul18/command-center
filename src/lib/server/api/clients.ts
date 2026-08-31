import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { nowUtc, todayInWorkingZone } from '../dates';
import { ApiError, oneOf, optionalText, readJsonObject, requiredText } from './validate';
import { CLIENT_STATUSES, parseMoneyToCents } from '$lib/types';
import type { ClientStatus } from '$lib/types';

/**
 * Clients, thin but complete: list, create, edit, archive. D37.
 *
 * Archive rather than delete, consistent with SOPs under D33 and with the
 * ON DELETE RESTRICT on projects.client_id. There is deliberately no DELETE
 * route: a client with work against it is not something to remove by accident.
 */

/**
 * The list, with the three facts the redesigned table needs beside the name.
 *
 * Who to ring, what is owed, and how many projects are running. All three are
 * subqueries rather than joins: a join to contacts would multiply the row per
 * contact and a join to invoices would multiply it again, and the count of
 * projects would then be wrong in a way that reads as plausible.
 *
 * The money is filtered by the same rule Invoicing uses, `kind = 'invoice'` and
 * not voided, so this table cannot disagree with the invoice screen about what
 * a client owes. An estimate counted as a receivable inflates the number on the
 * one screen a person scans for who to chase. D144.
 */
const LIST_SELECT = `
  SELECT c.*,
    (SELECT COUNT(*) FROM projects WHERE client_id = c.id) AS project_count,
    (SELECT name FROM contacts WHERE client_id = c.id AND is_primary = 1 LIMIT 1)
      AS primary_contact_name,
    (SELECT email FROM contacts WHERE client_id = c.id AND is_primary = 1 LIMIT 1)
      AS primary_contact_email,
    (SELECT COUNT(*) FROM contacts WHERE client_id = c.id) AS contact_count,
    COALESCE((
      SELECT SUM(MAX(0, i.amount_cents - i.amount_paid_cents)) FROM invoices i
      WHERE i.client_id = c.id AND i.kind = 'invoice' AND i.voided_at IS NULL
    ), 0) AS outstanding_cents,
    COALESCE((
      SELECT SUM(MAX(0, i.amount_cents - i.amount_paid_cents)) FROM invoices i
      WHERE i.client_id = c.id AND i.kind = 'invoice' AND i.voided_at IS NULL
        AND i.amount_paid_cents < i.amount_cents AND i.due_date < ?1
    ), 0) AS overdue_cents
  FROM clients c
`;

export const clients = new Hono<ApiEnv>();

clients.get('/', async (c) => {
	const raw = c.req.query('status') ?? 'active';
	const status = raw === 'all' ? null : oneOf<ClientStatus>(raw, CLIENT_STATUSES, 'status', 'active');

	/**
	 * Overdue is measured against today rather than stored, the same way the
	 * invoice list measures it. Bound as ?1 because the subqueries in the select
	 * come before the WHERE clause and positional binds keep the two from
	 * swapping places the next time a filter is added.
	 */
	const today = todayInWorkingZone();

	const { results } = await c.env.DB.prepare(
		`${LIST_SELECT} ${status ? 'WHERE c.status = ?2' : ''} ORDER BY c.name COLLATE NOCASE`
	)
		.bind(...(status ? [today, status] : [today]))
		.all();

	const counts = await c.env.DB.prepare(
		`SELECT
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived
     FROM clients`
	).first<Record<string, number | null>>();

	return c.json({
		clients: results ?? [],
		today,
		counts: { active: counts?.active ?? 0, archived: counts?.archived ?? 0 }
	});
});

clients.post('/', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const now = nowUtc();
	const id = crypto.randomUUID();

	try {
		await c.env.DB.prepare(
			`INSERT INTO clients (id, name, billing_terms, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`
		)
			.bind(
				id,
				requiredText(body.name, 'Name', 200),
				optionalText(body.billing_terms, 'Billing terms', 120),
				optionalText(body.notes, 'Notes', 4000),
				now,
				now
			)
			.run();
	} catch (err) {
		// The name has a unique index, so a duplicate is a user mistake rather
		// than a server fault and deserves a specific message.
		if (String(err).includes('UNIQUE')) {
			throw new ApiError(409, 'A client with that name already exists.');
		}
		throw err;
	}

	// LIST_SELECT takes ?1 for today, because the overdue subquery needs it.
	// Every caller binds it, or the row comes back short one placeholder and the
	// route answers with no client at all. D134: a shared fragment changing its
	// contract is a caller audit, not a local edit.
	const created = await c.env.DB.prepare(`${LIST_SELECT} WHERE c.id = ?2`)
		.bind(todayInWorkingZone(), id)
		.first();
	return c.json({ client: created }, 201);
});

const UPDATABLE = ['name', 'billing_terms', 'notes', 'status', 'default_rate_cents'] as const;

/**
 * A default hourly rate, in cents.
 *
 * Accepts a plain number of cents or a money string such as "150" or "150.00",
 * because the field on screen is money and the column is cents. Rejects anything
 * else rather than coercing, since a silently wrong rate multiplies through
 * every hour booked against the client.
 */
function readRate(raw: unknown): number | null {
	if (raw === null || raw === undefined || raw === '') return null;
	if (typeof raw === 'number') {
		if (!Number.isInteger(raw) || raw < 0) {
			throw new ApiError(400, 'The default rate must be a whole number of cents, or empty.');
		}
		return raw;
	}
	const cents = parseMoneyToCents(String(raw));
	if (cents === null) {
		throw new ApiError(400, 'The default rate must be an amount such as 150 or 150.00, or empty.');
	}
	return cents;
}

clients.patch('/:id', async (c) => {
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw);

	const existing = await c.env.DB.prepare('SELECT id FROM clients WHERE id = ?').bind(id).first();
	if (!existing) throw new ApiError(404, 'Client not found.');

	const sets: string[] = [];
	const binds: unknown[] = [];

	for (const field of UPDATABLE) {
		if (!(field in body)) continue;
		const raw = body[field];
		let value: string | number | null;

		switch (field) {
			case 'name':
				value = requiredText(raw, 'Name', 200);
				break;
			case 'billing_terms':
				value = optionalText(raw, 'Billing terms', 120);
				break;
			case 'notes':
				value = optionalText(raw, 'Notes', 4000);
				break;
			case 'default_rate_cents':
				// Money, so integer cents and never a float. Empty clears the rate,
				// which is a real state: a client billed at whatever was agreed per
				// invoice rather than at a standing rate.
				value = readRate(raw);
				break;
			default:
				value = oneOf<ClientStatus>(raw, CLIENT_STATUSES, 'status', 'active');
		}

		sets.push(`${field} = ?`);
		binds.push(value);
	}

	if (sets.length === 0) throw new ApiError(400, 'Nothing to update.');

	sets.push('updated_at = ?');
	binds.push(nowUtc());
	binds.push(id);

	try {
		await c.env.DB.prepare(`UPDATE clients SET ${sets.join(', ')} WHERE id = ?`)
			.bind(...binds)
			.run();
	} catch (err) {
		if (String(err).includes('UNIQUE')) {
			throw new ApiError(409, 'A client with that name already exists.');
		}
		throw err;
	}

	const updated = await c.env.DB.prepare(`${LIST_SELECT} WHERE c.id = ?2`)
		.bind(todayInWorkingZone(), id)
		.first();
	return c.json({ client: updated });
});
