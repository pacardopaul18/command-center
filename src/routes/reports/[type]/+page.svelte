<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import ReportBody from '$lib/components/ReportBody.svelte';
	import { formatDay } from '$lib/format';
	import { reportMeta } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const meta = $derived(reportMeta(data.type));

	/**
	 * The window lives in the URL, so changing it is a navigation. That keeps a
	 * report linkable and makes the browser back button do the obvious thing.
	 *
	 * The inputs are uncontrolled, holding their own value the way a plain form
	 * does. Mirroring them into component state would mean keeping that state in
	 * step with every navigation, and the only thing it would buy is live min and
	 * max attributes.
	 *
	 * Instead a reversed range is swapped on submit. The API returns a 400 for
	 * from after to, which would surface as an error page, and quietly reading a
	 * backwards range the obvious way is kinder than that and never wrong.
	 */
	function onsubmit(event: SubmitEvent) {
		const form = event.currentTarget as HTMLFormElement;
		const a = form.elements.namedItem('from') as HTMLInputElement;
		const b = form.elements.namedItem('to') as HTMLInputElement;
		if (a.value && b.value && a.value > b.value) {
			[a.value, b.value] = [b.value, a.value];
		}
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
	<form class="window" data-sveltekit-noscroll {onsubmit}>
		<label>
			<span>From</span>
			<input type="date" name="from" value={data.from} />
		</label>
		<label>
			<span>To</span>
			<input type="date" name="to" value={data.to} />
		</label>
		<Button type="submit" variant="secondary">Run</Button>
	</form>
{/if}

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

	.window {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-3);
		margin-bottom: var(--space-5);
		padding: var(--space-4);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		background: var(--surface-card);
	}

	.window label {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.window input {
		/* 16px on touch so iOS does not zoom the page on focus. D23. */
		min-height: 44px;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-control);
		border-radius: var(--radius-sm);
		background: var(--white);
		color: var(--text-body);
		font-family: var(--font-sans);
		font-size: 16px;
	}

	@media (min-width: 720px) {
		.window input {
			font-size: var(--text-sm);
		}
	}

	.window input:focus-visible {
		outline: 2px solid var(--navy);
		outline-offset: 1px;
	}
</style>
