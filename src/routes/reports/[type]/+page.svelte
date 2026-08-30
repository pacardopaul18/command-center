<script lang="ts">
	import ReportBody from '$lib/components/ReportBody.svelte';
	import ReportWindow from '$lib/components/ReportWindow.svelte';
	import { formatDay } from '$lib/format';
	import { REPORTS, reportMeta } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const meta = $derived(reportMeta(data.type));

	/** A link to another report that keeps the range the reader chose. */
	function windowedHref(type: string): string {
		return `/reports/${type}?from=${data.from}&to=${data.to}`;
	}

	const printHref = $derived(
		meta.windowed
			? `/reports/${data.type}/print?from=${data.from}&to=${data.to}`
			: `/reports/${data.type}/print`
	);
</script>

<svelte:head><title>{meta.title}</title></svelte:head>

<header class="head">
	<p class="crumb"><a href="/reports">Reports</a></p>
	<div class="title-row">
		<div>
			<h1>{meta.title}</h1>
			<p class="summary">{meta.summary}</p>
		</div>
		<a class="print" href={printHref}>Print or save as PDF</a>
	</div>
	<p class="asof">
		{#if meta.windowed}
			Covering {formatDay(data.from)} to {formatDay(data.to)}. Aging and overdue counts are as of {formatDay(data.today)}.
		{:else}
			As of {formatDay(data.today)}.
		{/if}
	</p>
</header>

{#if meta.windowed}
	<ReportWindow from={data.from} to={data.to} />
{/if}

<!--
	Every other report, reachable without losing the window.

	Setting a range and then having it evaporate on the way to the next report is
	the friction that makes a date filter unused. A snapshot report ignores the
	parameters, so carrying them costs nothing and means the range survives a
	round trip through one.
-->
<nav class="siblings" aria-label="Other reports">
	{#each REPORTS.filter((r) => r.type !== data.type) as other (other.type)}
		<a href={windowedHref(other.type)}>{other.title}</a>
	{/each}
</nav>

<ReportBody type={data.type} data={data.data} today={data.today} />

<style>
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-bottom: var(--space-5);
	}

	.crumb {
		margin: 0;
		font-size: var(--text-sm);
	}

	.crumb a {
		color: var(--text-link);
	}

	/* Mobile first: the print link sits under the title until there is room. */
	.title-row {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	@media (min-width: 720px) {
		.title-row {
			flex-direction: row;
			align-items: flex-start;
			justify-content: space-between;
			gap: var(--space-4);
		}
	}

	h1 {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: var(--weight-medium);
	}

	.summary,
	.asof {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.asof {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}

	.siblings {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-bottom: var(--space-5);
		font-size: var(--text-sm);
	}

	.siblings a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0 var(--space-3);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-pill);
		color: var(--text-link);
		text-decoration: none;
	}

	.siblings a:hover {
		background: var(--surface-hover);
		border-color: var(--border-strong);
	}

	.siblings a:focus-visible {
		outline: 2px solid var(--navy);
		outline-offset: 2px;
	}

	.print {
		display: inline-flex;
		align-items: center;
		/* 44px tap-target floor, D22. */
		min-height: 44px;
		padding: 0 var(--space-4);
		border: 1px solid var(--border-control);
		border-radius: var(--radius-sm);
		background: var(--surface-card);
		color: var(--text-body);
		font-size: var(--text-sm);
		text-decoration: none;
		white-space: nowrap;
	}

	.print:hover {
		background: var(--surface-hover);
	}

	.print:focus-visible {
		outline: 2px solid var(--navy);
		outline-offset: 2px;
	}




</style>
