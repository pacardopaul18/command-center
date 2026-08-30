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

	/**
	 * Bodies the server sent, merged with any fetched here since.
	 *
	 * A derived merge rather than state seeded from the load. Effects do not run
	 * during server rendering, so seeding through one left the first paint with
	 * no body at all and the message appeared only after hydration; and seeding
	 * at declaration would go stale when navigating between threads, which reuses
	 * this component. Merging is correct in both cases and needs no lifecycle.
	 */
	let fetched = $state<Record<string, { body: string; format: 'text' | 'html' | null }>>({});
	let toggled = $state<Record<string, boolean>>({});
	let loading = $state<string | null>(null);
	let busy = $state(false);
	let errorMessage = $state('');

	const bodies = $derived({ ...data.bodies, ...fetched });

	/** Open by default per the server, minus anything collapsed here. */
	const openIds = $derived(
		data.messages
			.map((m) => m.id)
			.filter((id) => (id in toggled ? toggled[id] : data.open_ids.includes(id)))
	);

	// Reading it marks it read. Not a button: opening a thread is the act.
	$effect(() => {
		const id = data.thread.id;
		if (data.thread.read_at) return;
		apiWrite(`/api/email/threads/${id}/read`, 'POST', {});
	});

	async function toggle(message: ThreadMessage) {
		const isOpen = openIds.includes(message.id);
		toggled = { ...toggled, [message.id]: !isOpen };
		if (isOpen) return;

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
				if (payload.body) {
					fetched = { ...fetched, [message.id]: { body: payload.body, format: payload.format } };
				}
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

	let drafting = $state(false);
	let draftEdit = $state<string | null>(null);
	let copied = $state(false);

	/** The edit if there is one, otherwise what the model wrote. */
	const draftText = $derived(
		draftEdit ?? data.draft?.edited_body ?? data.draft?.body ?? ''
	);

	/** True when the thread has moved on since the draft was written. */
	const draftStale = $derived(
		Boolean(
			data.draft?.based_on_last_at &&
				data.thread.last_at &&
				data.draft.based_on_last_at < data.thread.last_at
		)
	);

	async function writeDraft() {
		drafting = true;
		errorMessage = '';
		draftEdit = null;
		const result = await apiWrite(`/api/email/threads/${data.thread.id}/draft`, 'POST', {});
		if (!result.ok) errorMessage = result.error ?? 'Could not write a draft.';
		else await invalidateAll();
		drafting = false;
	}

	async function saveEdit() {
		if (draftEdit === null) return;
		drafting = true;
		const result = await apiWrite(`/api/email/threads/${data.thread.id}/draft`, 'PATCH', {
			body: draftEdit
		});
		if (!result.ok) errorMessage = result.error ?? 'Could not save that edit.';
		else {
			draftEdit = null;
			await invalidateAll();
		}
		drafting = false;
	}

	/**
	 * Copies the draft out. This is as far as the app goes, by design: there is
	 * no send scope and no compose scope, so a reply leaves here as text on a
	 * clipboard and a person sends it.
	 */
	async function copyDraft() {
		try {
			await navigator.clipboard.writeText(draftText);
			copied = true;
			setTimeout(() => (copied = false), 4000);
			await apiWrite(`/api/email/threads/${data.thread.id}/draft/copied`, 'POST', {});
		} catch {
			errorMessage = 'Could not reach the clipboard. Select the text and copy it.';
		}
	}

	function fileSize(bytes: number | null): string {
		if (bytes === null) return 'unknown size';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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


<section class="draft">
	<div class="draft-head">
		<h2>Reply</h2>
		<div class="draft-actions">
			<button type="button" class="fix" disabled={drafting} onclick={writeDraft}>
				{drafting ? 'Writing...' : data.draft ? 'Write it again' : 'Draft a reply'}
			</button>
			{#if data.draft}
				<button type="button" class="fix" onclick={copyDraft}>
					{copied ? 'Copied' : 'Copy'}
				</button>
			{/if}
		</div>
	</div>

	<p class="tiny">
		This app cannot send email and never will. It has no permission to send, reply or
		create a draft in Gmail, so a reply leaves here by being copied out and sent by you.
	</p>

	{#if data.draft}
		{#if draftStale}
			<p class="warn" role="status">
				The thread has had a message since this was written. Write it again before
				sending.
			</p>
		{/if}

		<textarea
			rows="12"
			value={draftText}
			oninput={(e) => (draftEdit = (e.currentTarget as HTMLTextAreaElement).value)}
			aria-label="Proposed reply"
		></textarea>

		<p class="tiny">
			{#if draftEdit !== null}
				<button type="button" class="fix" disabled={drafting} onclick={saveEdit}>Save edit</button>
				Your changes are kept next to the original, not over it.
			{:else}
				Written by {data.draft.model ?? 'the model'}.
				{#if data.draft.edited_at}You have edited it.{/if}
				{#if data.draft.copied_at}Copied {formatMoment(data.draft.copied_at)}.{/if}
			{/if}
		</p>
	{:else}
		<p class="tiny">
			No draft yet. It reads the whole thread, anything known about the client, and how
			you write in your own sent messages.
		</p>
	{/if}
</section>


{#if data.attachments.length > 0}
	<section class="files">
		<h2>Attachments</h2>
		<ul>
			{#each data.attachments as file (file.id)}
				<li>
					<span class="name">{file.filename ?? 'Unnamed file'}</span>
					<span class="tiny">{file.mime_type ?? 'unknown type'} &middot; {fileSize(file.size_bytes)}</span>
				</li>
			{/each}
		</ul>
		<p class="tiny">
			Names and sizes only. The files themselves stay in Gmail until asked for.
		</p>
	</section>
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

	.draft,
	.files {
		margin: var(--space-4) 0 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		padding: var(--space-3) var(--space-4);
	}

	.draft-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.draft h2,
	.files h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--text-base);
	}

	.draft-actions {
		display: flex;
		gap: var(--space-2);
	}

	.draft textarea {
		width: 100%;
		font: inherit;
		font-size: var(--text-sm);
		line-height: 1.6;
		padding: var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface-hover);
		color: var(--text-primary);
		resize: vertical;
	}

	.warn {
		margin: 0 0 var(--space-2);
		font-size: var(--text-sm);
		border: 1px solid var(--gold);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
	}

	.files ul {
		list-style: none;
		margin: 0 0 var(--space-2);
		padding: 0;
	}

	.files li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: baseline;
		padding: var(--space-1) 0;
	}

	.files .name {
		font-weight: 600;
		overflow-wrap: anywhere;
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
