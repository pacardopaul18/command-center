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

	$effect(() => {
		q = data.q;
	});

	function urlFor(next: Record<string, string | null>) {
		const params = new URLSearchParams();
		const merged: Record<string, string | null> = {
			q,
			account: data.account,
			client_id: data.clientId,
			tab: data.tab,
			archived: data.archived ? 'true' : null,
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

	{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}

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
			apply({ q });
		}}
	>
		<div class="search">
			<Input bind:value={q} placeholder="Search subjects, senders and gists" />
		</div>
		<Button type="submit">Search</Button>
		<div class="client">
			<Select
				value={data.clientId}
				onchange={(e) => apply({ client_id: (e.currentTarget as HTMLSelectElement).value })}
			>
				<option value="">Every client</option>
				{#each data.clients as client (client.id)}
					<option value={client.id}>{client.name}</option>
				{/each}
			</Select>
		</div>
		<a class="ghost" href={urlFor({ archived: data.archived ? null : 'true' })}>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<rect x="2" y="4" width="20" height="5" rx="1" />
				<path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
				<path d="M10 13h4" />
			</svg>
			{data.archived ? 'Hide archived' : 'Show archived'} ({data.archivedCount})
		</a>
	</form>

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
			<div class="thread">
				<a class="row" href="/mail/{thread.id}?account={thread.account_id ?? data.account}">
					<span class="chip {chipClass(thread)}">{chipLabel(thread)}</span>
					{#if thread.severity_override}<span class="edited mono">edited</span>{/if}
					<span class="subject">{thread.subject ?? '(no subject)'}</span>
					<span class="when mono">{thread.last_at ? formatMoment(thread.last_at) : ''}</span>
					<svg class="go" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M9 18l6-6-6-6" />
					</svg>
				</a>

				<p class="meta">
					{#if data.scope === 'all' && thread.account_email}
						<span class="acct mono">{thread.account_email}</span>
					{/if}
					{thread.latest_from_name ?? thread.latest_from ?? 'Unknown sender'}
					{#if thread.actual_count > 1}&middot; {thread.actual_count} messages{/if}
					{#if thread.client_name}&middot; {thread.client_name}{/if}
				</p>

				{#if thread.gist}
					<p class="gist">{thread.gist}</p>
				{:else if thread.latest_snippet}
					<p class="gist faint">{thread.latest_snippet}</p>
				{/if}

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
			</div>
		{/each}

		{#if data.threads.length === 0}
			<p class="none">No threads in this view. Pick another tab above.</p>
		{/if}
	</div>
{/if}

<style>
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

	.thread + .thread {
		border-top: 1px solid var(--border-thin);
	}

	/* The whole row is the link, so the target is the size of the row rather
	   than the size of the words. */
	.row {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		padding: 14px 20px 4px;
		text-decoration: none;
		color: inherit;
		transition: background-color var(--transition-fast);
	}

	.row:hover {
		background: var(--surface-hover);
	}

	.subject {
		flex: 1;
		min-width: 0;
		font-weight: 600;
		font-size: var(--text-md);
		color: var(--text-link);
		overflow-wrap: anywhere;
		text-decoration: underline;
		text-decoration-color: transparent;
		text-underline-offset: 3px;
		transition: text-decoration-color var(--transition-fast);
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

	/* Colour is a second signal. The word in the chip carries the state. */
	.chip-urgent {
		background: #f3e5c2;
		color: #77590f;
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
