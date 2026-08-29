<script lang="ts">
	import Card from '$lib/components/Card.svelte';
	import { REPORTS } from '$lib/types';
</script>

<svelte:head><title>Reports</title></svelte:head>

<header class="head">
	<h1>Reports</h1>
	<p>Each report is a live query. Nothing is stored, so every one is current when you open it.</p>
</header>

<div class="grid">
	{#each REPORTS as report (report.type)}
		<a class="tile" href="/reports/{report.type}">
			<h2>{report.title}</h2>
			<p>{report.summary}</p>
			<span class="meta">{report.windowed ? 'Covers a date range you choose' : 'A snapshot of right now'}</span>
		</a>
	{/each}
</div>

<Card title="Partner time saved">
	<p class="deferred">
		The fifth report in the architecture is not built. It needs a time-saved log,
		a slips-caught register, and a baseline time audit that has not been run yet.
		Building it now would mean inventing the baseline, which would make the
		headline number a guess. It is v2 work, once there is real data behind it.
	</p>
</Card>

<style>
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-bottom: var(--space-5);
	}

	.head h1 {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: var(--weight-medium);
	}

	.head p {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--text-sm);
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-4);
		margin-bottom: var(--space-5);
	}

	@media (min-width: 720px) {
		.grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	.tile {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		/* 44px tap-target floor, D22. */
		min-height: 44px;
		padding: var(--space-4);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		background: var(--surface-card);
		text-decoration: none;
		color: inherit;
	}

	.tile:hover {
		background: var(--surface-hover);
		border-color: var(--border-strong);
	}

	.tile:focus-visible {
		outline: 2px solid var(--navy);
		outline-offset: 2px;
	}

	.tile h2 {
		margin: 0;
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
		color: var(--text-link);
	}

	.tile p {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.meta {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.deferred {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
</style>
