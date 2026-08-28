<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import {
		ACTION_SOURCES,
		ACTION_STATUSES,
		ACTION_VIEWS,
		SOURCE_LABELS,
		STATUS_LABELS,
		VIEW_LABELS
	} from '$lib/types';
	import type { ActionItem, ActionStatus } from '$lib/types';
	import { deadlineLabel, formatDay } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');
	let editingId = $state<string | null>(null);
	let showDetail = $state(false);

	// New item defaults, per the UX principles: status open, deadline today+2.
	function blankDraft() {
		const base = new Date(`${data.today}T00:00:00Z`);
		base.setUTCDate(base.getUTCDate() + 2);
		return {
			title: '',
			context: '',
			owner: '',
			deadline: base.toISOString().slice(0, 10),
			status: 'open' as ActionStatus,
			source: 'manual' as string,
			project_id: ''
		};
	}

	let draft = $state(blankDraft());
	let edit = $state<Record<string, string>>({});

	async function send(path: string, method: string, body?: unknown) {
		busy = true;
		errorMessage = '';
		try {
			const res = await fetch(path, {
				method,
				headers: body ? { 'content-type': 'application/json' } : undefined,
				body: body ? JSON.stringify(body) : undefined
			});
			const payload = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				errorMessage = payload.error ?? 'The request failed.';
				return false;
			}
			await invalidateAll();
			return true;
		} catch {
			errorMessage = 'Could not reach the server.';
			return false;
		} finally {
			busy = false;
		}
	}

	async function create(event: SubmitEvent) {
		event.preventDefault();
		if (!draft.title.trim()) {
			errorMessage = 'Give the item a title.';
			return;
		}
		const ok = await send('/api/action-items', 'POST', { ...draft });
		if (ok) {
			draft = blankDraft();
			showDetail = false;
			notice = 'Action item added.';
		}
	}

	function startEdit(item: ActionItem) {
		editingId = item.id;
		errorMessage = '';
		edit = {
			title: item.title,
			context: item.context ?? '',
			owner: item.owner ?? '',
			deadline: item.deadline ?? '',
			status: item.status,
			source: item.source,
			project_id: item.project_id ?? ''
		};
	}

	async function saveEdit(event: SubmitEvent) {
		event.preventDefault();
		if (!editingId) return;
		const ok = await send(`/api/action-items/${editingId}`, 'PATCH', { ...edit });
		if (ok) {
			editingId = null;
			notice = 'Changes saved.';
		}
	}

	async function toggleDone(item: ActionItem) {
		const next: ActionStatus = item.status === 'done' ? 'open' : 'done';
		const ok = await send(`/api/action-items/${item.id}`, 'PATCH', { status: next });
		if (ok) notice = next === 'done' ? 'Marked done.' : 'Reopened.';
	}

	async function remove(item: ActionItem) {
		if (!confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
		const ok = await send(`/api/action-items/${item.id}`, 'DELETE');
		if (ok) {
			if (editingId === item.id) editingId = null;
			notice = 'Action item deleted.';
		}
	}

	/** Filter chips and the search box all drive the URL, so views are linkable. */
	function urlFor(patch: Record<string, string>) {
		const params = new URLSearchParams(page.url.searchParams);
		for (const [key, value] of Object.entries(patch)) {
			if (value) params.set(key, value);
			else params.delete(key);
		}
		const query = params.toString();
		return query ? `/actions?${query}` : '/actions';
	}

	function applySearch(event: SubmitEvent) {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const values = new FormData(form);
		goto(
			urlFor({
				q: String(values.get('q') ?? ''),
				project_id: String(values.get('project_id') ?? '')
			}),
			{ keepFocus: true }
		);
	}
</script>

<svelte:head>
	<title>Action Items | Command Center</title>
</svelte:head>

<div class="head">
	<div>
		<h1>Action Items</h1>
		<p class="sub">Nothing slips. Today is {formatDay(data.today)}, Mountain Time.</p>
	</div>
	{#if data.counts.overdue > 0}
		<p class="alarm">
			<strong class="mono">{data.counts.overdue}</strong>
			overdue
		</p>
	{/if}
</div>

<p class="status-line" role="status" aria-live="polite">{notice}</p>

{#if errorMessage}
	<p class="error" role="alert">{errorMessage}</p>
{/if}

<section class="card" aria-labelledby="capture-heading">
	<h2 id="capture-heading">Capture an item</h2>
	<form onsubmit={create}>
		<div class="capture-row">
			<div class="grow">
				<label for="new-title">Title</label>
				<input
					id="new-title"
					type="text"
					bind:value={draft.title}
					placeholder="What has to happen"
					maxlength="300"
					required
				/>
			</div>
			<button class="btn" type="submit" disabled={busy}>Add item</button>
		</div>

		<button
			type="button"
			class="btn btn-quiet toggle"
			aria-expanded={showDetail}
			onclick={() => (showDetail = !showDetail)}
		>
			{showDetail ? 'Hide detail' : 'Add owner, deadline, project'}
		</button>

		{#if showDetail}
			<div class="grid">
				<div>
					<label for="new-owner">Owner</label>
					<input id="new-owner" type="text" bind:value={draft.owner} placeholder="Who owns it" />
				</div>
				<div>
					<label for="new-deadline">Deadline</label>
					<input id="new-deadline" type="date" bind:value={draft.deadline} />
				</div>
				<div>
					<label for="new-status">Status</label>
					<select id="new-status" bind:value={draft.status}>
						{#each ACTION_STATUSES as value (value)}
							<option {value}>{STATUS_LABELS[value]}</option>
						{/each}
					</select>
				</div>
				<div>
					<label for="new-source">Source</label>
					<select id="new-source" bind:value={draft.source}>
						{#each ACTION_SOURCES as value (value)}
							<option {value}>{SOURCE_LABELS[value]}</option>
						{/each}
					</select>
				</div>
				<div class="span-2">
					<label for="new-project">Project</label>
					<select id="new-project" bind:value={draft.project_id}>
						<option value="">No project</option>
						{#each data.projects as project (project.id)}
							<option value={project.id}>{project.name}</option>
						{/each}
					</select>
				</div>
				<div class="span-2">
					<label for="new-context">Context</label>
					<textarea
						id="new-context"
						bind:value={draft.context}
						placeholder="One line so future you knows what this was about"
					></textarea>
				</div>
			</div>
		{/if}
	</form>
</section>

<nav class="chips" aria-label="Filter action items">
	{#each ACTION_VIEWS as view (view)}
		<a
			href={urlFor({ view })}
			class="chip"
			class:alarm-chip={view === 'overdue' && data.counts[view] > 0}
			aria-current={data.view === view ? 'page' : undefined}
		>
			{VIEW_LABELS[view]}
			<span class="count mono">{data.counts[view]}</span>
		</a>
	{/each}
</nav>

<form class="filters" onsubmit={applySearch}>
	<div class="grow">
		<label for="filter-q">Search</label>
		<input
			id="filter-q"
			name="q"
			type="search"
			value={data.q}
			placeholder="Title, context or owner"
		/>
	</div>
	<div class="grow">
		<label for="filter-project">Project</label>
		<select id="filter-project" name="project_id" value={data.projectId}>
			<option value="">All projects</option>
			{#each data.projects as project (project.id)}
				<option value={project.id}>{project.name}</option>
			{/each}
		</select>
	</div>
	<button class="btn btn-secondary" type="submit">Apply</button>
</form>

<h2 class="list-heading">
	{VIEW_LABELS[data.view]}
	<span class="muted-text">({data.items.length})</span>
</h2>

{#if data.items.length === 0}
	<p class="empty">
		{#if data.view === 'overdue'}
			Nothing is overdue. That is the point.
		{:else if data.view === 'today'}
			Nothing is due today.
		{:else if data.q || data.projectId}
			No items match these filters.
		{:else}
			No action items yet. Capture the first one above.
		{/if}
	</p>
{:else}
	<ul class="list">
		{#each data.items as item (item.id)}
			{@const due = deadlineLabel(item.deadline, data.today, item.status)}
			<li class="item" class:done={item.status === 'done'}>
				{#if editingId === item.id}
					<form class="edit" onsubmit={saveEdit}>
						<div>
							<label for="edit-title">Title</label>
							<input id="edit-title" type="text" bind:value={edit.title} maxlength="300" required />
						</div>
						<div class="grid">
							<div>
								<label for="edit-owner">Owner</label>
								<input id="edit-owner" type="text" bind:value={edit.owner} />
							</div>
							<div>
								<label for="edit-deadline">Deadline</label>
								<input id="edit-deadline" type="date" bind:value={edit.deadline} />
							</div>
							<div>
								<label for="edit-status">Status</label>
								<select id="edit-status" bind:value={edit.status}>
									{#each ACTION_STATUSES as value (value)}
										<option {value}>{STATUS_LABELS[value]}</option>
									{/each}
								</select>
							</div>
							<div>
								<label for="edit-source">Source</label>
								<select id="edit-source" bind:value={edit.source}>
									{#each ACTION_SOURCES as value (value)}
										<option {value}>{SOURCE_LABELS[value]}</option>
									{/each}
								</select>
							</div>
							<div class="span-2">
								<label for="edit-project">Project</label>
								<select id="edit-project" bind:value={edit.project_id}>
									<option value="">No project</option>
									{#each data.projects as project (project.id)}
										<option value={project.id}>{project.name}</option>
									{/each}
								</select>
							</div>
							<div class="span-2">
								<label for="edit-context">Context</label>
								<textarea id="edit-context" bind:value={edit.context}></textarea>
							</div>
						</div>
						<div class="edit-actions">
							<button class="btn" type="submit" disabled={busy}>Save</button>
							<button
								class="btn btn-secondary"
								type="button"
								onclick={() => (editingId = null)}
								disabled={busy}
							>
								Cancel
							</button>
							<button class="btn btn-danger" type="button" onclick={() => remove(item)} disabled={busy}>
								Delete
							</button>
						</div>
					</form>
				{:else}
					<div class="row">
						<button
							type="button"
							class="check"
							onclick={() => toggleDone(item)}
							disabled={busy}
							aria-pressed={item.status === 'done'}
						>
							<span class="box" aria-hidden="true">{item.status === 'done' ? '✓' : ''}</span>
							<span class="visually-hidden">
								{item.status === 'done' ? 'Reopen' : 'Mark done'}: {item.title}
							</span>
						</button>

						<div class="body">
							<p class="title">{item.title}</p>
							{#if item.context}
								<p class="context">{item.context}</p>
							{/if}

							<ul class="meta">
								<li class="pill tone-{due.tone}">
									{due.text}{#if due.date}<span class="mono meta-date">{due.date}</span>{/if}
								</li>
								<li class="pill state state-{item.status}">{STATUS_LABELS[item.status]}</li>
								{#if item.owner}
									<li class="pill">{item.owner}</li>
								{/if}
								{#if item.project_name}
									<li class="pill">
										<a href={urlFor({ project_id: item.project_id ?? '', view: 'all' })}>
											{item.project_name}
										</a>
									</li>
								{/if}
								<li class="pill quiet">{SOURCE_LABELS[item.source]}</li>
							</ul>
						</div>

						<button class="btn btn-quiet" type="button" onclick={() => startEdit(item)}>
							Edit<span class="visually-hidden"> {item.title}</span>
						</button>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-2);
	}

	.sub {
		color: var(--muted);
		font-size: 0.9375rem;
		margin-top: var(--space-1);
	}

	.alarm {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: #fbeceb;
		color: var(--red);
		border: 1px solid #f0cfcc;
		font-size: 0.875rem;
	}

	.alarm strong {
		font-size: 1.125rem;
	}

	.status-line {
		min-height: 1.25rem;
		margin: var(--space-2) 0 0;
		font-size: 0.875rem;
		color: var(--green);
	}

	.error {
		margin: var(--space-2) 0 0;
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		background: #fbeceb;
		border: 1px solid #f0cfcc;
		color: var(--red);
		font-size: 0.9375rem;
	}

	.card {
		margin-top: var(--space-4);
		padding: var(--space-4);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}

	.card h2 {
		margin-bottom: var(--space-3);
	}

	/* Mobile fallback for every multi column block below: one column at 412px,
	   two columns only from 640px up. */
	.capture-row {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.grow {
		flex: 1;
		min-width: 0;
	}

	.toggle {
		margin-top: var(--space-2);
		padding-inline: 0;
		font-size: 0.875rem;
		text-decoration: underline;
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-3);
		margin-top: var(--space-3);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-5);
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--tap);
		padding: 0 var(--space-3);
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		background: var(--surface);
		color: var(--ink);
		text-decoration: none;
		font-size: 0.9375rem;
	}

	.chip:hover {
		background: var(--cream);
	}

	.chip[aria-current='page'] {
		background: var(--navy);
		border-color: var(--navy);
		color: var(--cream);
		font-weight: 500;
	}

	.chip .count {
		font-size: 0.8125rem;
		color: var(--muted);
	}

	.chip[aria-current='page'] .count {
		color: var(--cream);
	}

	.alarm-chip {
		border-color: var(--red);
	}

	.alarm-chip .count {
		color: var(--red);
		font-weight: 500;
	}

	.alarm-chip[aria-current='page'] {
		background: var(--red);
		border-color: var(--red);
	}

	.alarm-chip[aria-current='page'] .count {
		color: var(--cream);
	}

	.filters {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-top: var(--space-4);
		padding: var(--space-4);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}

	.list-heading {
		margin-top: var(--space-5);
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
	}

	.muted-text {
		color: var(--muted);
		font-weight: 400;
		font-size: 0.9375rem;
	}

	.empty {
		margin-top: var(--space-3);
		padding: var(--space-5) var(--space-4);
		text-align: center;
		color: var(--muted);
		background: var(--surface);
		border: 1px dashed var(--line-strong);
		border-radius: var(--radius);
	}

	.list {
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.item {
		background: var(--surface);
		border: 1px solid var(--line);
		border-left: 3px solid var(--gold);
		border-radius: var(--radius);
		padding: var(--space-3);
	}

	.item.done {
		border-left-color: var(--green);
		background: #fcfbf7;
	}

	.row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
	}

	.check {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--tap);
		height: var(--tap);
		margin: -2px 0 0 -6px;
		background: none;
		border: none;
		cursor: pointer;
	}

	.box {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border: 2px solid var(--line-strong);
		border-radius: var(--radius-sm);
		color: var(--surface);
		font-size: 0.875rem;
		line-height: 1;
	}

	.check:hover .box {
		border-color: var(--navy);
	}

	.done .box {
		background: var(--green);
		border-color: var(--green);
	}

	.body {
		flex: 1;
		min-width: 0;
	}

	.title {
		font-weight: 500;
		overflow-wrap: anywhere;
	}

	.done .title {
		text-decoration: line-through;
		color: var(--muted);
	}

	.context {
		margin-top: var(--space-1);
		font-size: 0.9375rem;
		color: var(--muted);
		overflow-wrap: anywhere;
	}

	.meta {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: var(--space-3) 0 0;
		padding: 0;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: 2px var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--cream);
		border: 1px solid var(--line);
		font-size: 0.8125rem;
		color: var(--ink);
	}

	.pill.quiet {
		background: transparent;
		border-color: transparent;
		color: var(--muted);
	}

	.meta-date {
		color: var(--muted);
		font-size: 0.75rem;
	}

	.tone-overdue {
		background: #fbeceb;
		border-color: #f0cfcc;
		color: var(--red);
		font-weight: 500;
	}

	.tone-overdue .meta-date {
		color: var(--red);
	}

	.tone-today {
		background: #fff6df;
		border-color: var(--gold);
		color: #6b4e00;
		font-weight: 500;
	}

	.tone-today .meta-date {
		color: #6b4e00;
	}

	.tone-none {
		color: var(--muted);
	}

	.state-done {
		background: #e6f2ec;
		border-color: #bcdccc;
		color: var(--green);
	}

	.state-ambiguous,
	.state-blocked {
		background: #fff6df;
		border-color: var(--gold);
		color: #6b4e00;
	}

	.edit {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.edit-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	@media (min-width: 640px) {
		.grid {
			grid-template-columns: 1fr 1fr;
		}
		.span-2 {
			grid-column: 1 / -1;
		}
		.capture-row {
			flex-direction: row;
			align-items: flex-end;
		}
		.filters {
			flex-direction: row;
			align-items: flex-end;
		}
	}
</style>
