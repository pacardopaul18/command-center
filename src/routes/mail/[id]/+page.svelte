<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { apiWrite } from '$lib/http';
	import { formatMoment } from '$lib/format';
	import { SEVERITIES, SEVERITY_HELP, SEVERITY_LABELS, CATEGORY_LABELS } from '$lib/types-mail';
	import type { Severity } from '$lib/types-mail';
	import EmailBody from '$lib/components/EmailBody.svelte';
	import MailComposer from '$lib/components/MailComposer.svelte';
	import { forwardHeader, replyRecipients } from '$lib/reply-recipients';
	import type { PageData } from './$types';
	import type { ThreadMessage } from './+page';

	/**
	 * One thread, rebuilt per CR-1.
	 *
	 * Messages newest first, the latest open on arrival with its body already on
	 * the page. Everything that can be done has a visible control: expand, reply,
	 * forward, correct, archive, download.
	 *
	 * None of those controls can send anything. Reply and Forward look exactly
	 * like a send surface and are not one: Reply focuses the drafting box, and
	 * Forward composes a block and puts it on the clipboard. There is no scope
	 * that would allow otherwise, and the copy says so where somebody would
	 * reasonably assume there is.
	 */

	let { data }: { data: PageData } = $props();

	/** Every request from this page carries the account. See the load. */
	const acct = $derived(data.account ? `?account=${encodeURIComponent(data.account)}` : '');
	const acctAmp = $derived(data.account ? `&account=${encodeURIComponent(data.account)}` : '');

	let fetched = $state<Record<string, { body: string; format: 'text' | 'html' | null }>>({});
	let toggled = $state<Record<string, boolean>>({});
	let loading = $state<string | null>(null);
	let busy = $state(false);
	let errorMessage = $state('');
	/**
	 * The composer, when one is open.
	 *
	 * Session local by ruling: an AI draft persists because it cost money, but
	 * what Paul types is his version of it and belongs to this visit. Editing a
	 * draft here never writes back over the model's output.
	 */
	let composer = $state<'reply' | 'forward' | null>(null);
	let cTo = $state('');
	let cCc = $state('');
	let cSubject = $state('');
	let cBody = $state('');
	let composerBox: { focusBody: () => void } | null = $state(null);
	let copied = $state('');
	let attachmentsOpen = $state(true);

	const bodies = $derived({ ...data.bodies, ...fetched });

	const openIds = $derived(
		data.messages
			.map((m) => m.id)
			.filter((id) => (id in toggled ? toggled[id] : data.open_ids.includes(id)))
	);

	/** Newest first, which is the order a person reads a thread they know. */
	const ordered = $derived([...data.messages].reverse());

	const effective = $derived(data.thread.severity_override ?? data.thread.severity);
	const effectiveCategory = $derived(data.thread.category_override ?? data.thread.category);

	const attachmentBytes = $derived(
		data.attachments.reduce((n, a) => n + (a.size_bytes ?? 0), 0)
	);

	/** How many people are in the thread, counted by address rather than name. */
	const people = $derived(
		new Set(
			data.messages
				.map((m) => (m.from_email ?? '').trim().toLowerCase())
				.filter(Boolean)
		).size
	);

	/**
	 * The same thread in Gmail, for everything this app deliberately cannot do.
	 * `authuser` pins the mailbox, so a two-account reader does not land in
	 * whichever account Google saw most recently.
	 */
	const gmailUrl = $derived(
		data.account_email
			? `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(data.account_email)}#all/${encodeURIComponent(data.thread.provider_thread_id)}`
			: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(data.thread.provider_thread_id)}`
	);

	/**
	 * Which way the draft on screen was written.
	 *
	 * Held for this visit only. The drafts table has no column for it, and
	 * adding one is a schema change for a label, so on reload the draft is
	 * honestly just "Draft" rather than claiming an origin it cannot know.
	 */
	let draftMode = $state<'from_your_words' | 'from_thread' | null>(null);

	const draftText = $derived(data.draft?.edited_body ?? data.draft?.body ?? '');

	const draftStale = $derived(
		Boolean(
			data.draft?.based_on_last_at &&
				data.thread.last_at &&
				data.draft.based_on_last_at < data.thread.last_at
		)
	);

	// Opening a thread is the act of reading it. Not a button.
	$effect(() => {
		if (data.thread.read_at) return;
		apiWrite(`/api/email/threads/${data.thread.id}/read${acct}`, 'POST', {});
	});

	/** The subject a reply or forward carries, without stacking prefixes. */
	function prefixed(prefix: 'Re:' | 'Fwd:'): string {
		const subject = data.thread.subject ?? '';
		return new RegExp(`^${prefix}`, 'i').test(subject.trim())
			? subject
			: `${prefix} ${subject}`.trim();
	}

	/**
	 * Opens the reply composer.
	 *
	 * `sender` is the per-message icon: that message's author goes in To and the
	 * rest of the thread still lands in Cc, so replying to one person does not
	 * quietly drop everybody else.
	 */
	function openReply(sender?: string | null) {
		const { to, cc } = replyRecipients(data.messages, data.account_email, sender ?? null);
		cTo = to.join(', ');
		cCc = cc.join(', ');
		cSubject = prefixed('Re:');
		cBody = '';
		composer = 'reply';
		queueMicrotask(() => composerBox?.focusBody());
	}

	/**
	 * Opens the forward composer.
	 *
	 * To is deliberately empty: a forward goes somewhere new, and prefilling it
	 * with anyone from the thread would be a guess with a stranger's mail in it.
	 */
	function openForward() {
		const newest = ordered[0];
		cTo = '';
		cCc = '';
		cSubject = prefixed('Fwd:');
		cBody =
			forwardHeader(
				newest?.from_name
					? `${newest.from_name} <${newest.from_email ?? ''}>`
					: (newest?.from_email ?? null),
				newest ? formatMoment(newest.sent_at) : '',
				newest?.subject ?? data.thread.subject,
				newest?.to_emails ?? null
			) + (newest ? (bodies[newest.id]?.body ?? newest.snippet ?? '') : '');
		composer = 'forward';
		queueMicrotask(() => composerBox?.focusBody());
	}

	async function toggle(message: ThreadMessage) {
		const isOpen = openIds.includes(message.id);
		toggled = { ...toggled, [message.id]: !isOpen };
		if (isOpen || bodies[message.id] || !message.body_key) return;

		loading = message.id;
		errorMessage = '';
		try {
			const res = await fetch(`/api/email/messages/${message.id}/body${acct}`);
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
			errorMessage = 'Could not reach the server.';
		}
		loading = null;
	}

	async function correct(severity: Severity) {
		busy = true;
		errorMessage = '';
		const result = await apiWrite(
			`/api/email/threads/${data.thread.id}/correct${acct}`,
			'POST',
			{ severity }
		);
		if (!result.ok) errorMessage = result.error ?? 'Could not save that.';
		else await invalidateAll();
		busy = false;
	}

	async function archive() {
		busy = true;
		const undo = data.thread.archived_at ? '&undo=true' : '';
		const result = await apiWrite(
			`/api/email/threads/${data.thread.id}/archive${acct}${acct ? undo : undo.replace('&', '?')}`,
			'POST',
			{}
		);
		if (!result.ok) errorMessage = result.error ?? 'Could not archive that.';
		else await invalidateAll();
		busy = false;
	}

	/**
	 * The two assist buttons, one route.
	 *
	 * "Draft it for me" writes from the thread. "Rephrase mine" sends what Paul
	 * typed as the guidance, which is the same path the drafting pass already
	 * had. The result fills the composer, where he edits it as his own; the
	 * stored draft stays the model's output and is not written back over.
	 */
	async function draft(useMyWords: boolean) {
		busy = true;
		errorMessage = '';
		const result = await apiWrite(`/api/email/threads/${data.thread.id}/draft${acct}`, 'POST', {
			guidance: useMyWords ? cBody : null
		});
		if (!result.ok) {
			errorMessage = result.error ?? 'Could not write a draft.';
		} else {
			const payload = result.data as
				| { mode?: string; draft?: { body?: string } | null }
				| undefined;
			const mode = payload?.mode;
			draftMode = mode === 'from_your_words' || mode === 'from_thread' ? mode : null;
			if (payload?.draft?.body) cBody = payload.draft.body;
			await invalidateAll();
		}
		busy = false;
	}

	/**
	 * Every attachment, one request each.
	 *
	 * Deliberately not a bulk endpoint: each file goes through the same
	 * ownership-checked route as its own row, so there is one download path to
	 * reason about rather than two. Staggered because browsers drop downloads
	 * fired in the same tick.
	 */
	function downloadAll() {
		data.attachments.forEach((file, i) => {
			setTimeout(() => {
				const a = document.createElement('a');
				a.href = `/api/email/attachments/${file.id}/download${acct}`;
				a.download = file.filename ?? 'attachment';
				document.body.appendChild(a);
				a.click();
				a.remove();
			}, i * 400);
		});
	}

	/**
	 * Copies text out.
	 *
	 * Every "copy" on this screen is the same shape and the same boundary: the
	 * text is composed here from what is already on the page, goes to the
	 * clipboard, and is never persisted, never sent, and never printed anywhere.
	 * That is the whole export path, and it is deliberately the only one.
	 */
	async function copy(what: string, label: string) {
		try {
			await navigator.clipboard.writeText(what);
			copied = label;
			setTimeout(() => (copied = ''), 1500);
		} catch {
			errorMessage = 'Could not reach the clipboard. Select the text and copy it.';
		}
	}

	function forwardBlock(): string {
		const lines = [`---------- Forwarded message ----------`];
		for (const m of data.messages) {
			lines.push(
				`From: ${m.from_name ? `${m.from_name} <${m.from_email ?? ''}>` : (m.from_email ?? 'unknown')}`,
				`Date: ${formatMoment(m.sent_at)}`,
				`Subject: ${m.subject ?? data.thread.subject ?? ''}`,
				m.to_emails ? `To: ${m.to_emails}` : '',
				'',
				bodies[m.id]?.body ?? m.snippet ?? '',
				''
			);
		}
		return lines.filter((l) => l !== undefined).join('\n');
	}

	function who(message: ThreadMessage): string {
		return message.from_name ?? message.from_email ?? 'Unknown sender';
	}

	function initials(message: ThreadMessage): string {
		const name = message.from_name ?? message.from_email ?? '?';
		return name
			.split(/[\s@.]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => w[0].toUpperCase())
			.join('');
	}

	function fileSize(bytes: number | null): string {
		if (bytes === null) return 'unknown';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	const CHIP: Record<string, string> = {
		urgent: 'chip-urgent',
		important: 'chip-important',
		routine: 'chip-routine',
		noise: 'chip-noise'
	};
</script>

<svelte:head><title>{data.thread.subject ?? 'Thread'}</title></svelte:head>

<a class="back" href="/mail{acct}">
	<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
	</svg>
	Back to mail
</a>

{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}

<div class="top">
	<div class="headings">
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

		<div class="state">
			<span class="chip {data.thread.archived_at ? 'chip-archived' : (CHIP[effective ?? ''] ?? 'chip-none')}">
				{data.thread.archived_at
					? 'Archived'
					: effective
						? SEVERITY_LABELS[effective]
						: 'Untriaged'}
			</span>
			{#if effectiveCategory}
				<span class="cat mono">{CATEGORY_LABELS[effectiveCategory]}</span>
			{/if}
			{#if data.thread.severity_override}
				<span class="note">You set this. The model said {data.thread.severity}.</span>
			{/if}
		</div>

		<div class="state">
			<span class="fixes-label mono">Change to</span>
			{#each SEVERITIES as severity (severity)}
				{#if severity !== effective}
					<button
						type="button"
						class="pill"
						disabled={busy}
						title={SEVERITY_HELP[severity]}
						onclick={() => correct(severity)}
					>
						{SEVERITY_LABELS[severity]}
					</button>
				{/if}
			{/each}
			<button type="button" class="pill" disabled={busy} onclick={archive}>
				{data.thread.archived_at ? 'Unarchive' : 'Archive'}
			</button>
		</div>

		<p class="fine">
			Archiving files it here. Your Gmail is untouched, because this app has no permission to
			change it.
		</p>
	</div>

	<section class="tools">
		<button
			type="button"
			class="tools-head"
			aria-expanded={attachmentsOpen}
			onclick={() => (attachmentsOpen = !attachmentsOpen)}
		>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--navy-700)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
			</svg>
			<span class="tools-title">
				{data.attachments.length === 0
					? 'No attachments'
					: `${data.attachments.length} attachment${data.attachments.length === 1 ? '' : 's'}`}
			</span>
			<span class="grow"></span>
			{#if data.attachments.length > 0}
				<span class="mono dim">{fileSize(attachmentBytes)}</span>
			{/if}
		</button>

		{#if attachmentsOpen && data.attachments.length > 0}
			<ul class="files">
				{#each data.attachments as file (file.id)}
					<li>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
						</svg>
						<span class="fname">{file.filename ?? 'Unnamed file'}</span>
						<span class="mono dim">{fileSize(file.size_bytes)}</span>
						<a
							class="dl"
							href="/api/email/attachments/{file.id}/download{acct}"
							title="Download {file.filename ?? 'file'}"
							download
						>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" />
							</svg>
							<span class="visually-hidden">Download {file.filename ?? 'file'}</span>
						</a>
					</li>
				{/each}
			</ul>
			{#if data.attachments.length > 1}
				<div class="pad downloads">
					<button type="button" class="ghost" onclick={downloadAll}>Download all</button>
				</div>
			{/if}
			<p class="fine pad">Fetched from Gmail when you ask. Nothing is stored here.</p>
		{/if}

		<div class="tools-foot">
			<a class="ghost" href={gmailUrl} target="_blank" rel="noopener noreferrer">
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
					<path d="M15 3h6v6" />
					<path d="M10 14 21 3" />
				</svg>
				Open in Gmail
			</a>
			<button
				type="button"
				class="ghost"
				onclick={() => copy(data.thread.summary ?? data.thread.gist ?? '', 'summary')}
			>
				{copied === 'summary' ? 'Copied' : 'Copy summary'}
			</button>
			<span class="mono fine count">{people} {people === 1 ? 'person' : 'people'}</span>
		</div>
	</section>
</div>

<div class="cols">
	<div class="messages">
		{#each ordered as message (message.id)}
			{@const isOpen = openIds.includes(message.id)}
			<article class="msg">
				<div class="msg-head-row">
				<button class="msg-head" type="button" aria-expanded={isOpen} onclick={() => toggle(message)}>
					<span class="avatar" aria-hidden="true">{initials(message)}</span>
					<span class="from">{who(message)}</span>
					{#if message.from_email}<span class="mono dim addr">{message.from_email}</span>{/if}
					<span class="grow"></span>
					<span class="mono dim">{formatMoment(message.sent_at)}</span>
					<svg class="chev" class:open={isOpen} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M6 9l6 6 6-6" />
					</svg>
				</button>
				<button
					class="msg-reply"
					type="button"
					aria-label="Reply to {who(message)}"
					title="Reply to {who(message)}"
					onclick={() => openReply(message.from_email)}
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M9 17l-5-5 5-5" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" />
					</svg>
				</button>
				</div>

				{#if isOpen}
					<div class="msg-body">
						{#if message.to_emails}<p class="fine">To {message.to_emails}</p>{/if}
						{#if bodies[message.id]}
							<EmailBody body={bodies[message.id].body} format={bodies[message.id].format} />
						{:else if loading === message.id}
							<p class="fine">Reading...</p>
						{:else}
							<p class="fine">No body was stored for this message.</p>
						{/if}
					</div>
				{:else if message.snippet}
					<p class="preview">{message.snippet}</p>
				{/if}
			</article>
		{/each}

	</div>

	<div class="rail">
		<!--
			The card always renders. It used to disappear when there was no
			summary, which is most threads until triage has run, and a card that
			vanishes tells the reader nothing about why. D113 again.
		-->
		<section class="card">
			<h2>Summary</h2>
			{#if data.thread.summary}
				{#if data.thread.gist}<p class="gist">{data.thread.gist}</p>{/if}
				<p class="prose">{data.thread.summary}</p>
				{#if data.thread.summary_at}
					<p class="fine mono">
						Written {formatMoment(data.thread.summary_at)}
						{#if data.thread.summary_model}by {data.thread.summary_model}{/if}.
						{#if data.thread.last_at && data.thread.summary_at < data.thread.last_at}
							The thread has moved since.
						{/if}
					</p>
				{/if}
			{:else if data.thread.gist}
				<!--
					A gist means triage has already run, so saying triage is still to
					come would contradict the line above it. What is missing here is
					the longer summary, which is a separate pass.
				-->
				<p class="gist">{data.thread.gist}</p>
				<p class="fine">
					That is the one line from triage. No full summary yet, which is a
					separate pass and runs from Settings.
				</p>
			{:else}
				<p class="fine">
					No summary yet. Triage runs at the next firing, or from Settings.
				</p>
			{/if}
		</section>

		{#if composer}
			<MailComposer
				bind:this={composerBox}
				mode={composer}
				bind:to={cTo}
				bind:cc={cCc}
				bind:subject={cSubject}
				bind:body={cBody}
				authuser={data.account_email}
				{busy}
				attachmentCount={composer === 'forward' ? data.attachments.length : 0}
				onDraft={() => draft(false)}
				onRephrase={() => draft(true)}
				onClose={() => (composer = null)}
			/>
		{:else}
			<section class="card">
				<h2>Reply</h2>
				<p class="fine">
					Reply or Forward opens a composer here. You write the message, Gmail sends it, and
					this app never can.
				</p>
				<div class="draft-buttons">
					<button type="button" class="primary sm" onclick={() => openReply()}>Reply</button>
					<button type="button" class="secondary sm" onclick={openForward}>Forward</button>
				</div>
			</section>
		{/if}

		{#if data.draft}
			<section class="card">
				<p class="fine mono label">
					{#if draftMode === 'from_your_words'}
						Draft, built on your words
					{:else if draftMode === 'from_thread'}
						Draft, written from the thread
					{:else}
						Saved draft
					{/if}
				</p>
				{#if draftStale}
					<p class="warn">The thread has had a message since this was written.</p>
				{/if}
				<p class="prose pre">{draftText}</p>
				<div class="draft-buttons">
					<button
						type="button"
						class="secondary sm"
						onclick={() => {
							if (!composer) openReply();
							cBody = draftText;
							composerBox?.focusBody();
						}}
					>
						Use it in the composer
					</button>
					<button type="button" class="secondary sm" onclick={() => copy(draftText, 'draft')}>
						{copied === 'draft' ? 'Copied' : 'Copy draft'}
					</button>
				</div>
				<p class="fine">
					The model's version, kept as written. Editing in the composer does not change it.
				</p>
			</section>
		{/if}
	</div>
</div>

<style>
	.back {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-left: -10px;
		padding: 6px 10px;
		border-radius: var(--radius-sm);
		text-decoration: none;
		font-size: var(--text-base);
		font-weight: 500;
		color: var(--navy-700);
		transition: background-color var(--transition-fast);
	}

	.back:hover {
		background: var(--navy-50);
	}

	.top {
		display: flex;
		gap: var(--space-5);
		align-items: flex-start;
		justify-content: space-between;
		flex-wrap: wrap;
		margin-top: var(--space-3);
	}

	.headings {
		flex: 1;
		min-width: min(420px, 100%);
	}

	h1 {
		font-size: var(--text-2xl);
		font-weight: 700;
		margin: 0 0 6px;
		overflow-wrap: anywhere;
	}

	.meta {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.state {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-3);
		flex-wrap: wrap;
	}

	.chip,
	.cat {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		padding: 4px 12px;
		border-radius: var(--radius-pill);
		white-space: nowrap;
	}

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
	.chip-noise,
	.chip-none {
		background: #f0efea;
		color: var(--muted);
	}
	.chip-archived {
		background: var(--navy-100);
		color: var(--navy);
	}

	.cat {
		background: transparent;
		color: var(--text-secondary);
		padding-left: 0;
	}

	.note,
	.fine {
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.fine {
		margin: var(--space-2) 0 0;
	}

	.fine.pad {
		padding: 0 16px 12px;
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

	.tools {
		width: 380px;
		max-width: 100%;
		flex-shrink: 0;
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		overflow: hidden;
	}

	.tools-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: 12px 16px;
		background: none;
		border: 0;
		cursor: pointer;
		font: inherit;
		text-align: left;
		color: inherit;
		transition: background-color var(--transition-fast);
	}

	.tools-head:hover {
		background: var(--surface-hover);
	}

	.tools-title {
		font-weight: 600;
		color: var(--text-link);
	}

	.grow {
		flex: 1;
	}

	.dim {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.files {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.files li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 9px 16px;
		border-top: 1px solid var(--border-thin);
	}

	.fname {
		flex: 1;
		min-width: 0;
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text-link);
		overflow-wrap: anywhere;
	}

	.dl {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		background: var(--surface-card);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		color: var(--navy-700);
		transition: background-color var(--transition-fast);
	}

	.dl:hover {
		background: var(--navy-50);
	}

	/* Right aligned, as the design has it: a footer action, not a list item. */
	.downloads {
		display: flex;
		justify-content: flex-end;
	}

	.tools-foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		padding: 8px 12px;
		border-top: 1px solid var(--border-thin);
	}

	/* The count sits opposite the controls, which is what pushes it right. */
	.tools-foot .count {
		margin-left: auto;
		color: var(--text-secondary);
	}

	.ghost {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		text-decoration: none;
		padding: 6px 10px;
		background: none;
		border: 0;
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--navy-700);
		transition: background-color var(--transition-fast);
	}

	.ghost:hover {
		background: var(--navy-50);
	}

	.cols {
		display: grid;
		grid-template-columns: minmax(420px, 1fr) 380px;
		gap: var(--space-5);
		align-items: start;
		margin-top: var(--space-5);
	}

	/* One column on a phone, and the rail follows the messages rather than
	   sitting beside them. The suite checks 412px for sideways scroll. */
	@media (max-width: 900px) {
		.cols {
			grid-template-columns: 1fr;
		}

		.tools {
			width: 100%;
		}
	}

	.messages {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}

	.msg {
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		overflow: hidden;
	}

	.msg-head-row {
		display: flex;
		align-items: stretch;
	}

	.msg-head-row .msg-head {
		flex: 1;
		min-width: 0;
	}

	/* Its own control, beside the expander rather than inside it. */
	.msg-reply {
		display: inline-flex;
		align-items: center;
		padding: 0 12px;
		background: none;
		border: 0;
		border-left: 1px solid var(--border-thin);
		color: var(--navy-700);
		cursor: pointer;
	}

	.msg-reply:hover {
		background: var(--surface-hover);
	}

	.msg-head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		padding: 14px 20px;
		background: none;
		border: 0;
		cursor: pointer;
		font: inherit;
		text-align: left;
		color: inherit;
		transition: background-color var(--transition-fast);
	}

	.msg-head:hover {
		background: var(--surface-hover);
	}

	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		flex-shrink: 0;
		border-radius: 50%;
		background: var(--navy-100);
		color: var(--navy);
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.from {
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.addr {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 16rem;
	}

	.chev {
		flex-shrink: 0;
		transition: transform var(--transition-fast);
	}

	.chev.open {
		transform: rotate(180deg);
	}

	.msg-body {
		padding: 4px 24px 20px 64px;
		border-top: 1px solid var(--border-thin);
	}

	.preview {
		margin: 0;
		padding: 0 20px 14px 64px;
		font-size: var(--text-sm);
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.primary,
	.secondary {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: 9px 16px;
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: var(--text-base);
		font-weight: 500;
		transition: background-color var(--transition-fast);
	}

	.primary {
		background: var(--navy);
		color: var(--text-inverse);
		border: 1px solid transparent;
	}

	.primary:hover:not(:disabled) {
		background: var(--navy-700);
	}

	.secondary {
		background: var(--surface-card);
		color: var(--ink);
		border: 1px solid var(--border-strong);
	}

	.secondary:hover:not(:disabled) {
		background: var(--surface-hover);
	}

	.primary:disabled,
	.secondary:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.sm {
		padding: 6px 12px;
		font-size: var(--text-sm);
	}

	.rail {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
	}

	.card {
		padding: 20px 24px;
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
	}

	.card h2 {
		font-size: var(--text-lg);
		font-weight: 700;
		margin: 0 0 8px;
	}

	.gist {
		margin: 0 0 12px;
		font-weight: 600;
		font-size: var(--text-base);
	}

	.prose {
		margin: 0;
		font-size: var(--text-base);
		line-height: 1.6;
		color: var(--text-body);
		overflow-wrap: anywhere;
	}

	.prose.pre {
		white-space: pre-line;
	}

	.draft-buttons {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-3);
		flex-wrap: wrap;
	}

	.draft {
		margin-top: var(--space-3);
		padding: 12px;
		background: var(--surface-callout);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-sm);
	}

	.warn {
		margin: 0 0 8px;
		padding: var(--space-2);
		border: 1px solid var(--gold);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
	}
</style>
