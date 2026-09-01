import type { D1Database } from '@cloudflare/workers-types';
import { nowUtc } from './dates';
import { depthOf, extensionOf, nameOf, normalisePath, parentOf } from '../dropbox-paths';
import { normaliseName } from '../csv';

/**
 * The Dropbox mirror: a metadata copy of the client folders.
 *
 * DROPBOX IS THE SOURCE OF TRUTH AND THIS IS A COPY. Paths, names, sizes and
 * modification times. No bytes, no download, no write, no delete. The app holds
 * a map of where the client work is; it does not hold the client work.
 *
 * The ingest is a function over a list of entries rather than a walk of a
 * filesystem, because a Worker has no filesystem. Tonight a local script walks
 * the synced folder and posts what it finds; the OAuth connector that follows
 * posts the same shape from `/files/list_folder`. One ingest, so what runs in
 * production is what was exercised locally.
 *
 * L2 IS A HARD RULE: activity is file level. Nothing here reads a folder's own
 * modification time, and `rollUpFolders` derives every folder's last activity
 * from the files beneath it. A synced Dropbox touches folder mtimes when it
 * syncs, so a folder date says when the sync client last thought about the
 * folder rather than when anybody did work in it, and reading one made dormant
 * clients look active.
 */

const newId = () => crypto.randomUUID();

/** One entry as either source supplies it. Folders carry no time, by rule. */
export interface DropboxEntry {
	kind: 'folder' | 'file';
	/** Path relative to the mirror root, in any spelling. Normalised on the way in. */
	path: string;
	dropbox_id?: string | null;
	size_bytes?: number | null;
	/** A file's own modification time, ISO 8601 UTC. Never supplied for a folder. */
	modified_at?: string | null;
}

export interface IngestCounts {
	folders: number;
	files: number;
	total_bytes: number;
	/** Entries rejected on the way in, with the reason, so nothing vanishes quietly. */
	rejected: number;
	rejected_because: string[];
}

/**
 * Writes a batch of entries into the mirror.
 *
 * Upserts on the path, so a re-scan overwrites rather than doubling and a
 * partial batch can simply be sent again.
 */
export async function ingestEntries(
	db: D1Database,
	entries: DropboxEntry[]
): Promise<IngestCounts> {
	const at = nowUtc();
	const counts: IngestCounts = {
		folders: 0,
		files: 0,
		total_bytes: 0,
		rejected: 0,
		rejected_because: []
	};

	const reject = (why: string) => {
		counts.rejected += 1;
		if (!counts.rejected_because.includes(why)) counts.rejected_because.push(why);
	};

	for (const entry of entries) {
		const path = normalisePath(entry.path ?? '');
		if (path === '/' || path === '') {
			reject('an entry had no path');
			continue;
		}

		if (entry.kind === 'folder') {
			// A folder arriving with a modification time is the L2 rule being
			// broken at the source. Dropping the value rather than storing it
			// means no later query can accidentally find it.
			if (entry.modified_at) reject('a folder arrived carrying a modification time, which was dropped');

			await db
				.prepare(
					`INSERT INTO dropbox_folders (path, dropbox_id, name, parent_path, depth, synced_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT(path) DO UPDATE SET
             dropbox_id = COALESCE(?2, dropbox_id), name = ?3, parent_path = ?4,
             depth = ?5, synced_at = ?6`
				)
				.bind(path, entry.dropbox_id ?? null, nameOf(path), parentOf(path), depthOf(path), at)
				.run();
			counts.folders += 1;
			continue;
		}

		const folder = parentOf(path);
		if (!folder) {
			reject('a file had no folder above it');
			continue;
		}

		const size = Math.max(0, Math.trunc(entry.size_bytes ?? 0));
		await db
			.prepare(
				`INSERT INTO dropbox_files
         (path, dropbox_id, folder_path, name, extension, size_bytes, modified_at, synced_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(path) DO UPDATE SET
           dropbox_id = COALESCE(?2, dropbox_id), folder_path = ?3, name = ?4,
           extension = ?5, size_bytes = ?6, modified_at = ?7, synced_at = ?8`
			)
			.bind(
				path,
				entry.dropbox_id ?? null,
				folder,
				nameOf(path),
				extensionOf(nameOf(path)),
				size,
				entry.modified_at ?? null,
				at
			)
			.run();

		counts.files += 1;
		counts.total_bytes += size;
	}

	return counts;
}

export interface RollUp {
	folders: number;
	folders_with_activity: number;
	folders_empty: number;
}

/**
 * Recomputes every folder's file count, size and last activity from the files.
 *
 * Recursive: a client folder's totals include everything beneath it, because
 * the question is "when did anything happen for this client" and an answer that
 * stopped at the first level would say nothing happened while all the work sat
 * one folder deeper.
 *
 * Done deepest first, so each folder can add up the answers its children have
 * already computed instead of re-walking the tree once per folder.
 */
export async function rollUpFolders(db: D1Database): Promise<RollUp> {
	// Its own files first. This is the only place a folder's numbers come from,
	// and they come from files.
	await db
		.prepare(
			`UPDATE dropbox_folders SET
         file_count = COALESCE((SELECT COUNT(*) FROM dropbox_files f WHERE f.folder_path = dropbox_folders.path), 0),
         total_bytes = COALESCE((SELECT SUM(size_bytes) FROM dropbox_files f WHERE f.folder_path = dropbox_folders.path), 0),
         last_activity = (SELECT MAX(modified_at) FROM dropbox_files f WHERE f.folder_path = dropbox_folders.path)`
		)
		.run();

	const deepest = await db
		.prepare('SELECT COALESCE(MAX(depth), 0) AS d FROM dropbox_folders')
		.first<{ d: number }>();

	for (let depth = (deepest?.d ?? 0) - 1; depth >= 0; depth--) {
		await db
			.prepare(
				`UPDATE dropbox_folders SET
           file_count = file_count + COALESCE(
             (SELECT SUM(c.file_count) FROM dropbox_folders c WHERE c.parent_path = dropbox_folders.path), 0),
           total_bytes = total_bytes + COALESCE(
             (SELECT SUM(c.total_bytes) FROM dropbox_folders c WHERE c.parent_path = dropbox_folders.path), 0),
           last_activity = MAX(
             COALESCE(last_activity, ''),
             COALESCE((SELECT MAX(c.last_activity) FROM dropbox_folders c WHERE c.parent_path = dropbox_folders.path), '')
           )
         WHERE depth = ?`
			)
			.bind(depth)
			.run();
	}

	// MAX over the empty-string stand-in leaves '' where there was nothing at
	// all. An empty string is not a date and must not be shown as one.
	await db.prepare("UPDATE dropbox_folders SET last_activity = NULL WHERE last_activity = ''").run();

	const summary = await db
		.prepare(
			`SELECT COUNT(*) AS folders,
              SUM(CASE WHEN last_activity IS NOT NULL THEN 1 ELSE 0 END) AS with_activity,
              SUM(CASE WHEN file_count = 0 THEN 1 ELSE 0 END) AS empty
       FROM dropbox_folders`
		)
		.first<{ folders: number; with_activity: number; empty: number }>();

	return {
		folders: summary?.folders ?? 0,
		folders_with_activity: summary?.with_activity ?? 0,
		folders_empty: summary?.empty ?? 0
	};
}

export interface FolderMatch {
	candidates: number;
	by_dropbox_name: number;
	by_normalised_name: number;
	unassigned: number;
}

/**
 * Files client-level folders against clients, using the crosswalk.
 *
 * Only the folders at the client depth are candidates. Matching every folder in
 * the tree would file `Invoices` under whichever client happened to have a
 * crosswalk row spelled that way, which is exactly the wrong-client failure the
 * unassigned bucket exists to prevent.
 *
 * The gid rule does not apply here, because a folder has no Asana gid. So the
 * precedence starts at rule two: exact dropbox_name, then normalised name, then
 * unassigned.
 */
export async function matchFoldersToClients(
	db: D1Database,
	depth: number
): Promise<FolderMatch> {
	const { results: folders } = await db
		.prepare('SELECT path, name, client_match FROM dropbox_folders WHERE depth = ?')
		.bind(depth)
		.all<{ path: string; name: string; client_match: string | null }>();

	const { results: crosswalk } = await db
		.prepare(
			`SELECT canonical_name, asana_name, dropbox_name, client_id
       FROM client_crosswalk WHERE client_id IS NOT NULL`
		)
		.all<{
			canonical_name: string;
			asana_name: string | null;
			dropbox_name: string | null;
			client_id: string;
		}>();

	const byDropbox = new Map<string, string>();
	const byNormalised = new Map<string, string>();
	for (const row of crosswalk ?? []) {
		if (row.dropbox_name) byDropbox.set(row.dropbox_name, row.client_id);
		for (const alias of [row.canonical_name, row.asana_name, row.dropbox_name]) {
			if (!alias) continue;
			const key = normaliseName(alias);
			if (key && !byNormalised.has(key)) byNormalised.set(key, row.client_id);
		}
	}

	const report: FolderMatch = {
		candidates: folders?.length ?? 0,
		by_dropbox_name: 0,
		by_normalised_name: 0,
		unassigned: 0
	};

	for (const folder of folders ?? []) {
		if (folder.client_match === 'manual') continue;

		const exact = byDropbox.get(folder.name);
		const loose = exact ? undefined : byNormalised.get(normaliseName(folder.name));

		let clientId: string | null = null;
		let how: 'crosswalk' | 'exact_name' | null = null;

		if (exact) {
			clientId = exact;
			how = 'crosswalk';
			report.by_dropbox_name += 1;
		} else if (loose) {
			clientId = loose;
			how = 'exact_name';
			report.by_normalised_name += 1;
		} else {
			report.unassigned += 1;
		}

		await db
			.prepare('UPDATE dropbox_folders SET client_id = ?, client_match = ? WHERE path = ?')
			.bind(clientId, how, folder.path)
			.run();
	}

	return report;
}

/** Opens a scan record, so a run that dies half way is visible as unfinished. */
export async function openScan(db: D1Database, root: string, source: 'local' | 'api'): Promise<string> {
	const id = newId();
	await db
		.prepare('INSERT INTO dropbox_scans (id, root, source, started_at) VALUES (?, ?, ?, ?)')
		.bind(id, root, source, nowUtc())
		.run();
	return id;
}

export async function closeScan(
	db: D1Database,
	id: string,
	counts: { folders: number; files: number; total_bytes: number; skipped: number },
	note: string | null
): Promise<void> {
	await db
		.prepare(
			`UPDATE dropbox_scans
       SET folders = ?, files = ?, total_bytes = ?, skipped = ?, finished_at = ?, note = ?
       WHERE id = ?`
		)
		.bind(counts.folders, counts.files, counts.total_bytes, counts.skipped, nowUtc(), note, id)
		.run();
}
