import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { ApiError, readJsonObject } from './validate';
import { matchProjectsToClients } from '../crosswalk';
import { matchFoldersToClients } from '../dropbox';
import { readSettings } from '../asana';

/**
 * The unassigned bucket, and the way out of it.
 *
 * An unassigned row is a question on a screen, which is the whole reason the
 * bucket exists: a project filed under the wrong client is invisible and gets
 * believed, while an unassigned one gets answered once. This is where it gets
 * answered.
 *
 * NOTHING HERE WRITES TO ASANA OR DROPBOX. Choosing a client for a mirrored
 * project changes which client the app files it under. It does not rename
 * anything, move anything or touch either source system, which are read only in
 * this phase and are the source of truth.
 */

export const unassigned = new Hono<ApiEnv>();

/** The depth at which a Dropbox folder is a client. Matches the scanner. */
const CLIENT_DEPTH = 2;

/**
 * Everything still waiting for an answer, with enough context to give one.
 *
 * Each row carries what the mirror knows about it: how much work is in it, when
 * it was last touched, whether it is archived. Asking somebody to pick a client
 * for a bare name is asking them to guess, which is the thing this screen
 * exists to avoid.
 */
unassigned.get('/', async (c) => {
	const { results: projects } = await c.env.DB.prepare(
		`SELECT p.gid, p.name, p.archived, p.modified_at,
            (SELECT COUNT(*) FROM asana_tasks t WHERE t.project_gid = p.gid) AS tasks,
            (SELECT COUNT(*) FROM asana_tasks t WHERE t.project_gid = p.gid AND t.completed = 0) AS open_tasks
     FROM asana_projects p
     WHERE p.client_id IS NULL
     ORDER BY p.archived, p.name`
	).all();

	const { results: folders } = await c.env.DB.prepare(
		`SELECT path, name, file_count, total_bytes, last_activity
     FROM dropbox_folders
     WHERE depth = ? AND client_id IS NULL
     ORDER BY last_activity DESC NULLS LAST, name`
	)
		.bind(CLIENT_DEPTH)
		.all();

	// The clients to choose from, with what is already filed under each, so a
	// name that looks plausible can be checked against whether it already holds
	// the rest of this client's work.
	const { results: clients } = await c.env.DB.prepare(
		`SELECT c.id, c.name,
            (SELECT COUNT(*) FROM asana_projects p WHERE p.client_id = c.id) AS projects,
            (SELECT COUNT(*) FROM dropbox_folders f WHERE f.client_id = c.id AND f.depth = ?) AS folders
     FROM clients c
     ORDER BY c.name COLLATE NOCASE`
	)
		.bind(CLIENT_DEPTH)
		.all();

	return c.json({
		projects: projects ?? [],
		folders: folders ?? [],
		clients: clients ?? [],
		counts: {
			projects: projects?.length ?? 0,
			folders: folders?.length ?? 0
		}
	});
});

/**
 * Records Paul's answer, and re-files immediately.
 *
 * The override goes in its own table rather than into `client_crosswalk`,
 * because the crosswalk is a faithful copy of a file and every load rewrites it
 * from what the file says. A manual row has no line in the file to be rewritten
 * from, so the next load would delete exactly the corrections that cost the
 * most to make.
 *
 * Re-filing happens here rather than on a separate call, because an override
 * that has been recorded and not applied is the state where the screen and the
 * database disagree and nothing says so.
 */
unassigned.post('/', async (c) => {
	const body = await readJsonObject(c.req.raw);

	const kind = body.kind === 'dropbox_folder' ? 'dropbox_folder' : body.kind === 'asana_project' ? 'asana_project' : null;
	if (!kind) throw new ApiError(400, 'Say whether this is an asana_project or a dropbox_folder.');

	const key = typeof body.subject_key === 'string' ? body.subject_key.trim() : '';
	if (!key) throw new ApiError(400, 'Say which project or folder is being filed.');

	const clientId = typeof body.client_id === 'string' ? body.client_id.trim() : '';
	if (!clientId) throw new ApiError(400, 'Choose a client.');

	// D108: a named thing that does not exist is refused, never defaulted.
	const client = await c.env.DB.prepare('SELECT id, name FROM clients WHERE id = ?')
		.bind(clientId)
		.first<{ id: string; name: string }>();
	if (!client) throw new ApiError(404, 'That client does not exist.');

	const subject =
		kind === 'asana_project'
			? await c.env.DB.prepare('SELECT name FROM asana_projects WHERE gid = ?')
					.bind(key)
					.first<{ name: string }>()
			: await c.env.DB.prepare('SELECT name FROM dropbox_folders WHERE path = ?')
					.bind(key)
					.first<{ name: string }>();

	if (!subject) {
		throw new ApiError(
			404,
			kind === 'asana_project'
				? 'No mirrored Asana project has that gid.'
				: 'No mirrored Dropbox folder has that path.'
		);
	}

	await c.env.DB.prepare(
		`INSERT INTO client_overrides (kind, subject_key, client_id, subject_name, reason, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(kind, subject_key) DO UPDATE SET
       client_id = ?3, subject_name = ?4, reason = ?5, created_at = ?6`
	)
		.bind(
			kind,
			key,
			clientId,
			subject.name,
			typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null,
			new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
		)
		.run();

	const workspace = (await readSettings(c.env.SESSIONS)).workspace_gid ?? (await firstWorkspace(c));

	return c.json({
		filed: { kind, subject_key: key, subject_name: subject.name, client: client.name },
		asana: workspace ? await matchProjectsToClients(c.env.DB, workspace) : null,
		dropbox: await matchFoldersToClients(c.env.DB, CLIENT_DEPTH)
	});
});

/**
 * Removes an override, putting the row back where the rules would have put it.
 *
 * Needed because an override is a judgement and judgements get revised. Without
 * this, a wrong answer would be permanent and the only way back would be
 * editing the database by hand, which is the thing this whole design exists to
 * make unnecessary.
 */
unassigned.delete('/:kind/:key{.+}', async (c) => {
	const kind = c.req.param('kind');
	if (kind !== 'asana_project' && kind !== 'dropbox_folder') {
		throw new ApiError(400, 'The kind must be asana_project or dropbox_folder.');
	}

	const key = decodeURIComponent(c.req.param('key'));
	const existing = await c.env.DB.prepare(
		'SELECT subject_key FROM client_overrides WHERE kind = ? AND subject_key = ?'
	)
		.bind(kind, key)
		.first();

	if (!existing) throw new ApiError(404, 'There is no override on that.');

	await c.env.DB.prepare('DELETE FROM client_overrides WHERE kind = ? AND subject_key = ?')
		.bind(kind, key)
		.run();

	const workspace = (await readSettings(c.env.SESSIONS)).workspace_gid ?? (await firstWorkspace(c));

	return c.json({
		removed: { kind, subject_key: key },
		asana: workspace ? await matchProjectsToClients(c.env.DB, workspace) : null,
		dropbox: await matchFoldersToClients(c.env.DB, CLIENT_DEPTH)
	});
});

/**
 * The workspace the mirror was pulled into, when settings do not name one.
 *
 * The mirror knows which workspace it holds; making the re-file depend on a KV
 * setting that was never written would mean a correct override silently not
 * being applied.
 */
async function firstWorkspace(c: { env: ApiEnv['Bindings'] }): Promise<string | null> {
	const row = await c.env.DB.prepare(
		'SELECT workspace_gid FROM asana_sync_state ORDER BY updated_at DESC LIMIT 1'
	).first<{ workspace_gid: string }>();
	return row?.workspace_gid ?? null;
}
