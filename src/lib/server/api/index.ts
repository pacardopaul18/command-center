import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { actionItems } from './action-items';
import { projects } from './projects';
import { today } from './today';
import { ApiError } from './validate';
import { todayInWorkingZone, WORKING_TIME_ZONE } from '../dates';

/**
 * The Command Center API.
 *
 * Mounted by src/routes/api/[...path]/+server.ts, which is a single SvelteKit
 * catch-all endpoint. That is deliberate: with adapter-cloudflare, a top level
 * /functions directory would take precedence over the generated _worker.js and
 * break the SvelteKit app, so keeping the API inside the SvelteKit route tree is
 * the clean option for git-connected Pages. One build, one deploy artifact, and
 * the same bindings for pages and API.
 */
export const api = new Hono<ApiEnv>().basePath('/api');

api.get('/health', (c) =>
	c.json({
		ok: true,
		today: todayInWorkingZone(),
		time_zone: WORKING_TIME_ZONE
	})
);

api.route('/today', today);
api.route('/action-items', actionItems);
api.route('/projects', projects);

api.notFound((c) => c.json({ error: 'Not found.' }, 404));

api.onError((err, c) => {
	if (err instanceof ApiError) {
		return c.json({ error: err.message }, err.status as 400);
	}
	console.error('API error', err);
	return c.json({ error: 'Something went wrong on the server.' }, 500);
});
