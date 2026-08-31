<script lang="ts">
	import { apiWrite } from '$lib/http';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { formatDay } from '$lib/format';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import FormField from '$lib/components/FormField.svelte';
	import Input from '$lib/components/Input.svelte';
	import Select from '$lib/components/Select.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import Textarea from '$lib/components/Textarea.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');
	let showForm = $state(false);

	function blankDraft() {
		return { title: '', category: '', review_due: '', body: '' };
	}

	let draft = $state(blankDraft());

	// Grouped by category, the way the design's library reads. Uncategorised
	// SOPs collect at the end rather than being hidden.
	const groups = $derived.by(() => {
		const map = new Map<string, PageData['sops']>();
		for (const sop of data.sops) {
			const key = sop.category ?? '';
			const list = map.get(key) ?? [];
			list.push(sop);
			map.set(key, list);
		}
		return [...map.entries()]
			.sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
			.map(([category, sops]) => ({ category, sops }));
	});

	async function create(event: SubmitEvent) {
		event.preventDefault();
		if (!draft.title.trim() || !draft.body.trim()) {
			errorMessage = 'A SOP needs a title and a body.';
			return;
		}
		busy = true;
		errorMessage = '';
		try {
			const result = await apiWrite<{ sop?: { id: string } }>('/api/sops', 'POST', draft);
			if (!result.ok) {
				errorMessage = result.error ?? 'Could not create the SOP.';
				return;
			}
			const payload = result.data ?? {};
			draft = blankDraft();
			showForm = false;
			notice = 'SOP created.';
			await invalidateAll();
			if (payload.sop) goto(`/sops/${payload.sop.id}`);
		} catch {
			errorMessage = 'Could not reach the server.';
		} finally {
			busy = false;
		}
	}

	function urlFor(patch: Record<string, string>) {
		const params = new URLSearchParams(page.url.searchParams);
		for (const [key, value] of Object.entries(patch)) {
			if (value) params.set(key, value);
			else params.delete(key);
		}
		const query = params.toString();
		return query ? `/sops?${query}` : '/sops';
	}

	function applyFilters(event: SubmitEvent) {
		event.preventDefault();
		const values = new FormData(event.currentTarget as HTMLFormElement);
		goto(
			urlFor({
				q: String(values.get('q') ?? ''),
				category: String(values.get('category') ?? '')
			}),
			{ keepFocus: true }
		);
	}
</script>

<svelte:head>
	<title>SOPs | Command Center</title>
</svelte:head>

<header class="head">
	<div>
		<h1>SOPs</h1>
		<p class="sub">
			How the work gets done, written down and current. Shelves hold books, books hold
			chapters, chapters hold pages.
		</p>
	</div>
	<Button onclick={() => (showForm = !showForm)}>{showForm ? 'Cancel' : 'New SOP'}</Button>
</header>

<p class="status-line" role="status" aria-live="polite">{notice}</p>

{#if errorMessage}
	<p class="error-banner" role="alert">{errorMessage}</p>
{/if}

{#if showForm}
	<div class="block">
		<Card title="New SOP">
			<form onsubmit={create}>
				<div class="grid">
					<div class="span-all">
						<FormField label="Title">
							<Input bind:value={draft.title} placeholder="What this procedure covers" maxlength={300} required />
						</FormField>
					</div>
					<FormField label="Category" hint="Groups the library. Reuse an existing name to file it alongside.">
						<Input bind:value={draft.category} placeholder="Billing, Client delivery, Internal" maxlength={120} />
					</FormField>
					<FormField label="Review due" hint="Critical procedures quarterly, stable ones annually.">
						<Input type="date" bind:value={draft.review_due} mono />
					</FormField>
					<div class="span-all">
						<FormField label="Body" hint="One action per numbered step, plain language.">
							<Textarea bind:value={draft.body} rows={10} placeholder={'1. First step.\n2. Second step.'} />
						</FormField>
					</div>
				</div>
				<div class="form-actions">
					<Button type="submit" disabled={busy}>Create version 1</Button>
				</div>
			</form>
		</Card>
	</div>
{/if}


<div class="tiles">
	<div class="tile">
		<span class="tile-label mono">Pages</span>
		<span class="tile-value">{data.library.counts.pages}</span>
		<span class="tile-note mono">
			{data.library.shelves.length} shelves, {data.library.shelves.reduce((n, s) => n + s.book_count, 0)} books
		</span>
	</div>
	<div class="tile">
		<span class="tile-label mono">Filed</span>
		<span class="tile-value">{data.library.counts.pages - data.library.unfiled}</span>
		<span class="tile-note mono">on a shelf</span>
	</div>
	<div class="tile warn">
		<span class="tile-label mono">Unfiled</span>
		<span class="tile-value">{data.library.unfiled}</span>
		<span class="tile-note mono">no chapter yet</span>
	</div>
	<div class="tile warn">
		<span class="tile-label mono">Review overdue</span>
		<span class="tile-value">{data.library.counts.review_overdue}</span>
		<span class="tile-note mono">
			{data.library.counts.review_overdue === 0 ? 'nothing waiting' : 'past their date'}
		</span>
	</div>
</div>

<!--
	The shelves, and under them the flat list every page still lives in.

	Both are shown rather than one replacing the other, because a hundred and
	eleven pages were filed under a category and nothing else until the shelves
	arrived. A library that only showed filed pages would have lost them.
-->
{#if data.library.shelves.length > 0}
	<div class="shelves">
		{#each data.library.shelves as shelf (shelf.id)}
			<a class="shelf" href="/sops/shelves/{shelf.id}">
				<span class="shelf-name">{shelf.name}</span>
				{#if shelf.description}<span class="shelf-note">{shelf.description}</span>{/if}
				<span class="shelf-counts mono">
					{shelf.book_count} books · {shelf.page_count} pages
					{#if shelf.owner}· {shelf.owner}{/if}
				</span>
			</a>
		{/each}
	</div>
{/if}

<h2 class="section">Every page</h2>
<nav class="tabs" aria-label="Filter SOPs">
	<a href={urlFor({ status: '' })} class="tab" aria-current={data.status === 'active' ? 'page' : undefined}>
		Active <span class="count mono">{data.counts.active}</span>
	</a>
	<a href={urlFor({ status: 'archived' })} class="tab" aria-current={data.status === 'archived' ? 'page' : undefined}>
		Archived <span class="count mono">{data.counts.archived}</span>
	</a>
	<a href={urlFor({ status: 'all' })} class="tab" aria-current={data.status === 'all' ? 'page' : undefined}>
		All <span class="count mono">{data.counts.active + data.counts.archived}</span>
	</a>
</nav>

<form class="filters" onsubmit={applyFilters}>
	<FormField label="Search">
		<Input name="q" type="search" value={data.q} placeholder="Title, category or step text" />
	</FormField>
	<FormField label="Category">
		<Select name="category" value={data.category}>
			<option value="">All categories</option>
			{#each data.categories as entry (entry.category)}
				<option value={entry.category}>{entry.category} ({entry.count})</option>
			{/each}
		</Select>
	</FormField>
	<Button variant="secondary" type="submit">Apply</Button>
</form>

{#if data.sops.length === 0}
	<p class="empty">
		{#if data.q || data.category}
			No SOPs match these filters.
		{:else if data.status === 'archived'}
			Nothing is archived.
		{:else}
			No SOPs yet. Write the first one for a task you have done more than twice.
		{/if}
	</p>
{:else}
	{#each groups as group (group.category)}
		<section class="group">
			<h2 class="label-mono">{group.category || 'Uncategorised'}</h2>
			<ul class="rows">
				{#each group.sops as sop (sop.id)}
					<li>
						<a class="row" href="/sops/{sop.id}">
							<span class="title">{sop.title}</span>
							<span class="meta mono">
								v{sop.current_version_number ?? 1}
								{#if sop.version_count && sop.version_count > 1}
									<span class="sep">·</span>{sop.version_count} versions
								{/if}
								{#if sop.review_due}
									<span class="sep">·</span>review {formatDay(sop.review_due)}
								{/if}
							</span>
							{#if sop.status === 'archived'}
								<StatusChip tone="waiting" label="Archived" size="sm" />
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
{/if}

<style>

	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: var(--space-3);
		margin: var(--space-4) 0;
	}

	.tile {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3);
		border: 1px solid var(--border-thin);
		border-left: 3px solid var(--navy-600);
		border-radius: var(--radius-md);
		background: var(--surface-card);
	}

	.tile.warn {
		border-left-color: var(--gold-600, #c9a84c);
	}

	.tile-label {
		font-size: var(--text-xs);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.tile-value {
		font-size: var(--text-xl);
		color: var(--text-heading);
	}

	.tile-note {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.shelves {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}

	.shelf {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		background: var(--surface-card);
		text-decoration: none;
		min-height: 44px;
	}

	.shelf:hover {
		border-color: var(--navy-600);
	}

	.shelf-name {
		font-size: var(--text-md);
		color: var(--text-heading);
	}

	.shelf-note,
	.shelf-counts {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.section {
		margin: 0 0 var(--space-2);
		font-size: var(--text-sm);
		font-family: var(--font-mono);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.sub {
		margin-top: var(--space-1);
		color: var(--text-secondary);
	}

	.status-line {
		min-height: 1.25rem;
		margin-top: var(--space-2);
		font-size: var(--text-sm);
		color: var(--green-700);
	}

	.error-banner {
		margin-top: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--red-200);
		border-radius: var(--radius-sm);
		background: var(--red-100);
		color: var(--red);
	}

	.block {
		margin-top: var(--space-4);
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-3);
	}

	.form-actions {
		margin-top: var(--space-4);
	}

	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin-top: var(--space-5);
		border-bottom: 1px solid var(--border-thin);
	}

	.tab {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--tap);
		padding: 0 var(--space-3);
		margin-bottom: -1px;
		border-bottom: 2px solid transparent;
		color: var(--text-secondary);
		text-decoration: none;
	}

	.tab:hover {
		color: var(--ink);
		text-decoration: none;
	}

	.tab[aria-current='page'] {
		color: var(--navy);
		border-bottom-color: var(--navy);
		font-weight: var(--weight-medium);
	}

	.count {
		font-size: var(--text-xs);
	}

	.filters {
		display: grid;
		grid-template-columns: 1fr;
		align-items: end;
		gap: var(--space-3);
		margin-top: var(--space-4);
	}

	.empty {
		margin-top: var(--space-5);
		padding: var(--space-7) var(--space-4);
		text-align: center;
		color: var(--text-secondary);
		background: var(--surface-card);
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-md);
	}

	.group {
		margin-top: var(--space-5);
	}

	.group h2 {
		font-size: var(--text-xs);
		margin-bottom: var(--space-2);
	}

	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.row {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-1);
		padding: var(--space-3) var(--space-4);
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		color: inherit;
		text-decoration: none;
	}

	.row:hover {
		background: var(--surface-hover);
		color: inherit;
		text-decoration: none;
	}

	.row:hover .title {
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.title {
		font-weight: var(--weight-medium);
		overflow-wrap: anywhere;
	}

	.meta {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.sep {
		margin: 0 var(--space-1);
	}

	@media (min-width: 720px) {
		.grid {
			grid-template-columns: 1fr 1fr;
		}

		.span-all {
			grid-column: 1 / -1;
		}

		.filters {
			grid-template-columns: 2fr 2fr auto;
		}

		.row {
			grid-template-columns: 1fr auto auto;
			gap: var(--space-4);
			align-items: center;
		}
	}
</style>
