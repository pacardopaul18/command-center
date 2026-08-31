<script lang="ts">
	import {
		buildComposeUrl,
		composeAsText,
		composeFits,
		MAX_COMPOSE_URL
	} from '$lib/gmail-compose';

	/**
	 * A reply or a forward, written by Paul.
	 *
	 * The previous version of this was a steering box with the model as the only
	 * author: the one thing you could not do on a mail screen was write. Here
	 * the person is the author by default and the model is two buttons they may
	 * choose to press.
	 *
	 * Nothing typed here is stored. An AI draft persists, because it cost money
	 * and regenerating it would be paying twice, but the edited version belongs
	 * to this visit only. That split is deliberate: the stored draft is the
	 * model's output, and this is Paul's version of it.
	 *
	 * The app still cannot send. "Send via Gmail" opens Gmail's compose window
	 * with the message in it, and the person presses Send there.
	 */

	let {
		mode,
		to = $bindable(''),
		cc = $bindable(''),
		subject = $bindable(''),
		body = $bindable(''),
		authuser,
		busy = false,
		attachmentCount = 0,
		onDraft,
		onRephrase,
		onClose
	}: {
		mode: 'reply' | 'forward';
		to?: string;
		cc?: string;
		subject?: string;
		body?: string;
		authuser: string | null;
		busy?: boolean;
		attachmentCount?: number;
		onDraft: () => void;
		onRephrase: () => void;
		onClose: () => void;
	} = $props();

	let copied = $state(false);
	let bodyBox: HTMLTextAreaElement | null = $state(null);

	const fields = $derived({ authuser, to, cc, subject, body });
	const fits = $derived(composeFits(fields));
	const url = $derived(buildComposeUrl(fields));
	const overBy = $derived(Math.max(0, url.length - MAX_COMPOSE_URL));

	/** A forward with nobody to forward to is the one field that must be filled. */
	const missingTo = $derived(mode === 'forward' && to.trim() === '');

	export function focusBody() {
		bodyBox?.focus();
		bodyBox?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	async function copyOut() {
		try {
			await navigator.clipboard.writeText(composeAsText(fields));
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			copied = false;
		}
	}
</script>

<section class="composer" aria-label={mode === 'reply' ? 'Reply' : 'Forward'}>
	<header>
		<h2>{mode === 'reply' ? 'Reply' : 'Forward'}</h2>
		<button type="button" class="close" onclick={onClose} aria-label="Close">Close</button>
	</header>

	<p class="fine">
		This app cannot send email and never will. Send via Gmail opens Gmail with this message
		already in it, and you press Send there.
	</p>

	{#if mode === 'forward' && attachmentCount > 0}
		<p class="warn" role="status">
			{attachmentCount}
			{attachmentCount === 1 ? 'attachment stays' : 'attachments stay'} here. Only text travels
			to Gmail, so attach {attachmentCount === 1 ? 'it' : 'them'} again there if the file matters.
		</p>
	{/if}

	<label class="field">
		<span>To</span>
		<input type="text" bind:value={to} spellcheck="false" autocomplete="off" />
	</label>
	{#if missingTo}
		<p class="warn" role="alert">A forward needs somebody to forward to.</p>
	{/if}

	<label class="field">
		<span>Cc</span>
		<input type="text" bind:value={cc} spellcheck="false" autocomplete="off" />
	</label>

	<label class="field">
		<span>Subject</span>
		<input type="text" bind:value={subject} />
	</label>

	<label class="field body">
		<span>Message</span>
		<textarea bind:this={bodyBox} bind:value={body} rows="10"></textarea>
	</label>

	<div class="assist">
		<button type="button" class="secondary sm" disabled={busy} onclick={onDraft}>
			{busy ? 'Working...' : 'Draft it for me'}
		</button>
		<button
			type="button"
			class="secondary sm"
			disabled={busy || body.trim() === ''}
			title={body.trim() ? undefined : 'Write something first'}
			onclick={onRephrase}
		>
			Rephrase mine
		</button>
	</div>

	<div class="actions">
		{#if fits}
			<a
				class="primary"
				class:disabled={missingTo}
				href={missingTo ? undefined : url}
				target="_blank"
				rel="noopener noreferrer"
				aria-disabled={missingTo}
			>
				Send via Gmail
			</a>
		{:else}
			<button type="button" class="primary" onclick={copyOut}>
				{copied ? 'Copied' : 'Copy the message'}
			</button>
		{/if}
		<button type="button" class="secondary" onclick={copyOut}>
			{copied ? 'Copied' : 'Copy'}
		</button>
	</div>

	{#if !fits}
		<p class="warn" role="status">
			Too long to hand to Gmail in a link, by about {overBy} characters. Gmail would cut the
			ending off without saying so, so copy it and paste it into a new message instead.
		</p>
	{/if}
</section>

<style>
	.composer {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
	}

	header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
	}

	h2 {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: 700;
	}

	.close {
		background: none;
		border: 0;
		padding: 2px 4px;
		font: inherit;
		font-size: var(--text-sm);
		color: var(--text-secondary);
		cursor: pointer;
		text-decoration: underline;
	}

	.fine {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.field span {
		font-size: var(--text-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--text-secondary);
	}

	input,
	textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 8px 10px;
		font: inherit;
		font-size: var(--text-sm);
		color: var(--ink);
		background: var(--surface-page);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
	}

	textarea {
		resize: vertical;
		min-height: 9rem;
		line-height: 1.6;
	}

	input:focus-visible,
	textarea:focus-visible {
		outline: 2px solid var(--navy);
		outline-offset: 1px;
	}

	.assist,
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.primary,
	.secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 8px 14px;
		border-radius: var(--radius-sm);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		text-decoration: none;
	}

	.primary {
		background: var(--navy);
		border: 1px solid var(--navy);
		color: #fff;
	}

	.primary.disabled {
		opacity: 0.5;
		pointer-events: none;
	}

	.secondary {
		background: var(--surface-card);
		border: 1px solid var(--border-strong);
		color: var(--ink);
	}

	.sm {
		padding: 6px 10px;
		font-size: var(--text-xs);
	}

	.warn {
		margin: 0;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--gold);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
	}
</style>
