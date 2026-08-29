import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { ApiError, optionalText, readJsonObject } from './validate';
import {
	AsanaError,
	EMPTY_SETTINGS,
	listProjects,
	listWorkspaces,
	readSettings,
	writeSettings
} from '../asana';
import type { AsanaSettings } from '../asana';

/**
 * Asana configuration.
 *
 * The token is a Worker secret. Everything else is a choice Paul makes once and
 * lives in KV, which is where the architecture puts settings.
 *
 * A workspace has to be chosen before anything can be pushed, because Asana
 * requires `workspace` on task creation unless a project is given. Rather than
 * make Paul dig a gid out of an Asana URL, the workspaces and projects his token
 * can see are listed from the API and he picks from them.
 */

export const asana = new Hono<ApiEnv>();

/** The one place the missing-token message is written. */
function requireToken(token: string | undefined): string {
	if (!token) {
		throw new ApiError(
			503,
			'No Asana token is configured. Set it with `wrangler secret put ASANA_TOKEN`.'
		);
	}
	return token;
}

/** Asana failures are already legible; this only re-labels them for the API. */
export function asApiError(err: unknown): unknown {
	if (err instanceof AsanaError) {
		return new ApiError(err.status, err.detail ? `${err.message} Asana said: ${err.detail}` : err.message);
	}
	return err;
}

/**
 * What the UI needs to decide what to show: whether a push is possible at all,
 * and why not when it is not.
 *
 * `token_present` is a boolean and never the token. Reporting whether a secret
 * exists is useful; reporting any part of its value would not be.
 */
asana.get('/', async (c) => {
	const settings = await readSettings(c.env.SESSIONS);
	const tokenPresent = Boolean(c.env.ASANA_TOKEN);

	return c.json({
		token_present: tokenPresent,
		settings,
		ready: tokenPresent && Boolean(settings.workspace_gid),
		blocked_because: !tokenPresent
			? 'ASANA_TOKEN is not set on the Worker.'
			: !settings.workspace_gid
				? 'No Asana workspace has been chosen yet.'
				: null
	});
});

asana.get('/workspaces', async (c) => {
	const token = requireToken(c.env.ASANA_TOKEN);
	try {
		return c.json({ workspaces: await listWorkspaces(token) });
	} catch (err) {
		throw asApiError(err);
	}
});

asana.get('/projects', async (c) => {
	const token = requireToken(c.env.ASANA_TOKEN);
	const workspace = c.req.query('workspace') ?? (await readSettings(c.env.SESSIONS)).workspace_gid;
	if (!workspace) throw new ApiError(400, 'Choose a workspace before listing its projects.');

	try {
		return c.json({ projects: await listProjects(token, workspace) });
	} catch (err) {
		throw asApiError(err);
	}
});

/**
 * Saves the workspace, project and default assignee.
 *
 * The names are stored alongside the gids so the settings screen can say
 * "Kabuhayan" rather than "1201234567890123", without a round trip to Asana on
 * every page load. They are a cache of a label, never used to identify
 * anything: every request to Asana uses the gid.
 */
asana.put('/', async (c) => {
	const body = await readJsonObject(c.req.raw);

	const workspaceGid = optionalText(body.workspace_gid, 'workspace_gid', 64);
	if (!workspaceGid) {
		throw new ApiError(400, 'A workspace is required. Asana cannot create a task without one.');
	}

	const settings: AsanaSettings = {
		...EMPTY_SETTINGS,
		workspace_gid: workspaceGid,
		workspace_name: optionalText(body.workspace_name, 'workspace_name', 200),
		project_gid: optionalText(body.project_gid, 'project_gid', 64),
		project_name: optionalText(body.project_name, 'project_name', 200),
		assignee: optionalText(body.assignee, 'assignee', 200)
	};

	// A project id without its workspace is meaningless, and a stale project name
	// against a new project id would be worse than no name at all.
	if (!settings.project_gid) settings.project_name = null;

	await writeSettings(c.env.SESSIONS, settings);
	return c.json({ settings });
});
