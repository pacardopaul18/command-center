<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { apiWrite } from '$lib/http';
	import { formatMoment } from '$lib/format';
	import { SEVERITIES, SEVERITY_LABELS } from '$lib/types-mail';
	import type { Severity, ThreadRow } from '$lib/types-mail';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import Input from '$lib/components/Input.svelte';
	import Select from '$lib/components/Select.svelte';
	import MailboxPicker from '$lib/components/MailboxPicker.svelte';
	import { reauthNotice } from '$lib/mailbox-warning';
	import type { PageData } from './$types';

	/**
	 * Mail, rebuilt per CR-1.
	 *
	 * The design's organising idea is that everything you can do is visible: a
	 * row is a link, a chip is a state, a pill is a correction, and none of them
	 * need to be discovered by hovering. The previous version had the same
	 * capabilities and hid most of them.
	 *
	 * What has not changed is the boundary. Archiving is a local flag, no control
	 * on this screen can reach Gmail, and the copy says so where somebody would
	 * otherwise assume otherwise.
	 */

	let { data }: { data: PageData } = $props();

	let q = $state('');
	let busy = $state(false);
	let errorMessage = $state('');

	/**
	 * Whether the reclassify pills are on screen.
	 *
	 * They are the single biggest thing between one row and the next, and most
	 * of the time the classifier is right and they are not wanted. Remembered
	 * per browser, because it is a preference about looking rather than a fact
	 * about the mail.
	 */
	let showPills = $state(false);

	/** The client filter, typed rather than picked from a list of sixty. */
	let clientQuery = $state('');
	let clientOpen = $state(false);

	$effect(() => {
		q = data.q;
	});

	$effect(() => {
		try {
			const stored = localStorage.getItem('mail:show-pills');
			if (stored !== null) showPills = stored === 'true';
		} catch {
			// A browser refusing storage is not a reason to fail to render.
		}
	});

	function togglePills() {
		showPills = !showPills;
		try {
			localStorage.setItem('mail:show-pills', String(showPills));
		} catch {
			// Same: the preference simply does not persist.
		}
	}

	/**
	 * Search as you type.
	 *
	 * Debounced rather than fired per keystroke, because each one is a round
	 * trip and a query. Emptying the field is a search too: it used to leave the
	 * old results on screen until Enter was pressed, which reads as the list
	 * having stopped working.
	 */
	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	function onSearchInput(value: string) {
		q = value;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			if (value.trim() === (data.q ?? '').trim()) return;
			apply({ q: value.trim() || null, page: null });
		}, 250);
	}

	async function toggleStar(thread: ThreadRow) {
		const account = thread.account_id ?? data.account;
		const result = await apiWrite(
			`/api/email/threads/${thread.id}/star?account=${account}`,
			'POST',
			{ starred: !thread.starred_at }
		);
		if (!result.ok) errorMessage = result.error ?? 'Could not change that.';
		else await invalidateAll();
	}

	function urlFor(next: Record<string, string | null>) {
		const params = new URLSearchParams();
		const merged: Record<string, string | null> = {
			q,
			account: data.account,
			client_id: data.clientId,
			tab: data.tab,
			archived: data.archived ? 'true' : null,
			per: String(data.perPage),
			page: data.page > 1 ? String(data.page) : null,
			...next
		};
		for (const [key, value] of Object.entries(merged)) {
			if (value) params.set(key, value);
		}
		return `/mail?${params}`;
	}

	function apply(next: Record<string, string | null>) {
		goto(urlFor(next), { keepFocus: true });
	}

	async function switchAccount(account: string) {
		busy = true;
		await apiWrite('/api/connections/active-account', 'PUT', { account });
		busy = false;
		goto(urlFor({ account }), { keepFocus: true });
	}

	async function correct(thread: ThreadRow, severity: Severity) {
		busy = true;
		errorMessage = '';
		const result = await apiWrite(
			`/api/email/threads/${thread.id}/correct?account=${thread.account_id ?? data.account}`,
			'POST',
			{ severity }
		);
		if (!result.ok) errorMessage = result.error ?? 'Could not save that correction.';
		else await invalidateAll();
		busy = false;
	}

	async function archive(thread: ThreadRow) {
		busy = true;
		errorMessage = '';
		const undo = thread.archived_at ? '&undo=true' : '';
		const result = await apiWrite(
			`/api/email/threads/${thread.id}/archive?account=${thread.account_id ?? data.account}${undo}`,
			'POST',
			{}
		);
		if (!result.ok) errorMessage = result.error ?? 'Could not archive that.';
		else await invalidateAll();
		busy = false;
	}

	/** The tabs, in the order the design fixes them. */
	const TABS: { key: string; label: string }[] = [
		{ key: 'needs', label: 'Needs you' },
		{ key: 'urgent', label: 'Urgent' },
		{ key: 'important', label: 'Important' },
		{ key: 'routine', label: 'Routine' },
		{ key: 'noise', label: 'Noise' },
		{ key: 'all', label: 'Everything' }
	];

	const clientMatches = $derived(
		clientQuery.trim() === ''
			? data.clients
			: data.clients.filter((c) =>
					c.name.toLowerCase().includes(clientQuery.trim().toLowerCase())
				)
	);

	const activeClientName = $derived(
		data.clients.find((c) => c.id === data.clientId)?.name ?? ''
	);

	function chooseClient(id: string | null) {
		clientOpen = false;
		clientQuery = '';
		apply({ client_id: id, page: null });
	}

	/** Paging arithmetic, kept here so the markup stays readable. */
	const pageCount = $derived(Math.max(1, Math.ceil(data.total / data.perPage)));
	const firstOnPage = $derived(data.total === 0 ? 0 : (data.page - 1) * data.perPage + 1);
	const lastOnPage = $derived(Math.min(data.page * data.perPage, data.total));

	const PAGE_SIZES = [10, 20, 50, 100];

	function countFor(key: string): number {
		if (key === 'needs') return data.needsYou;
		if (key === 'all') return Object.values(data.counts).reduce((n, v) => n + v, 0);
		return data.counts[key] ?? 0;
	}

	const CHIP: Record<string, string> = {
		urgent: 'chip-urgent',
		important: 'chip-important',
		routine: 'chip-routine',
		noise: 'chip-noise'
	};

	function chipClass(thread: ThreadRow): string {
		if (thread.archived_at) return 'chip-archived';
		return CHIP[thread.effective_severity ?? ''] ?? 'chip-none';
	}

	function chipLabel(thread: ThreadRow): string {
		if (thread.archived_at) return 'Archived';
		return thread.effective_severity ? SEVERITY_LABELS[thread.effective_severity] : 'Untriaged';
	}
</script>

<svelte:head><title>Mail</title></svelte:head>

{#if data.noAccount}
	<Card title="No account connected">
		<p class="empty">Connect a Google account in Settings to read mail here.</p>
	</Card>
{:else}
	<header class="head">
		<div>
			<h1>Mail</h1>
			<p class="sub">
				{Object.values(data.counts).reduce((n, v) => n + v, 0)} threads. Read only. Archiving
				here does not touch Gmail.
			</p>
		</div>
		<MailboxPicker
			accounts={data.roster}
			active={data.scope === 'all' ? 'all' : data.account}
			{busy}
			onChange={switchAccount}
		/>
	</header>

	{#each data.roster as account (account.id)}
		{@const notice = reauthNotice(account)}
		{#if notice}
			<p class="reauth" role="status">{notice}</p>
		{/if}
	{/each}

	{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}

	<div class="sticky">
	<nav class="tabs" aria-label="Filter mail by what it needs from you">
		{#each TABS as tab (tab.key)}
			<a
				href={urlFor({ tab: tab.key })}
				class="tab"
				class:on={data.tab === tab.key}
				aria-current={data.tab === tab.key ? 'page' : undefined}
			>
				{tab.label}
				<span class="tab-n mono">{countFor(tab.key)}</span>
			</a>
		{/each}
	</nav>

	<form
		class="filters"
		onsubmit={(e) => {
			e.preventDefault();
			apply({ q, page: null });
		}}
	>
		<div class="search">
			<input
				type="search"
				value={q}
				placeholder="Search subjects, senders and gists"
				aria-label="Search mail"
				oninput={(e) => onSearchInput((e.currentTarget as HTMLInputElement).value)}
			/>
		</div>

		<!--
			Typed, not picked. A native select jumps to the first name starting
			with the letter pressed and forgets it a moment later, so "Ba" lands
			on the first B and stays there. This matches anywhere in the name.
		-->
		<div class="client">
			<input
				type="text"
				role="combobox"
				aria-expanded={clientOpen}
				aria-controls="client-options"
				aria-autocomplete="list"
				aria-label="Filter by client"
				placeholder={activeClientName || 'Every client'}
				value={clientQuery}
				oninput={(e) => {
					clientQuery = (e.currentTarget as HTMLInputElement).value;
					clientOpen = true;
				}}
				onfocus={() => (clientOpen = true)}
				onblur={() => setTimeout(() => (clientOpen = false), 150)}
			/>
			{#if clientOpen}
				<ul class="options" id="client-options" role="listbox">
					<li role="option" aria-selected={!data.clientId}>
						<button type="button" onclick={() => chooseClient(null)}>Every client</button>
					</li>
					{#each clientMatches.slice(0, 8) as client (client.id)}
						<li role="option" aria-selected={data.clientId === client.id}>
							<button type="button" onclick={() => chooseClient(client.id)}>{client.name}</button>
						</li>
					{/each}
					{#if clientMatches.length === 0}
						<li class="none" role="presentation">No client matches that.</li>
					{/if}
				</ul>
			{/if}
		</div>

		<button type="button" class="ghost" onclick={togglePills} aria-pressed={showPills}>
			{showPills ? 'Hide labels' : 'Show labels'}
		</button>
		<a class="ghost" href={urlFor({ archived: data.archived ? null : 'true' })}>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<rect x="2" y="4" width="20" height="5" rx="1" />
				<path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
				<path d="M10 13h4" />
			</svg>
			{data.archived ? 'Hide archived' : 'Show archived'} ({data.archivedCount})
		</a>
	</form>
	</div>

	{#if (data.counts.untriaged ?? 0) > 0}
		<div class="callout">
			<span
				>{data.counts.untriaged} threads have no triage yet. Run Summarise from Settings to sort
				them.</span
			>
			<Button variant="secondary" size="sm" onclick={() => goto('/settings')}>Open settings</Button>
		</div>
	{/if}

	<div class="threads">
		{#each data.threads as thread (thread.id)}
			{@const unread = !thread.read_at}
			<div class="thread" class:unread class:read={!unread}>
				<!--
					One line, the way a mail client shows one. The gist and the
					correction pills used to make every row four lines deep, so
					eight threads filled the screen.
				-->
				<button
					type="button"
					class="star"
					aria-pressed={Boolean(thread.starred_at)}
					aria-label={thread.starred_at ? 'Remove from favourites' : 'Add to favourites'}
					title={thread.starred_at ? 'Remove from favourites' : 'Add to favourites'}
					onclick={() => toggleStar(thread)}
				>
					<svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" fill={thread.starred_at ? 'currentColor' : 'none'} aria-hidden="true">
						<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" />
					</svg>
				</button>

				<a class="row" href="/mail/{thread.id}?account={thread.account_id ?? data.account}">
					<span class="chip {chipClass(thread)}">{chipLabel(thread)}</span>
					<span class="subject">{thread.subject ?? '(no subject)'}</span>
					<span class="from">
						{#if data.scope === 'all' && thread.account_email}
							<span class="acct mono">{thread.account_email}</span>
						{/if}
						{thread.latest_from_name ?? thread.latest_from ?? 'Unknown sender'}
						{#if thread.actual_count > 1}<span class="n mono">{thread.actual_count}</span>{/if}
					</span>
					<span class="preview">
						{thread.gist ?? thread.latest_snippet ?? ''}
					</span>
					{#if thread.client_name}<span class="client-tag">{thread.client_name}</span>{/if}
					{#if thread.severity_override}<span class="edited mono">edited</span>{/if}
					<span class="when mono">{thread.last_at ? formatMoment(thread.last_at) : ''}</span>
				</a>

				{#if showPills}
					<div class="fixes">
						<span class="fixes-label mono">Not right?</span>
						{#each SEVERITIES as severity (severity)}
							{#if severity !== thread.effective_severity}
								<button
									type="button"
									class="pill"
									disabled={busy}
									onclick={() => correct(thread, severity)}
								>
									{SEVERITY_LABELS[severity]}
								</button>
							{/if}
						{/each}
						<button type="button" class="pill" disabled={busy} onclick={() => archive(thread)}>
							{thread.archived_at ? 'Unarchive' : 'Archive'}
						</button>
					</div>
				{/if}
			</div>
		{/each}

		{#if data.threads.length === 0}
			<p class="none">No threads in this view. Pick another tab above.</p>
		{/if}
	</div>

	{#if data.total > 0}
		<div class="pager">
			<span class="mono count">
				{firstOnPage} to {lastOnPage} of {data.total}
			</span>

			<label class="per">
				<span>Per page</span>
				<select
					value={String(data.perPage)}
					onchange={(e) =>
						apply({ per: (e.currentTarget as HTMLSelectElement).value, page: null })}
				>
					{#each PAGE_SIZES as size (size)}
						<option value={String(size)}>{size}</option>
					{/each}
				</select>
			</label>

			<div class="steps">
				{#if data.page > 1}
					<a class="ghost" href={urlFor({ page: String(data.page - 1) })}>Previous</a>
				{:else}
					<span class="ghost off">Previous</span>
				{/if}
				<span class="mono">Page {data.page} of {pageCount}</span>
				{#if data.page < pageCount}
					<a class="ghost" href={urlFor({ page: String(data.page + 1) })}>Next</a>
				{:else}
					<span class="ghost off">Next</span>
				{/if}
			</div>
		</div>
	{/if}
{/if}

<style>
	/* A full width notice, in flow. Inside the picker column it widened the
	   header's flex child and rode up beside the title. */
	.reauth {
		margin: var(--space-3) 0 0;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--gold);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
	}

	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-4);
		flex-wrap: wrap;
	}

	h1 {
		font-size: var(--text-2xl);
		font-weight: 700;
		margin: 0 0 6px;
	}

	.sub {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	/* Segmented control. The container carries the border and shadow; the tabs
	   inside carry only their own state, so the group reads as one thing. */
	.tabs {
		display: inline-flex;
		gap: 4px;
		margin-top: var(--space-5);
		padding: 4px;
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		max-width: 100%;
		overflow-x: auto;
	}

	.tab {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: 7px 14px;
		border-radius: var(--radius-sm);
		white-space: nowrap;
		flex-shrink: 0;
		font-size: var(--text-base);
		font-weight: 500;
		text-decoration: none;
		color: var(--ink);
		transition: background-color var(--transition-fast);
	}

	.tab:hover {
		background: var(--navy-50);
	}

	.tab.on {
		background: var(--navy);
		color: var(--text-inverse);
	}

	.tab.on:hover {
		background: var(--navy);
	}

	.tab-n {
		font-size: var(--text-xs);
		color: var(--muted);
	}

	.tab.on .tab-n {
		color: var(--text-inverse-muted);
	}

	.filters {
		display: flex;
		gap: var(--space-3);
		margin-top: var(--space-4);
		align-items: center;
		flex-wrap: wrap;
	}

	.search {
		flex: 1;
		min-width: 280px;
	}

	.client {
		width: 220px;
	}

	.ghost {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		border-radius: var(--radius-sm);
		text-decoration: none;
		font-size: var(--text-base);
		font-weight: 500;
		color: var(--navy-700);
		transition: background-color var(--transition-fast);
	}

	.ghost:hover {
		background: var(--navy-50);
	}

	.callout {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-top: var(--space-4);
		padding: 12px 16px;
		background: var(--surface-callout);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		flex-wrap: wrap;
	}

	.threads {
		margin-top: var(--space-4);
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		overflow: hidden;
	}

	.thread {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.thread + .thread {
		border-top: 1px solid var(--border-thin);
	}

	.thread:hover {
		background: var(--surface-hover);
	}

	/* The controls stay put while the list moves under them. Reaching for a tab
	   after scrolling should not mean scrolling back first. */
	.sticky {
		position: sticky;
		top: 0;
		z-index: 5;
		padding: var(--space-3) 0;
		margin-bottom: var(--space-3);
		background: var(--surface-page);
		border-bottom: 1px solid var(--border-thin);
	}

	.pager {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-4);
		margin-top: var(--space-4);
		font-size: var(--text-sm);
	}

	.pager .count {
		color: var(--text-secondary);
	}

	.per {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}

	.per select {
		padding: 4px 8px;
		font: inherit;
		font-size: var(--text-sm);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-card);
	}

	.steps {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		margin-left: auto;
	}

	.off {
		opacity: 0.4;
		pointer-events: none;
	}

	/* The client typeahead's list of matches. */
	.client {
		position: relative;
	}

	.client input,
	.search input {
		width: 100%;
		box-sizing: border-box;
		padding: 8px 10px;
		font: inherit;
		font-size: var(--text-sm);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-card);
		color: var(--ink);
	}

	.options {
		position: absolute;
		z-index: 10;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		margin: 0;
		padding: 4px;
		list-style: none;
		max-height: 16rem;
		overflow-y: auto;
		background: var(--surface-card);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-card);
	}

	.options button {
		display: block;
		width: 100%;
		text-align: left;
		padding: 6px 8px;
		font: inherit;
		font-size: var(--text-sm);
		background: none;
		border: 0;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.options button:hover {
		background: var(--surface-hover);
	}

	.options .none {
		padding: 6px 8px;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	/* The whole row is the link, so the target is the size of the row rather
	   than the size of the words. One line, like a mail client: subject, sender
	   and preview share it and each is truncated rather than wrapped. */
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex: 1;
		min-width: 0;
		padding: 9px 20px 9px 0;
		text-decoration: none;
		color: inherit;
		transition: background-color var(--transition-fast);
	}

	.row:hover {
		background: var(--surface-hover);
	}

	.subject {
		flex: 0 1 auto;
		max-width: 40%;
		min-width: 0;
		font-size: var(--text-sm);
		color: var(--text-link);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-decoration: underline;
		text-decoration-color: transparent;
		text-underline-offset: 3px;
		transition: text-decoration-color var(--transition-fast);
	}

	/* Unread reads as unread: the subject carries the weight, the row sits on
	   plain white. Read rows step back rather than disappearing. */
	.thread.unread .subject {
		font-weight: 700;
	}

	.thread.read {
		background: var(--surface-page);
	}

	.thread.read .subject,
	.thread.read .from,
	.thread.read .preview {
		color: var(--text-secondary);
	}

	.from {
		flex: 0 1 auto;
		max-width: 22%;
		min-width: 0;
		font-size: var(--text-sm);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.thread.unread .from {
		font-weight: 600;
	}

	.from .n {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.preview {
		flex: 1 1 auto;
		min-width: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.client-tag {
		flex: none;
		font-size: var(--text-xs);
		padding: 2px 8px;
		border-radius: var(--radius-pill);
		background: var(--navy-50);
		color: var(--navy-500);
		white-space: nowrap;
	}

	/* The heart. Its own control beside the link, not inside it: a button inside
	   an anchor is invalid and the browser resolves it by dropping one. */
	.star {
		flex: none;
		display: inline-flex;
		align-items: center;
		padding: 0 10px 0 14px;
		background: none;
		border: 0;
		color: var(--border-strong);
		cursor: pointer;
	}

	.star[aria-pressed='true'] {
		color: var(--red);
	}

	.star:hover {
		color: var(--red);
	}

	.row:hover .subject {
		text-decoration-color: var(--navy-500);
	}

	.chip {
		align-self: center;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		padding: 3px 10px;
		border-radius: var(--radius-pill);
		white-space: nowrap;
	}

	/* Colour is a second signal and the word still carries the state, but the
	   ladder has to be visible at a glance: urgent in red, important in gold,
	   then the quiet ones. Urgent used to be a shade of the same gold as
	   important, which made the two hardest to tell apart the two that most
	   need telling apart. Contrast checked against the pale ground. */
	.chip-urgent {
		background: var(--red-100);
		color: var(--red);
		font-weight: 700;
	}
	.chip-important {
		background: var(--gold-100);
		color: var(--gold-600);
	}
	.chip-routine {
		background: var(--navy-50);
		color: var(--navy-500);
	}
	.chip-noise {
		background: #f0efea;
		color: var(--muted);
	}
	.chip-archived {
		background: var(--navy-100);
		color: var(--navy);
	}
	.chip-none {
		background: #f0efea;
		color: var(--muted);
	}

	.edited {
		font-size: var(--text-xs);
		font-style: italic;
		color: var(--text-secondary);
	}

	.when {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		white-space: nowrap;
	}

	.go {
		color: var(--muted);
		flex-shrink: 0;
		align-self: center;
	}

	.meta {
		margin: 4px 0 0;
		padding: 0 20px;
		font-size: var(--text-sm);
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}

	.acct {
		display: inline-block;
		margin-right: 6px;
		padding: 1px 8px;
		border: 1px solid var(--navy-100);
		border-radius: var(--radius-pill);
		font-size: var(--text-xs);
		color: var(--navy);
	}

	.gist {
		margin: 6px 0 0;
		padding: 0 20px;
		font-size: var(--text-base);
		color: var(--text-body);
		overflow-wrap: anywhere;
	}

	.gist.faint {
		color: var(--text-secondary);
	}

	.fixes {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 10px 20px 14px;
		flex-wrap: wrap;
	}

	.fixes-label {
		font-size: var(--text-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--text-secondary);
	}

	.pill {
		padding: 4px 12px;
		background: var(--surface-card);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-pill);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--navy-700);
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.pill:hover:not(:disabled) {
		background: var(--navy-50);
		border-color: var(--navy-500);
	}

	.pill:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.none,
	.empty {
		margin: 0;
		padding: 40px 20px;
		text-align: center;
		font-size: var(--text-base);
		color: var(--text-secondary);
	}
</style>
