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
 */
export async function handleScheduled(
	event: { scheduledTime: number; cron: string },
	env: DigestEnv,
	ctx: { waitUntil(promise: Promise<unknown>): void }
): Promise<void> {
	const now = new Date(event.scheduledTime);
	const kind = digestDueAt(now);

	if (!kind) {
		// Wrong side of a DST changeover. Nothing to do, and saying so in the log
		// makes an absent digest distinguishable from a broken one.
		console.log(`cron ${event.cron}: no digest due at this hour`);
		return;
	}

	ctx.waitUntil(
		runDigest(env, kind).then((result) => {
			console.log(`cron ${event.cron}: ${kind} digest ${result.status}`, result.detail ?? '');
		})
	);
}
