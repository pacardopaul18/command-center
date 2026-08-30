<script lang="ts">
	import { formatMoment } from '$lib/format';
	import Card from '$lib/components/Card.svelte';
	import type { PageData } from './$types';
	import type { ThreadMessage } from './+page';

	/**
	 * One thread.
	 *
	 * Bodies are fetched one at a time, on demand, rather than all at once with
	 * the page. A long thread is a lot of text nobody asked for, and the list
	 * above it is usually enough to find the message that matters.
	 *
	 * Nothing on this page can reply, forward or draft. There is no permission
	 * for any of it, which is why there is no button for any of it either.
	 */

	let { data }: { data: PageData } = $props();

	let open = $state<Record<string, string | null>>({});
	let loading = $state<string | null>(null);
	let errorMessage = $state('');

	async function toggle(message: { id: string; body_key: string | null }) {
		if (message.id in open) {
			const next = { ...open };
			delete next[message.id];
			open = next;
			return;
		}

		if (!message.body_key) {
			open = { ...open, [message.id]: null };
			return;
		}

		loading = message.id;
		errorMessage = '';
		try {
			const res = await fetch(`/api/email/messages/${message.id}/body`);
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				errorMessage = body.error ?? 'Could not read that message.';
			} else {
				const body = (await res.json()) as { body: string | null };
				open = { ...open, [message.id]: body.body };
			}
		} catch {
			errorMessage = 'Could not read that message.';
		}
		loading = null;
	}

	function who(message: ThreadMessage): string {
		if (message.from_name && message.from_email) {
			return `${message.from_name} (${message.from_email})`;
		}
		return message.from_email ?? 'Unknown sender';
	}
</script>

<svelte:head><title>{data.thread.subject ?? 'Thread'}</title></svelte:head>

<nav class="crumbs mono" aria-label="Breadcrumb">
	<a href="/mail">Mail</a> <span aria-hidden="true">/</span>
	<span>Thread</span>
</nav>

<header class="head">
	<h1>{data.thread.subject ?? '(no subject)'}</h1>
	<p class="meta">
		{data.messages.length} message{data.messages.length === 1 ? '' : 's'}
		{#if data.thread.first_at}
			&middot; {formatMoment(data.thread.first_at)}
		{/if}
		{#if data.thread.last_at && data.thread.last_at !== data.thread.first_at}
			to {formatMoment(data.thread.last_at)}
		{/if}
		{#if data.thread.client_name}
			&middot; <a href="/clients/{data.thread.client_id}">{data.thread.client_name}</a>
		{/if}
	</p>
</header>

{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}

{#if data.thread.summary}
	<Card title="Summary" subtitle="Written by {data.thread.summary_model ?? 'the model'}">
		<p class="summary">{data.thread.summary}</p>
		{#if data.thread.summary_at}
			<p class="tiny">
				Written {formatMoment(data.thread.summary_at)}.
				{#if data.thread.last_at && data.thread.summary_at < data.thread.last_at}
					The thread has had messages since. This summary does not cover them.
				{/if}
			</p>
		{/if}
	</Card>
{/if}

<ul class="messages">
	{#each data.messages as message (message.id)}
		<li>
			<button
				class="row"
				type="button"
				aria-expanded={message.id in open}
				onclick={() => toggle(message)}
			>
				<span class="from">{who(message)}</span>
				<span class="when mono">{formatMoment(message.sent_at)}</span>
			</button>

			{#if message.to_emails}
				<p class="to">To {message.to_emails}</p>
			{/if}

			{#if message.id in open}
				{#if open[message.id]}
					<pre class="body">{open[message.id]}</pre>
				{:else}
					<p class="tiny">No body was stored for this message.</p>
				{/if}
			{:else if loading === message.id}
				<p class="tiny">Reading...</p>
			{:else if message.snippet}
				<p class="snippet">{message.snippet}</p>
			{/if}
		</li>
	{/each}
</ul>

<style>
	.crumbs {
		font-size: var(--text-xs);
		margin-bottom: var(--space-3);
		color: var(--text-secondary);
	}

	.head {
		margin-bottom: var(--space-4);
	}

	h1 {
		margin: 0 0 var(--space-1);
		overflow-wrap: anywhere;
	}

	.meta {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.summary {
		margin: 0 0 var(--space-2);
	}

	.tiny {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.messages {
		list-style: none;
		margin: var(--space-4) 0 0;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		overflow: hidden;
	}

	.messages li {
		padding: var(--space-3) var(--space-4);
	}

	.messages li + li {
		border-top: 1px solid var(--border);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		justify-content: space-between;
		align-items: baseline;
		width: 100%;
		background: none;
		border: 0;
		padding: 0;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}

	.from {
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.when {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		white-space: nowrap;
	}

	.to,
	.snippet {
		margin: 2px 0 0;
		font-size: var(--text-xs);
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}

	.body {
		margin: var(--space-3) 0 0;
		padding: var(--space-3);
		background: var(--surface-hover);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		/* Mail is full of very long unbroken links. Without this the page scrolls
		   sideways on a phone, which the suite checks for at 412px. */
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 32rem;
		overflow-y: auto;
	}
</style>
