import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { ApiError, readJsonObject } from './validate';
import {
	closeScan,
	ingestEntries,
	matchFoldersToClients,
	openScan,
	rollUpFolders,
	type DropboxEntry
} from '../dropbox';

/**
 * The Dropbox mirror, read only.
 *
 * There is no route here that writes to Dropbox, uploads, moves or deletes, and
 * there is no route that serves a file's contents. That is not an omission to
 * be filled in later: the ruling is that Dropbox is the source of truth and the
 * app mirrors it, and the absence of the surface is the mechanism. A guarantee
 * test asserts that this file names no such route, on the same reasoning as
 * D70: a capability that does not exist cannot be reached by a later bug.
 *
 * Entries arrive as a batch in the request body rather than being read off a
 * disk, because a Worker has no disk. Tonight a local script posts what it
 * finds in the synced folder; the OAuth connector posts the same shape.
 */

export const dropbox = new Hono<ApiEnv>();

/** Entries per request. Large enough to be few requests, small enough to retry. */
const MAX_BATCH = 1000;

/** The depth at which a folder is a client. Under the root, then the team folder. */
const CLIENT_DEPTH = 2;

dropbox.post('/scan/open', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const root = typeof body.root === 'string' ? body.root.trim() : '';
	if (!root) throw new ApiError(400, 'A scan needs to say which root it read.');

	const source = body.source === 'api' ? 'api' : 'local';
	return c.json({ scan_id: await openScan(c.env.DB, root, source) });
});

dropbox.post('/scan/entries', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const entries = body.entries;

	if (!Array.isArray(entries)) throw new ApiError(400, 'Send an `entries` array.');
	if (entries.length > MAX_BATCH) {
		throw new ApiError(413, `Send at most ${MAX_BATCH} entries per request.`);
	}

	return c.json(await ingestEntries(c.env.DB, entries as DropboxEntry[]));
});

/**
 * Closes the scan and derives everything that is derived.
 *
 * Roll-up and matching run here rather than on each batch, because both are
 * whole-tree operations: a folder's totals are wrong until the last file
 * beneath it has arrived, and a mirror left in that state would put a wrong
 * number on a screen rather than no number.
 */
dropbox.post('/scan/close', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const scanId = typeof body.scan_id === 'string' ? body.scan_id : '';
	if (!scanId) throw new ApiError(400, 'Say which scan is being closed.');

	const rollup = await rollUpFolders(c.env.DB);
	const match = await matchFoldersToClients(c.env.DB, CLIENT_DEPTH);

	const totals = await c.env.DB.prepare(
		`SELECT (SELECT COUNT(*) FROM dropbox_folders) AS folders,
            (SELECT COUNT(*) FROM dropbox_files) AS files,
            (SELECT COALESCE(SUM(size_bytes), 0) FROM dropbox_files) AS total_bytes`
	).first<{ folders: number; files: number; total_bytes: number }>();

	const skipped = Number(body.skipped ?? 0);
	await closeScan(
		c.env.DB,
		scanId,
		{
			folders: totals?.folders ?? 0,
			files: totals?.files ?? 0,
			total_bytes: totals?.total_bytes ?? 0,
			skipped: Number.isFinite(skipped) ? Math.trunc(skipped) : 0
		},
		typeof body.note === 'string' ? body.note : null
	);

	return c.json({ totals, rollup, match });
});

/**
 * Re-files the client folders without re-walking the tree.
 *
 * Needed because the crosswalk can be corrected and re-loaded after a scan, and
 * making somebody re-walk eleven thousand files to apply a spreadsheet edit
 * would be a strange thing to have to do.
 */
dropbox.post('/match', async (c) => {
	return c.json({ match: await matchFoldersToClients(c.env.DB, CLIENT_DEPTH) });
});

/** What the mirror holds. Counts, never names. */
dropbox.get('/', async (c) => {
	const scan = await c.env.DB.prepare(
		'SELECT * FROM dropbox_scans ORDER BY started_at DESC LIMIT 1'
	).first();

	const totals = await c.env.DB.prepare(
		`SELECT (SELECT COUNT(*) FROM dropbox_folders) AS folders,
            (SELECT COUNT(*) FROM dropbox_files) AS files,
            (SELECT COALESCE(SUM(size_bytes), 0) FROM dropbox_files) AS total_bytes,
            (SELECT COUNT(*) FROM dropbox_folders WHERE depth = ?1) AS client_folders,
            (SELECT COUNT(*) FROM dropbox_folders WHERE depth = ?1 AND client_id IS NOT NULL) AS client_folders_matched`
	)
		.bind(CLIENT_DEPTH)
		.first();

	return c.json({ last_scan: scan ?? null, totals });
});
