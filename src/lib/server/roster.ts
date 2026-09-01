import type { D1Database } from '@cloudflare/workers-types';
import { nowUtc } from './dates';
import { parseCsv, normaliseName } from '../csv';

/**
 * The client roster: a status overlay, loaded from its own file.
 *
 * Not a matching authority. The crosswalk decides which client a project
 * belongs to; this says what state that client is in and what evidence the call
 * rests on. Keeping them apart matters because they disagree: six of the
 * roster's thirty-six names do not appear in the crosswalk at all, and a loader
 * that quietly reconciled them would hide the fact rather than surface it.
 *
 * The status is stored as the file writes it and is not folded into
 * `clients.status`, which allows only active and archived. Three of the five
 * roster values are Paul saying "this needs a second look", which neither of
 * the app's two states can express, and collapsing it would destroy the only
 * thing the row was written to say.
 */

const newId = () => crypto.randomUUID();

const COLUMNS = ['name', 'status', 'shared_mount', 'last_activity', 'evidence', 'notes'] as const;

export interface RosterLoad {
	source: string;
	rows_in_file: number;
	rows_written: number;
	rows_skipped: number;
	/** What the table holds afterwards, which is not always what was written. D174. */
	rows_in_table: number;
	matched: number;
	unmatched: number;
	/** Roster names with no client to attach to. Reported, never invented. */
	unmatched_names: number;
	unknown_columns: string[];
	missing_columns: string[];
}

function blankToNull(value: string | undefined): string | null {
	const trimmed = (value ?? '').trim();
	return trimmed === '' ? null : trimmed;
}

/**
 * Reads the roster file and attaches each row to a client where it can.
 *
 * Matching starts at the name, because the roster carries no Asana gid: the
 * first precedence rule has nothing to work with here. Exact first, then
 * normalised, then nothing. Nothing is a real answer and appears in the count.
 */
export async function loadRoster(
	db: D1Database,
	source: string,
	text: string
): Promise<RosterLoad> {
	const table = parseCsv(text);
	const at = nowUtc();

	const unknown = table.header.filter((h) => !COLUMNS.includes(h as (typeof COLUMNS)[number]));
	const missing = COLUMNS.filter((c) => !table.header.includes(c));

	if (!table.header.includes('name')) {
		throw new Error(
			`The roster file has no name column. It has: ${table.header.join(', ') || '(nothing)'}`
		);
	}

	// Every client the app knows, by exact name and by normalised name. Built
	// once: thirty-six rows times two queries each is not slow, but the
	// normalised pass cannot be done in SQL without a function SQLite does not
	// have, so the list comes into memory regardless.
	const { results: clients } = await db
		.prepare('SELECT id, name FROM clients')
		.all<{ id: string; name: string }>();

	const byExact = new Map<string, string>();
	const byNormalised = new Map<string, string>();
	for (const client of clients ?? []) {
		byExact.set(client.name.toLowerCase(), client.id);
		const key = normaliseName(client.name);
		if (key && !byNormalised.has(key)) byNormalised.set(key, client.id);
	}

	// The crosswalk's aliases too. A roster name may match how Asana or Dropbox
	// spells a client rather than how the app displays it, and refusing to look
	// there would report an unmatched row that the data already answers.
	const { results: aliases } = await db
		.prepare(
			`SELECT asana_name, dropbox_name, client_id FROM client_crosswalk WHERE client_id IS NOT NULL`
		)
		.all<{ asana_name: string | null; dropbox_name: string | null; client_id: string }>();

	for (const alias of aliases ?? []) {
		for (const spelling of [alias.asana_name, alias.dropbox_name]) {
			if (!spelling) continue;
			const lower = spelling.toLowerCase();
			if (!byExact.has(lower)) byExact.set(lower, alias.client_id);
			const key = normaliseName(spelling);
			if (key && !byNormalised.has(key)) byNormalised.set(key, alias.client_id);
		}
	}

	let written = 0;
	let skipped = 0;
	let matched = 0;
	let unmatched = 0;

	for (const row of table.rows) {
		const name = blankToNull(row.name);
		if (!name) {
			skipped += 1;
			continue;
		}

		const exact = byExact.get(name.toLowerCase());
		const loose = exact ? undefined : byNormalised.get(normaliseName(name));
		const clientId = exact ?? loose ?? null;
		const how = exact ? 'exact_name' : loose ? 'normalised_name' : null;

		if (clientId) matched += 1;
		else unmatched += 1;

		await db
			.prepare(
				`INSERT INTO client_roster
         (name, status, shared_mount, last_activity, evidence, notes, client_id, matched_by, loaded_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(name) DO UPDATE SET
           status = ?2, shared_mount = ?3, last_activity = ?4, evidence = ?5, notes = ?6,
           client_id = ?7, matched_by = ?8, loaded_at = ?9`
			)
			.bind(
				name,
				blankToNull(row.status),
				blankToNull(row.shared_mount),
				blankToNull(row.last_activity),
				blankToNull(row.evidence),
				blankToNull(row.notes),
				clientId,
				how,
				at
			)
			.run();

		written += 1;
	}

	// Read the table back rather than trusting the loop. A file that collides
	// with itself writes more rows than it keeps, which is how the crosswalk
	// lost ten Asana gids while reporting that it had written all fifty-five.
	const held = await db
		.prepare(
			`SELECT COUNT(*) AS rows,
              SUM(CASE WHEN client_id IS NOT NULL THEN 1 ELSE 0 END) AS matched
       FROM client_roster`
		)
		.first<{ rows: number; matched: number }>();

	const load: RosterLoad = {
		source,
		rows_in_file: table.rows.length,
		rows_written: written,
		rows_skipped: skipped,
		rows_in_table: held?.rows ?? 0,
		matched,
		unmatched,
		unmatched_names: (held?.rows ?? 0) - (held?.matched ?? 0),
		unknown_columns: unknown,
		missing_columns: missing
	};

	const note =
		[
			missing.length ? `missing columns: ${missing.join(', ')}` : null,
			unknown.length ? `unknown columns: ${unknown.join(', ')}` : null,
			load.rows_written !== load.rows_in_table
				? `${load.rows_written - load.rows_in_table} rows collided on name and did not survive`
				: null
		]
			.filter(Boolean)
			.join('; ') || null;

	await db
		.prepare(
			`INSERT INTO client_roster_loads
       (id, source, rows_in_file, rows_written, rows_skipped, rows_in_table, matched, unmatched, loaded_at, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			newId(),
			source,
			load.rows_in_file,
			written,
			skipped,
			load.rows_in_table,
			matched,
			unmatched,
			at,
			note
		)
		.run();

	return load;
}
