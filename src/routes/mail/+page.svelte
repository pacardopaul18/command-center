<script lang="ts">
	import { goto } from '$app/navigation';
	import { formatMoment } from '$lib/format';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import Input from '$lib/components/Input.svelte';
	import Select from '$lib/components/Select.svelte';
	import type { PageData } from './$types';

	/**
	 * Mail, browsable.
	 *
	 * Threads rather than messages, because a conversation is the unit a person
	 * thinks in and it is also the unit the summaries are written against.
	 *
	 * A thread shows a client only when a sender matched a known contact exactly.
	 * Nothing is inferred from the domain: two clients can share gmail.com, and a
	 * confidently wrong attribution is worse than a blank one, because the blank
	 * is visibly missing and the wrong one is not.
	 */

	let { data }: { data: PageData } = $props();

	// Seeded from the URL and re-seeded whenever it changes, so navigating with
	// a different query does not leave the box showing the previous search.
	let q = $state('');
	$effect(() => {
		q = data.q;
	});

	function applyFilters(next: Record<string, string | null>) {
		const params = new URLSearchParams();
		const merged = { q, client_id: data.clientId, unlinked: data.unlinked ? 'true' : '', ...next };
		for (const [key, value] of Object.entries(merged)) {
			if (value) params.set(key, value);
		}
		goto(`/mail?${params}`, { keepFocus: true });
	}

	function search(event: SubmitEvent) {
		event.preventDefault();
		applyFilters({ q });
	}
</script>

<svelte:head><title>Mail</title></svelte:head>

<header class="head">
	<h1>Mail</h1>
	<p class="sub">
		{#if data.ingest}
			{data.ingest.stored.threads} threads from {data.ingest.stored.messages} messages
			{#if data.ingest.account} in {data.ingest.account}{/if}.
		{:else}
			Nothing ingested yet.
		{/if}
		Read only.
	</p>
</header>

<form class="filters" onsubmit={search}>
	<div class="search">
		<Input bind:value={q} placeholder="Search subjects, senders and snippets" />
		<Button type="submit" size="sm">Search</Button>
	</div>

	<Select
		value={data.clientId}
		onchange={(e) => applyFilters({ client_id: (e.currentTarget as HTMLSelectElement).value })}
	>
		<option value="">Every client</option>
		{#each data.clients as client (client.id)}
			<option value={client.id}>{client.name}</option>
		{/each}
	</Select>

	<label class="check">
		<input
			type="checkbox"
			checked={data.unlinked}
			onchange={(e) =>
				applyFilters({ unlinked: (e.currentTarget as HTMLInputElement).checked ? 'true' : '' })}
		/>
		<span>Not linked to a client</span>
	</label>
</form>

{#if data.threads.length === 0}
	<Card title="Nothing to show">
		<p class="empty">
			{#if data.ingest && data.ingest.stored.messages === 0}
				No mail has been ingested yet. Start a read from Settings.
			{:else}
				No threads match those filters.
			{/if}
		</p>
	</Card>
{:else}
	<ul class="threads">
		{#each data.threads as thread (thread.id)}
			<li>
				<a class="thread" href="/mail/{thread.id}">
					<div class="thread-head">
						<span class="subject">{thread.subject ?? '(no subject)'}</span>
						<span class="when mono">{thread.last_at ? formatMoment(thread.last_at) : ''}</span>
					</div>
					<p class="meta">
						{thread.latest_from ?? 'Unknown sender'}
						&middot; {thread.actual_count} message{thread.actual_count === 1 ? '' : 's'}
						{#if thread.client_name}
							&middot; <span class="client">{thread.client_name}</span>
						{/if}
					</p>
					{#if thread.summary}
						<p class="summary">{thread.summary}</p>
					{:else if thread.latest_snippet}
						<p class="snippet">{thread.latest_snippet}</p>
					{/if}
				</a>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.head {
		margin-bottom: var(--space-4);
	}

	h1 {
		margin: 0 0 var(--space-1);
	}

	.sub {
		margin: 0;
		font-size: var(--text-sm);
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
		flex: 1 1 260px;
	}

	.check {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}

	.threads {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--surface);
	}

	.threads li + li {
		border-top: 1px solid var(--border);
	}

	.thread {
		display: block;
		padding: var(--space-3) var(--space-4);
		text-decoration: none;
		color: inherit;
	}

	.thread:hover {
		background: var(--surface-hover);
	}

	.thread-head {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		justify-content: space-between;
		align-items: baseline;
	}

	.subject {
		font-weight: 600;
		overflow-wrap: anywhere;
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

	.client {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0 6px;
	}

	.snippet,
	.summary {
		margin: var(--space-2) 0 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}

	.summary {
		color: var(--text-primary);
		border-left: 2px solid var(--gold);
		padding-left: var(--space-3);
	}

	.empty {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
</style>
