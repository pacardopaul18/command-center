<script lang="ts">
	import Button from './Button.svelte';
	import { invalidateAll } from '$app/navigation';

	/**
	 * How old the mirrored data on this screen is, and a way to fix it.
	 *
	 * The accuracy audit found the app two days behind Asana with nothing on any
	 * screen saying so. That half of the finding was not about counts at all: a
	 * number with no date is a number the reader assumes is current, and this one
	 * was not. Every screen sourced from the mirror carries this.
	 *
	 * The refresh button is here because a screen that is hours old with no way
	 * to bring it current is a screen somebody stops trusting rather than one
	 * they wait on.
	 */
	let {
		freshness,
		source = 'Asana',
		/**
		 * How to bring this source current, when the app can.
		 *
		 * Null means it cannot, and then no button is drawn. The app has no
		 * filesystem in a Worker and cannot re-walk Dropbox, so offering a Sync
		 * now there would be an affordance that does nothing: D27, and the more
		 * so on a control whose whole purpose is to fix the thing it names.
		 */
		refreshPath = '/api/asana/refresh',
		/** What to say instead, when there is no button to offer. */
		refreshHint = ''
	}: {
		freshness: {
			synced: boolean;
			as_of?: string | null;
			age_minutes?: number | null;
			reason?: string;
			last_error?: string | null;
		} | null;
		source?: string;
		refreshPath?: string | null;
		refreshHint?: string;
	} = $props();

	let busy = $state(false);
	let failed = $state('');

	/** Plain words. "1,647 minutes" is a number nobody converts in their head. */
	function age(minutes: number): string {
		if (minutes < 2) return 'just now';
		if (minutes < 60) return `${minutes} minutes ago`;
		const hours = Math.round(minutes / 60);
		if (hours < 36) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
		const days = Math.round(hours / 24);
		return days === 1 ? 'yesterday' : `${days} days ago`;
	}

	/*
	 * Stale enough to say so louder. Six hours is two missed firings, which is
	 * the point at which "recently" stops being true.
	 */
	const stale = $derived((freshness?.age_minutes ?? 0) > 360);

	async function refresh() {
		busy = true;
		failed = '';
		try {
			const res = await fetch(refreshPath!, { method: 'POST' });
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				failed = body.error ?? 'The refresh did not run.';
				return;
			}
			await invalidateAll();
		} catch {
			failed = 'Could not reach the server.';
		} finally {
			busy = false;
		}
	}
</script>

{#if freshness}
	<p class="freshness" class:stale>
		{#if freshness.synced && freshness.age_minutes != null}
			<span>{source} data as of <strong>{age(freshness.age_minutes)}</strong></span>
		{:else}
			<span>{freshness.reason ?? 'Asana has not been mirrored yet.'}</span>
		{/if}

		{#if freshness.last_error}
			<span class="bad">Last sync reported: {freshness.last_error}</span>
		{/if}

		{#if refreshPath}
			<Button variant="ghost" size="sm" disabled={busy} onclick={refresh}>
				{busy ? 'Syncing' : 'Sync now'}
			</Button>
		{:else if refreshHint}
			<span class="hint">{refreshHint}</span>
		{/if}

		{#if failed}<span class="bad">{failed}</span>{/if}
	</p>
{/if}

<style>
	.freshness {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin: 0 0 var(--space-4);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-2);
		background: var(--surface-hover);
		color: var(--text-secondary);
		font-size: 0.8125rem;
	}

	/*
	 * Gold, not red. Stale data is worth noticing and is not an error, and D20
	 * keeps red for overdue and nothing else.
	 */
	.freshness.stale {
		background: var(--gold-100);
		color: var(--gold-600);
	}

	.freshness strong {
		color: inherit;
	}

	.bad {
		color: var(--red);
	}

	.hint {
		font-style: italic;
	}
</style>
