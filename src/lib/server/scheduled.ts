import { digestDueAt, runDigest } from './digest';
import type { DigestEnv } from './digest';

/**
 * The Cron Trigger entry point.
 *
 * This is bundled separately and stitched onto the SvelteKit worker by
 * scripts/wrap-worker.js, because @sveltejs/adapter-cloudflare emits a worker
 * that exports only `fetch`. A Cron Trigger against a worker with no `scheduled`
 * export fails, so the export has to be added after the adapter runs.
 *
 * The cron fires at four UTC hours, covering 07:00 and 17:00 Mountain in both
 * halves of the year. digestDueAt decides whether this particular firing is the
 * real one. Three of every four firings do nothing, which is the price of a
 * UTC-only scheduler and a zone that observes DST.
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
	const kind = digestDueAt(now);

	// Every firing logs, including the three in four that do nothing. An absent
	// digest and a broken one look identical from the outside otherwise, which is
	// exactly the ambiguity that made the first incident hard to close.
	if (!kind) {
		console.log(
			`cron ${event.cron} at ${now.toISOString()}: no digest due at this Mountain hour`
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
