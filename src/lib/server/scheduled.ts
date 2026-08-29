import { digestDueAt, runDigest } from './digest';
import type { DigestEnv } from './digest';
import { backupDueAt, runBackup } from './backup';

/**
 * The Cron Trigger entry point.
 *
 * This is bundled separately and stitched onto the SvelteKit worker by
 * scripts/wrap-worker.js, because @sveltejs/adapter-cloudflare emits a worker
 * that exports only `fetch`. A Cron Trigger against a worker with no `scheduled`
 * export fails, so the export has to be added after the adapter runs.
 *
 * The cron fires at six UTC hours, covering 03:00, 07:00 and 17:00 Mountain in
 * both halves of the year. Each job decides for itself whether this particular
 * firing is its real one by reading the Mountain hour. Three of the six do
 * nothing, which is the price of a UTC-only scheduler and a zone that observes
 * DST.
 *
 * 03:00 Mountain is the nightly D1 to R2 backup. It is deliberately its own
 * firing rather than a passenger on the morning digest: a slow or failing dump
 * must not be able to delay or break the digest, and an operator reading the
 * logs should be able to tell which job failed without untangling them.
 *
 * The send is awaited rather than handed to ctx.waitUntil.
 *
 * waitUntil is legal in a scheduled handler and the work does run, but the
 * handler returns the moment it is called, so the invocation is recorded as
 * finished before the send has happened and a throw inside runDigest surfaces as
 * an unhandled rejection against an invocation already marked successful. For a
 * job that runs twice a day, cannot be retried by the platform, and is only
 * observable through its own logs, the outcome of the firing needs to be the
 * outcome of the send. Awaiting makes them the same thing.
 */
export async function handleScheduled(
	event: { scheduledTime: number; cron: string },
	env: DigestEnv
): Promise<void> {
	const now = new Date(event.scheduledTime);

	// Every firing logs, including the ones that do nothing. An absent job and a
	// broken one look identical from the outside otherwise, which is exactly the
	// ambiguity that made the first digest incident hard to close.
	if (backupDueAt(now)) {
		console.log(`cron ${event.cron} at ${now.toISOString()}: nightly backup due, running`);
		try {
			const result = await runBackup(env.DB, env.FILES);
			console.log(
				`cron ${event.cron}: backup wrote ${result.key}, ${result.bytes} bytes, ` +
					`${result.total_rows} rows across ${result.tables.length} tables` +
					(result.deleted.length > 0 ? `, pruned ${result.deleted.length}` : '')
			);
		} catch (err) {
			console.error(`cron ${event.cron}: backup threw`, String(err));
			throw err;
		}
		return;
	}

	const kind = digestDueAt(now);

	if (!kind) {
		console.log(
			`cron ${event.cron} at ${now.toISOString()}: nothing due at this Mountain hour`
		);
		return;
	}

	console.log(`cron ${event.cron} at ${now.toISOString()}: ${kind} digest due, sending`);

	try {
		const result = await runDigest(env, kind);
		console.log(
			`cron ${event.cron}: ${kind} digest ${result.status}`,
			result.subject ?? '',
			result.detail ?? ''
		);
	} catch (err) {
		// Logged with context, then rethrown so the invocation itself is recorded
		// as failed. A cron that swallows its own errors is a cron that reports
		// success every day while sending nothing.
		console.error(`cron ${event.cron}: ${kind} digest threw`, String(err));
		throw err;
	}
}
