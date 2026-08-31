<script lang="ts">
	import { apiWrite } from '$lib/http';
	import { invalidateAll } from '$app/navigation';
	import { formatDayShort } from '$lib/format';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import Input from '$lib/components/Input.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Select from '$lib/components/Select.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import Textarea from '$lib/components/Textarea.svelte';
	import type { PageData } from './$types';

	/**
	 * One shelf and the books on it.
	 *
	 * Ownership is a record of who looks after this, not a permission system.
	 * The prototype draws role-based access inherited from the shelf; this is a
	 * single-user app behind Cloudflare Access, so a roles table would enforce
	 * nothing and exist only to make the screen look like it enforced something.
	 * The page says so out loud rather than implying otherwise. D162.
	 */

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let errorMessage = $state('');
	let showForm = $state(false);

	let draft = $state({
		title: '',
		description: '',
		owner: '',
		review_cycle_days: '',
		status: 'draft'
	});

	async function createBook(event: SubmitEvent) {
		event.preventDefault();
		if (!draft.title.trim()) {
			errorMessage = 'Give the book a title.';
			return;
		}
		busy = true;
		errorMessage = '';
		const res = await apiWrite(`/api/sops/shelves/${data.shelf.id}/books`, 'POST', {
			...draft,
			review_cycle_days: draft.review_cycle_days || null,
			owner: draft.owner || null,
			description: draft.description || null
		});
		busy = false;
		if (res.ok) {
			draft = { title: '', description: '', owner: '', review_cycle_days: '', status: 'draft' };
			showForm = false;
			await invalidateAll();
		} else {
			errorMessage = res.error ?? 'Could not create that book.';
		}
	}

	const TONE: Record<string, 'open' | 'done' | 'waiting'> = {
		draft: 'open',
		published: 'done',
		archived: 'waiting'
	};

	const cycleLabel = (days: number | null) =>
		days === null ? 'No cycle' : days % 30 === 0 ? `Every ${days / 30} months` : `Every ${days} days`;
</script>

<svelte:head><title>{data.shelf.name} | SOPs</title></svelte:head>

<nav class="crumbs mono" aria-label="Breadcrumb">
	<a href="/sops">SOPs</a> <span aria-hidden="true">/</span>
	<span>{data.shelf.name}</span>
</nav>

<header class="head">
	<div>
		<h1>{data.shelf.name}</h1>
		<p class="sub">
			{data.shelf.book_count}
			{data.shelf.book_count === 1 ? 'book' : 'books'} · {data.shelf.page_count} pages
			{#if data.shelf.owner}· looked after by {data.shelf.owner}{/if}
		</p>
		{#if data.shelf.description}<p class="sub">{data.shelf.description}</p>{/if}
	</div>
	<Button onclick={() => (showForm = true)}>New book</Button>
</header>

{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}

{#if data.books.length === 0}
	<p class="empty">
		No books on this shelf yet. A book is one procedure read start to finish, and its
		chapters are the parts of it.
	</p>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th scope="col">Book</th>
					<th scope="col" class="num">Chapters</th>
					<th scope="col" class="num">Pages</th>
					<th scope="col">Last edited</th>
					<th scope="col">Next review</th>
					<th scope="col">Owner</th>
					<th scope="col">Status</th>
				</tr>
			</thead>
			<tbody>
				{#each data.books as book (book.id)}
					<tr>
						<td>
							<a class="name" href="/sops/books/{book.id}">{book.title}</a>
							{#if book.description}<span class="note">{book.description}</span>{/if}
						</td>
						<td class="num mono">{book.chapter_count}</td>
						<td class="num mono">{book.page_count}</td>
						<td class="mono nowrap">
							{#if book.last_edited_at}
								{formatDayShort(book.last_edited_at.slice(0, 10))}
							{:else}
								<span class="dim">Never</span>
							{/if}
						</td>
						<td class="mono nowrap">
							{#if book.next_review}
								{formatDayShort(book.next_review)}
							{:else}
								<!-- D27: no cycle is not an overdue review, and must not read as one. -->
								<span class="dim">{cycleLabel(book.review_cycle_days)}</span>
							{/if}
						</td>
						<td>{book.owner_shown ?? '-'}</td>
						<td><StatusChip tone={TONE[book.status]} label={book.status} size="sm" /></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<p class="fine">
	Owners are a record of who looks after a shelf or a book. This app has one user and sits
	behind Cloudflare Access, so nothing here grants or withholds permission.
</p>

<Modal bind:open={showForm} title="New book">
	<form class="new" onsubmit={createBook}>
		<label class="field">
			<span>Title</span>
			<Input bind:value={draft.title} placeholder="What the procedure is" maxlength={200} />
		</label>
		<label class="field">
			<span>What it covers</span>
			<Textarea bind:value={draft.description} rows={2} />
		</label>
		<div class="pair">
			<label class="field">
				<span>Looked after by</span>
				<Input bind:value={draft.owner} placeholder="Inherits the shelf owner" maxlength={120} />
			</label>
			<label class="field">
				<span>Review cycle</span>
				<Select bind:value={draft.review_cycle_days}>
					<option value="">No cycle</option>
					<option value="30">Every month</option>
					<option value="90">Every quarter</option>
					<option value="180">Every six months</option>
					<option value="365">Every year</option>
				</Select>
			</label>
		</div>
		<div class="form-actions">
			<Button type="submit" disabled={busy}>Create book</Button>
			<Button variant="secondary" onclick={() => (showForm = false)}>Cancel</Button>
		</div>
	</form>
</Modal>

<style>
	.crumbs {
		font-size: var(--text-xs);
		color: var(--text-muted);
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
		margin: var(--space-2) 0 var(--space-4);
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

	.error {
		margin: 0 0 var(--space-3);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--red-200, #c05b4d);
		border-radius: var(--radius-sm);
		color: var(--red, #8a2f22);
		font-size: var(--text-sm);
	}

	.table-wrap {
		overflow-x: auto;
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		background: var(--surface-card);
	}

	table {
		width: 100%;
		min-width: 820px;
		border-collapse: collapse;
	}

	th,
	td {
		padding: var(--space-3);
		text-align: left;
		vertical-align: top;
		border-bottom: 1px solid var(--border-hairline);
	}

	th {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
		font-weight: 400;
		white-space: nowrap;
	}

	tbody tr:last-child td {
		border-bottom: none;
	}

	.num {
		text-align: right;
	}

	.nowrap {
		white-space: nowrap;
	}

	.name {
		display: block;
		color: var(--text-heading);
		font-size: var(--text-sm);
	}

	.note {
		display: block;
		margin-top: 2px;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.dim {
		color: var(--text-muted);
	}

	.empty,
	.fine {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.fine {
		margin-top: var(--space-3);
		font-size: var(--text-xs);
	}

	.new {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: 0 var(--space-4) var(--space-4);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.field > span {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.pair {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-3);
	}

	@media (min-width: 560px) {
		.pair {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.form-actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
</style>
