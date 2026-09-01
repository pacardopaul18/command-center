import type { D1Database } from '@cloudflare/workers-types';
import { nowUtc } from './dates';
import { parseCsv, normaliseName } from '../csv';

/** Ids match the rest of the app: a random UUID, generated where the row is. */
const newId = () => crypto.randomUUID();

/**
 * A stable id for one line of the crosswalk file.
 *
 * Derived from the line's own identifying fields rather than random, so loading
 * the same file twice updates the same rows instead of doubling the table. A
 * random id would make every load an append, and the second load would show 110
 * rows for a 55 row file.
 *
 * The gid alone will not serve as the key: twelve of the fifty-five lines have
 * none. Nor will canonical_name, which is what 0035 exists to correct.
 */
async function rowKey(...parts: (string | null)[]): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(parts.map((p) => (p ?? '').trim().toLowerCase()).join('\u0000'))
	);
	return [...new Uint8Array(digest)]
		.slice(0, 16)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Loading the client crosswalk, and using it to file Asana projects.
 *
 * THE CROSSWALK IS DATA. The file is the override path: Paul edits the
 * spreadsheet, the loader re-reads it, and nothing in here has an opinion the
 * file cannot overrule. That is why the mapping is not forty lines of `if` in a
 * matcher, which would have made every correction a code change and a deploy.
 *
 * PRECEDENCE, in order, stopping at the first that fires:
 *
 *   1. asana_gid exact       authoritative, never overridden by a name
 *   2. dropbox_name exact    for folders
 *   3. normalised name       case, punctuation and legal suffix ignored
 *   4. unassigned            visible, resolvable by Paul, never guessed
 *
 * The fourth is a real answer and not a failure. A project filed under the
 * wrong client is worse than one filed under none: the wrong filing is
 * invisible and gets believed, while an unassigned project is a question on a
 * screen that somebody answers once.
 */

/** The columns the crosswalk file is expected to carry. */
const COLUMNS = [
	'canonical_name',
	'type',
	'presence',
	'dropbox_name',
	'asana_name',
	'name_drift',
	'dropbox_status',
	'shared_mount',
	'dropbox_last_activity',
	'asana_gid',
	'asana_total_tasks',
	'asana_open_tasks',
	'asana_owner',
	'notes'
] as const;

export interface CrosswalkLoad {
	source: string;
	rows_in_file: number;
	rows_written: number;
	rows_skipped: number;
	with_asana_gid: number;
	with_dropbox_name: number;
	with_both: number;
	name_drift: number;
	clients_created: number;
	clients_existing: number;
	/**
	 * What the table holds afterwards, which is not always what was written.
	 *
	 * A file that collides with itself writes more rows than it keeps, and a
	 * load reporting only what it did would say 55 while the table held 45. That
	 * is how ten Asana gids went missing with no failing number anywhere.
	 */
	rows_in_table: number;
	distinct_clients: number;
	/** Rows whose gid the table did not keep. Should always be zero. */
	gids_lost: number;
	/** Header names in the file that this does not store, so a rename is loud. */
	unknown_columns: string[];
	/** Expected columns the file did not have, same reason. */
	missing_columns: string[];
}

function blankToNull(value: string | undefined): string | null {
	const trimmed = (value ?? '').trim();
	return trimmed === '' ? null : trimmed;
}

function intOrNull(value: string | undefined): number | null {
	const text = blankToNull(value);
	if (text === null) return null;
	const n = Number(text.replace(/,/g, ''));
	return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Whether the file's name_drift column is saying yes, however it spells it. */
function isDrift(value: string | null): boolean {
	if (!value) return false;
	return /^(y|yes|true|1|drift)/i.test(value);
}

/**
 * Reads the crosswalk file into the table and files each row against a client.
 *
 * Counts everything it did, including what it did not do. A load that read 12
 * rows when the last one read 55 is a truncated file, and the only way that is
 * noticed is if the number is recorded rather than assumed.
 */
export async function loadCrosswalk(
	db: D1Database,
	source: string,
	text: string
): Promise<CrosswalkLoad> {
	const table = parseCsv(text);
	const at = nowUtc();

	const unknown = table.header.filter((h) => !COLUMNS.includes(h as (typeof COLUMNS)[number]));
	const missing = COLUMNS.filter((c) => !table.header.includes(c));

	// canonical_name is the key. Without it there is no file, only a grid.
	if (!table.header.includes('canonical_name')) {
		throw new Error(
			`The crosswalk file has no canonical_name column. It has: ${table.header.join(', ') || '(nothing)'}`
		);
	}

	let written = 0;
	let skipped = 0;
	let withGid = 0;
	let withDropbox = 0;
	let withBoth = 0;
	let drift = 0;
	let created = 0;
	let existing = 0;

	for (const row of table.rows) {
		const canonical = blankToNull(row.canonical_name);
		if (!canonical) {
			skipped += 1;
			continue;
		}

		const asanaGid = blankToNull(row.asana_gid);
		const dropboxName = blankToNull(row.dropbox_name);
		const nameDrift = blankToNull(row.name_drift);

		if (asanaGid) withGid += 1;
		if (dropboxName) withDropbox += 1;
		if (asanaGid && dropboxName) withBoth += 1;
		if (isDrift(nameDrift)) drift += 1;

		// The client row, keyed on the canonical name because that is what the
		// app displays. The name index is NOCASE, so a second load with a
		// different capitalisation finds the same client rather than making one.
		const found = await db
			.prepare('SELECT id FROM clients WHERE name = ? COLLATE NOCASE')
			.bind(canonical)
			.first<{ id: string }>();

		let clientId: string;
		if (found) {
			clientId = found.id;
			existing += 1;
		} else {
			clientId = newId();
			await db
				.prepare(
					`INSERT INTO clients (id, name, status, notes, created_at, updated_at)
           VALUES (?, ?, 'active', ?, ?, ?)`
				)
				.bind(clientId, canonical, blankToNull(row.notes), at, at)
				.run();
			created += 1;
		}

		// A stable id from the file's own content, so a re-load updates the row
		// it wrote last time instead of adding a second one. The gid alone will
		// not do: twelve rows have none.
		const rowId = await rowKey(canonical, asanaGid, dropboxName, row.asana_name ?? '');

		await db
			.prepare(
				`INSERT INTO client_crosswalk
         (id, canonical_name, type, presence, dropbox_name, asana_name, name_drift,
          dropbox_status, shared_mount, dropbox_last_activity, asana_gid,
          asana_total_tasks, asana_open_tasks, asana_owner, notes,
          client_id, matched_by, loaded_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
         ON CONFLICT(id) DO UPDATE SET
           canonical_name = ?2, type = ?3, presence = ?4, dropbox_name = ?5, asana_name = ?6,
           name_drift = ?7, dropbox_status = ?8, shared_mount = ?9, dropbox_last_activity = ?10,
           asana_gid = ?11, asana_total_tasks = ?12, asana_open_tasks = ?13, asana_owner = ?14,
           notes = ?15, client_id = ?16, matched_by = ?17, loaded_at = ?18`
			)
			.bind(
				rowId,
				canonical,
				blankToNull(row.type),
				blankToNull(row.presence),
				dropboxName,
				blankToNull(row.asana_name),
				nameDrift,
				blankToNull(row.dropbox_status),
				blankToNull(row.shared_mount),
				blankToNull(row.dropbox_last_activity),
				asanaGid,
				intOrNull(row.asana_total_tasks),
				intOrNull(row.asana_open_tasks),
				blankToNull(row.asana_owner),
				blankToNull(row.notes),
				clientId,
				asanaGid ? 'asana_gid' : dropboxName ? 'dropbox_name' : 'normalised_name',
				at
			)
			.run();

		written += 1;
	}

	// Read the table back rather than trusting the loop's own tally. A file that
	// collides with itself writes more rows than it keeps, and only the table
	// knows which number is the real one.
	const held = await db
		.prepare(
			`SELECT COUNT(*) AS rows,
              COUNT(DISTINCT canonical_name) AS clients,
              SUM(CASE WHEN asana_gid IS NOT NULL THEN 1 ELSE 0 END) AS gids
       FROM client_crosswalk`
		)
		.first<{ rows: number; clients: number; gids: number }>();

	const load: CrosswalkLoad = {
		source,
		rows_in_file: table.rows.length,
		rows_written: written,
		rows_skipped: skipped,
		with_asana_gid: withGid,
		with_dropbox_name: withDropbox,
		with_both: withBoth,
		name_drift: drift,
		clients_created: created,
		clients_existing: existing,
		rows_in_table: held?.rows ?? 0,
		distinct_clients: held?.clients ?? 0,
		gids_lost: withGid - (held?.gids ?? 0),
		unknown_columns: unknown,
		missing_columns: missing
	};

	const note =
		[
			missing.length ? `missing columns: ${missing.join(', ')}` : null,
			unknown.length ? `unknown columns: ${unknown.join(', ')}` : null
		]
			.filter(Boolean)
			.join('; ') || null;

	await db
		.prepare(
			`INSERT INTO client_crosswalk_loads
       (id, source, rows_in_file, rows_written, rows_skipped, with_asana_gid,
        with_dropbox_name, with_both, name_drift, loaded_at, note,
        rows_in_table, distinct_clients)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			newId(),
			source,
			load.rows_in_file,
			written,
			skipped,
			withGid,
			withDropbox,
			withBoth,
			drift,
			at,
			[
				note,
				load.gids_lost > 0
					? `${load.gids_lost} rows with an Asana gid did not survive into the table`
					: null
			]
				.filter(Boolean)
				.join('; ') || null,
			load.rows_in_table,
			load.distinct_clients
		)
		.run();

	return load;
}

export interface MatchReport {
	projects: number;
	by_gid: number;
	by_dropbox_name: number;
	by_normalised_name: number;
	unassigned: number;
}

/**
 * Files every mirrored project against a client, in precedence order.
 *
 * Rewrites the answer every time rather than only filling blanks, because the
 * crosswalk is the source: a row Paul corrected in the file must win over what
 * a previous run decided. A `manual` match is the one exception, since that is
 * already Paul's answer and re-deriving it would throw away the correction.
 */
export async function matchProjectsToClients(
	db: D1Database,
	workspaceGid: string
): Promise<MatchReport> {
	const { results } = await db
		.prepare('SELECT gid, name, client_match FROM asana_projects WHERE workspace_gid = ?')
		.bind(workspaceGid)
		.all<{ gid: string; name: string; client_match: string | null }>();

	const { results: crosswalk } = await db
		.prepare(
			`SELECT canonical_name, asana_gid, asana_name, dropbox_name, client_id
       FROM client_crosswalk WHERE client_id IS NOT NULL`
		)
		.all<{
			canonical_name: string;
			asana_gid: string | null;
			asana_name: string | null;
			dropbox_name: string | null;
			client_id: string;
		}>();

	const byGid = new Map<string, string>();
	const byDropbox = new Map<string, string>();
	const byNormalised = new Map<string, string>();

	for (const row of crosswalk ?? []) {
		if (row.asana_gid) byGid.set(row.asana_gid, row.client_id);
		if (row.dropbox_name) byDropbox.set(row.dropbox_name, row.client_id);
		for (const alias of [row.canonical_name, row.asana_name, row.dropbox_name]) {
			if (!alias) continue;
			const key = normaliseName(alias);
			// First alias wins. A later row normalising onto the same key is an
			// ambiguity, and resolving it by overwriting would make the answer
			// depend on row order.
			if (key && !byNormalised.has(key)) byNormalised.set(key, row.client_id);
		}
	}

	const report: MatchReport = {
		projects: results?.length ?? 0,
		by_gid: 0,
		by_dropbox_name: 0,
		by_normalised_name: 0,
		unassigned: 0
	};

	for (const project of results ?? []) {
		if (project.client_match === 'manual') continue;

		let clientId: string | null = null;
		let how: 'crosswalk' | 'exact_name' | null = null;

		const gidHit = byGid.get(project.gid);
		const dropboxHit = gidHit ? undefined : byDropbox.get(project.name);
		const normalisedHit =
			gidHit || dropboxHit ? undefined : byNormalised.get(normaliseName(project.name));

		if (gidHit) {
			clientId = gidHit;
			how = 'crosswalk';
			report.by_gid += 1;
		} else if (dropboxHit) {
			clientId = dropboxHit;
			how = 'exact_name';
			report.by_dropbox_name += 1;
		} else if (normalisedHit) {
			clientId = normalisedHit;
			how = 'exact_name';
			report.by_normalised_name += 1;
		} else {
			report.unassigned += 1;
		}

		await db
			.prepare('UPDATE asana_projects SET client_id = ?, client_match = ? WHERE gid = ?')
			.bind(clientId, how, project.gid)
			.run();
	}

	return report;
}
