import type { D1Database } from '@cloudflare/workers-types';
import { nowUtc, todayInWorkingZone } from './dates';

/**
 * Recurring invoices, raised as drafts.
 *
 * One implementation, called from two places: the button on the invoicing
 * screen and the daily cron. Two implementations of "what is due" is how a
 * screen and a scheduled job come to disagree about whether an invoice was
 * already raised, and the answer to that question is a duplicate invoice sent
 * to a client.
 *
 * A draft, never a sent document. This app has no way to mail a client,
 * asserted in tests/layer2-no-send-surface.test.ts rather than promised, so the
 * furthest automation can go is putting the next invoice in front of Paul with
 * the work already on it.
 *
 * Idempotent by date. auto_next_date moves forward only after a draft is
 * written, so a second run on the same day raises nothing. That matters more
 * for the cron than for the button: Cron Triggers do not retry, but they do
 * fire more than once a day in this account, and a job that raised an invoice
 * per firing would bill three times over.
 */

export interface RaisedDraft {
	invoice_number: string;
	client_name: string;
	amount_cents: number;
}

/** Calendar arithmetic on a plain date string. No time zone is involved. */
export function addDays(day: string, days: number): string {
	const date = new Date(`${day}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

/** Days a schedule runs for, used for both the next date and the due date. */
export function scheduleDays(frequency: string): number {
	if (/week/i.test(frequency)) return 7;
	if (/fortnight/i.test(frequency)) return 14;
	if (/quarter/i.test(frequency)) return 90;
	return 30;
}

/** The next number in a series, read from the database rather than remembered. */
export async function nextInvoiceNumber(db: D1Database, prefix: string): Promise<string> {
	const row = await db
		.prepare(
			`SELECT invoice_number FROM invoices
       WHERE invoice_number LIKE ?1
       ORDER BY LENGTH(invoice_number) DESC, invoice_number DESC LIMIT 1`
		)
		.bind(`${prefix}-%`)
		.first<{ invoice_number: string }>();

	const current = Number(row?.invoice_number?.split('-').pop() ?? 0);
	const next = Number.isFinite(current) && current > 0 ? current + 1 : 1001;
	return `${prefix}-${next}`;
}

export async function raiseRecurringDrafts(
	db: D1Database,
	options: { clientId?: string | null; today?: string } = {}
): Promise<{ today: string; raised: RaisedDraft[]; skipped: string[] }> {
	const today = options.today ?? todayInWorkingZone();
	const now = nowUtc();
	const onlyClient = options.clientId ?? null;

	const due = await db
		.prepare(
			`SELECT id, name, auto_frequency, auto_next_date
       FROM clients
       WHERE status = 'active' AND auto_recurring = 1
         AND (auto_next_date IS NULL OR auto_next_date <= ?1)
         AND (?2 IS NULL OR id = ?2)`
		)
		.bind(today, onlyClient)
		.all<{ id: string; name: string; auto_frequency: string | null }>();

	const raised: RaisedDraft[] = [];
	const skipped: string[] = [];

	for (const client of due.results ?? []) {
		/**
		 * The most recent invoice is the template: same lines, same categories,
		 * today's dates.
		 *
		 * A client with nothing to copy is skipped and named, not given a blank
		 * invoice. An invoice for nothing is worse than no invoice, and a silent
		 * skip is worse than both: the schedule would look switched on and
		 * produce nothing, with no record saying why.
		 */
		const last = await db
			.prepare(
				`SELECT * FROM invoices
         WHERE client_id = ? AND kind = 'invoice' AND voided_at IS NULL
         ORDER BY issue_date DESC, created_at DESC LIMIT 1`
			)
			.bind(client.id)
			.first<Record<string, unknown>>();
		if (!last) {
			skipped.push(client.name);
			continue;
		}

		const frequency = client.auto_frequency ?? 'Monthly';
		const days = scheduleDays(frequency);
		const number = await nextInvoiceNumber(db, 'INV');
		const newId = crypto.randomUUID();

		await db
			.prepare(
				`INSERT INTO invoices
         (id, client_id, billing_period_id, invoice_number, issue_date, due_date,
          amount_cents, amount_paid_cents, status, kind, category, subcategory, message,
          discount_kind, discount_value, discount_cents, tax_percent, tax_cents,
          subtotal_cents, recurring_frequency, source_invoice_id, created_at, updated_at)
         SELECT ?1, client_id, NULL, ?2, ?3, ?4,
          amount_cents, 0, 'draft', 'invoice', category, subcategory, message,
          discount_kind, discount_value, discount_cents, tax_percent, tax_cents,
          subtotal_cents, ?5, ?6, ?7, ?7
         FROM invoices WHERE id = ?6`
			)
			.bind(newId, number, today, addDays(today, days), frequency, String(last.id), now)
			.run();

		// The lines come across as new rows rather than as a reference: two
		// documents sharing one set of lines is one edit away from changing an
		// invoice that has already gone out.
		const lines = await db
			.prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY position')
			.bind(String(last.id))
			.all<Record<string, unknown>>();

		const rows = lines.results ?? [];
		if (rows.length > 0) {
			await db.batch(
				rows.map((line) =>
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

		await db
			.prepare(
				`INSERT INTO invoice_events (id, invoice_id, occurred_at, kind, detail, created_at)
         VALUES (?, ?, ?, 'created', ?, ?)`
			)
			.bind(
				crypto.randomUUID(),
				newId,
				now,
				`Raised as a draft on the ${frequency.toLowerCase()} schedule, from ` +
					`${String(last.invoice_number)}. Nothing was sent.`,
				now
			)
			.run();

		await db
			.prepare('UPDATE clients SET auto_next_date = ?, updated_at = ? WHERE id = ?')
			.bind(addDays(today, days), now, client.id)
			.run();

		raised.push({
			invoice_number: number,
			client_name: client.name,
			amount_cents: Number(last.amount_cents ?? 0)
		});
	}

	return { today, raised, skipped };
}
