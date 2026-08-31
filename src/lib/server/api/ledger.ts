import type { D1Database } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { nowUtc } from '../dates';
import { ApiError, oneOf, optionalText, readJsonObject, requiredText } from './validate';
import { parseMoneyToCents } from '$lib/types';

/**
 * The ledger. P3-E1.
 *
 * Single entry by ruling, cash basis: revenue posts when money arrives, not
 * when an invoice is issued. Nothing here posts anything yet, which is E2; this
 * is the store and the screen that proves the shape against a real month.
 *
 * These are Paul's own books. No route here takes an account, and neither table
 * carries a connection_id, because scoping the firm's finances to a Google
 * mailbox would be the category error the E1 audit warned about.
 */

export const ledger = new Hono<ApiEnv>();

const KINDS = ['income', 'expense', 'overhead'] as const;
const PROVENANCE = ['manual', 'invoice', 'import'] as const;

type Kind = (typeof KINDS)[number];
type Provenance = (typeof PROVENANCE)[number];

/**
 * A currency is three letters and is never guessed.
 *
 * Nothing else in the schema carries one, so the first mixed-currency month is
 * the moment every existing total silently becomes wrong. Requiring it per row
 * makes that impossible to arrive at by accident.
 */
function currencyCode(value: unknown, field: string): string {
	const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
	if (!/^[A-Z]{3}$/.test(code)) {
		throw new ApiError(400, `${field} must be a three letter currency code, like USD or PHP.`);
	}
	return code;
}

ledger.get('/categories', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT c.*, p.name AS parent_name,
       (SELECT COUNT(*) FROM ledger_transactions t WHERE t.category_id = c.id) AS transaction_count
     FROM ledger_categories c
     LEFT JOIN ledger_categories p ON p.id = c.parent_id
     WHERE (c.archived_at IS NULL OR ?1 = 1)
     ORDER BY c.kind, COALESCE(p.name, c.name) COLLATE NOCASE, c.name COLLATE NOCASE`
	)
		.bind(c.req.query('include_archived') === 'true' ? 1 : 0)
		.all();

	return c.json({ categories: results ?? [] });
});

ledger.post('/categories', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const name = requiredText(body.name, 'name', 120);
	/**
	 * No fallback on purpose.
	 *
	 * `oneOf` takes a default, and there is no safe one here: a category filed
	 * under the wrong kind flips the sign of every subtotal it appears in, and
	 * it would do so quietly. Missing is an error, not a shrug.
	 */
	const kindRaw = requiredText(body.kind, 'kind', 16);
	if (!KINDS.includes(kindRaw as Kind)) {
		throw new ApiError(400, `kind must be one of: ${KINDS.join(', ')}.`);
	}
	const kind = kindRaw as Kind;
	const parentId = optionalText(body.parent_id, 'parent_id', 64);
	const now = nowUtc();

	if (parentId) {
		const parent = await c.env.DB.prepare('SELECT kind FROM ledger_categories WHERE id = ?')
			.bind(parentId)
			.first<{ kind: string }>();
		if (!parent) throw new ApiError(404, 'No category with that id to nest under.');
	}

	const id = crypto.randomUUID();
	try {
		await c.env.DB.prepare(
			`INSERT INTO ledger_categories (id, name, kind, parent_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
		)
			.bind(id, name, kind, parentId ?? null, now, now)
			.run();
	} catch (err) {
		// Matched by what the database actually says. SQLite names the column on
		// a unique violation and never the index, which is D80.
		const message = err instanceof Error ? err.message : '';
		if (message.includes('ledger_categories.name') || message.includes('UNIQUE')) {
			throw new ApiError(409, 'A category with that name already exists.');
		}
		if (message.includes('nest one level')) {
			throw new ApiError(409, 'A category may nest one level, and that parent already has one.');
		}
		if (message.includes('same kind as its parent')) {
			throw new ApiError(409, 'A child category must have the same kind as its parent.');
		}
		throw err;
	}

	const created = await c.env.DB.prepare('SELECT * FROM ledger_categories WHERE id = ?')
		.bind(id)
		.first();
	return c.json({ category: created }, 201);
});


/**
 * Renaming and re-parenting a category.
 *
 * The database holds the shape rules: one level of nesting, a child matching
 * its parent's kind, no self-parenting, no nesting a category that has children
 * of its own. Those are triggers rather than checks here because an import or a
 * correction by hand would bypass a route. This translates their words into an
 * answer a person can act on.
 *
 * The kind cannot be changed. Moving a category from expense to income would
 * silently flip the sign of every transaction already filed under it, and the
 * numbers in every report built on those rows. Make a new category and move the
 * rows deliberately.
 */
ledger.patch('/categories/:id', async (c) => {
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw);

	const existing = await c.env.DB.prepare('SELECT * FROM ledger_categories WHERE id = ?')
		.bind(id)
		.first<{ id: string; kind: string; name: string }>();
	if (!existing) throw new ApiError(404, 'No category with that id.');

	if ('kind' in body && body.kind !== existing.kind) {
		throw new ApiError(
			400,
			'A category cannot change kind. Every transaction already filed under it would change ' +
				'sign. Make a new category and move the entries across.'
		);
	}

	const sets: string[] = [];
	const binds: unknown[] = [];

	if ('name' in body) {
		sets.push('name = ?');
		binds.push(requiredText(body.name, 'name', 120));
	}

	if ('parent_id' in body) {
		const parentId = optionalText(body.parent_id, 'parent_id', 64);
		if (parentId) {
			const parent = await c.env.DB.prepare('SELECT id FROM ledger_categories WHERE id = ?')
				.bind(parentId)
				.first();
			if (!parent) throw new ApiError(404, 'No category with that id to nest under.');
		}
		sets.push('parent_id = ?');
		binds.push(parentId ?? null);
	}

	if (sets.length === 0) throw new ApiError(400, 'Nothing to change.');

	sets.push('updated_at = ?');
	binds.push(nowUtc(), id);

	try {
		await c.env.DB.prepare(`UPDATE ledger_categories SET ${sets.join(', ')} WHERE id = ?`)
			.bind(...binds)
			.run();
	} catch (err) {
		const message = err instanceof Error ? err.message : '';
		// The triggers already say the useful thing; passed through rather than
		// paraphrased, so the words on screen match the rule that produced them.
		for (const phrase of [
			'nest one level',
			'same kind as its parent',
			'its own parent',
			'has children'
		]) {
			if (message.includes(phrase)) throw new ApiError(409, message.split('SQLITE')[0].trim());
		}
		if (message.includes('UNIQUE') || message.includes('ledger_categories.name')) {
			throw new ApiError(409, 'A category with that name already exists.');
		}
		throw err;
	}

	const updated = await c.env.DB.prepare('SELECT * FROM ledger_categories WHERE id = ?')
		.bind(id)
		.first();
	return c.json({ category: updated });
});

/**
 * Retiring a category.
 *
 * Deleted only while nothing references it. Once a transaction is filed under a
 * category, removing it would either orphan the row or take the money with it,
 * and neither is a thing a books system should offer. So it is deactivated
 * instead: gone from the pickers, still attached to its history.
 *
 * The refusal says which case it is and how many rows are involved, because
 * "cannot delete" without a number is an argument the reader cannot check.
 */
ledger.delete('/categories/:id', async (c) => {
	const id = c.req.param('id');

	const existing = await c.env.DB.prepare('SELECT id FROM ledger_categories WHERE id = ?')
		.bind(id)
		.first();
	if (!existing) throw new ApiError(404, 'No category with that id.');

	const used = await c.env.DB.prepare(
		'SELECT COUNT(*) AS n FROM ledger_transactions WHERE category_id = ?'
	)
		.bind(id)
		.first<{ n: number }>();

	const children = await c.env.DB.prepare(
		'SELECT COUNT(*) AS n FROM ledger_categories WHERE parent_id = ?'
	)
		.bind(id)
		.first<{ n: number }>();

	const usedCount = Number(used?.n ?? 0);
	const childCount = Number(children?.n ?? 0);

	if (usedCount > 0 || childCount > 0) {
		throw new ApiError(
			409,
			usedCount > 0
				? `${usedCount} ${usedCount === 1 ? 'entry is' : 'entries are'} filed under this ` +
					'category, so it cannot be deleted. Deactivate it instead and it will leave the ' +
					'pickers while keeping its history.'
				: `It has ${childCount} ${childCount === 1 ? 'child' : 'children'}. Move or remove ` +
					'those first.'
		);
	}

	await c.env.DB.prepare('DELETE FROM ledger_categories WHERE id = ?').bind(id).run();
	return c.json({ ok: true, deleted: true });
});

/** Deactivate, or bring one back. Archived categories keep their history. */
ledger.post('/categories/:id/archive', async (c) => {
	const id = c.req.param('id');
	const body = (await c.req.json().catch(() => ({}))) as { archived?: unknown };
	const archived = body.archived !== false;

	const existing = await c.env.DB.prepare('SELECT id FROM ledger_categories WHERE id = ?')
		.bind(id)
		.first();
	if (!existing) throw new ApiError(404, 'No category with that id.');

	await c.env.DB.prepare(
		'UPDATE ledger_categories SET archived_at = ?, updated_at = ? WHERE id = ?'
	)
		.bind(archived ? nowUtc() : null, nowUtc(), id)
		.run();

	return c.json({ ok: true, archived });
});

/** The window a listing or a total covers. Both ends optional, both inclusive. */
function window(c: { req: { query: (k: string) => string | undefined } }) {
	const from = c.req.query('from');
	const to = c.req.query('to');
	const where: string[] = [];
	const binds: string[] = [];
	if (from) {
		where.push('t.txn_date >= ?');
		binds.push(from);
	}
	if (to) {
		where.push('t.txn_date <= ?');
		binds.push(to);
	}
	return { where, binds };
}

ledger.get('/transactions', async (c) => {
	const { where, binds } = window(c);

	for (const [param, column] of [
		['category_id', 't.category_id'],
		['client_id', 't.client_id'],
		['project_id', 't.project_id'],
		['currency', 't.currency']
	] as const) {
		const value = c.req.query(param);
		if (value) {
			where.push(`${column} = ?`);
			binds.push(value);
		}
	}

	const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100), 1), 500);

	const { results } = await c.env.DB.prepare(
		`SELECT t.*, cat.name AS category_name, cat.kind AS category_kind,
        cl.name AS client_name, p.name AS project_name
     FROM ledger_transactions t
     JOIN ledger_categories cat ON cat.id = t.category_id
     LEFT JOIN clients cl ON cl.id = t.client_id
     LEFT JOIN projects p ON p.id = t.project_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY t.txn_date DESC, t.created_at DESC
     LIMIT ?`
	)
		.bind(...binds, limit)
		.all();

	return c.json({ transactions: results ?? [] });
});

/**
 * Totals, per currency, and never one number.
 *
 * There is deliberately no grand total in this response. Adding 100 USD to
 * 100 PHP produces 200 of nothing, and the result would look finished, which is
 * the whole danger: a wrong total is indistinguishable from a right one unless
 * the shape of the answer refuses to combine them.
 */
ledger.get('/totals', async (c) => {
	const { where, binds } = window(c);

	const { results } = await c.env.DB.prepare(
		`SELECT t.currency,
        cat.kind,
        SUM(t.amount_cents) AS amount_cents,
        COUNT(*) AS entries
     FROM ledger_transactions t
     JOIN ledger_categories cat ON cat.id = t.category_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     GROUP BY t.currency, cat.kind
     ORDER BY t.currency, cat.kind`
	)
		.bind(...binds)
		.all<{ currency: string; kind: string; amount_cents: number; entries: number }>();

	const rows = results ?? [];
	const byCurrency = new Map<
		string,
		{ currency: string; amount_cents: number; income_cents: number; expense_cents: number; overhead_cents: number; entries: number }
	>();

	for (const row of rows) {
		const entry = byCurrency.get(row.currency) ?? {
			currency: row.currency,
			amount_cents: 0,
			income_cents: 0,
			expense_cents: 0,
			overhead_cents: 0,
			entries: 0
		};
		if (row.kind === 'income') entry.income_cents += row.amount_cents;
		if (row.kind === 'expense') entry.expense_cents += row.amount_cents;
		if (row.kind === 'overhead') entry.overhead_cents += row.amount_cents;
		entry.amount_cents = entry.income_cents - entry.expense_cents - entry.overhead_cents;
		entry.entries += row.entries;
		byCurrency.set(row.currency, entry);
	}

	return c.json({ totals: [...byCurrency.values()], by_kind: rows });
});

ledger.post('/transactions', async (c) => {
	const body = await readJsonObject(c.req.raw);

	const categoryId = requiredText(body.category_id, 'category_id', 64);
	const category = await c.env.DB.prepare('SELECT id FROM ledger_categories WHERE id = ?')
		.bind(categoryId)
		.first();
	if (!category) throw new ApiError(404, 'No category with that id.');

	const txnDate = requiredText(body.txn_date, 'txn_date', 10);
	/**
	 * Amounts are entered positive and the category's kind carries the sign.
	 *
	 * An expense of 40 is stored as 40 under an expense category, not as -40.
	 * Letting both conventions exist would mean a stored -40 expense subtracts
	 * twice once the totals apply the kind, which is a wrong number that still
	 * looks like money.
	 */
	const rawAmount = requiredText(body.amount, 'amount', 24);
	const amountCents = parseMoneyToCents(rawAmount);
	if (amountCents === null || amountCents === 0) {
		throw new ApiError(400, 'amount must be a positive figure, like 1250 or 1,250.00.');
	}
	const currency = currencyCode(body.currency, 'currency');
	// Manual is the honest default here: a row arriving through this route was
	// typed by hand unless it says otherwise.
	const provenance = oneOf<Provenance>(body.provenance, PROVENANCE, 'provenance', 'manual');
	const clientId = optionalText(body.client_id, 'client_id', 64);
	const projectId = optionalText(body.project_id, 'project_id', 64);
	const notes = optionalText(body.notes, 'notes', 2000);
	const now = nowUtc();
	const id = crypto.randomUUID();

	try {
		await c.env.DB.prepare(
			`INSERT INTO ledger_transactions
       (id, category_id, client_id, project_id, txn_date, amount_cents, currency,
        provenance, source_invoice_id, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
		)
			.bind(
				id,
				categoryId,
				clientId ?? null,
				projectId ?? null,
				txnDate,
				amountCents,
				currency,
				provenance,
				notes ?? null,
				now,
				now
			)
			.run();
	} catch (err) {
		const message = err instanceof Error ? err.message : '';
		// The trigger's own words, passed through rather than paraphrased: it
		// already says the useful thing.
		if (message.includes('belongs to a different client')) {
			throw new ApiError(
				409,
				'That project belongs to a different client than the one on this transaction.'
			);
		}
		if (message.includes('FOREIGN KEY')) {
			throw new ApiError(404, 'The client or project on this transaction does not exist.');
		}
		throw err;
	}

	const created = await c.env.DB.prepare(
		`SELECT t.*, cat.name AS category_name, cat.kind AS category_kind
     FROM ledger_transactions t JOIN ledger_categories cat ON cat.id = t.category_id
     WHERE t.id = ?`
	)
		.bind(id)
		.first();

	return c.json({ transaction: created }, 201);
});

/**
 * Correcting a line, and the one rule that governs it.
 *
 * The redesign draws a pencil and a bin on every row and there was neither
 * route. A ledger nobody can correct is a ledger people stop entering things
 * into, so both exist now, and both refuse the same class of row: anything this
 * app posted for itself.
 *
 * `provenance` is the whole mechanism. A line with provenance 'invoice' was
 * written when a payment was recorded against an invoice, and editing it here
 * would make the ledger and the invoice disagree about money that has already
 * arrived. The refusal names where the change belongs rather than saying no.
 * D156.
 *
 * An imported line is refused for the same reason in the other direction: it is
 * a record of what a statement said, and a statement that has been edited is
 * not evidence of anything.
 */
async function manualLine(db: D1Database, id: string) {
	const row = await db
		.prepare(
			`SELECT t.id, t.provenance, t.source_invoice_id, i.invoice_number
       FROM ledger_transactions t
       LEFT JOIN invoices i ON i.id = t.source_invoice_id
       WHERE t.id = ?`
		)
		.bind(id)
		.first<{
			id: string;
			provenance: string;
			source_invoice_id: string | null;
			invoice_number: string | null;
		}>();

	if (!row) throw new ApiError(404, 'No transaction with that id.');

	if (row.provenance === 'invoice') {
		throw new ApiError(
			409,
			row.invoice_number
				? `This line was posted from invoice ${row.invoice_number}. Change the payment on that invoice instead.`
				: 'This line was posted from an invoice. Change the payment on that invoice instead.'
		);
	}

	if (row.provenance === 'import') {
		throw new ApiError(
			409,
			'This line came from an imported statement, and an edited statement is not evidence. Add a correcting line instead.'
		);
	}

	return row;
}

ledger.patch('/transactions/:id', async (c) => {
	const db = c.env.DB;
	const id = c.req.param('id');
	await manualLine(db, id);

	const body = await readJsonObject(c.req.raw);
	const sets: string[] = [];
	const binds: unknown[] = [];

	if (body.category_id !== undefined) {
		const categoryId = requiredText(body.category_id, 'category_id', 64);
		const category = await db
			.prepare('SELECT id FROM ledger_categories WHERE id = ?')
			.bind(categoryId)
			.first();
		if (!category) throw new ApiError(404, 'No category with that id.');
		sets.push('category_id = ?');
		binds.push(categoryId);
	}

	if (body.txn_date !== undefined) {
		sets.push('txn_date = ?');
		binds.push(requiredText(body.txn_date, 'txn_date', 10));
	}

	if (body.amount !== undefined) {
		// Same convention as the create route: positive, with the category's kind
		// carrying the sign. A stored negative expense would subtract twice.
		const amountCents = parseMoneyToCents(requiredText(body.amount, 'amount', 24));
		if (amountCents === null || amountCents === 0) {
			throw new ApiError(400, 'amount must be a positive figure, like 1250 or 1,250.00.');
		}
		sets.push('amount_cents = ?');
		binds.push(amountCents);
	}

	for (const [key, column, limit] of [
		['client_id', 'client_id', 64],
		['project_id', 'project_id', 64],
		['notes', 'notes', 2000]
	] as const) {
		if (body[key] !== undefined) {
			sets.push(`${column} = ?`);
			binds.push(optionalText(body[key], key, limit) ?? null);
		}
	}

	if (sets.length === 0) throw new ApiError(400, 'Nothing to change.');

	sets.push('updated_at = ?');
	binds.push(nowUtc());

	try {
		await db
			.prepare(`UPDATE ledger_transactions SET ${sets.join(', ')} WHERE id = ?`)
			.bind(...binds, id)
			.run();
	} catch (err) {
		const message = err instanceof Error ? err.message : '';
		// The trigger's own words, as the create route passes them through.
		if (message.includes('belongs to a different client')) {
			throw new ApiError(
				409,
				'That project belongs to a different client than the one on this transaction.'
			);
		}
		if (message.includes('FOREIGN KEY')) {
			throw new ApiError(404, 'The client or project on this transaction does not exist.');
		}
		throw err;
	}

	const updated = await db
		.prepare(
			`SELECT t.*, cat.name AS category_name, cat.kind AS category_kind
       FROM ledger_transactions t JOIN ledger_categories cat ON cat.id = t.category_id
       WHERE t.id = ?`
		)
		.bind(id)
		.first();

	return c.json({ transaction: updated });
});

ledger.delete('/transactions/:id', async (c) => {
	const db = c.env.DB;
	const id = c.req.param('id');
	await manualLine(db, id);

	/**
	 * The receipts go with it, and the objects go with the rows.
	 *
	 * `expense_receipts` cascades on delete, so leaving R2 alone would strand
	 * every attached file: no row names them and nothing knows to remove them.
	 * They are read and deleted first, so the worst case is a stray object
	 * rather than a stray object nobody can find.
	 */
	const { results } = await db
		.prepare('SELECT r2_key FROM expense_receipts WHERE transaction_id = ?')
		.bind(id)
		.all<{ r2_key: string }>();

	for (const receipt of results ?? []) {
		await c.env.FILES.delete(receipt.r2_key).catch(() => {});
	}

	await db.prepare('DELETE FROM ledger_transactions WHERE id = ?').bind(id).run();
	return c.json({ ok: true });
});

/**
 * The month on screen, as a CSV.
 *
 * Exports exactly what the window asks for and nothing else, so a file cannot
 * quietly contain more than the screen it was taken from. One row per line,
 * amounts as plain decimal numbers rather than as formatted money, because this
 * is going into a spreadsheet and "$1,250.00" arrives there as text.
 */
ledger.get('/export', async (c) => {
	const { where, binds } = window(c);

	const { results } = await c.env.DB.prepare(
		`SELECT t.txn_date, cat.name AS category_name, cat.kind AS category_kind,
        cl.name AS client_name, p.name AS project_name,
        t.amount_cents, t.currency, t.provenance, t.notes
     FROM ledger_transactions t
     JOIN ledger_categories cat ON cat.id = t.category_id
     LEFT JOIN clients cl ON cl.id = t.client_id
     LEFT JOIN projects p ON p.id = t.project_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY t.txn_date ASC, t.created_at ASC`
	)
		.bind(...binds)
		.all<Record<string, string | number | null>>();

	/**
	 * One CSV field, quoted.
	 *
	 * Everything is quoted rather than only the fields that need it. A rule that
	 * decides per field is a rule that gets the decision wrong on the one note
	 * containing a comma, and a note is exactly where a comma turns up.
	 *
	 * A leading =, +, - or @ is prefixed with a quote, because a spreadsheet
	 * reads those as the start of a formula. A note beginning "-40 refunded"
	 * would otherwise be evaluated by Excel, which is the well-known way a CSV
	 * export becomes a security problem in somebody else's application.
	 */
	const field = (value: string | number | null): string => {
		let text = value === null || value === undefined ? '' : String(value);
		if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
		return `"${text.replace(/"/g, '""')}"`;
	};

	const header = [
		'date',
		'category',
		'kind',
		'client',
		'project',
		'amount',
		'currency',
		'provenance',
		'notes'
	];

	const lines = [header.map(field).join(',')];
	for (const row of results ?? []) {
		lines.push(
			[
				row.txn_date,
				row.category_name,
				row.category_kind,
				row.client_name,
				row.project_name,
				// Plain decimal. A spreadsheet reads 1250.00 as a number and
				// "$1,250.00" as text, and a column of text does not add up.
				(Number(row.amount_cents) / 100).toFixed(2),
				row.currency,
				row.provenance,
				row.notes
			].map(field).join(',')
		);
	}

	const from = c.req.query('from');
	const to = c.req.query('to');
	const name = from && to ? `ledger-${from}-to-${to}.csv` : 'ledger.csv';

	return new Response(lines.join('\r\n') + '\r\n', {
		headers: {
			// UTF-8 said out loud, so a note with an accent in it opens correctly.
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${name}"`,
			'cache-control': 'private, no-store'
		}
	});
});

/**
 * Receipts. P3-E3.
 *
 * Metadata in D1, bytes in R2, the split the rest of the app already uses. A
 * receipt exists only against a transaction, so every route here reaches it
 * through its transaction rather than by id alone: a receipt id that could be
 * fetched on its own would be a way to read a file without the row that
 * explains what it is.
 */

/** Twelve megabytes. A photographed receipt is well under; a scan can approach it. */
const MAX_RECEIPT_BYTES = 12 * 1024 * 1024;

const ALLOWED_RECEIPT_TYPES = [
	'application/pdf',
	'image/jpeg',
	'image/png',
	'image/heic',
	'image/webp'
];

ledger.get('/transactions/:id/receipts', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT id, transaction_id, filename, mime_type, size_bytes, uploaded_at
     FROM expense_receipts WHERE transaction_id = ? ORDER BY uploaded_at DESC`
	)
		.bind(c.req.param('id'))
		.all();
	return c.json({ receipts: results ?? [] });
});

ledger.post('/transactions/:id/receipts', async (c) => {
	const transactionId = c.req.param('id');
	const transaction = await c.env.DB.prepare('SELECT id FROM ledger_transactions WHERE id = ?')
		.bind(transactionId)
		.first();
	if (!transaction) throw new ApiError(404, 'No transaction with that id.');

	const form = await c.req.formData().catch(() => null);
	const file = form?.get('file');
	if (!(file instanceof File)) throw new ApiError(400, 'Attach a file as the "file" field.');

	if (file.size === 0) throw new ApiError(400, 'That file is empty.');
	if (file.size > MAX_RECEIPT_BYTES) {
		throw new ApiError(413, 'That file is larger than 12 MB.');
	}
	const mime = file.type || 'application/octet-stream';
	if (!ALLOWED_RECEIPT_TYPES.includes(mime)) {
		throw new ApiError(415, `A receipt must be a PDF or an image. That one is ${mime}.`);
	}

	const id = crypto.randomUUID();
	const key = `receipts/${transactionId}/${id}`;
	const now = nowUtc();

	await c.env.FILES.put(key, await file.arrayBuffer(), {
		httpMetadata: { contentType: mime }
	});

	try {
		await c.env.DB.prepare(
			`INSERT INTO expense_receipts
       (id, transaction_id, filename, mime_type, size_bytes, r2_key, uploaded_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
			.bind(id, transactionId, file.name || 'receipt', mime, file.size, key, now, now)
			.run();
	} catch (err) {
		// The row is the record. If it did not land, the object is unreachable
		// and is removed rather than left as a file nothing points at.
		await c.env.FILES.delete(key).catch(() => {});
		throw err;
	}

	const created = await c.env.DB.prepare(
		'SELECT id, transaction_id, filename, mime_type, size_bytes, uploaded_at FROM expense_receipts WHERE id = ?'
	)
		.bind(id)
		.first();
	return c.json({ receipt: created }, 201);
});

/**
 * The bytes, reached through the transaction that owns them.
 *
 * The row is checked before R2 is touched, so a guessed key cannot serve a
 * file: the object is only ever named by a row the caller has already been
 * shown to be entitled to reach.
 */
ledger.get('/transactions/:id/receipts/:receiptId', async (c) => {
	const row = await c.env.DB.prepare(
		`SELECT r2_key, filename, mime_type FROM expense_receipts
     WHERE id = ? AND transaction_id = ?`
	)
		.bind(c.req.param('receiptId'), c.req.param('id'))
		.first<{ r2_key: string; filename: string; mime_type: string | null }>();
	if (!row) throw new ApiError(404, 'No receipt with that id on that transaction.');

	const object = await c.env.FILES.get(row.r2_key);
	if (!object) {
		throw new ApiError(404, 'The record is here but the file is missing from storage.');
	}

	// Buffered rather than piped, matching the attachment route: the Workers R2
	// stream and the platform Response type disagree, and a receipt is small.
	const bytes = new Uint8Array(await object.arrayBuffer());
	const safe = row.filename.replace(new RegExp('["' + String.fromCharCode(13, 10) + ']', 'g'), '');

	return new Response(bytes.buffer as ArrayBuffer, {
		headers: {
			'content-type': row.mime_type ?? 'application/octet-stream',
			'content-disposition': `attachment; filename="${safe}"`,
			// Never cached by a shared cache: this is somebody's private file.
			'cache-control': 'private, no-store'
		}
	});
});

ledger.delete('/transactions/:id/receipts/:receiptId', async (c) => {
	const row = await c.env.DB.prepare(
		'SELECT r2_key FROM expense_receipts WHERE id = ? AND transaction_id = ?'
	)
		.bind(c.req.param('receiptId'), c.req.param('id'))
		.first<{ r2_key: string }>();
	if (!row) throw new ApiError(404, 'No receipt with that id on that transaction.');

	await c.env.DB.prepare('DELETE FROM expense_receipts WHERE id = ?')
		.bind(c.req.param('receiptId'))
		.run();
	await c.env.FILES.delete(row.r2_key).catch(() => {});

	return c.json({ ok: true });
});
