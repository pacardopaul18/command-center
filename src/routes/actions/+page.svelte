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
	import { apiWrite } from '$lib/http';
	import { asanaTaskUrl } from '$lib/types';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import Pager from '$lib/components/Pager.svelte';
	import FormField from '$lib/components/FormField.svelte';
	import Input from '$lib/components/Input.svelte';
	import Select from '$lib/components/Select.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import Textarea from '$lib/components/Textarea.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/**
	 * The owner picker's options.
	 *
	 * The roster comes from the server: users, then every owner the data already
	 * names. The value currently on the record is added if it is missing, because
	 * a select that cannot represent what it was given silently rewrites it on
	 * the next save, and losing an owner that way would be invisible.
	 */
	function ownerOptions(current: string | null | undefined): string[] {
		const list = [...data.owners];
		const value = (current ?? '').trim();
		if (value && !list.some((o) => o.toLowerCase() === value.toLowerCase())) list.unshift(value);
		return list;
	}

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');
	let editingId = $state<string | null>(null);

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

	/**
	 * Every write on this screen. Goes through apiWrite, which refuses to call a
	 * response successful unless it actually parsed as JSON. See src/lib/http.ts.
	 */
	async function send(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
		busy = true;
		errorMessage = '';
		try {
			const result = await apiWrite(path, method, body);
			if (!result.ok) {
				errorMessage = result.error ?? 'The request failed.';
				return false;
			}
			await invalidateAll();
			return true;
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

	/**
	 * Pushes one item to Asana. D4: explicit, per item, never automatic.
	 *
	 * A failure is reported and nothing local changes, which is the whole point
	 * of the push being its own endpoint. The item keeps its deadline, its owner
	 * and its status whatever Asana does, and Paul can carry on tracking it here.
	 */
	async function pushToAsana(item: ActionItem) {
		busy = true;
		notice = '';
		errorMessage = '';
		try {
			const res = await fetch(`/api/action-items/${item.id}/asana`, { method: 'POST' });
			const payload = (await res.json().catch(() => ({}))) as {
				error?: string;
				asana?: {
					gid: string;
					url: string;
					url_from_asana: boolean;
					assignee: string;
					project_name: string | null;
				};
			};
			if (!res.ok) {
				errorMessage = payload.error ?? 'Could not push to Asana.';
				return;
			}
			const a = payload.asana;
			// Says where the task landed, because the first production push created
			// one nobody could find. D-asana-1.
			notice = a
				? `Pushed to Asana as task ${a.gid}, assigned to ${a.assignee}` +
					`${a.project_name ? ` in ${a.project_name}` : ', no project'}. ` +
					`Link came from ${a.url_from_asana ? "Asana's own permalink" : 'the gid'}.`
				: 'Pushed to Asana.';
			await invalidateAll();
		} catch {
			errorMessage = 'Could not reach the server. Nothing was pushed and nothing changed here.';
		} finally {
			busy = false;
		}
	}

	/** The tooltip and disabled reason for the push control on a given item. */
	function pushBlockedReason(item: ActionItem): string | null {
		if (item.asana_task_gid) return 'Already in Asana.';
		return data.asana.blocked_because;
	}

	/**
	 * Converts an action item into a ticket.
	 *
	 * The action item is not touched. It is the record that the commitment was
	 * made, and closing or deleting it here would destroy the capture history to
	 * tidy a list. A second conversion is refused by the server, so the button
	 * disappears once one exists rather than relying on the user remembering.
	 */
	async function convert(item: ActionItem) {
		busy = true;
		notice = '';
		errorMessage = '';
		const result = await apiWrite<{ ticket: { id: string; title: string } }>(
			`/api/tickets/convert/${item.id}`,
			'POST',
			{}
		);
		if (!result.ok) {
			errorMessage = result.error ?? 'Could not convert to a ticket.';
		} else {
			notice = `Converted to a ticket. The action item is still here as the record.`;
			await invalidateAll();
		}
		busy = false;
	}

	async function remove(item: ActionItem) {
		if (!confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
		const ok = await send(`/api/action-items/${item.id}`, 'DELETE');
		if (ok) {
			if (editingId === item.id) editingId = null;
			notice = 'Action item deleted.';
		}
	}

	/** Filter tabs and the search box all drive the URL, so views stay linkable. */
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

	/** Deadline tone maps onto the chip vocabulary the design system fixes. */
	function dueTone(tone: string) {
		if (tone === 'overdue') return 'overdue';
		if (tone === 'today' || tone === 'soon') return 'atrisk';
		return 'open';
	}
</script>

<svelte:head>
	<title>Action items | Command Center</title>
</svelte:head>

<header class="head">
	<div>
		<h1>Action items</h1>
		<p class="sub">Every commitment from client calls, tracked to done.</p>
		<p class="today label-mono">Today is {formatDay(data.today)}, Mountain Time</p>
	</div>
	{#if data.counts.overdue > 0}
		<p class="alarm">
			<strong class="mono">{data.counts.overdue}</strong>
			overdue
		</p>
	{/if}
</header>

<p class="status-line" role="status" aria-live="polite">{notice}</p>

{#if errorMessage}
	<p class="error-banner" role="alert">{errorMessage}</p>
{/if}

<div class="capture">
	<Card title="Capture an item">
		<form onsubmit={create}>
			<div class="grid">
				<div class="span-all">
					<FormField label="Title">
						<Input
							bind:value={draft.title}
							placeholder="What has to happen"
							maxlength={300}
							required
						/>
					</FormField>
				</div>
				<FormField label="Owner">
					<Select bind:value={draft.owner}>
						<option value="">Unassigned</option>
						{#each ownerOptions(draft.owner) as name (name)}
							<option value={name}>{name}</option>
						{/each}
					</Select>
				</FormField>
				<FormField label="Deadline">
					<Input type="date" bind:value={draft.deadline} mono />
				</FormField>
				<FormField label="Status">
					<Select bind:value={draft.status}>
						{#each ACTION_STATUSES as value (value)}
							<option {value}>{STATUS_LABELS[value]}</option>
						{/each}
					</Select>
				</FormField>
				<FormField label="Source">
					<Select bind:value={draft.source}>
						{#each ACTION_SOURCES as value (value)}
							<option {value}>{SOURCE_LABELS[value]}</option>
						{/each}
					</Select>
				</FormField>
				<div class="span-all">
					<FormField label="Project">
						<Select bind:value={draft.project_id}>
							<option value="">No project</option>
							{#each data.projects as project (project.id)}
								<option value={project.id}>{project.name}</option>
							{/each}
						</Select>
					</FormField>
				</div>
				<div class="span-all">
					<FormField label="Context" hint="One line of context so the item still makes sense later.">
						<Textarea bind:value={draft.context} placeholder="What this was about" />
					</FormField>
				</div>
			</div>
			<div class="capture-actions">
				<Button type="submit" disabled={busy}>Add item</Button>
			</div>
		</form>
	</Card>
</div>

<nav class="tabs" aria-label="Filter action items">
	{#each ACTION_VIEWS as view (view)}
		<a
			href={urlFor({ view })}
			class="tab"
			class:alarm-tab={view === 'overdue' && data.counts[view] > 0}
			aria-current={data.view === view ? 'page' : undefined}
		>
			{VIEW_LABELS[view]}
			<span class="count mono">{data.counts[view]}</span>
		</a>
	{/each}
</nav>

<form class="filters" onsubmit={applySearch}>
	<FormField label="Search">
		<Input name="q" type="search" value={data.q} placeholder="Title, context or owner" />
	</FormField>
	<FormField label="Project">
		<Select name="project_id" value={data.projectId}>
			<option value="">All projects</option>
			{#each data.projects as project (project.id)}
				<option value={project.id}>{project.name}</option>
			{/each}
		</Select>
	</FormField>
	<Button variant="secondary" type="submit">Apply</Button>
</form>

{#if data.items.length === 0}
	<p class="empty">
		{#if data.view === 'overdue'}
			Nothing is overdue.
		{:else if data.view === 'today'}
			Nothing is due today.
		{:else if data.q || data.projectId}
			No action items match these filters.
		{:else}
			No action items yet. Add one with quick add, or press N.
		{/if}
	</p>
{:else}
	<!-- Desktop: the table from the design's ActionItemsScreen.
	     Below 960px it collapses to the card list, which is the only readable
	     shape at 412px. Both render the same rows and the same actions. -->
	<div class="table-wrap">
		<table>
			<caption class="visually-hidden">
				{VIEW_LABELS[data.view]}, {data.items.length} items
			</caption>
			<thead>
				<tr>
					<th scope="col"><span class="visually-hidden">Done</span></th>
					<th scope="col" class="label-mono grow">Title</th>
					<th scope="col" class="label-mono">Owner</th>
					<th scope="col" class="label-mono">Project</th>
					<th scope="col" class="label-mono">Deadline</th>
					<th scope="col" class="label-mono">Status</th>
					<th scope="col" class="label-mono">Source</th>
					<th scope="col" class="label-mono">Asana</th>
					<th scope="col"><span class="visually-hidden">Actions</span></th>
				</tr>
			</thead>
			<tbody>
				{#each data.items as item (item.id)}
					{@const due = deadlineLabel(item.deadline, data.today, item.status)}
					<tr class:done={item.status === 'done'}>
						<td>
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
						</td>
						<td class="grow">
							<span class="cell-title">{item.title}</span>
							{#if item.context}
								<span class="cell-context">{item.context}</span>
							{/if}
						</td>
						<td class="muted-cell">{item.owner ?? 'None'}</td>
						<td class="muted-cell">
							{#if item.project_name}
								<a href={urlFor({ project_id: item.project_id ?? '', view: 'all' })}>
									{item.project_name}
								</a>
							{:else}
								None
							{/if}
						</td>
						<td class="mono nowrap">
							{#if item.deadline}
								{due.date}
								{#if due.tone === 'overdue' || due.tone === 'today'}
									<span class="due-note tone-{due.tone}">{due.text}</span>
								{/if}
							{:else}
								No deadline
							{/if}
						</td>
						<td>
							<StatusChip
								tone={due.tone === 'overdue' && item.status !== 'done' ? 'overdue' : item.status}
								label={due.tone === 'overdue' && item.status !== 'done'
									? 'Overdue'
									: STATUS_LABELS[item.status]}
							/>
						</td>
						<td class="muted-cell">{SOURCE_LABELS[item.source]}</td>
						<td class="nowrap">
							{#if item.asana_task_gid}
								{#if item.asana_sync_state === 'ambiguous'}
									<span
										class="asana-ambiguous"
										title={item.asana_sync_note ?? 'Asana could not resolve this link.'}
									>
										Needs a look
									</span>
								{/if}
								<a
									class="asana-link"
									href={asanaTaskUrl(item.asana_task_gid)}
									target="_blank"
									rel="noopener noreferrer"
								>
									In Asana<span class="visually-hidden">
										, opens task {item.asana_task_gid} in a new tab</span
									>
								</a>
							{:else}
								<Button
									variant="ghost"
									size="sm"
									disabled={busy || !data.asana.ready}
									title={pushBlockedReason(item) ?? 'Create this as a task in Asana'}
									onclick={() => pushToAsana(item)}
								>
									Push<span class="visually-hidden"> {item.title} to Asana</span>
								</Button>
							{/if}
						</td>
						<td class="right nowrap">
							{#if item.project_id && item.status !== 'done'}
								<Button
									variant="ghost"
									size="sm"
									disabled={busy}
									title="Create a ticket from this item"
									onclick={() => convert(item)}
								>
									To ticket<span class="visually-hidden">: {item.title}</span>
								</Button>
							{/if}
							<Button variant="ghost" size="sm" onclick={() => startEdit(item)}>
								Edit<span class="visually-hidden"> {item.title}</span>
							</Button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<ul class="list">
		{#each data.items as item (item.id)}
			{@const due = deadlineLabel(item.deadline, data.today, item.status)}
			<li class="item" class:done={item.status === 'done'}>
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
							<li>
								<StatusChip
									tone={due.tone === 'overdue' && item.status !== 'done' ? 'overdue' : item.status}
									label={due.tone === 'overdue' && item.status !== 'done'
										? 'Overdue'
										: STATUS_LABELS[item.status]}
									size="sm"
								/>
							</li>
							{#if item.deadline}
								<li>
									<StatusChip tone={dueTone(due.tone)} label={due.text} size="sm" />
								</li>
								<li class="mono meta-date">{due.date}</li>
							{/if}
							{#if item.owner}
								<li class="meta-text">{item.owner}</li>
							{/if}
							{#if item.project_name}
								<li>
									<a href={urlFor({ project_id: item.project_id ?? '', view: 'all' })}>
										{item.project_name}
									</a>
								</li>
							{/if}
							<li class="meta-text">{SOURCE_LABELS[item.source]}</li>
							{#if item.asana_task_gid}
								{#if item.asana_sync_state === 'ambiguous'}
									<span
										class="asana-ambiguous"
										title={item.asana_sync_note ?? 'Asana could not resolve this link.'}
									>
										Needs a look
									</span>
								{/if}
								
								<li>
									<a
										class="asana-link"
										href={asanaTaskUrl(item.asana_task_gid)}
										target="_blank"
										rel="noopener noreferrer"
									>
										In Asana<span class="visually-hidden">
											, opens task {item.asana_task_gid} in a new tab</span
										>
									</a>
								</li>
							{/if}
						</ul>

						{#if !item.asana_task_gid}
							<div class="card-push">
								<Button
									variant="ghost"
									size="sm"
									disabled={busy || !data.asana.ready}
									title={pushBlockedReason(item) ?? 'Create this as a task in Asana'}
									onclick={() => pushToAsana(item)}
								>
									Push to Asana<span class="visually-hidden">: {item.title}</span>
								</Button>
							</div>
						{/if}
					</div>

					<div class="card-actions">
						{#if item.project_id && item.status !== 'done'}
							<Button variant="ghost" size="sm" disabled={busy} onclick={() => convert(item)}>
								To ticket<span class="visually-hidden">: {item.title}</span>
							</Button>
						{/if}
						<Button variant="ghost" size="sm" onclick={() => startEdit(item)}>
							Edit<span class="visually-hidden"> {item.title}</span>
						</Button>
					</div>
				</div>
			</li>
		{/each}
	</ul>

	<Pager paging={data.paging} label="action items" />
{/if}

{#if editingId}
	{@const item = data.items.find((i) => i.id === editingId)}
	{#if item}
		<div class="edit-panel">
			<Card title="Edit action item" subtitle={item.title}>
				<form onsubmit={saveEdit}>
					<div class="grid">
						<div class="span-all">
							<FormField label="Title">
								<Input bind:value={edit.title} maxlength={300} required />
							</FormField>
						</div>
						<FormField label="Owner">
							<Select bind:value={edit.owner}>
								<option value="">Unassigned</option>
								{#each ownerOptions(edit.owner) as name (name)}
									<option value={name}>{name}</option>
								{/each}
							</Select>
						</FormField>
						<FormField label="Deadline">
							<Input type="date" bind:value={edit.deadline} mono />
						</FormField>
						<FormField label="Status">
							<Select bind:value={edit.status}>
								{#each ACTION_STATUSES as value (value)}
									<option {value}>{STATUS_LABELS[value]}</option>
								{/each}
							</Select>
						</FormField>
						<FormField label="Source">
							<Select bind:value={edit.source}>
								{#each ACTION_SOURCES as value (value)}
									<option {value}>{SOURCE_LABELS[value]}</option>
								{/each}
							</Select>
						</FormField>
						<div class="span-all">
							<FormField label="Project">
								<Select bind:value={edit.project_id}>
									<option value="">No project</option>
									{#each data.projects as project (project.id)}
										<option value={project.id}>{project.name}</option>
									{/each}
								</Select>
							</FormField>
						</div>
						<div class="span-all">
							<FormField label="Context">
								<Textarea bind:value={edit.context} />
							</FormField>
						</div>
					</div>
					<div class="edit-actions">
						<Button type="submit" disabled={busy}>Save</Button>
						<Button variant="secondary" onclick={() => (editingId = null)} disabled={busy}>
							Cancel
						</Button>
						<Button variant="danger" onclick={() => remove(item)} disabled={busy}>Delete</Button>
					</div>
				</form>
			</Card>
		</div>
	{/if}
{/if}

<style>
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

	/* Overdue and due today are decided against this date, so it is stated. */
	.today {
		margin-top: var(--space-2);
	}

	.alarm {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--red-200);
		border-radius: var(--radius-sm);
		background: var(--red-100);
		color: var(--red);
		font-size: var(--text-sm);
	}

	.alarm strong {
		font-size: var(--text-md);
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

	.capture,
	.edit-panel {
		margin-top: var(--space-4);
	}

	/* Mobile fallback declared first: one column at 412px. */
	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-3);
	}

	.capture-actions,
	.edit-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}

	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin-top: var(--space-6);
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

	.alarm-tab {
		color: var(--red);
	}

	.alarm-tab[aria-current='page'] {
		color: var(--red);
		border-bottom-color: var(--red);
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

	/* The table is desktop only. */
	.table-wrap {
		display: none;
	}

	.list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: var(--space-4) 0 0;
		padding: 0;
	}

	.item {
		padding: var(--space-3);
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-left: 3px solid var(--gold);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
	}

	.item.done {
		border-left-color: var(--green);
		background: var(--surface-row-alt);
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
		margin: -6px 0 0 -10px;
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
		border: 2px solid var(--border-control);
		border-radius: var(--radius-sm);
		color: var(--surface-card);
		font-size: var(--text-sm);
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
		font-weight: var(--weight-medium);
		overflow-wrap: anywhere;
	}

	.done .title {
		text-decoration: line-through;
		color: var(--text-secondary);
	}

	.context {
		margin-top: var(--space-1);
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}

	.meta {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin: var(--space-3) 0 0;
		padding: 0;
	}

	.meta-text,
	.meta-date {
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	/* D22, content blocks. Form grids go two up here. */
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
	}

	/* D22, shell and tables. The card list gives way to the table only here,
	   because seven columns need the room the sidebar breakpoint implies. */
	@media (min-width: 960px) {
		.list {
			display: none;
		}

		.table-wrap {
			display: block;
			margin-top: var(--space-4);
			padding: var(--space-1) var(--space-2) var(--space-2);
			background: var(--surface-card);
			border: 1px solid var(--border-thin);
			border-radius: var(--radius-md);
			box-shadow: var(--shadow-card);
			overflow-x: auto;
		}

		table {
			width: 100%;
			border-collapse: collapse;
		}

		th {
			padding: var(--space-2) var(--space-3);
			text-align: left;
			font-weight: var(--weight-semibold);
			color: var(--text-body);
			border-bottom: 2px solid var(--border-strong);
			background: var(--surface-row-alt);
		}

		td {
			padding: var(--space-3);
			border-top: 1px solid var(--border-thin);
			vertical-align: top;
			white-space: nowrap;
		}

		td.grow,
		th.grow {
			width: 100%;
			white-space: normal;
		}

		tbody tr:hover {
			background: var(--surface-hover);
		}

		.cell-title {
			display: block;
			font-weight: var(--weight-medium);
			overflow-wrap: anywhere;
		}

		.cell-context {
			display: block;
			margin-top: var(--space-1);
			font-size: var(--text-sm);
			color: var(--text-secondary);
			overflow-wrap: anywhere;
		}

		.muted-cell {
			color: var(--text-secondary);
		}

		.nowrap {
			white-space: nowrap;
		}

		.right {
			text-align: right;
		}

		.due-note {
			display: block;
			margin-top: var(--space-1);
			font-family: var(--font-sans);
			font-size: var(--text-sm);
		}

		.due-note.tone-overdue {
			color: var(--red);
		}

		.due-note.tone-today {
			color: var(--text-warn);
		}

		.done .cell-title {
			text-decoration: line-through;
			color: var(--text-secondary);
		}

		.check {
			margin: -8px 0 0 -8px;
		}
	}

	/* Asana push and link. D4: the link is built from the stored gid. */
	/**
	 * D69's marker, where the item is rather than only in Settings.
	 *
	 * Deliberately not red. Ambiguous is not a failure, it is an accurate
	 * report that the two systems disagree, and the item itself is untouched.
	 * Never colour alone: the words carry the state.
	 */
	.asana-ambiguous {
		display: inline-block;
		font-size: var(--text-xs);
		padding: 1px 6px;
		margin-right: var(--space-2);
		border-radius: 999px;
		border: 1px solid var(--gold);
		color: var(--text-primary);
		white-space: nowrap;
	}

	.asana-link {
		font-size: var(--text-sm);
		color: var(--text-link);
	}

	.card-actions {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.card-push {
		margin-top: var(--space-2);
	}
</style>
