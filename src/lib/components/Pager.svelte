<script lang="ts">
	import { goto } from '$app/navigation';
	import { page as pageState } from '$app/state';

	/**
	 * Paging control for a server paginated list.
	 *
	 * State lives in the URL, so a page is linkable, the back button works, and a
	 * reload lands where the reader was. Same reasoning as the report windows.
	 *
	 * Changing the page size returns to page one rather than trying to keep the
	 * reader's position. Holding position across a size change means computing
	 * which page the first visible row now falls on, and getting that subtly
	 * wrong is worse than an honest jump to the start.
	 */

	interface Paging {
		page: number;
		page_size: number;
		total: number;
		page_count: number;
		sizes: readonly number[];
	}

	let { paging, label = 'items' }: { paging: Paging; label?: string } = $props();

	const first = $derived(paging.total === 0 ? 0 : (paging.page - 1) * paging.page_size + 1);
	const last = $derived(Math.min(paging.page * paging.page_size, paging.total));

	function to(patch: Record<string, string>) {
		const params = new URLSearchParams(pageState.url.searchParams);
		for (const [k, v] of Object.entries(patch)) {
			if (v) params.set(k, v);
			else params.delete(k);
		}
		const query = params.toString();
		goto(`${pageState.url.pathname}${query ? `?${query}` : ''}`, { keepFocus: true, noScroll: true });
	}
</script>

<nav class="pager" aria-label="Pagination">
	<!--
		Plain text, not a live region. It was role="status", which announced the
		range on every page change and, more concretely, gave every paginated
		screen a second status region competing with the one the page already
		uses for save confirmations.
	-->
	<p class="range">
		{#if paging.total === 0}
			No {label}
		{:else}
			{first} to {last} of {paging.total}
			{label}
		{/if}
	</p>

	<div class="controls">
		<label class="size">
			<span>Per page</span>
			<select
				value={String(paging.page_size)}
				onchange={(e) => to({ page_size: e.currentTarget.value, page: '' })}
			>
				{#each paging.sizes as size (size)}
					<option value={String(size)}>{size}</option>
				{/each}
			</select>
		</label>

		<div class="steps">
			<button
				type="button"
				disabled={paging.page <= 1}
				onclick={() => to({ page: String(paging.page - 1) })}
			>
				Previous
			</button>
			<span class="of mono">Page {paging.page} of {paging.page_count}</span>
			<button
				type="button"
				disabled={paging.page >= paging.page_count}
				onclick={() => to({ page: String(paging.page + 1) })}
			>
				Next
			</button>
		</div>
	</div>
</nav>

<style>
	/* Mobile first: the count sits above the controls until there is room. */
	.pager {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-top: var(--space-4);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		background: var(--surface-card);
	}

	@media (min-width: 720px) {
		.pager {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
		}
	}

	.range {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4);
	}

	.size {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	select {
		/* 44px tap target, 16px on touch so iOS does not zoom. D22, D23. */
		min-height: var(--tap);
		padding: 0 var(--space-3);
		border: 1px solid var(--border-control);
		border-radius: var(--radius-sm);
		background: var(--white);
		color: var(--text-body);
		font-family: var(--font-sans);
		font-size: 16px;
	}

	.steps {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	button {
		min-height: var(--tap);
		padding: 0 var(--space-4);
		border: 1px solid var(--border-control);
		border-radius: var(--radius-sm);
		background: var(--surface-card);
		color: var(--text-body);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		cursor: pointer;
	}

	button:hover:not(:disabled) {
		background: var(--surface-hover);
	}

	button:disabled {
		opacity: 0.45;
		cursor: default;
	}

	button:focus-visible,
	select:focus-visible {
		outline: 2px solid var(--navy);
		outline-offset: 2px;
	}

	.of {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		white-space: nowrap;
	}

	@media (min-width: 720px) {
		select {
			font-size: var(--text-sm);
		}
	}
</style>
