import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { ApiError } from './validate';

/**
 * The Dropbox files, as the app reads them.
 *
 * READ FROM THE MIRROR, NOT COPIED INTO IT. There is no projection pass for
 * files and that is deliberate: copying 11,150 metadata rows into
 * `project_files` would create a second copy that has to be kept converging
 * with the first, for no gain. The app authors nothing about these rows, so
 * there is nothing for a copy to hold that the mirror does not. A query renders
 * them; the mirror stays the only place they live.
 *
 * METADATA ONLY. Paths, names, sizes, modification times. No route here serves
 * a file's contents, and there is no write, move or delete surface, because
 * Dropbox is the source of truth and the app mirrors it read only in this
 * phase. A guarantee test asserts that this file names none of those.
 *
 * L2: a folder's activity is the newest file beneath it, computed by the
 * mirror's roll-up and never read off a folder's own date.
 */

export const files = new Hono<ApiEnv>();

/** The depth at which a Dropbox folder is a client. Matches the scanner. */
const CLIENT_DEPTH = 2;

const PAGE_SIZES = [25, 50, 100, 200, 500];

/**
 * Files, newest first, filtered by client or by project.
 *
 * Paged, because eleven thousand rows in one response is a payload nobody reads
 * and a screen nobody can use.
 */
files.get('/', async (c) => {
	const pageSize = Number(c.req.query('page_size') ?? '50');
	if (!PAGE_SIZES.includes(pageSize)) {
		throw new ApiError(400, `page_size must be one of: ${PAGE_SIZES.join(', ')}.`);
	}

	const page = Math.max(1, Number(c.req.query('page') ?? '1') || 1);
	const clientId = c.req.query('client_id')?.trim() || null;
	const search = c.req.query('q')?.trim() || null;
	const extension = c.req.query('extension')?.trim().toLowerCase() || null;

	/*
	 * A file belongs to the client its folder tree belongs to.
	 *
	 * The client is set on the folder at client depth, and a file can be many
	 * levels below that, so the join walks up by path prefix rather than by
	 * parent. Matching on the folder's own client_id alone would attach only the
	 * files sitting directly in the client's top folder, which is almost none of
	 * them.
	 */
	const where: string[] = [];
	const binds: unknown[] = [];

	if (clientId) {
		where.push(`EXISTS (
      SELECT 1 FROM dropbox_folders cf
      WHERE cf.depth = ${CLIENT_DEPTH} AND cf.client_id = ?
        AND (f.folder_path = cf.path OR f.folder_path LIKE cf.path || '/%')
    )`);
		binds.push(clientId);
	}

	if (search) {
		where.push('f.name LIKE ?');
		binds.push(`%${search}%`);
	}

	if (extension) {
		where.push('f.extension = ?');
		binds.push(extension);
	}

	const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

	const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM dropbox_files f ${clause}`)
		.bind(...(binds as never[]))
		.first<{ n: number }>();

	const { results } = await c.env.DB.prepare(
		`SELECT f.path, f.name, f.extension, f.size_bytes, f.modified_at, f.folder_path
     FROM dropbox_files f
     ${clause}
     ORDER BY f.modified_at DESC NULLS LAST, f.name
     LIMIT ? OFFSET ?`
	)
		.bind(...([...binds, pageSize, (page - 1) * pageSize] as never[]))
		.all();

	return c.json({
		files: results ?? [],
		page,
		page_size: pageSize,
		total: total?.n ?? 0
	});
});

/**
 * What the mirror holds overall, and the kinds of file in it.
 *
 * Counts, so the screen can say what is there without listing it.
 */
files.get('/summary', async (c) => {
	const totals = await c.env.DB.prepare(
		`SELECT COUNT(*) AS files,
            COALESCE(SUM(size_bytes), 0) AS total_bytes,
            MAX(modified_at) AS newest
     FROM dropbox_files`
	).first();

	const { results: kinds } = await c.env.DB.prepare(
		`SELECT COALESCE(extension, '(none)') AS extension, COUNT(*) AS files,
            COALESCE(SUM(size_bytes), 0) AS total_bytes
     FROM dropbox_files GROUP BY extension ORDER BY files DESC LIMIT 12`
	).all();

	const filing = await c.env.DB.prepare(
		`SELECT
       (SELECT COUNT(*) FROM dropbox_folders WHERE depth = ?1) AS client_folders,
       (SELECT COUNT(*) FROM dropbox_folders WHERE depth = ?1 AND client_id IS NOT NULL) AS filed,
       (SELECT COUNT(*) FROM dropbox_folders WHERE depth = ?1 AND client_id IS NULL) AS unassigned`
	)
		.bind(CLIENT_DEPTH)
		.first();

	/*
	 * Files under a client folder nobody has matched yet.
	 *
	 * Counted rather than hidden. An unassigned folder is a question on the
	 * reconciliation screen, and a Files view that quietly omitted its contents
	 * would report a smaller Dropbox than exists.
	 */
	const unassignedFiles = await c.env.DB.prepare(
		`SELECT COUNT(*) AS n FROM dropbox_files f
     WHERE NOT EXISTS (
       SELECT 1 FROM dropbox_folders cf
       WHERE cf.depth = ?1 AND cf.client_id IS NOT NULL
         AND (f.folder_path = cf.path OR f.folder_path LIKE cf.path || '/%')
     )`
	)
		.bind(CLIENT_DEPTH)
		.first<{ n: number }>();

	return c.json({
		totals,
		kinds: kinds ?? [],
		filing,
		files_not_under_a_matched_client: unassignedFiles?.n ?? 0
	});
});
