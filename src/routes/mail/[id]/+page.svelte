<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { apiWrite } from '$lib/http';
	import { formatMoment } from '$lib/format';
	import { SEVERITIES, SEVERITY_HELP, SEVERITY_LABELS, CATEGORY_LABELS } from '$lib/types-mail';
	import type { Severity } from '$lib/types-mail';
	import Card from '$lib/components/Card.svelte';
	import EmailBody from '$lib/components/EmailBody.svelte';
	import type { PageData } from './$types';
	import type { ThreadMessage } from './+page';

	/**
	 * One thread, opened the way a mail client opens one.
	 *
	 * A single message thread is fully open. A longer one opens its latest and
	 * collapses the rest. Paul had to click every message to see anything, which
	 * was work the page could have done and now does: the bodies that will be
	 * open arrive with the page.
	 *
	 * Bodies are rendered, not dumped. See EmailBody: the source is parsed into a
	 * validated tree and drawn as elements, so a marketing email reads as mail
	 * rather than as a wall of tracking URLs, and nothing it contains can run.
	 *
	 * There is no reply, forward or draft button, because there is no permission
	 * for any of it.
	 */

	let { data }: { data: PageData } = $props();

	// Initialised from the load, not only synced by an effect. Effects do not run
	// during server rendering, so seeding them there alone left the first paint
	// with no body at all and the message appeared only after hydration.
	let bodies = $state<Record<string, { body: string; format: 'text' | 'html' | null }>>({
		...data.bodies
	});
	let openIds = $state<string[]>([...data.open_ids]);
	let loading = $state<string | null>(null);
	let busy = $state(false);
	let errorMessage = $state('');

	// Re-seeded on navigation between threads, which reuses this component.
	let seededFor = data.thread.id;
	$effect(() => {
		if (data.thread.id === seededFor) return;
		seededFor = data.thread.id;
		bodies = { ...data.bodies };
		openIds = [...data.open_ids];
	});

	// Reading it marks it read. Not a button: opening a thread is the act.
	$effect(() => {
		const id = data.thread.id;
		if (data.thread.read_at) return;
		apiWrite(`/api/email/threads/${id}/read`, 'POST', {});
	});

	async function toggle(message: ThreadMessage) {
		if (openIds.includes(message.id)) {
			openIds = openIds.filter((id) => id !== message.id);
			return;
		}
		openIds = [...openIds, message.id];

		if (bodies[message.id] || !message.body_key) return;

		loading = message.id;
		errorMessage = '';
		try {
			const res = await fetch(`/api/email/messages/${message.id}/body`);
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				errorMessage = body.error ?? 'Could not read that message.';
			} else {
				const payload = (await res.json()) as {
					body: string | null;
					format: 'text' | 'html' | null;
				};
				if (payload.body) bodies = { ...bodies, [message.id]: { body: payload.body, format: payload.format } };
			}
		} catch {
			errorMessage = 'Could not read that message.';
		}
		loading = null;
	}

	async function correct(severity: Severity) {
		busy = true;
		errorMessage = '';
		const result = await apiWrite(`/api/email/threads/${data.thread.id}/correct`, 'POST', {
			severity
		});
		if (!result.ok) errorMessage = result.error ?? 'Could not save that.';
		else await invalidateAll();
		busy = false;
	}

	async function archive() {
		busy = true;
		const undo = data.thread.archived_at ? '?undo=true' : '';
		const result = await apiWrite(`/api/email/threads/${data.thread.id}/archive${undo}`, 'POST', {});
		if (!result.ok) errorMessage = result.error ?? 'Could not archive that.';
		else await invalidateAll();
		busy = false;
	}

	function who(message: ThreadMessage): string {
		if (message.from_name && message.from_email) return `${message.from_name} <${message.from_email}>`;
		return message.from_email ?? 'Unknown sender';
	}

	const effective = $derived(data.thread.severity_override ?? data.thread.severity);
	const effectiveCategory = $derived(data.thread.category_override ?? data.thread.category);
</script>

<svelte:head><title>{data.thread.subject ?? 'Thread'}</title></svelte:head>

<nav class="crumbs mono" aria-label="Breadcrumb">
	<a href="/mail">Mail</a> <span aria-hidden="true">/</span> <span>Thread</span>
</nav>

<header class="head">
	<h1>{data.thread.subject ?? '(no subject)'}</h1>
	<p class="meta">
		{data.messages.length} message{data.messages.length === 1 ? '' : 's'}
		{#if data.thread.first_at}&middot; {formatMoment(data.thread.first_at)}{/if}
		{#if data.thread.last_at && data.thread.last_at !== data.thread.first_at}
			to {formatMoment(data.thread.last_at)}
		{/if}
		{#if data.thread.client_name}
			&middot; <a href="/clients/{data.thread.client_id}">{data.thread.client_name}</a>
		{/if}
	</p>
</header>

{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}

<div class="triage">
	<div class="chips">
		<span class="sev sev-{effective ?? 'none'}">
			{effective ? SEVERITY_LABELS[effective] : 'Untriaged'}
		</span>
		{#if effectiveCategory}
			<span class="cat">{CATEGORY_LABELS[effectiveCategory]}</span>
		{/if}
		{#if data.thread.severity_override}
			<span class="tiny">You set this. The model said {data.thread.severity}.</span>
		{/if}
	</div>

	<div class="fixes">
		{#each SEVERITIES as severity (severity)}
			{#if severity !== effective}
				<button type="button" class="fix" disabled={busy} title={SEVERITY_HELP[severity]} onclick={() => correct(severity)}>
					{SEVERITY_LABELS[severity]}
				</button>
			{/if}
		{/each}
		<button type="button" class="fix" disabled={busy} onclick={archive}>
			{data.thread.archived_at ? 'Unarchive' : 'Archive'}
		</button>
	</div>
	<p class="tiny">
		Archiving files it here. Your Gmail is untouched, because this app has no permission
		to change it.
	</p>
</div>

{#if data.thread.summary}
	<Card title="Summary" subtitle={data.thread.gist ?? undefined}>
		<p class="summary">{data.thread.summary}</p>
		{#if data.thread.summary_at}
			<p class="tiny">
				Written {formatMoment(data.thread.summary_at)}
				{#if data.thread.summary_model}by {data.thread.summary_model}{/if}.
				{#if data.thread.last_at && data.thread.summary_at < data.thread.last_at}
					The thread has had messages since, so this does not cover them.
				{/if}
			</p>
		{/if}
	</Card>
{/if}

<ul class="messages">
	{#each data.messages as message (message.id)}
		{@const isOpen = openIds.includes(message.id)}
		<li>
			<button class="row" type="button" aria-expanded={isOpen} onclick={() => toggle(message)}>
				<span class="from">{who(message)}</span>
				<span class="when mono">{formatMoment(message.sent_at)}</span>
			</button>

			{#if isOpen}
				{#if message.to_emails}<p class="to">To {message.to_emails}</p>{/if}
				{#if bodies[message.id]}
					<EmailBody body={bodies[message.id].body} format={bodies[message.id].format} />
				{:else if loading === message.id}
					<p class="tiny">Reading...</p>
				{:else}
					<p class="tiny">No body was stored for this message.</p>
				{/if}
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
		margin-bottom: var(--space-3);
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

	.triage {
		margin-bottom: var(--space-4);
	}

	.chips,
	.fixes {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	.sev,
	.cat {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 1px 8px;
		border-radius: 999px;
		border: 1px solid var(--border);
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
		padding: 0 0 var(--space-2);
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
		margin: 0 0 var(--space-2);
		font-size: var(--text-xs);
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}
</style>
