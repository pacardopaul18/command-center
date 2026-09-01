import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { actionItems } from './action-items';
import { asana } from './asana';
import { client360 } from './client-360';
import { connections } from './connections';
import { email } from './email';
import { backups } from './backups';
import { crosswalk } from './crosswalk';
import { dropbox } from './dropbox';
import { unassigned } from './unassigned';
import { files } from './files';
import { clients } from './clients';
import { digests } from './digests';
import { invoicing } from './invoicing';
import { ledger } from './ledger';
import { meetings } from './meetings';
import { people } from './people';
import { projects } from './projects';
import { reports } from './reports';
import { settings } from './settings';
import { sops } from './sops';
import { templates } from './templates';
import { tickets } from './tickets';
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

	/**
	 * Which dataset this server is actually looking at, read from the data
	 * rather than from how the process was started.
	 *
	 * A build-time flag would say what somebody intended; this says what is
	 * there. The volume fixture writes a marker row, so its presence is proof
	 * the synthetic dataset is loaded, and its absence is proof it is not. A
	 * label that can disagree with the database is worse than no label, because
	 * the whole reason for showing it is to stop somebody typing real client
	 * notes into the fixture or running a destructive test against firm data.
	 */
	const seedMarker = await c.env.DB.prepare("SELECT id FROM users WHERE id = 'v-u-seed'")
		.first<{ id: string }>()
		.catch(() => null);

	return c.json(
		{
			ok: !schema.drift,
			today: todayInWorkingZone(),
			time_zone: WORKING_TIME_ZONE,
			data_environment: seedMarker ? 'seed' : 'real',
			schema
		},
		schema.drift ? 503 : 200
	);
});

api.route('/tickets', tickets);
api.route('/today', today);
api.route('/action-items', actionItems);
api.route('/asana', asana);
// Contacts, contracts and the client overview all hang off the same router.
api.route('/', client360);
api.route('/backups', backups);
api.route('/connections', connections);
api.route('/email', email);
api.route('/clients', clients);
api.route('/crosswalk', crosswalk);
api.route('/dropbox', dropbox);
api.route('/unassigned', unassigned);
api.route('/files', files);
api.route('/digests', digests);
api.route('/invoicing', invoicing);
api.route('/ledger', ledger);
api.route('/meetings', meetings);
api.route('/people', people);
api.route('/projects', projects);
api.route('/reports', reports);
api.route('/sops', sops);
api.route('/settings', settings);
api.route('/templates', templates);

api.notFound((c) => c.json({ error: 'Not found.' }, 404));

api.onError((err, c) => {
	if (err instanceof ApiError) {
		return c.json({ error: err.message }, err.status as 400);
	}
	console.error('API error', err);
	return c.json({ error: 'Something went wrong on the server.' }, 500);
});
