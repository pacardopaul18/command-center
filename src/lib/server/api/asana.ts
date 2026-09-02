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
import { CURSOR_KEY, STALE_DAYS, syncFromAsana } from '../asana-sync';
import { mirrorStep, mirrorTotals } from '../asana-mirror';
import { projectMirror } from '../projection';
import { auditProjects } from '../asana-audit';

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
		// Ready to push, which is a narrower question than ready to read. The
		// mirror needs a token and a workspace; a push needs both of those and
		// somebody to have decided it may happen.
		ready: tokenPresent && Boolean(settings.workspace_gid) && settings.push_enabled,
		blocked_because: !tokenPresent
			? 'ASANA_TOKEN is not set on the Worker.'
			: !settings.workspace_gid
				? 'No Asana workspace has been chosen yet.'
				: !settings.push_enabled
					? 'Pushing to Asana is switched off. Asana is the source of truth in this phase.'
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
		assignee: optionalText(body.assignee, 'assignee', 200),

		// Only `true` turns it on. Anything else, including the field being
		// absent, leaves it off: a write that forgot to mention the push must
		// not be able to enable it, which is the failure this switch exists to
		// prevent in the first place.
		push_enabled: body.push_enabled === true
	};

	// A project id without its workspace is meaningless, and a stale project name
	// against a new project id would be worse than no name at all.
	if (!settings.project_gid) settings.project_name = null;

	await writeSettings(c.env.SESSIONS, settings);
	return c.json({ settings });
});

/**
 * Runs a sync now.
 *
 * Explicit rather than automatic, the same shape D4 gave the push. A sync
 * changes Paul's own records from a system he does not fully control, so it
 * happens when he asks for it and reports exactly what it did. `changes` is a
 * list of sentences, not a count: "three items updated" is not something anyone
 * can check, and the point of pulling from Asana is being able to see what came
 * back.
 *
 * `sweep=false` skips the direct re-check of stale links. The poll alone is one
 * request; the sweep is one request per unconfirmed link, so a caller that only
 * wants recent edits can say so.
 */
asana.post('/sync', async (c) => {
	const token = requireToken(c.env.ASANA_TOKEN);
	const sweep = c.req.query('sweep') !== 'false';

	try {
		const outcome = await syncFromAsana(c.env.DB, c.env.SESSIONS, token, { sweep });
		return c.json({ ok: true, outcome });
	} catch (err) {
		throw asApiError(err);
	}
});

/**
 * What the last sync knows, without running one.
 *
 * Separate from the sync itself so a screen can show the state of things
 * without making a request to Asana as a side effect of being looked at.
 */
asana.get('/sync', async (c) => {
	const cursor = await c.env.SESSIONS.get(CURSOR_KEY);

	const counts = await c.env.DB.prepare(
		`SELECT
       COUNT(*) AS linked,
       SUM(CASE WHEN asana_sync_state = 'ambiguous' THEN 1 ELSE 0 END) AS ambiguous,
       SUM(CASE WHEN asana_sync_state IS NULL THEN 1 ELSE 0 END) AS never_synced,
       MIN(asana_synced_at) AS oldest_confirmation
     FROM action_items WHERE asana_task_gid IS NOT NULL`
	).first<{
		linked: number;
		ambiguous: number | null;
		never_synced: number | null;
		oldest_confirmation: string | null;
	}>();

	const ambiguous = await c.env.DB.prepare(
		`SELECT id, title, asana_task_gid, asana_sync_note, asana_synced_at
     FROM action_items WHERE asana_sync_state = 'ambiguous' ORDER BY asana_synced_at DESC`
	).all();

	return c.json({
		last_sync: cursor,
		stale_days: STALE_DAYS,
		linked: Number(counts?.linked ?? 0),
		ambiguous_count: Number(counts?.ambiguous ?? 0),
		never_synced: Number(counts?.never_synced ?? 0),
		oldest_confirmation: counts?.oldest_confirmation ?? null,
		ambiguous: ambiguous.results ?? []
	});
});

/**
 * Clears an ambiguous marker once Paul has looked at it.
 *
 * D69 says the sync never resolves ambiguity on its own, and this is the other
 * half of that: a person decides. The gid is still not cleared here. If the
 * task really is gone, the honest record is an item that was once pushed to a
 * task that no longer exists, and erasing the gid would erase that fact.
 */
asana.post('/sync/acknowledge/:id', async (c) => {
	const result = await c.env.DB.prepare(
		`UPDATE action_items
     SET asana_sync_state = 'ok',
         asana_sync_note = 'Reviewed by Paul. ' || COALESCE(asana_sync_note, '')
     WHERE id = ? AND asana_sync_state = 'ambiguous'`
	)
		.bind(c.req.param('id'))
		.run();

	if (!result.meta.changes) {
		throw new ApiError(404, 'No ambiguous Asana link on that item.');
	}
	return c.json({ ok: true });
});

/**
 * The mirror: a full read-only pull of the workspace into the asana_* tables.
 *
 * A POST because it writes, even though it writes nothing to Asana. One call
 * spends one budget of requests and returns where it got to; call it again to
 * continue. That is the shape because a full pull is thousands of requests
 * against a service that allows 150 a minute, and a single invocation that
 * tried it would be killed halfway with nothing recorded.
 */
asana.post('/mirror', async (c) => {
	requireToken(c.env.ASANA_TOKEN);
	const workspace = c.req.query('workspace') ?? (await readSettings(c.env.SESSIONS)).workspace_gid;
	if (!workspace) throw new ApiError(400, 'Choose a workspace before mirroring it.');

	const budget = Number(c.req.query('budget') ?? '120');
	if (!Number.isFinite(budget) || budget < 1 || budget > 2000) {
		throw new ApiError(400, 'The request budget must be between 1 and 2000.');
	}

	const outcome = await mirrorStep(c.env, workspace, Math.floor(budget));
	return c.json({ ...outcome, totals: await mirrorTotals(c.env.DB, workspace) });
});

/**
 * Where the mirror has got to, without pulling anything.
 *
 * Counted from the tables rather than read back from the last run's own
 * report, so a resumed pull's numbers are about the mirror and not about one
 * invocation of it.
 */
asana.get('/mirror', async (c) => {
	const workspace = c.req.query('workspace') ?? (await readSettings(c.env.SESSIONS)).workspace_gid;
	if (!workspace) throw new ApiError(400, 'Choose a workspace before reading its mirror.');

	const state = await c.env.DB.prepare(
		'SELECT phase, cursor, started_at, finished_at, last_error, updated_at FROM asana_sync_state WHERE workspace_gid = ?'
	)
		.bind(workspace)
		.first();

	return c.json({
		workspace_gid: workspace,
		state: state ?? null,
		totals: await mirrorTotals(c.env.DB, workspace)
	});
});

/**
 * Puts the mirror onto the app's own screens.
 *
 * Separate from the pull on purpose. The mirror is a faithful copy and this is a
 * rendering of it, and keeping the two apart is what lets Thursday's schema work
 * change the rendering without touching a single row of what Asana said.
 *
 * Safe to run twice, and safe to run after a re-pull: every row is found again
 * by its gid, so a second run updates rather than doubles.
 */
asana.post('/project', async (c) => {
	const workspace =
		c.req.query('workspace') ??
		(await readSettings(c.env.SESSIONS)).workspace_gid ??
		(
			await c.env.DB.prepare(
				'SELECT workspace_gid FROM asana_sync_state ORDER BY updated_at DESC LIMIT 1'
			).first<{ workspace_gid: string }>()
		)?.workspace_gid;

	if (!workspace) throw new ApiError(400, 'There is no mirrored workspace to project.');

	return c.json(await projectMirror(c.env.DB, workspace));
});

/** The last projection run, so the report survives the terminal it printed in. */
asana.get('/project', async (c) => {
	const run = await c.env.DB.prepare(
		'SELECT * FROM projection_runs ORDER BY started_at DESC LIMIT 1'
	).first();
	return c.json({ last_run: run ?? null });
});

/**
 * Compares the app against live Asana, and corrects nothing.
 *
 * Read only on both sides, deliberately. An audit that repaired as it went
 * would leave nobody able to say how wrong things had been, and the size of the
 * gap is the finding.
 */
asana.get('/audit', async (c) => {
	requireToken(c.env.ASANA_TOKEN);

	const workspace =
		c.req.query('workspace') ??
		(await readSettings(c.env.SESSIONS)).workspace_gid ??
		(
			await c.env.DB.prepare(
				'SELECT workspace_gid FROM asana_sync_state ORDER BY updated_at DESC LIMIT 1'
			).first<{ workspace_gid: string }>()
		)?.workspace_gid;

	if (!workspace) throw new ApiError(400, 'There is no mirrored workspace to audit.');

	const sample = Math.min(Math.max(Number(c.req.query('sample') ?? 10), 1), 40);

	try {
		return c.json(await auditProjects(c.env, workspace, sample));
	} catch (err) {
		throw asApiError(err);
	}
});
