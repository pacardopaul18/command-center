import { digestDueAt, runDigest } from './digest';
import type { DigestEnv } from './digest';
import { backupDueAt, runBackup } from './backup';
import { runMailMaintenance } from './mail-jobs';
import { raiseRecurringDrafts } from './recurring';
import type { MailEnv } from './mail-jobs';

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
 * Mail work rides these same firings rather than getting a cron of its own.
 * The cron surface does not change without an evidence-window review, and
 * piggybacking needs no expression change at all: every firing does whatever
 * mail work its remaining budget allows, after the job the firing exists for.
 *
 * That ordering is deliberate. Mail maintenance never throws and never runs
 * first, so a slow or failing mail job cannot delay or break a digest or a
 * backup. It is a passenger, and it is treated as one.
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
	env: DigestEnv & MailEnv
): Promise<void> {
	const now = new Date(event.scheduledTime);

	/**
	 * Mail work, logged like everything else so a firing that did nothing and a
	 * firing that failed do not look the same from outside.
	 */
	async function mailWork() {
		const outcome = await runMailMaintenance(env);
		console.log(`cron ${event.cron}: mail ${outcome.ran}, ${outcome.detail}`);
	}

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
		await mailWork();
		return;
	}

	const kind = digestDueAt(now);

	if (!kind) {
		console.log(
			`cron ${event.cron} at ${now.toISOString()}: no digest due at this Mountain hour`
		);
		// The quiet firings are the useful ones for mail: nothing else is
		// competing for the invocation's budget.
		await mailWork();
		return;
	}

	/**
	 * Recurring invoice drafts, raised before the morning digest is built.
	 *
	 * Ordering is the point. A draft raised after the digest was assembled would
	 * not appear in it until tomorrow, so the one email that says what needs
	 * attention today would be missing a document created ninety seconds
	 * earlier.
	 *
	 * Morning only, and never on the evening firing: a draft that appeared at
	 * 17:00 would sit unread overnight with its issue date already spent.
	 *
	 * It never throws into the digest. A failed raise is logged and the digest
	 * goes out regardless, because a missing draft is a nuisance and a missing
	 * digest is the failure this whole schedule exists to prevent.
	 */
	if (kind === 'morning') {
		try {
			const result = await raiseRecurringDrafts(env.DB);
			console.log(
				`cron ${event.cron}: recurring raised ${result.raised.length}` +
					(result.raised.length > 0
						? ` (${result.raised.map((r) => `${r.invoice_number} ${r.client_name}`).join(', ')})`
						: '') +
					(result.skipped.length > 0
						? `, skipped ${result.skipped.length} with nothing to copy: ${result.skipped.join(', ')}`
						: '')
			);
		} catch (err) {
			console.error(`cron ${event.cron}: recurring raise threw`, String(err));
		}
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

	await mailWork();
}
