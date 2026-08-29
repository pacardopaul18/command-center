import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { nowUtc, todayInWorkingZone, WORKING_TIME_ZONE } from './dates';

/**
 * Nightly D1 to R2 backup.
 *
 * Pulled forward from v2 by PM ruling on 2026-08-29.
 *
 * D1 on the Free plan keeps 7 days of its own point-in-time restore, which is a
 * real safety net but not one Paul controls, cannot be read without the
 * Cloudflare API, and disappears if the database is deleted. This produces a
 * file he owns, in his own bucket, restorable with a single wrangler command.
 *
 * **Why the dump is written by hand rather than exported.** `wrangler d1 export`
 * is a CLI command and does not exist inside a Worker. The D1 REST export
 * endpoint does, but reaching it needs a Cloudflare API token stored as another
 * secret, which is a new credential and a new failure mode for something that
 * can be done with the binding already in scope. So the dump is assembled from
 * `sqlite_master` and a read of each table.
 *
 * **Two honest limits, stated rather than implied.**
 *
 * The dump is not transactionally consistent. D1 gives no snapshot isolation
 * across separate statements, so a write landing between two table reads would
 * be caught half-in. For a single-user app backed up while its one user is
 * asleep this is not a real risk, but it is a real property and the restore
 * instructions say so.
 *
 * The whole dump is assembled in memory. That is correct for a database of this
 * size and would not be for a large one. The threshold is checked and the
 * backup fails loudly rather than silently truncating.
 */

/**
 * The Mountain hour the nightly backup runs at.
 *
 * 03:00 local, which is genuinely overnight year round and well clear of both
 * digests. Cron Triggers are UTC only, so the schedule fires at 09:00Z and
 * 10:00Z and this decides which of the two is the real one, exactly as the
 * digests do. Reusing that pattern rather than inventing a second one, D54.
 */
export const BACKUP_HOUR_MT = 3;

/** True when this firing is the nightly backup. */
export function backupDueAt(now: Date): boolean {
	const hour = Number(
		new Intl.DateTimeFormat('en-GB', {
			timeZone: WORKING_TIME_ZONE,
			hour: '2-digit',
			hour12: false
		}).format(now)
	);
	return hour === BACKUP_HOUR_MT;
}

/** Above this, stop and say so rather than quietly producing a broken file. */
const MAX_DUMP_BYTES = 40 * 1024 * 1024;

/** Backups older than this are deleted after a successful write. */
export const RETENTION_DAYS = 30;

/** D1 and SQLite internals. Neither belongs in a restore. */
function isInternal(name: string): boolean {
	return name.startsWith('sqlite_') || name.startsWith('_cf_');
}

interface MasterRow {
	type: string;
	name: string;
	tbl_name: string;
	sql: string | null;
}

/**
 * Quotes a value for a SQL literal.
 *
 * The schema is TEXT, INTEGER and REAL only, verified against every migration,
 * so anything else arriving here means the schema changed without this being
 * revisited. It throws rather than guessing, because a backup that silently
 * mangles a column is worse than one that fails.
 */
function literal(value: unknown, table: string, column: string): string {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			throw new Error(`${table}.${column} holds a non-finite number, which cannot be dumped.`);
		}
		return String(value);
	}
	if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
	if (typeof value === 'boolean') return value ? '1' : '0';
	throw new Error(
		`${table}.${column} holds an unsupported type (${typeof value}). The dump refuses to guess.`
	);
}

/**
 * Orders tables so a referenced table is always inserted before the table that
 * references it.
 *
 * Restores otherwise fail on foreign keys depending on which order sqlite_master
 * happens to return. The dependency edges are read from each table's own DDL,
 * which is the same text SQLite stores, so this cannot drift from the schema.
 *
 * A cycle would make a correct order impossible. There is none today, and if one
 * ever appears the remaining tables are appended in their existing order rather
 * than the backup failing: a dump that needs manual FK handling on restore beats
 * no dump.
 */
export function orderByDependency(tables: { name: string; sql: string }[]): string[] {
	const names = tables.map((t) => t.name);
	const deps = new Map<string, Set<string>>();

	for (const t of tables) {
		const found = new Set<string>();
		for (const m of t.sql.matchAll(/REFERENCES\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)) {
			const target = m[1];
			// A self reference is not an ordering constraint within one table.
			if (target !== t.name && names.includes(target)) found.add(target);
		}
		deps.set(t.name, found);
	}

	const ordered: string[] = [];
	const placed = new Set<string>();
	let progress = true;

	while (progress && ordered.length < names.length) {
		progress = false;
		for (const name of names) {
			if (placed.has(name)) continue;
			const need = deps.get(name) ?? new Set();
			if ([...need].every((d) => placed.has(d))) {
				ordered.push(name);
				placed.add(name);
				progress = true;
			}
		}
	}

	for (const name of names) if (!placed.has(name)) ordered.push(name);
	return ordered;
}

export interface DumpStats {
	tables: { name: string; rows: number }[];
	total_rows: number;
	bytes: number;
	sql: string;
}

/** Builds the full SQL dump. Pure apart from reading the database. */
export async function dumpDatabase(db: D1Database): Promise<DumpStats> {
	const master = await db
		.prepare(
			`SELECT type, name, tbl_name, sql FROM sqlite_master
       WHERE sql IS NOT NULL ORDER BY type, name`
		)
		.all<MasterRow>();

	const rows = (master.results ?? []).filter((r) => !isInternal(r.name) && !isInternal(r.tbl_name));
	const tables = rows.filter((r) => r.type === 'table').map((r) => ({ name: r.name, sql: r.sql! }));
	const indexes = rows.filter((r) => r.type === 'index');
	const triggers = rows.filter((r) => r.type === 'trigger');

	if (tables.length === 0) {
		throw new Error('The database reported no tables. Refusing to write an empty backup.');
	}

	const order = orderByDependency(tables);
	const ddl = new Map(tables.map((t) => [t.name, t.sql]));

	const parts: string[] = [
		'-- Command Center backup',
		`-- Generated ${nowUtc()} by the Worker, from the D1 binding.`,
		'--',
		'-- Restore into an empty database with:',
		'--   npx wrangler d1 execute command-center-db --remote --file=<this file>',
		'--',
		'-- Not transactionally consistent: D1 gives no snapshot across statements,',
		'-- so a write landing mid-dump could be caught half-in.',
		'',
		'PRAGMA foreign_keys = OFF;',
		''
	];

	// Schema first, in dependency order, so the file is also readable as a
	// description of the database.
	for (const name of order) parts.push(`${ddl.get(name)!};`);
	parts.push('');

	const stats: { name: string; rows: number }[] = [];
	let totalRows = 0;

	for (const name of order) {
		// The table name comes from sqlite_master, not from user input, so it
		// cannot be anything but an existing identifier. Quoted regardless.
		const data = await db.prepare(`SELECT * FROM "${name}"`).all<Record<string, unknown>>();
		const results = data.results ?? [];
		stats.push({ name, rows: results.length });
		totalRows += results.length;
		if (results.length === 0) continue;

		parts.push(`-- ${name}: ${results.length} row${results.length === 1 ? '' : 's'}`);
		const columns = Object.keys(results[0]);
		const columnList = columns.map((c) => `"${c}"`).join(', ');

		for (const row of results) {
			const values = columns.map((c) => literal(row[c], name, c)).join(', ');
			parts.push(`INSERT INTO "${name}" (${columnList}) VALUES (${values});`);
		}
		parts.push('');
	}

	// Indexes and triggers after the data. Building an index over a populated
	// table is cheaper, and a trigger installed before the inserts would fire on
	// every one of them, which for the SOP immutability triggers means a restore
	// that rejects its own data.
	for (const i of indexes) parts.push(`${i.sql};`);
	if (indexes.length > 0) parts.push('');
	for (const t of triggers) parts.push(`${t.sql};`);
	if (triggers.length > 0) parts.push('');

	parts.push('PRAGMA foreign_keys = ON;');
	parts.push('');

	const sql = parts.join('\n');
	const bytes = new TextEncoder().encode(sql).length;

	if (bytes > MAX_DUMP_BYTES) {
		throw new Error(
			`The dump is ${bytes} bytes, over the ${MAX_DUMP_BYTES} byte ceiling this builds in memory. ` +
				'Move to a streaming export before backing up again.'
		);
	}

	return { tables: stats, total_rows: totalRows, bytes, sql };
}

export interface BackupResult {
	key: string;
	bytes: number;
	total_rows: number;
	tables: { name: string; rows: number }[];
	deleted: string[];
	day: string;
}

/** R2 key for a given Mountain day. One backup per day, overwritten on rerun. */
export function backupKey(day: string): string {
	return `backups/d1/${day}.sql`;
}

/**
 * Writes today's backup and prunes old ones.
 *
 * The prune runs only after the write has succeeded, so a failed backup never
 * removes a good one. Same rule as the digest's sent marker and the Asana gid:
 * the consequence of an action is recorded after the action, never before.
 */
export async function runBackup(db: D1Database, bucket: R2Bucket): Promise<BackupResult> {
	const day = todayInWorkingZone();
	const key = backupKey(day);
	const dump = await dumpDatabase(db);

	await bucket.put(key, dump.sql, {
		httpMetadata: { contentType: 'application/sql' },
		customMetadata: {
			generated_at: nowUtc(),
			total_rows: String(dump.total_rows),
			tables: String(dump.tables.length)
		}
	});

	const deleted = await pruneBackups(bucket, day);

	return {
		key,
		bytes: dump.bytes,
		total_rows: dump.total_rows,
		tables: dump.tables,
		deleted,
		day
	};
}

/** Deletes backups older than the retention window, measured in whole days. */
export async function pruneBackups(bucket: R2Bucket, day: string): Promise<string[]> {
	const cutoff = Date.parse(`${day}T00:00:00Z`) - RETENTION_DAYS * 86_400_000;
	const listed = await bucket.list({ prefix: 'backups/d1/' });
	const deleted: string[] = [];

	for (const object of listed.objects) {
		const match = object.key.match(/(\d{4}-\d{2}-\d{2})\.sql$/);
		// A key that does not carry a date is left alone. Deleting things this
		// function does not understand is how a prune becomes an incident.
		if (!match) continue;
		if (Date.parse(`${match[1]}T00:00:00Z`) < cutoff) {
			await bucket.delete(object.key);
			deleted.push(object.key);
		}
	}

	return deleted;
}

export interface BackupListing {
	key: string;
	day: string;
	bytes: number;
	uploaded: string;
}

export async function listBackups(bucket: R2Bucket): Promise<BackupListing[]> {
	const listed = await bucket.list({ prefix: 'backups/d1/' });
	return listed.objects
		.map((o) => ({
			key: o.key,
			day: o.key.match(/(\d{4}-\d{2}-\d{2})\.sql$/)?.[1] ?? '',
			bytes: o.size,
			uploaded: o.uploaded instanceof Date ? o.uploaded.toISOString() : String(o.uploaded)
		}))
		.sort((a, b) => b.day.localeCompare(a.day));
}
