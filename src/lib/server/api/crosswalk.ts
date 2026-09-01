import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { ApiError } from './validate';
import { loadCrosswalk, matchProjectsToClients } from '../crosswalk';
import { readSettings } from '../asana';

/**
 * The client crosswalk: loaded from a file, read by the matcher.
 *
 * The body is the CSV itself rather than a path on disk, because the same route
 * has to work from a Worker that has no filesystem. Locally a small script
 * reads the file and posts it; in production the same bytes arrive the same
 * way. One code path, so what is tested locally is what runs.
 */

export const crosswalk = new Hono<ApiEnv>();

/** A file this size is a mistake, and refusing it is cheaper than parsing it. */
const MAX_BYTES = 2 * 1024 * 1024;

crosswalk.post('/', async (c) => {
	const source = c.req.query('source') ?? 'upload';
	const text = await c.req.text();

	if (text.length > MAX_BYTES) {
		throw new ApiError(413, 'That crosswalk file is larger than 2 MB, which it should not be.');
	}
	if (text.trim() === '') {
		throw new ApiError(400, 'The crosswalk file was empty.');
	}

	let load;
	try {
		load = await loadCrosswalk(c.env.DB, source, text);
	} catch (err) {
		throw new ApiError(400, err instanceof Error ? err.message : 'The crosswalk file could not be read.');
	}

	// Matching runs on load rather than on a separate call, because a crosswalk
	// that has been loaded and not applied is the state where the screen and the
	// file disagree and nothing says so.
	const workspace = c.req.query('workspace') ?? (await readSettings(c.env.SESSIONS)).workspace_gid;
	const match = workspace ? await matchProjectsToClients(c.env.DB, workspace) : null;

	return c.json({
		load,
		match,
		matched: Boolean(match),
		not_matched_because: match ? null : 'No Asana workspace is chosen, so there is nothing to file.'
	});
});

/**
 * Re-files the mirrored projects without re-reading the file.
 *
 * Needed because a pull can bring in projects the last load never saw, and
 * re-uploading the spreadsheet to file them would be a strange thing to have to
 * do.
 */
crosswalk.post('/match', async (c) => {
	const workspace = c.req.query('workspace') ?? (await readSettings(c.env.SESSIONS)).workspace_gid;
	if (!workspace) throw new ApiError(400, 'Choose a workspace before filing its projects.');
	return c.json({ match: await matchProjectsToClients(c.env.DB, workspace) });
});

/** What was loaded, when, and how the projects currently sit. */
crosswalk.get('/', async (c) => {
	const last = await c.env.DB.prepare(
		'SELECT * FROM client_crosswalk_loads ORDER BY loaded_at DESC LIMIT 1'
	).first();

	const rows = await c.env.DB.prepare(
		`SELECT COUNT(*) AS rows,
            SUM(CASE WHEN asana_gid IS NOT NULL THEN 1 ELSE 0 END) AS with_asana_gid,
            SUM(CASE WHEN dropbox_name IS NOT NULL THEN 1 ELSE 0 END) AS with_dropbox_name
     FROM client_crosswalk`
	).first();

	const filing = await c.env.DB.prepare(
		`SELECT COUNT(*) AS projects,
            SUM(CASE WHEN client_match = 'crosswalk' THEN 1 ELSE 0 END) AS by_gid,
            SUM(CASE WHEN client_match = 'exact_name' THEN 1 ELSE 0 END) AS by_name,
            SUM(CASE WHEN client_match = 'manual' THEN 1 ELSE 0 END) AS by_hand,
            SUM(CASE WHEN client_id IS NULL THEN 1 ELSE 0 END) AS unassigned
     FROM asana_projects`
	).first();

	return c.json({ last_load: last ?? null, crosswalk: rows, filing });
});
