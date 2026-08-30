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
	import AccountSwitcher from '$lib/components/AccountSwitcher.svelte';
	import type { PageData } from './$types';

	/**
	 * Mail, as a list you can scan.
	 *
	 * The first version put the full summary in every row, which Paul correctly
	 * called unreadable. A list needs a label and one line; the paragraph belongs
	 * inside the thread. So a row is a severity chip, a sender, a subject and the
	 * one line gist, and nothing else.
	 *
	 * Urgent and Important are the default view. Routine and Noise are one click
	 * away and never gone, because a filter that hides mail permanently is one
	 * nobody trusts.
	 */

	let { data }: { data: PageData } = $props();

	let q = $state('');
	let busy = $state(false);
	let errorMessage = $state('');

	$effect(() => {
		q = data.q;
	});

	/**
	 * Changing mailbox is remembered, so the next visit opens where this one
	 * left off rather than on whichever account sorts first.
	 */
	async function switchAccount(account: string) {
		busy = true;
		await apiWrite('/api/connections/active-account', 'PUT', { account });
		busy = false;
		goto(urlFor({ account }), { keepFocus: true });
	}

	function urlFor(next: Record<string, string | null>) {
		const params = new URLSearchParams();
		const merged: Record<string, string | null> = {
			q,
			account: data.account,
			client_id: data.clientId,
			severity: data.severity,
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

	function search(event: SubmitEvent) {
		event.preventDefault();
		apply({ q });
	}

	async function correct(thread: ThreadRow, severity: Severity) {
		busy = true;
		errorMessage = '';
		const result = await apiWrite(`/api/email/threads/${thread.id}/correct`, 'POST', { severity });
		if (!result.ok) errorMessage = result.error ?? 'Could not save that correction.';
		else await invalidateAll();
		busy = false;
	}

	async function archive(thread: ThreadRow) {
		busy = true;
		errorMessage = '';
		const undo = thread.archived_at ? '?undo=true' : '';
		const result = await apiWrite(`/api/email/threads/${thread.id}/archive${undo}`, 'POST', {});
		if (!result.ok) errorMessage = result.error ?? 'Could not archive that.';
		else await invalidateAll();
		busy = false;
	}

	const chips: { key: string; label: string }[] = [
		{ key: 'urgent,important', label: 'Needs you' },
		{ key: 'urgent', label: 'Urgent' },
		{ key: 'important', label: 'Important' },
		{ key: 'routine', label: 'Routine' },
		{ key: 'noise', label: 'Noise' },
		{ key: 'all', label: 'Everything' }
	];

	const current = $derived(data.severity ?? 'urgent,important');

	function countFor(key: string): number {
		if (key === 'all') return Object.values(data.counts).reduce((n, v) => n + v, 0);
		return key.split(',').reduce((n, part) => n + (data.counts[part] ?? 0), 0);
	}
</script>

<svelte:head><title>Mail</title></svelte:head>

<header class="head">
	<h1>Mail</h1>
	<p class="sub">
		{#if data.ingest}
			{data.ingest.stored.threads} threads from {data.ingest.stored.messages} messages
			{#if data.ingest.account} in {data.ingest.account}{/if}.
		{/if}
		Read only. Archiving here does not touch Gmail.
	</p>
</header>

{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}

{#if data.noAccount}
	<Card title="No account connected">
		<p class="empty">Connect a Google account in Settings to read mail here.</p>
	</Card>
{:else}
<AccountSwitcher
	accounts={data.roster}
	active={data.scope === 'all' ? 'all' : data.account}
	{busy}
	onChange={switchAccount}
/>

<nav class="chips" aria-label="Filter by what it needs from you">
	{#each chips as chip (chip.key)}
		<a
			href={urlFor({ severity: chip.key === 'all' ? 'all' : chip.key })}
			class="chip"
			class:on={current === chip.key}
			aria-current={current === chip.key ? 'page' : undefined}
		>
			{chip.label}
			<span class="n mono">{countFor(chip.key)}</span>
		</a>
	{/each}
</nav>

<form class="filters" onsubmit={search}>
	<div class="search">
		<Input bind:value={q} placeholder="Search subjects, senders and gists" />
		<Button type="submit" size="sm">Search</Button>
	</div>

	<Select
		value={data.clientId}
		onchange={(e) => apply({ client_id: (e.currentTarget as HTMLSelectElement).value })}
	>
		<option value="">Every client</option>
		{#each data.clients as client (client.id)}
			<option value={client.id}>{client.name}</option>
		{/each}
	</Select>

	<a class="plain-link" href={urlFor({ archived: data.archived ? null : 'true' })}>
		{data.archived ? 'Hide archived' : 'Show archived'}
	</a>
</form>

{#if data.untriaged > 0}
	<p class="notice" role="status">
		{data.untriaged} thread{data.untriaged === 1 ? ' has' : 's have'} no triage yet. Run
		Summarise from Settings to sort them.
	</p>
{/if}

{#if data.threads.length === 0}
	<Card title="Nothing here">
		<p class="empty">
			{#if data.ingest && data.ingest.stored.messages === 0}
				No mail has been read yet. Start from Settings.
			{:else}
				Nothing matches this filter. Try Everything.
			{/if}
		</p>
	</Card>
{:else}
	<ul class="threads">
		{#each data.threads as thread (thread.id)}
			<li class:unread={!thread.read_at}>
				<div class="row">
					<span
						class="sev sev-{thread.effective_severity ?? 'none'}"
						title={thread.severity_override
							? `You set this. The model said ${thread.severity}.`
							: undefined}
					>
						{thread.effective_severity ? SEVERITY_LABELS[thread.effective_severity] : 'Untriaged'}
						{#if thread.severity_override}<span class="mine">edited</span>{/if}
					</span>

					<a class="subject" href="/mail/{thread.id}">{thread.subject ?? '(no subject)'}</a>

					<span class="when mono">{thread.last_at ? formatMoment(thread.last_at) : ''}</span>
				</div>

				<p class="meta">
					{#if data.scope === 'all' && thread.account_email}
						<span class="acct">{thread.account_email}</span>
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

				<div class="actions">
					<span class="tiny">Not right?</span>
					{#each SEVERITIES as severity (severity)}
						{#if severity !== thread.effective_severity}
							<button type="button" class="fix" disabled={busy} onclick={() => correct(thread, severity)}>
								{SEVERITY_LABELS[severity]}
							</button>
						{/if}
					{/each}
					<button type="button" class="fix" disabled={busy} onclick={() => archive(thread)}>
						{thread.archived_at ? 'Unarchive' : 'Archive'}
					</button>
				</div>
			</li>
		{/each}
	</ul>
{/if}
{/if}

<style>
	.head {
		margin-bottom: var(--space-3);
	}

	h1 {
		margin: 0 0 var(--space-1);
	}

	.sub {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}

	.chip {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-2);
		font-size: var(--text-sm);
		padding: 4px 10px;
		border: 1px solid var(--border);
		border-radius: 999px;
		text-decoration: none;
		color: inherit;
		background: var(--surface);
	}

	.chip.on {
		border-color: var(--navy, #102a4c);
		font-weight: 600;
	}

	.chip .n {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}

	.search {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: 1 1 240px;
	}

	.plain-link {
		font-size: var(--text-sm);
	}

	.threads {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		overflow: hidden;
	}

	.threads li {
		padding: var(--space-3) var(--space-4);
	}

	.threads li + li {
		border-top: 1px solid var(--border);
	}

	.threads li.unread .subject {
		font-weight: 700;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2);
	}

	.subject {
		flex: 1 1 240px;
		min-width: 0;
		font-weight: 600;
		text-decoration: none;
		color: inherit;
		overflow-wrap: anywhere;
	}

	.subject:hover {
		text-decoration: underline;
	}

	/* The chip carries the state in words. Colour is a second signal and never
	   the only one, per the accessibility baseline. */
	.sev {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 1px 8px;
		border-radius: 999px;
		border: 1px solid var(--border);
		white-space: nowrap;
	}

	.sev-urgent {
		border-color: var(--gold);
		font-weight: 700;
	}

	.sev-important {
		border-color: var(--navy, #102a4c);
		font-weight: 600;
	}

	.sev-noise,
	.sev-none {
		color: var(--text-secondary);
	}

	.mine {
		margin-left: 4px;
		text-transform: none;
		letter-spacing: 0;
		font-style: italic;
	}

	.when {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		white-space: nowrap;
	}

	.meta {
		margin: 2px 0 0;
		font-size: var(--text-xs);
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}

	.gist {
		margin: var(--space-1) 0 0;
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}

	.gist.faint {
		color: var(--text-secondary);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.tiny {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.fix {
		font: inherit;
		font-size: var(--text-xs);
		background: none;
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 1px 8px;
		cursor: pointer;
		color: var(--text-secondary);
	}

	.fix:hover {
		color: var(--text-primary);
		border-color: var(--navy, #102a4c);
	}

	.empty {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
</style>
