import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { ApiError } from './validate';
import { listBackups, RETENTION_DAYS, runBackup } from '../backup';

/**
 * Backups.
 *
 * The nightly run happens on the Cron Trigger. These routes exist so a backup
 * can be taken and inspected without waiting for one, which is the same reason
 * the digests have their own run and preview routes, and for a better reason
 * here: the first thing anyone wants from a backup system is proof it produced
 * something restorable.
 */
export const backups = new Hono<ApiEnv>();

backups.get('/', async (c) => {
	const bucket = c.env.FILES;
	if (!bucket) throw new ApiError(503, 'The R2 bucket is not bound.');

	return c.json({
		retention_days: RETENTION_DAYS,
		backups: await listBackups(bucket)
	});
});

/** Runs a backup now. Overwrites today's if one already exists. */
backups.post('/run', async (c) => {
	const bucket = c.env.FILES;
	if (!bucket) throw new ApiError(503, 'The R2 bucket is not bound.');

	try {
		return c.json(await runBackup(c.env.DB, bucket));
	} catch (err) {
		// A backup failure is worth a specific message. "Something went wrong"
		// on the one thing standing between Paul and data loss is not enough.
		throw new ApiError(500, `The backup failed and nothing was written. ${String(err)}`);
	}
});
