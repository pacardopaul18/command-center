<script lang="ts">
	import { apiWrite } from '$lib/http';
	import { invalidateAll } from '$app/navigation';
	import { formatDayShort, formatMoment } from '$lib/format';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import Input from '$lib/components/Input.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import type { PageData } from './$types';

	/**
	 * One book: its chapters, the pages in each, and what has happened to them.
	 *
	 * The activity list is joined out of `sop_versions` rather than read from a
	 * table of its own. Every edit already writes a version with an author and a
	 * change note, so a second home for the same facts would drift the first
	 * time a version was written without remembering to log it. D155.
	 */

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let errorMessage = $state('');
	let notice = $state('');
	let chapterTitle = $state('');

	const pagesIn = (chapterId: string) => data.pages.filter((p) => p.chapter_id === chapterId);

	async function addChapter(event: SubmitEvent) {
		event.preventDefault();
		if (!chapterTitle.trim()) return;
		busy = true;
		errorMessage = '';
		const res = await apiWrite(`/api/sops/books/${data.book.id}/chapters`, 'POST', {
			title: chapterTitle
		});
		busy = false;
		if (res.ok) {
			chapterTitle = '';
			await invalidateAll();
		} else {
			errorMessage = res.error ?? 'Could not add that chapter.';
		}
	}

	/**
	 * Records that the book was read through today.
	 *
	 * The date it happened, not the date it is next due: the next date follows
	 * from the cycle, and storing it would have to be redone every time the
	 * cycle changed.
	 */
	async function markReviewed() {
		busy = true;
		const res = await apiWrite(`/api/sops/books/${data.book.id}/reviewed`, 'POST', {});
		busy = false;
		if (res.ok) {
			notice = 'Marked as read through today.';
			await invalidateAll();
		} else {
			errorMessage = res.error ?? 'Could not record that review.';
		}
	}

	const TONE: Record<string, 'open' | 'done' | 'waiting'> = {
		draft: 'open',
		published: 'done',
		archived: 'waiting'
	};
</script>

<svelte:head><title>{data.book.title} | SOPs</title></svelte:head>

<nav class="crumbs mono" aria-label="Breadcrumb">
	<a href="/sops">SOPs</a> <span aria-hidden="true">/</span>
	<a href="/sops/shelves/{data.book.shelf_id}">{data.book.shelf_name}</a>
	<span aria-hidden="true">/</span>
	<span>{data.book.title}</span>
</nav>

<header class="head">
	<div>
		<h1>{data.book.title}</h1>
		<p class="sub">
			{data.chapters.length}
			{data.chapters.length === 1 ? 'chapter' : 'chapters'} · {data.pages.length} pages
			{#if data.book.owner_shown}· looked after by {data.book.owner_shown}{/if}
		</p>
		{#if data.book.description}<p class="sub">{data.book.description}</p>{/if}
	</div>
	<div class="head-actions">
		<StatusChip tone={TONE[data.book.status]} label={data.book.status} />
		<Button variant="secondary" disabled={busy} onclick={markReviewed}>Mark reviewed</Button>
	</div>
</header>

<p class="status-line" role="status" aria-live="polite">{notice}</p>
{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}

<div class="board">
	<div class="main">
		<Card title="Contents">
			{#snippet actions()}
				<span class="fine mono">
					{#if data.book.next_review}
						next review {formatDayShort(data.book.next_review)}
					{:else}
						no review cycle
					{/if}
				</span>
			{/snippet}

			{#if data.chapters.length === 0}
				<p class="empty">
					No chapters yet. A chapter is a part of the procedure, and a page is one step or
					one topic within it.
				</p>
			{/if}

			{#each data.chapters as chapter, index (chapter.id)}
				<section class="chapter">
					<h2>{index + 1}. {chapter.title}</h2>
					{#if pagesIn(chapter.id).length === 0}
						<p class="empty">
							Nothing filed here yet. Open a page from
							<a href="/sops">the library</a> and file it into this chapter.
						</p>
					{:else}
						<ul class="pages">
							{#each pagesIn(chapter.id) as page (page.id)}
								<li>
									<a class="page-title" href="/sops/{page.id}">{page.title}</a>
									<span class="page-meta mono">
										{#if page.version_number}v{page.version_number}{/if}
										{#if page.last_edited_at}
											· {formatDayShort(page.last_edited_at.slice(0, 10))}
										{/if}
									</span>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/each}

			<form class="add-row" onsubmit={addChapter}>
				<Input bind:value={chapterTitle} placeholder="New chapter" maxlength={200} />
				<Button type="submit" variant="secondary" disabled={busy || !chapterTitle.trim()}>
					Add chapter
				</Button>
			</form>
		</Card>
	</div>

	<aside class="side">
		<Card title="Book activity" subtitle="Edits across every page in this book">
			{#if data.activity.length === 0}
				<p class="empty">Nothing recorded yet.</p>
			{:else}
				<ul class="feed">
					{#each data.activity as entry (entry.id)}
						<li>
							<span class="feed-when mono">
								{formatDayShort(entry.created_at.slice(0, 10))}
							</span>
							<span class="feed-body">
								<a href="/sops/{entry.sop_id}">{entry.sop_title}</a>
								<span class="feed-version mono">v{entry.version_number}</span>
								{#if entry.change_note}
									<span class="feed-note">{entry.change_note}</span>
								{:else}
									<span class="feed-note dim">First written version.</span>
								{/if}
								{#if entry.author}<span class="feed-who mono">{entry.author}</span>{/if}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>
	</aside>
</div>

<style>
	.crumbs {
		font-size: var(--text-xs);
		color: var(--text-muted);
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	.crumbs a {
		color: inherit;
	}

	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
		flex-wrap: wrap;
		margin: var(--space-2) 0 var(--space-3);
	}

	.head-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	h1 {
		margin: 0;
		font-size: var(--text-2xl);
		color: var(--text-heading);
	}

	.sub {
		margin: var(--space-1) 0 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	.status-line {
		margin: 0 0 var(--space-2);
		min-height: 1.2em;
		font-size: var(--text-sm);
		color: var(--green-700, #2e7d5b);
	}

	.error {
		margin: 0 0 var(--space-3);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--red-200, #c05b4d);
		border-radius: var(--radius-sm);
		color: var(--red, #8a2f22);
		font-size: var(--text-sm);
	}

	.board {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		align-items: start;
	}

	@media (min-width: 1000px) {
		.board {
			grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
		}
	}

	.main,
	.side {
		min-width: 0;
	}

	.chapter + .chapter {
		margin-top: var(--space-4);
	}

	.chapter h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--text-sm);
		font-family: var(--font-mono);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.pages,
	.feed {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.pages li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		min-height: 44px;
		padding: var(--space-2) 0;
	}

	.pages li + li,
	.feed li + li {
		border-top: 1px solid var(--border-hairline);
	}

	.page-title {
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}

	.page-meta,
	.fine {
		font-size: var(--text-xs);
		color: var(--text-muted);
		flex: none;
	}

	.add-row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex-wrap: wrap;
		margin-top: var(--space-4);
	}

	.add-row :global(input) {
		flex: 1;
		min-width: 160px;
	}

	.feed li {
		display: flex;
		gap: var(--space-3);
		align-items: baseline;
		padding: var(--space-2) 0;
	}

	.feed-when {
		flex: none;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.feed-body {
		font-size: var(--text-sm);
		min-width: 0;
	}

	.feed-version,
	.feed-who {
		margin-left: var(--space-2);
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.feed-note {
		display: block;
		margin-top: 2px;
		font-size: var(--text-xs);
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}

	.dim {
		color: var(--text-muted);
	}

	.empty {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
