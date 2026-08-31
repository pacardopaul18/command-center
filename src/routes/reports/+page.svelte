<script lang="ts">
	import Card from '$lib/components/Card.svelte';
	import ReportWindow from '$lib/components/ReportWindow.svelte';
	import { REPORTS } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** Carries a window already in the URL onto each report link. */
	const suffix = $derived(data.from && data.to ? `?from=${data.from}&to=${data.to}` : '');

	/**
	 * Snapshots and windowed reports are separated, because they answer
	 * different kinds of question and the date control only governs one of them.
	 * Mixing them under one range picker implies the picker changes all seven.
	 */
	const snapshots = $derived(REPORTS.filter((r) => !r.windowed));
	const windowed = $derived(REPORTS.filter((r) => r.windowed));

	const csvHref = (type: string) =>
		data.from && data.to
			? `/api/reports/${type}/export.csv?from=${data.from}&to=${data.to}`
			: `/api/reports/${type}/export.csv`;
</script>

<svelte:head><title>Reports</title></svelte:head>

<header class="head">
	<h1>Reports</h1>
	<p>Each report is a live query. Nothing is stored, so every one is current when you open it.</p>
</header>

<h2 class="section">Snapshots</h2>
<p class="section-note">As of right now. The date range below does not change these.</p>

<div class="grid">
	{#each snapshots as report (report.type)}
		<div class="tile">
			<a class="tile-link" href="/reports/{report.type}{suffix}">
				<span class="tile-title">{report.title}</span>
				<span class="tile-summary">{report.summary}</span>
			</a>
			<a class="tile-csv" href={csvHref(report.type)} download>Export CSV</a>
		</div>
	{/each}
</div>

<h2 class="section">Over a date range</h2>
<!--
	The picker sits with the reports it governs. On the index it sets the range
	every windowed report opens with, which is the same control the report pages
	carry, so a range set here survives the trip.
-->
<ReportWindow from={data.from} to={data.to} />

<div class="grid">
	{#each windowed as report (report.type)}
		<div class="tile">
			<a class="tile-link" href="/reports/{report.type}{suffix}">
				<span class="tile-title">{report.title}</span>
				<span class="tile-summary">{report.summary}</span>
			</a>
			<a class="tile-csv" href={csvHref(report.type)} download>Export CSV</a>
		</div>
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

	.section {
		margin: var(--space-5) 0 var(--space-1);
		font-size: var(--text-sm);
		font-family: var(--font-mono);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.section:first-of-type {
		margin-top: 0;
	}

	.section-note {
		margin: 0 0 var(--space-3);
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.tile-link {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		text-decoration: none;
	}

	.tile-title {
		font-size: var(--text-md);
		color: var(--text-heading);
	}

	.tile-summary {
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.tile-csv {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		/* 44px, D22. */
		min-height: 44px;
		margin-top: var(--space-2);
		padding: 0 var(--space-2);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		color: var(--text-muted);
		text-decoration: none;
	}

	.tile-csv:hover {
		color: var(--text-body);
		border-color: var(--navy-600);
	}
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




	.deferred {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
</style>
