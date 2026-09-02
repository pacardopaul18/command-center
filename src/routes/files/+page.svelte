<script lang="ts">
	import MirrorFreshness from '$lib/components/MirrorFreshness.svelte';
	import Card from '$lib/components/Card.svelte';
	import Input from '$lib/components/Input.svelte';
	import Select from '$lib/components/Select.svelte';
	import Button from '$lib/components/Button.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function bytes(n: number): string {
		if (n < 1024) return `${n} B`;
		const units = ['KB', 'MB', 'GB', 'TB'];
		let value = n / 1024;
		let unit = 0;
		while (value >= 1024 && unit < units.length - 1) {
			value /= 1024;
			unit += 1;
		}
		return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
	}

	const day = (v: string | null) => (v ? v.slice(0, 10) : 'unknown');

	/** A path without the file on the end, which is the part worth reading. */
	const folder = (p: string) => p.replace(/^\/[^/]*\//, '').replace(/\/[^/]*$/, '') || '/';

	const lastPage = $derived(Math.max(1, Math.ceil(data.total / data.page_size)));

	function link(changes: Record<string, string>): string {
		const q = new URLSearchParams();
		const base = { q: data.q, extension: data.extension, client_id: data.clientId, page: '1' };
		for (const [k, v] of Object.entries({ ...base, ...changes })) if (v) q.set(k, v);
		return `/files?${q}`;
	}
</script>

<svelte:head><title>Files</title></svelte:head>

<header class="head">
	<div>
		<h1>Files</h1>
		<p class="lede">
			What is in the firm's Dropbox, as of the last scan. Names, sizes and dates only:
			the app holds a map of where the client work is, not the client work. Dropbox is
			the source of truth and nothing here changes it.
		</p>
	</div>
	{#if data.summary}
		<div class="tally">
			<span><strong>{data.summary.totals.files.toLocaleString()}</strong> files</span>
			<span><strong>{bytes(data.summary.totals.total_bytes)}</strong></span>
		</div>
	{/if}
</header>

{#if data.summary}
	<!--
		How old the file list is, and how to make it newer.

		No Sync now button here, deliberately. A Worker has no filesystem and
		cannot re-walk Dropbox, so a button would be an affordance that does
		nothing, which is worse on a control whose whole purpose is to fix the
		thing it names. The hint says what actually works instead. D27.
	-->
	<MirrorFreshness
		freshness={data.summary.freshness}
		source="Dropbox"
		refreshPath={null}
		refreshHint="Re-walked by scripts/dropbox-scan.mjs on this machine, not from the app."
	/>

	<Card title="What is there" subtitle="By file kind, largest groups first">
		<ul class="kinds">
			{#each data.summary.kinds as kind (kind.extension)}
				<li>
					<a href={link({ extension: kind.extension === '(none)' ? '' : kind.extension })}>
						<span class="kind-name">{kind.extension}</span>
						<span class="kind-n">{kind.files.toLocaleString()}</span>
						<span class="kind-size">{bytes(kind.total_bytes)}</span>
					</a>
				</li>
			{/each}
		</ul>

		<!--
			Files under a folder nobody has matched to a client yet.

			Counted rather than hidden. A Files view that quietly omitted them
			would report a smaller Dropbox than exists, and the number is the
			reason to go and answer the question on the reconciliation screen.
		-->
		{#if data.summary.files_not_under_a_matched_client > 0}
			<p class="note">
				{data.summary.files_not_under_a_matched_client.toLocaleString()} files sit under
				{data.summary.filing.unassigned} client folders that have not been matched to a client.
				<a href="/clients/unassigned">Match them</a> and they will file themselves.
			</p>
		{/if}
	</Card>
{/if}

<Card title="All files" subtitle="{data.total.toLocaleString()} matching, newest first">
	<form class="filters" data-sveltekit-keepfocus>
		<!--
			A plain GET form, so the filters live in the URL and a filtered view is
			a link somebody can send. Nothing here is bound to component state:
			the box's value comes from the address on every load, so it cannot
			show one thing while the list shows another.
		-->
		<Input name="q" value={data.q} placeholder="Search file names" maxlength={200} />
		<Select name="client_id" value={data.clientId} aria-label="Client">
			<option value="">Every client</option>
			{#each data.clients as client (client.id)}
				<option value={client.id}>{client.name}</option>
			{/each}
		</Select>
		{#if data.extension}
			<input type="hidden" name="extension" value={data.extension} />
		{/if}
		<Button type="submit" variant="secondary">Filter</Button>
		{#if data.q || data.extension || data.clientId}
			<a class="clear" href="/files">Clear</a>
		{/if}
	</form>

	{#if data.files.length === 0}
		<p class="empty">
			No files match. {#if data.total === 0 && !data.q && !data.extension && !data.clientId}
				Nothing has been scanned into the mirror yet.
			{/if}
		</p>
	{:else}
		<div class="scroller">
			<table>
				<thead>
					<tr>
						<th scope="col">Name</th>
						<th scope="col">Folder</th>
						<th scope="col">Kind</th>
						<th scope="col" class="num">Size</th>
						<th scope="col">Changed</th>
					</tr>
				</thead>
				<tbody>
					{#each data.files as file (file.path)}
						<tr>
							<th scope="row">{file.name}</th>
							<td class="folder">{folder(file.path)}</td>
							<td>{file.extension ?? '-'}</td>
							<td class="num">{bytes(file.size_bytes)}</td>
							<td>{day(file.modified_at)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if lastPage > 1}
			<nav class="pager" aria-label="Pagination">
				<a
					href={link({ page: String(Math.max(1, data.page - 1)) })}
					aria-disabled={data.page <= 1}>Previous</a
				>
				<span>Page {data.page} of {lastPage}</span>
				<a
					href={link({ page: String(Math.min(lastPage, data.page + 1)) })}
					aria-disabled={data.page >= lastPage}>Next</a
				>
			</nav>
		{/if}
	{/if}
</Card>

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: var(--space-5);
	}

	h1 {
		margin: 0 0 var(--space-2);
	}

	.lede {
		margin: 0;
		max-width: 72ch;
		color: var(--text-secondary);
	}

	.tally {
		display: flex;
		gap: var(--space-4);
		color: var(--text-secondary);
		font-size: 0.875rem;
	}

	.tally strong {
		color: var(--ink);
		font-size: 1.25rem;
	}

	.kinds {
		list-style: none;
		margin: 0 0 var(--space-4);
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(15ch, 1fr));
		gap: var(--space-2);
	}

	.kinds a {
		display: grid;
		gap: 2px;
		/* D22: 44px tap floor. */
		min-height: 44px;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-2);
		text-decoration: none;
		color: inherit;
		background: var(--surface-card);
	}

	.kinds a:hover {
		background: var(--surface-hover);
	}

	.kind-name {
		font-family: var(--font-mono, monospace);
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	.kind-n {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.kind-size {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.note {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.875rem;
		max-width: 70ch;
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
		margin-bottom: var(--space-4);
	}

	.clear {
		color: var(--text-secondary);
		font-size: 0.875rem;
	}

	.empty {
		margin: 0;
		color: var(--text-secondary);
	}

	/* Wide content scrolls inside its own box; the page never scrolls sideways. */
	.scroller {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9375rem;
	}

	th,
	td {
		text-align: left;
		padding: var(--space-3);
		border-bottom: 1px solid var(--border-thin);
	}

	thead th {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		font-weight: 600;
		white-space: nowrap;
		border-bottom-width: 2px;
	}

	tbody th {
		font-weight: 600;
		min-width: 20ch;
	}

	.folder {
		color: var(--text-secondary);
		font-size: 0.8125rem;
		max-width: 40ch;
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.pager {
		display: flex;
		gap: var(--space-4);
		align-items: center;
		margin-top: var(--space-4);
		font-size: 0.875rem;
	}

	.pager a[aria-disabled='true'] {
		pointer-events: none;
		opacity: 0.4;
	}
</style>
