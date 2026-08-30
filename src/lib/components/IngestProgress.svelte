<script lang="ts">
	import { formatMoment } from '$lib/format';
	import Button from './Button.svelte';

	/**
	 * The ingestion readout.
	 *
	 * Paul has to be able to see ingestion state rather than infer it, which is
	 * why every number here comes from the stored record rather than from
	 * whatever the last request happened to return. A page opened halfway through
	 * a run, or after one finished, shows the same truth as one that watched it.
	 *
	 * The total is labelled an estimate because it is one. Gmail's own count is
	 * approximate, and a bar that reaches 100% at 93% of the real work, or stops
	 * at 92% having finished, is only confusing if it claimed to be exact.
	 */

	import type { EmailIngestState, EmailStored } from '$lib/types';

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

	const percent = $derived(
		ingest && ingest.total_estimate && ingest.total_estimate > 0
			? Math.min(100, Math.round((ingest.discovered / ingest.total_estimate) * 100))
			: null
	);

	const label = $derived(
		!ingest
			? 'Never run'
			: ingest.status === 'running'
				? 'Reading'
				: ingest.status === 'paused'
					? 'Paused'
					: ingest.status === 'done'
						? 'Finished'
						: ingest.status === 'failed'
							? 'Stopped on an error'
							: 'Idle'
	);
</script>

<div class="ingest">
	<p class="line">
		<strong>{label}</strong>
		{#if ingest}
			&middot; {ingest.fetched} of about {ingest.total_estimate ?? '?'} messages read
			{#if ingest.updated_at}
				&middot; last activity {formatMoment(ingest.updated_at)}
			{/if}
		{/if}
	</p>

	{#if percent !== null && ingest?.status !== 'done'}
		<div
			class="bar"
			role="progressbar"
			aria-valuenow={percent}
			aria-valuemin="0"
			aria-valuemax="100"
			aria-label="Mail ingestion progress"
		>
			<span style="width: {percent}%"></span>
		</div>
		<p class="tiny">
			{percent}% of an estimate. Gmail's own count is approximate, so the end may arrive a
			little early or late.
		</p>
	{/if}

	{#if ingest?.last_error}
		<p class="err" role="alert">{ingest.last_error}</p>
	{/if}

	<dl class="grid">
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
			{busy ? 'Working...' : 'Read the last ' + days + ' days'}
		</Button>

		{#if ingest && (ingest.status === 'running' || ingest.status === 'paused' || ingest.status === 'failed')}
			{#if ingest.status === 'running'}
				<Button variant="ghost" onclick={onPause} disabled={busy}>Pause</Button>
			{:else}
				<Button variant="secondary" onclick={onRun} disabled={busy}>Continue</Button>
			{/if}
		{/if}
	</div>

	<p class="tiny">
		Reading only. Nothing is sent, replied to, drafted or labelled, because the permission
		to do any of that was never requested.
	</p>
</div>

<style>
	.ingest {
		display: block;
	}

	.line {
		margin: 0 0 var(--space-2);
		font-size: var(--text-sm);
	}

	.bar {
		height: 8px;
		border-radius: 999px;
		background: var(--surface-hover);
		overflow: hidden;
		margin-bottom: var(--space-1);
	}

	.bar span {
		display: block;
		height: 100%;
		background: var(--navy, #102a4c);
	}

	.tiny {
		margin: 0 0 var(--space-3);
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.err {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		border: 1px solid var(--gold);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
		margin: 0 0 var(--space-3);
	}

	@media (min-width: 720px) {
		.grid {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.grid dt {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
		margin-bottom: 2px;
	}

	.grid dd {
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
