<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
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
	import { deadlineLabel, formatDay, formatDayShort, formatMoment } from '$lib/format';
	import { apiWrite } from '$lib/http';
	import { asanaTaskUrl } from '$lib/types';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Pager from '$lib/components/Pager.svelte';
	import FormField from '$lib/components/FormField.svelte';
	import Input from '$lib/components/Input.svelte';
	import Select from '$lib/components/Select.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import Textarea from '$lib/components/Textarea.svelte';
	import type { PageData } from './$types';

	/**
	 * The tracker.
	 *
	 * Five numbers, six tabs, four filters and a table that opens. Everything
	 * that selects a set of rows lives in the URL, so a view is linkable, the
	 * back button works and a reload lands where the reader was. Selection is
	 * the exception and is deliberately local: a link that arrives with rows
	 * pre-selected is a link that can act on somebody else's behalf.
	 *
	 * Three fields the prototype draws are not built. Priority, effort, and who
	 * a waiting item is waiting on are columns on the item and nothing else, and
	 * `action_items` takes no ALTER before Thursday. They are omitted rather
	 * than faked: a Priority column that always says "normal" is worse than no
	 * column, because it looks like data. Migration 0025 adds the trail, which
	 * is a new table and could ship now.
	 */

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

	/**
	 * Which quotes are open.
	 *
	 * A set rather than a single id: reading two proposals side by side is a
	 * normal thing to want when they came out of the same meeting, and an
	 * accordion that closes one to open another makes comparing them a chore.
	 */
	let expanded = $state(new SvelteSet<string>());

	function toggle(key: string) {
		if (expanded.has(key)) expanded.delete(key);
		else expanded.add(key);
	}

	/**
	 * A and R decide the focused row.
	 *
	 * Twenty-seven verdicts by mouse is the actual cost of this queue, and it is
	 * what was delaying them. Bound to the row's own buttons, which are where a
	 * keyboard user already is once they tab into the row. Only bare keys, so a
	 * browser shortcut is never intercepted.
	 */
	function onRowKey(event: KeyboardEvent, proposal: { source: string; id: string }) {
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		const key = event.key.toLowerCase();
		if (key !== 'a' && key !== 'r') return;
		event.preventDefault();
		decide(proposal, key === 'a' ? 'accept' : 'reject');
	}

	/** Which proposal is mid-decision, so only its own buttons disable. */
	let reviewing = $state('');

	/**
	 * Accepts or rejects, through one route that dispatches on the source.
	 *
	 * The reviewer is doing one thing and should not have to know which
	 * extraction produced the row in front of them.
	 */
	async function decide(proposal: { source: string; id: string }, decision: 'accept' | 'reject') {
		reviewing = proposal.id;
		errorMessage = '';
		try {
			const res = await fetch(
				`/api/action-items/proposals/${proposal.source}/${proposal.id}/${decision}`,
				{ method: 'POST' }
			);
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				errorMessage = body.error ?? 'That decision did not go through.';
				return;
			}
			notice = decision === 'accept' ? 'Added to your action items.' : 'Rejected.';
			await invalidateAll();
		} catch {
			errorMessage = 'Could not reach the server.';
		} finally {
			reviewing = '';
		}
	}
	let notice = $state('');
	let errorMessage = $state('');

	// --- The modal, which is both capture and edit -----------------------------

	let modalOpen = $state(false);
	let editingId = $state<string | null>(null);

	/** New item defaults, per the UX principles: status open, deadline today+2. */
	function blankDraft() {
		const base = new Date(`${data.today}T00:00:00Z`);
		base.setUTCDate(base.getUTCDate() + 2);
		return {
			title: '',
			context: '',
			owner: '',
			deadline: base.toISOString().slice(0, 10),
			status: 'open' as string,
			source: 'manual' as string,
			project_id: ''
		};
	}

	let draft = $state(blankDraft());

	function openCapture() {
		editingId = null;
		draft = blankDraft();
		errorMessage = '';
		modalOpen = true;
	}

	function openEdit(item: ActionItem) {
		editingId = item.id;
		errorMessage = '';
		draft = {
			title: item.title,
			context: item.context ?? '',
			owner: item.owner ?? '',
			deadline: item.deadline ?? '',
			status: item.status,
			source: item.source,
			project_id: item.project_id ?? ''
		};
		modalOpen = true;
	}

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

	async function saveModal(event: SubmitEvent) {
		event.preventDefault();
		if (!draft.title.trim()) {
			errorMessage = 'Give the item a title.';
			return;
		}
		const ok = editingId
			? await send(`/api/action-items/${editingId}`, 'PATCH', { ...draft })
			: await send('/api/action-items', 'POST', { ...draft });
		if (ok) {
			notice = editingId ? 'Changes saved.' : 'Action item added.';
			// The trail just gained a line, so a row left open is stale.
			if (editingId && expandedId === editingId) await loadTrail(editingId, true);
			modalOpen = false;
			editingId = null;
			draft = blankDraft();
		}
	}

	// --- Row actions -----------------------------------------------------------

	async function setStatus(item: ActionItem, next: ActionStatus, said: string) {
		const ok = await send(`/api/action-items/${item.id}`, 'PATCH', { status: next });
		if (ok) {
			notice = said;
			if (expandedId === item.id) await loadTrail(item.id, true);
		}
	}

	/** Pushes a deadline out by a week from wherever it is now, or from today. */
	async function pushWeek(item: ActionItem) {
		const from = item.deadline ?? data.today;
		const date = new Date(`${from}T00:00:00Z`);
		date.setUTCDate(date.getUTCDate() + 7);
		const next = date.toISOString().slice(0, 10);
		const ok = await send(`/api/action-items/${item.id}`, 'PATCH', { deadline: next });
		if (ok) {
			notice = `Deadline moved to ${formatDay(next)}.`;
			if (expandedId === item.id) await loadTrail(item.id, true);
		}
	}

	async function remove(item: ActionItem) {
		if (!confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
		const ok = await send(`/api/action-items/${item.id}`, 'DELETE');
		if (ok) {
			if (editingId === item.id) editingId = null;
			if (expandedId === item.id) expandedId = null;
			notice = 'Action item deleted.';
		}
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
			const result = await apiWrite<{
				asana?: {
					gid: string;
					url: string;
					url_from_asana: boolean;
					assignee: string;
					project_name: string | null;
				};
			}>(`/api/action-items/${item.id}/asana`, 'POST');
			if (!result.ok) {
				errorMessage = result.error ?? 'Could not push to Asana.';
				return;
			}
			const a = result.data?.asana;
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
			notice = 'Converted to a ticket. The action item is still here as the record.';
			await invalidateAll();
			if (expandedId === item.id) await loadTrail(item.id, true);
		}
		busy = false;
	}

	// --- The trail -------------------------------------------------------------

	interface TrailEvent {
		id: string;
		occurred_at: string;
		kind: string;
		detail: string;
	}

	let expandedId = $state<string | null>(null);
	let trails = $state<Record<string, TrailEvent[]>>({});
	let trailError = $state('');

	/**
	 * Fetched when a row opens rather than shipped with the list.
	 *
	 * A page of 50 items carries a few hundred events nobody has asked to see.
	 * One request per opened row, cached, is the honest trade, and the same one
	 * the billing periods make.
	 */
	async function loadTrail(id: string, force = false) {
		if (trails[id] && !force) return;
		trailError = '';
		try {
			const res = await fetch(`/api/action-items/${id}/events`);
			const payload = (await res.json().catch(() => null)) as
				| { events?: TrailEvent[]; error?: string }
				| null;
			if (!res.ok || !payload) {
				trailError = payload?.error ?? 'Could not load the trail.';
				return;
			}
			trails[id] = payload.events ?? [];
		} catch {
			trailError = 'Could not reach the server.';
		}
	}

	async function toggleRow(item: ActionItem) {
		if (expandedId === item.id) {
			expandedId = null;
			return;
		}
		expandedId = item.id;
		await loadTrail(item.id);
	}

	// --- Selection and bulk ----------------------------------------------------

	let selected = $state<Record<string, boolean>>({});
	const selectedIds = $derived(Object.keys(selected).filter((id) => selected[id]));
	const allOnPageSelected = $derived(
		data.items.length > 0 && data.items.every((i) => selected[i.id])
	);

	function toggleAll() {
		const next = { ...selected };
		if (allOnPageSelected) for (const item of data.items) delete next[item.id];
		else for (const item of data.items) next[item.id] = true;
		selected = next;
	}

	/**
	 * One request for the whole selection.
	 *
	 * Fifty PATCHes from the browser can half succeed with nothing saying which
	 * half, and the half that failed is invisible until somebody notices an item
	 * still open. The route applies one patch to every id and names what it
	 * could not find.
	 */
	async function bulk(patch: Record<string, unknown>, said: string) {
		if (selectedIds.length === 0) return;
		busy = true;
		errorMessage = '';
		const result = await apiWrite<{ changed: number; missing: string[] }>(
			'/api/action-items/bulk',
			'POST',
			{ ids: selectedIds, ...patch }
		);
		if (!result.ok) {
			errorMessage = result.error ?? 'The bulk change failed.';
		} else {
			const missing = result.data?.missing?.length ?? 0;
			notice =
				`${said} ${result.data?.changed ?? 0} items.` +
				(missing > 0 ? ` ${missing} were not found and were left alone.` : '');
			selected = {};
			trails = {};
			await invalidateAll();
		}
		busy = false;
	}

	function bulkPushWeek() {
		const date = new Date(`${data.today}T00:00:00Z`);
		date.setUTCDate(date.getUTCDate() + 7);
		return bulk({ deadline: date.toISOString().slice(0, 10) }, 'Deadline moved a week on');
	}

	// --- URL state -------------------------------------------------------------

	/** Filter tabs, pickers and the search box all drive the URL. */
	function urlFor(patch: Record<string, string>) {
		const params = new URLSearchParams(page.url.searchParams);
		for (const [key, value] of Object.entries(patch)) {
			if (value) params.set(key, value);
			else params.delete(key);
		}
		// Any change to what is being listed starts at page one. Staying on page
		// four of a different list is a blank screen that reads as "no results".
		if (!('page' in patch)) params.delete('page');
		const query = params.toString();
		return query ? `/actions?${query}` : '/actions';
	}

	function go(patch: Record<string, string>) {
		selected = {};
		goto(urlFor(patch), { keepFocus: true, noScroll: true });
	}

	function applySearch(event: SubmitEvent) {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		go({ q: String(new FormData(form).get('q') ?? '') });
	}

	/** Deadline tone maps onto the chip vocabulary the design system fixes. */
	function dueTone(tone: string) {
		if (tone === 'overdue') return 'overdue';
		if (tone === 'today' || tone === 'soon') return 'atrisk';
		return 'open';
	}

	const tiles = $derived([
		{ label: 'Open', value: data.counts.open, sub: 'everything not done', view: 'open' },
		{ label: 'Overdue', value: data.counts.overdue, sub: 'past the deadline', view: 'overdue' },
		{ label: 'Due today', value: data.counts.today, sub: formatDay(data.today), view: 'today' },
		{
			label: 'Waiting on',
			value: data.counts.waiting,
			sub: 'someone else has it',
			view: 'waiting'
		},
		{
			label: 'Done this week',
			value: data.counts.done_week,
			sub: 'nice and boring',
			view: 'done'
		}
	]);

	const SORTS: [string, string][] = [
		['deadline', 'Deadline, soonest'],
		['owner', 'Owner'],
		['updated', 'Recently changed']
	];
</script>

<svelte:head>
	<title>Action items | Command Center</title>
</svelte:head>

<header class="head">
	<div>
		<h1>Action items</h1>
		<p class="sub">
			Every commitment from client calls, tracked to done. Today is {formatDay(data.today)},
			Mountain Time.
		</p>
	</div>
	<Button onclick={openCapture}>Capture an item</Button>
</header>

<p class="status-line" role="status" aria-live="polite">{notice}</p>
{#if errorMessage}<p class="error-banner" role="alert">{errorMessage}</p>{/if}

<!--
	The queue comes first, above the summary tiles.

	A page is ordered by what the reader came to do. Twenty-seven decisions were
	waiting below five tiles reading zero and a filter row reading zero, so the
	first screen carried no content at all and the headline number on a page
	about pending decisions was a column of noughts.
-->
{#if data.proposals.counts.pending > 0}
	<Card
		title="Waiting for your decision"
		subtitle="{data.proposals.counts.pending} extracted from mail and meetings"
	>
		<p class="queue-note">
			Read out of a message or a transcript by a model. Nothing here is an action item
			until you accept it. Press <kbd>A</kbd> or <kbd>R</kbd> on a focused row, or use the
			buttons.
		</p>

		<ul class="queue">
			{#each data.proposals.proposals as proposal (proposal.source + proposal.id)}
				{@const open = expanded.has(proposal.source + proposal.id)}
				<!--
					A row, not a card.

					Twenty-seven decisions at a quarter of a viewport each is a
					scrolling exercise, and the cost of the interface was what was
					actually delaying the verdicts. Everything needed to decide is on
					one line and both verdicts are reachable without opening anything.
				-->
				<li class="proposal">
					<div class="row-main">
						<!--
							Title and context share a line, because at a desktop width
							there is 1,500px of it and stacking three blocks vertically
							wastes the room that makes the queue scannable.
						-->
						<div class="row-top">
							<span class="proposal-title">{proposal.title}</span>

						<!--
							One line of the quote stays visible, and that is deliberate.
							Deciding whether Paul really promised something needs the
							sentence in front of him; making him open something first is
							how a queue gets cleared by accepting everything. Compressed
							to a line rather than hidden, with the rest on expansion.
						-->
							<div class="proposal-meta mono">
								<span>{proposal.source === 'mail' ? 'Email' : 'Meeting'}</span>
								{#if proposal.owner}<span>{proposal.owner}</span>{/if}
								{#if proposal.deadline}
									<span>due {proposal.deadline}</span>
								{:else if proposal.due_signal}
									<!--
										The words the message used, not a date nobody stated. An
										inferred deadline becomes fact the moment somebody accepts.
									-->
									<span class="signal">said "{proposal.due_signal}", no date</span>
								{/if}
								<!--
									Where it came from and what it is about are context rather
									than decision inputs, so they drop off a phone and return
									on expansion. Who owes it and when are never dropped.
								-->
								<span class="wide-only">
									{#if proposal.origin}{proposal.origin}{/if}
								</span>
								<span class="wide-only">
									{#if proposal.client_name}{proposal.client_name}{/if}
									{#if proposal.project_name}{proposal.project_name}{/if}
								</span>
							</div>
						</div>

						{#if proposal.evidence}
							<blockquote class="evidence" class:full={open}>{proposal.evidence}</blockquote>
						{/if}
					</div>

					<div class="row-actions">
						{#if proposal.evidence}
							<button
								type="button"
								class="expand"
								aria-expanded={open}
								onclick={() => toggle(proposal.source + proposal.id)}
							>
								{open ? 'Less' : 'More'}
							</button>
						{/if}
						<!--
							The shortcut lives on the buttons rather than on the row.

							A list item is not an interactive element and giving it a tab
							stop and key handlers is the wrong shape for a screen reader.
							Tab already lands on Accept, which is where a keyboard user
							is, so A and R work from there and Enter still does the
							obvious thing.
						-->
						<button
							type="button"
							class="verdict accept"
							disabled={reviewing === proposal.id}
							onkeydown={(e) => onRowKey(e, proposal)}
							onclick={() => decide(proposal, 'accept')}
						>
							{reviewing === proposal.id ? '...' : 'Accept'}
						</button>
						<button
							type="button"
							class="verdict reject"
							disabled={reviewing === proposal.id}
							onkeydown={(e) => onRowKey(e, proposal)}
							onclick={() => decide(proposal, 'reject')}
						>
							Reject
						</button>
					</div>
				</li>
			{/each}
		</ul>
	</Card>
{/if}

<div class="tiles">
	{#each tiles as tile (tile.label)}
		<a
			class="tile"
			class:current={data.view === tile.view}
			class:alarm={tile.label === 'Overdue' && tile.value > 0}
			href={urlFor({ view: tile.view })}
		>
			<span class="tile-value mono">{tile.value}</span>
			<span class="tile-label">{tile.label}</span>
			<span class="tile-sub mono">{tile.sub}</span>
		</a>
	{/each}
</div>

<nav class="tabs" aria-label="Views">
	{#each ACTION_VIEWS as view (view)}
		<a class="tab" class:current={data.view === view} href={urlFor({ view })}>
			{VIEW_LABELS[view]}
			<span class="tab-count mono">{data.counts[view]}</span>
		</a>
	{/each}
</nav>

<div class="filters">
	<form class="search" onsubmit={applySearch}>
		<label class="visually-hidden" for="q">Search</label>
		<Input id="q" name="q" value={data.q} placeholder="Search title, context or owner" />
		<Button type="submit" variant="secondary">Search</Button>
	</form>

	<label class="visually-hidden" for="project-filter">Project</label>
	<Select
		id="project-filter"
		value={data.projectId}
		onchange={(e) => go({ project_id: (e.currentTarget as HTMLSelectElement).value })}
	>
		<option value="">All projects</option>
		{#each data.projects as project (project.id)}
			<option value={project.id}>{project.name}</option>
		{/each}
	</Select>

	<label class="visually-hidden" for="owner-filter">Owner</label>
	<Select
		id="owner-filter"
		value={data.owner}
		onchange={(e) => go({ owner: (e.currentTarget as HTMLSelectElement).value })}
	>
		<option value="">Everyone</option>
		<option value="unassigned">Unassigned</option>
		{#each data.owners as owner (owner)}
			<option value={owner}>{owner}</option>
		{/each}
	</Select>

	<label class="visually-hidden" for="sort">Sort</label>
	<Select
		id="sort"
		value={data.sort}
		onchange={(e) => go({ sort: (e.currentTarget as HTMLSelectElement).value })}
	>
		{#each SORTS as [value, label] (value)}
			<option {value}>{label}</option>
		{/each}
	</Select>
</div>

{#if selectedIds.length > 0}
	<div class="bulk" role="group" aria-label="Bulk actions">
		<span class="bulk-count mono">{selectedIds.length} selected</span>
		<Button
			variant="secondary"
			size="sm"
			disabled={busy}
			onclick={() => bulk({ status: 'done' }, 'Marked done on')}
		>
			Mark done
		</Button>
		<Button
			variant="ghost"
			size="sm"
			disabled={busy}
			onclick={() => bulk({ status: 'waiting' }, 'Moved to waiting on')}
		>
			Move to waiting
		</Button>
		<Button variant="ghost" size="sm" disabled={busy} onclick={bulkPushWeek}>
			Push a week
		</Button>
		<Button
			variant="ghost"
			size="sm"
			disabled={busy}
			onclick={() => bulk({ owner: '' }, 'Owner cleared on')}
		>
			Clear owner
		</Button>
		<Button variant="ghost" size="sm" onclick={() => (selected = {})}>Clear selection</Button>
	</div>
{/if}

<!--
	The review queue, on the page the reviewing is for.

	Evidence is shown at the point of decision, not behind a click. A reviewer
	deciding whether Paul really promised something needs the sentence in front
	of them; making them open something first is how a queue gets cleared by
	accepting everything.
-->
{#if data.items.length === 0}
	<!--
		An empty screen has to say which kind of empty it is.

		"Nothing here" reads as "you have nothing outstanding", which is a
		reassuring thing to tell somebody whose commitments have simply never
		been loaded. When the table holds nothing at all, say that instead, and
		say what would fill it. Asana's comments were deliberately not projected
		into this screen: ten thousand of them are not ten thousand commitments,
		and burying this list under them would make it useless. D138 on a screen
		rather than in a payload.
	-->
	{#if data.counts.all === 0}
		<div class="empty-state">
			<p class="empty">No action items exist yet.</p>
			<p class="empty-why">
				This screen holds what you owe people and what you are waiting on. Nothing has
				been captured into it: mirrored Asana comments are an activity trail on their
				ticket, not commitments, so they are deliberately not here. Items arrive when a
				meeting is summarised, or when you add one with Quick add.
			</p>
		</div>
	{:else}
		<p class="empty">Nothing here. Clear the search or pick another tab.</p>
	{/if}
{:else}
	<!-- D22: the table appears at 960px. Below that the same rows render as
	     cards, which is the only readable shape at 412px. -->
	<div class="table-wrap">
		<table>
			<caption class="visually-hidden">
				{VIEW_LABELS[data.view]}, {data.items.length} items
			</caption>
			<thead>
				<tr>
					<th scope="col" class="tick">
						<label class="visually-hidden" for="select-all">Select every row on this page</label>
						<input
							id="select-all"
							type="checkbox"
							checked={allOnPageSelected}
							onchange={toggleAll}
						/>
					</th>
					<th scope="col" class="label-mono grow">Item</th>
					<th scope="col" class="label-mono">Owner</th>
					<th scope="col" class="label-mono">Project</th>
					<th scope="col" class="label-mono">Deadline</th>
					<th scope="col" class="label-mono">Source</th>
					<th scope="col" class="label-mono">Status</th>
				</tr>
			</thead>
			<tbody>
				{#each data.items as item (item.id)}
					{@const due = deadlineLabel(item.deadline, data.today, item.status)}
					<tr class:done={item.status === 'done'} class:open={expandedId === item.id}>
						<td class="tick">
							<label class="visually-hidden" for="pick-{item.id}">Select {item.title}</label>
							<input
								id="pick-{item.id}"
								type="checkbox"
								checked={selected[item.id] ?? false}
								onchange={(e) => {
									const next = { ...selected };
									if ((e.currentTarget as HTMLInputElement).checked) next[item.id] = true;
									else delete next[item.id];
									selected = next;
								}}
							/>
						</td>
						<td class="grow">
							<button
								type="button"
								class="row-open"
								aria-expanded={expandedId === item.id}
								onclick={() => toggleRow(item)}
							>
								{item.title}
							</button>
							{#if item.context}
								<span class="cell-context">{item.context}</span>
							{/if}
						</td>
						<td class="muted-cell">{item.owner ?? 'Unassigned'}</td>
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
						<td class="muted-cell">{SOURCE_LABELS[item.source]}</td>
						<td>
							<StatusChip
								tone={due.tone === 'overdue' && item.status !== 'done' ? 'overdue' : item.status}
								label={due.tone === 'overdue' && item.status !== 'done'
									? 'Overdue'
									: STATUS_LABELS[item.status]}
								size="sm"
							/>
						</td>
					</tr>
					{#if expandedId === item.id}
						<tr class="expanded">
							<td colspan="7">
								<div class="row-actions">
									{#if item.status !== 'done'}
										<Button
											variant="secondary"
											size="sm"
											disabled={busy}
											onclick={() => setStatus(item, 'done', 'Marked done.')}
										>
											Mark done
										</Button>
									{:else}
										<Button
											variant="secondary"
											size="sm"
											disabled={busy}
											onclick={() => setStatus(item, 'open', 'Reopened.')}
										>
											Reopen
										</Button>
									{/if}
									{#if item.status !== 'done'}
										<Button variant="ghost" size="sm" disabled={busy} onclick={() => pushWeek(item)}>
											Push a week
										</Button>
									{/if}
									{#if item.status !== 'waiting' && item.status !== 'done'}
										<Button
											variant="ghost"
											size="sm"
											disabled={busy}
											onclick={() => setStatus(item, 'waiting', 'Moved to waiting.')}
										>
											Move to waiting
										</Button>
									{/if}
									{#if item.project_id && item.status !== 'done'}
										<Button
											variant="ghost"
											size="sm"
											disabled={busy}
											title="Create a ticket from this item"
											onclick={() => convert(item)}
										>
											To ticket
										</Button>
									{/if}
									{#if item.asana_task_gid}
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
										{#if item.asana_sync_state === 'ambiguous'}
											<span
												class="asana-ambiguous"
												title={item.asana_sync_note ?? 'Asana could not resolve this link.'}
											>
												Needs a look
											</span>
										{/if}
									{:else}
										<Button
											variant="ghost"
											size="sm"
											disabled={busy || !data.asana.ready}
											title={pushBlockedReason(item) ?? 'Create this as a task in Asana'}
											onclick={() => pushToAsana(item)}
										>
											Push to Asana
										</Button>
									{/if}
									<Button variant="ghost" size="sm" onclick={() => openEdit(item)}>Edit</Button>
									<Button variant="ghost" size="sm" disabled={busy} onclick={() => remove(item)}>
										Delete
									</Button>
								</div>

								{#if item.context}
									<p class="context">{item.context}</p>
								{/if}

								<p class="label-mono section-label">Trail</p>
								{#if trailError}
									<p class="note error" role="alert">{trailError}</p>
								{:else if (trails[item.id] ?? []).length === 0}
									<p class="note">Nothing recorded yet.</p>
								{:else}
									<ul class="trail">
										{#each trails[item.id] as event (event.id)}
											<li>
												<span class="mono t-when">{formatMoment(event.occurred_at)}</span>
												<span class="t-kind label-mono">{event.kind}</span>
												<span class="t-what">{event.detail}</span>
											</li>
										{/each}
									</ul>
								{/if}
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
	</div>

	<ul class="cards">
		{#each data.items as item (item.id)}
			{@const due = deadlineLabel(item.deadline, data.today, item.status)}
			<li class="card-row" class:flag={due.tone === 'overdue' && item.status !== 'done'}>
				<div class="card-head">
					<label class="pick">
						<input
							type="checkbox"
							checked={selected[item.id] ?? false}
							onchange={(e) => {
								const next = { ...selected };
								if ((e.currentTarget as HTMLInputElement).checked) next[item.id] = true;
								else delete next[item.id];
								selected = next;
							}}
						/>
						<span class="visually-hidden">Select {item.title}</span>
					</label>
					<button
						type="button"
						class="row-open"
						aria-expanded={expandedId === item.id}
						onclick={() => toggleRow(item)}
					>
						{item.title}
					</button>
					<StatusChip
						tone={due.tone === 'overdue' && item.status !== 'done' ? 'overdue' : item.status}
						label={due.tone === 'overdue' && item.status !== 'done'
							? 'Overdue'
							: STATUS_LABELS[item.status]}
						size="sm"
					/>
				</div>
				<p class="card-meta mono">
					{item.deadline ? due.date : 'No deadline'}
					<span class="sep">·</span>{item.owner ?? 'Unassigned'}
					{#if item.project_name}<span class="sep">·</span>{item.project_name}{/if}
				</p>
				{#if expandedId === item.id}
					<div class="row-actions">
						{#if item.status !== 'done'}
							<Button
								variant="secondary"
								size="sm"
								disabled={busy}
								onclick={() => setStatus(item, 'done', 'Marked done.')}
							>
								Mark done
							</Button>
							<Button variant="ghost" size="sm" disabled={busy} onclick={() => pushWeek(item)}>
								Push a week
							</Button>
						{:else}
							<Button
								variant="secondary"
								size="sm"
								disabled={busy}
								onclick={() => setStatus(item, 'open', 'Reopened.')}
							>
								Reopen
							</Button>
						{/if}
						<Button variant="ghost" size="sm" onclick={() => openEdit(item)}>Edit</Button>
					</div>
					{#if (trails[item.id] ?? []).length > 0}
						<ul class="trail">
							{#each trails[item.id] as event (event.id)}
								<li>
									<span class="mono t-when">{formatDayShort(event.occurred_at.slice(0, 10))}</span>
									<span class="t-what">{event.detail}</span>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>

	<Pager paging={data.paging} label="action items" />
{/if}

<Modal bind:open={modalOpen} title={editingId ? 'Edit action item' : 'Capture an item'}>
	<form class="modal-form" onsubmit={saveModal}>
		<FormField label="What has to happen">
			<Input bind:value={draft.title} maxlength={300} required />
		</FormField>

		<div class="grid">
			<FormField label="Owner">
				<Select bind:value={draft.owner}>
					<option value="">Unassigned</option>
					{#each ownerOptions(draft.owner) as owner (owner)}
						<option value={owner}>{owner}</option>
					{/each}
				</Select>
			</FormField>
			<FormField label="Deadline">
				<Input type="date" bind:value={draft.deadline} mono />
			</FormField>
			<FormField label="Status">
				<Select bind:value={draft.status}>
					{#each ACTION_STATUSES as status (status)}
						<option value={status}>{STATUS_LABELS[status]}</option>
					{/each}
				</Select>
			</FormField>
			<FormField label="Source">
				<Select bind:value={draft.source}>
					{#each ACTION_SOURCES as source (source)}
						<option value={source}>{SOURCE_LABELS[source]}</option>
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
				<FormField label="Context" hint="Why it matters, or what was said">
					<Textarea bind:value={draft.context} rows={3} maxlength={4000} />
				</FormField>
			</div>
		</div>

		<div class="modal-actions">
			<Button type="submit" disabled={busy}>{editingId ? 'Save changes' : 'Add item'}</Button>
			<Button variant="ghost" onclick={() => (modalOpen = false)}>Cancel</Button>
		</div>
	</form>
</Modal>

<style>
	/* --- The proposal queue, as rows ------------------------------------- */

	.queue {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.proposal {
		display: flex;
		gap: var(--space-3);
		align-items: center;
		justify-content: space-between;
		/* Explicit px, not a spacing token: the scale starts at 16px and a queue
		   row is the one place in the app that wants tighter than the scale. */
		padding: 6px 0;
		border-bottom: 1px solid var(--border-thin);
	}

	/* Title and context on one line, the quote under it. Two rows, not three. */
	.row-top {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-3);
	}

	.proposal:last-child {
		border-bottom: 0;
	}

	.row-main {
		min-width: 0;
		flex: 1;
	}

	.proposal-title {
		font-weight: 600;
		line-height: 1.3;
	}

	/*
	 * One line of the quote, expandable.
	 *
	 * Visible rather than hidden, because deciding whether Paul really promised
	 * something needs the sentence in front of him and opening a thing first is
	 * how a queue gets cleared by accepting everything. Clamped rather than
	 * truncated with a width, so it reflows at 412px instead of cutting mid-word
	 * at a fixed column.
	 */
	/* Specific enough to beat the global blockquote margin, which is set for
	   prose and is 12px of dead space on a one-line quote in a queue row. */
	.proposal .evidence {
		margin: 2px 0 0;
		padding-left: var(--space-2);
		border-left: 2px solid var(--border-thin);
		color: var(--text-secondary);
		font-size: var(--text-sm);
		display: -webkit-box;
		-webkit-line-clamp: 1;
		line-clamp: 1;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.evidence.full {
		-webkit-line-clamp: unset;
		line-clamp: unset;
		overflow: visible;
	}

	.proposal-meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		font-size: 0.6875rem;
		color: var(--text-secondary);
	}

	.proposal-meta span:empty {
		display: none;
	}

	.proposal-meta .signal {
		color: var(--ink);
	}

	.row-actions {
		display: flex;
		gap: var(--space-1);
		align-items: center;
		flex-shrink: 0;
	}

	/* D22: 44px tap floor on every verdict, at both widths. */
	.verdict,
	.expand {
		min-height: var(--tap);
		padding: 0 var(--space-3);
		border: 1px solid var(--border-control);
		border-radius: var(--radius-sm);
		background: var(--surface-card);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		cursor: pointer;
	}

	.expand {
		border-color: transparent;
		color: var(--text-secondary);
		padding: 0 var(--space-2);
	}

	.verdict.accept {
		border-color: var(--navy);
		color: var(--navy);
		font-weight: 600;
	}

	.verdict:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.verdict:focus-visible,
	.expand:focus-visible {
		outline: 2px solid var(--navy);
		outline-offset: 1px;
	}

	kbd {
		font-family: var(--font-mono, monospace);
		font-size: 0.75em;
		padding: 1px 4px;
		border: 1px solid var(--border-thin);
		border-radius: 3px;
	}

	/*
	 * At a phone width the verdicts move under the text rather than squeezing
	 * the title into a column two words wide. D22: Paul reads this at 412.
	 */
	@media (max-width: 560px) {
		.proposal {
			flex-direction: column;
			align-items: stretch;
			gap: var(--space-2);
		}

		/* Context drops off a phone; owner and deadline never do. */
		.wide-only {
			display: none;
		}

		.row-actions {
			width: 100%;
		}

		.verdict {
			flex: 1;
		}
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
		font-size: var(--text-sm);
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

	.tiles {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-2);
		margin-top: var(--space-4);
	}

	.tile {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		padding: var(--space-3) var(--space-4);
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-left: 3px solid var(--border-strong);
		border-radius: var(--radius-md);
		color: inherit;
		text-decoration: none;
	}

	.tile:hover {
		background: var(--surface-hover);
	}

	.tile.current {
		border-left-color: var(--navy);
		background: var(--navy-50);
	}

	.tile.alarm {
		border-left-color: var(--gold);
	}

	.tile-value {
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
	}

	.tile-label {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.tile-sub {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin-top: var(--space-4);
		padding: var(--space-1);
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
	}

	.tab {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--tap);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--text-body);
		text-decoration: none;
		white-space: nowrap;
	}

	.tab:hover {
		background: var(--navy-50);
	}

	.tab.current {
		background: var(--navy);
		color: var(--text-inverse);
	}

	.tab-count {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.tab.current .tab-count {
		color: var(--text-inverse-muted);
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}

	.search {
		display: flex;
		flex: 1 1 280px;
		gap: var(--space-2);
	}

	/**
	 * The three pickers sit beside the search box rather than under it.
	 *
	 * A Select renders its own element straight into this flex container, so it
	 * has no basis of its own and claimed a full row each. Found by rendering
	 * it, D128.
	 */
	.filters :global(select.control) {
		flex: 0 1 220px;
	}

	.bulk {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-3);
		padding: var(--space-2) var(--space-3);
		background: var(--navy-50);
		border: 1px solid var(--navy-100);
		border-radius: var(--radius-md);
	}

	.bulk-count {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
	}

	.queue-note {
		margin: 0 0 var(--space-4);
		color: var(--text-secondary);
		font-size: 0.875rem;
		max-width: 70ch;
	}

	.queue {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-4);
	}

	.proposal {
		padding: var(--space-4);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-2);
		background: var(--surface-card);
	}

	.proposal-head {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-3);
		align-items: baseline;
		justify-content: space-between;
	}

	.proposal-title {
		font-weight: 600;
	}

	.proposal-from {
		color: var(--text-secondary);
		font-size: 0.8125rem;
	}

	/* The sentence it was read from, quoted so it reads as somebody else's words. */
	.evidence {
		margin: var(--space-3) 0;
		padding-left: var(--space-3);
		border-left: 3px solid var(--border-strong);
		color: var(--text-secondary);
		font-size: 0.9375rem;
		line-height: 1.6;
	}

	.proposal-meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		color: var(--text-secondary);
		font-size: 0.8125rem;
		margin-bottom: var(--space-3);
	}

	.proposal-meta .signal {
		font-style: italic;
	}

	.proposal-actions {
		display: flex;
		gap: var(--space-2);
	}

	.empty-state {
		display: grid;
		gap: var(--space-2);
		max-width: 66ch;
	}

	.empty-why {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.9375rem;
		line-height: 1.6;
	}

	.empty {
		margin-top: var(--space-4);
		padding: var(--space-5) var(--space-4);
		text-align: center;
		color: var(--text-secondary);
		background: var(--surface-card);
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-md);
	}

	.table-wrap {
		display: none;
	}

	.cards {
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.card-row {
		padding: var(--space-3) var(--space-4);
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-left: 3px solid transparent;
		border-radius: var(--radius-md);
	}

	.card-row.flag {
		border-left-color: var(--gold);
	}

	.card-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.card-meta {
		margin-top: var(--space-1);
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.pick {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--tap);
		height: var(--tap);
		margin-left: calc(var(--space-2) * -1);
	}

	.row-open {
		flex: 1;
		min-width: 0;
		padding: var(--space-2) 0;
		text-align: left;
		background: none;
		border: none;
		font: inherit;
		color: var(--text-link);
		cursor: pointer;
	}

	.row-open:hover {
		text-decoration: underline;
	}

	.row-open:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.row-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
		margin-bottom: var(--space-2);
	}

	.context {
		margin: var(--space-2) 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.section-label {
		margin: var(--space-3) 0 var(--space-2);
	}

	.note {
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.note.error {
		color: var(--text-alarm);
	}

	.trail {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.trail li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--border-thin);
		font-size: var(--text-sm);
	}

	.t-when {
		width: 120px;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.t-kind {
		width: 80px;
	}

	.t-what {
		flex: 1;
	}

	.asana-link {
		font-size: var(--text-sm);
	}

	.asana-ambiguous {
		font-size: var(--text-xs);
		color: var(--text-warn);
	}

	.sep {
		margin: 0 var(--space-1);
	}

	.modal-form {
		padding: 0 var(--space-4) var(--space-4);
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-3);
		margin-top: var(--space-3);
	}

	.modal-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}

	@media (min-width: 560px) {
		.grid {
			grid-template-columns: 1fr 1fr;
		}

		.span-all {
			grid-column: 1 / -1;
		}
	}

	@media (min-width: 720px) {
		.tiles {
			grid-template-columns: repeat(5, 1fr);
		}
	}

	@media (min-width: 960px) {
		.cards {
			display: none;
		}

		.table-wrap {
			display: block;
			margin-top: var(--space-3);
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
			white-space: nowrap;
			border-bottom: 2px solid var(--border-strong);
			background: var(--surface-row-alt);
		}

		td {
			padding: var(--space-2) var(--space-3);
			border-top: 1px solid var(--border-thin);
			vertical-align: top;
		}

		th.tick,
		td.tick {
			width: 36px;
		}

		td.grow {
			min-width: 280px;
		}

		tbody tr:hover {
			background: var(--surface-hover);
		}

		tr.open,
		tr.expanded,
		tr.expanded:hover {
			background: var(--surface-row-alt);
		}

		tr.done .cell-context,
		tr.done .row-open {
			color: var(--text-secondary);
		}

		.cell-context {
			display: block;
			margin-top: 2px;
			font-size: var(--text-xs);
			color: var(--text-secondary);
		}

		.muted-cell {
			color: var(--text-secondary);
		}

		.due-note {
			display: block;
			font-size: var(--text-xs);
		}

		.due-note.tone-overdue {
			color: var(--red);
		}

		.due-note.tone-today {
			color: var(--text-warn);
		}

		.nowrap {
			white-space: nowrap;
		}
	}
</style>
