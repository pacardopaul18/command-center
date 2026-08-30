<script lang="ts">
	import { formatMoment } from '$lib/format';
	import type { EmailIngestState, EmailStored } from '$lib/types';
	import Button from './Button.svelte';

	/**
	 * The ingestion readout.
	 *
	 * Rewritten after it contradicted itself in front of Paul: the bar sat at
	 * "100% of an estimate" while the text beside it read "64 of 201". Two
	 * different quantities were being shown as though they were one.
	 *
	 * `discovered` is messages Gmail listed. `fetched` is messages newly stored.
	 * They diverge whenever a run covers mail already held, which is the normal
	 * case for every run after the first; on the run that exposed this they were
	 * 250 and 64. Both are now labelled for what they actually are.
	 *
	 * THERE IS NO PERCENTAGE ANY MORE. Gmail's `resultSizeEstimate` is not a
	 * count of the query's results: on that same run it said 201 while the run
	 * had already listed 250. A bar drawn from a number the run has demonstrably
	 * passed is not an approximation, it is a false statement, and clamping it to
	 * 100% only hides that it is wrong. Counts that are true beat a bar that is
	 * not.
	 */

	let {
		ingest,
		stored,
		account,
		busy = false,
		onStart,
		onRun,
		onPause
	}: {
		ingest: EmailIngestState | null;
		stored: EmailStored;
		account: string | null;
		busy?: boolean;
		onStart: (days: number) => void;
		onRun: () => void;
		onPause: () => void;
	} = $props();

	let days = $state(30);

	const label = $derived(
		!ingest
			? 'Never run'
			: ingest.status === 'running'
				? busy
					? 'Reading now'
					: 'Started, not currently reading'
				: ingest.status === 'paused'
					? 'Paused'
					: ingest.status === 'done'
						? 'Finished'
						: ingest.status === 'failed'
							? 'Stopped on an error'
							: 'Idle'
	);

	/**
	 * Messages listed per minute, measured from the run itself.
	 *
	 * Computed from started_at to updated_at, so a run that has been sitting
	 * untouched reports the rate it managed while it was moving rather than
	 * averaging in an hour of nothing.
	 */
	const rate = $derived.by(() => {
		if (!ingest?.started_at || !ingest.updated_at) return null;
		const elapsed = Date.parse(ingest.updated_at) - Date.parse(ingest.started_at);
		if (elapsed < 5000 || ingest.discovered < 25) return null;
		return Math.round((ingest.discovered / elapsed) * 60_000);
	});

	/** True once the run has listed more than Gmail said existed. */
	const estimatePassed = $derived(
		Boolean(ingest?.total_estimate && ingest.discovered > ingest.total_estimate)
	);

	/**
	 * Roughly how much longer, in minutes.
	 *
	 * Offered only while the estimate is still plausible. Once a run has passed
	 * it, the honest answer is that nobody knows how many remain, and saying so
	 * beats a number derived from a total already proven wrong.
	 */
	const minutesLeft = $derived.by(() => {
		if (!ingest?.total_estimate || !rate || estimatePassed) return null;
		const remaining = ingest.total_estimate - ingest.discovered;
		if (remaining <= 0) return null;
		return Math.max(1, Math.round(remaining / rate));
	});

	/** A run that says it is running while nothing is driving it. */
	const stalled = $derived(ingest?.status === 'running' && !busy);
</script>

<div class="ingest">
	<p class="line"><strong>{label}</strong></p>

	{#if ingest}
		<dl class="counters">
			<div>
				<dt>Listed by Gmail</dt>
				<dd class="mono">{ingest.discovered}</dd>
			</div>
			<div>
				<dt>Newly stored</dt>
				<dd class="mono">{ingest.fetched}</dd>
			</div>
			<div>
				<dt>Gmail's estimate</dt>
				<dd class="mono">{ingest.total_estimate ?? 'unknown'}</dd>
			</div>
			<div>
				<dt>Last activity</dt>
				<dd class="mono">
					{ingest.updated_at ? formatMoment(ingest.updated_at) : 'None'}
				</dd>
			</div>
		</dl>

		<p class="tiny">
			Listed is what Gmail returned. Newly stored is what was not already held, so a
			second run over the same mail lists a lot and stores little.
			{#if estimatePassed}
				This run has already listed more than Gmail estimated, so the estimate was low
				and the number remaining is not known.
			{:else if minutesLeft}
				At the current rate, roughly {minutesLeft} minute{minutesLeft === 1 ? '' : 's'} left.
			{/if}
			{#if rate}
				About {rate} messages a minute while it is moving.
			{/if}
		</p>
	{/if}

	{#if stalled}
		<p class="warn" role="status">
			This run is not moving. Reading happens from this page, so it stops when you
			navigate away, and nothing is lost when it does. Press Continue to pick up from
			where it stopped.
		</p>
	{/if}

	{#if ingest?.last_error}
		<p class="err" role="alert">{ingest.last_error}</p>
	{/if}

	<dl class="counters">
		<div>
			<dt>Account</dt>
			<dd>{account ?? 'Not connected'}</dd>
		</div>
		<div>
			<dt>Messages held</dt>
			<dd class="mono">{stored.messages}</dd>
		</div>
		<div>
			<dt>With a body</dt>
			<dd class="mono">{stored.with_body}</dd>
		</div>
		<div>
			<dt>Threads</dt>
			<dd class="mono">{stored.threads}</dd>
		</div>
	</dl>

	{#if stored.oldest && stored.newest}
		<p class="tiny">
			Holding mail from {formatMoment(stored.oldest)} to {formatMoment(stored.newest)}.
		</p>
	{/if}

	<div class="controls">
		<label class="days">
			<span>Days back</span>
			<input type="number" min="1" max="365" bind:value={days} disabled={busy} />
		</label>

		<Button onclick={() => onStart(days)} disabled={busy}>
			{busy ? 'Reading...' : 'Read the last ' + days + ' days'}
		</Button>

		{#if ingest && ingest.status !== 'done' && ingest.status !== 'idle'}
			{#if busy}
				<Button variant="ghost" onclick={onPause}>Pause</Button>
			{:else}
				<Button variant="secondary" onclick={onRun}>Continue</Button>
			{/if}
		{/if}
	</div>

	<p class="tiny">
		Keep this page open while it reads. Each batch is its own request and the position
		is written after every one, so closing the tab costs nothing but the time to press
		Continue.
	</p>

	<p class="tiny">
		Reading only. Nothing is sent, replied to, drafted or labelled, because the
		permission to do any of that was never requested.
	</p>
</div>

<style>
	.line {
		margin: 0 0 var(--space-2);
		font-size: var(--text-sm);
	}

	.tiny {
		margin: 0 0 var(--space-3);
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.warn,
	.err {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		border: 1px solid var(--gold);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
	}

	.counters {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
		margin: 0 0 var(--space-3);
	}

	@media (min-width: 720px) {
		.counters {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.counters dt {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
		margin-bottom: 2px;
	}

	.counters dd {
		margin: 0;
		font-size: var(--text-base);
		overflow-wrap: anywhere;
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-3);
		margin-bottom: var(--space-3);
	}

	.days {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.days input {
		width: 5rem;
		font-family: var(--font-mono);
		padding: var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text-primary);
	}
</style>
