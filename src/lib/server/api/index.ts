import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { actionItems } from './action-items';
import { asana } from './asana';
import { backups } from './backups';
import { clients } from './clients';
import { digests } from './digests';
import { invoicing } from './invoicing';
import { meetings } from './meetings';
import { projects } from './projects';
import { reports } from './reports';
import { sops } from './sops';
import { templates } from './templates';
import { today } from './today';
import { ApiError } from './validate';
import { todayInWorkingZone, WORKING_TIME_ZONE } from '../dates';
import { schemaStatus } from '../schema-version';

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

/**
 * Health, including schema drift.
 *
 * Returns 503 when the live database is behind the code, because that is not a
 * healthy Worker: some route is going to 500 the moment somebody opens it. The
 * /templates outage on 2026-08-29 was exactly this state, and nothing reported
 * it. Now one request does.
 */
api.get('/health', async (c) => {
	const schema = await schemaStatus(c.env.DB);
	return c.json(
		{
			ok: !schema.drift,
			today: todayInWorkingZone(),
			time_zone: WORKING_TIME_ZONE,
			schema
		},
		schema.drift ? 503 : 200
	);
});

api.route('/today', today);
api.route('/action-items', actionItems);
api.route('/asana', asana);
api.route('/backups', backups);
api.route('/clients', clients);
api.route('/digests', digests);
api.route('/invoicing', invoicing);
api.route('/meetings', meetings);
api.route('/projects', projects);
api.route('/reports', reports);
api.route('/sops', sops);
api.route('/templates', templates);

api.notFound((c) => c.json({ error: 'Not found.' }, 404));

api.onError((err, c) => {
	if (err instanceof ApiError) {
		return c.json({ error: err.message }, err.status as 400);
	}
	console.error('API error', err);
	return c.json({ error: 'Something went wrong on the server.' }, 500);
});
