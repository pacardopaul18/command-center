<script lang="ts">
	import { looksLikeHtml, parseEmailHtml } from '$lib/email-html';
	import { splitBody, toParagraphs } from '$lib/email-text';
	import EmailNodes from './EmailNodes.svelte';

	/**
	 * One email body, rendered the way a mail client renders one.
	 *
	 * Two problems, two treatments.
	 *
	 * Rich mail is parsed into a validated tree and drawn as Svelte elements.
	 * Nothing constructs HTML and `{@html}` is never involved. See email-html.ts.
	 *
	 * Plain mail is flowed. It arrives hard-wrapped at about 72 columns by the
	 * sender's client, and rendering that in a monospace block reproduces the
	 * narrow ragged column rather than the message. The wrapped lines are joined
	 * back into paragraphs and the page wraps them in the reading font.
	 *
	 * The quote trail is collapsed either way, because it is the single biggest
	 * reason a thread reads as a wall. Collapsed is never deleted: sometimes the
	 * quoted part is exactly the thing being pointed at.
	 */

	let {
		body,
		format = null
	}: { body: string; format?: 'text' | 'html' | null } = $props();

	let showImages = $state(false);
	let showQuoted = $state(false);
	let showSignature = $state(false);

	const isHtml = $derived(format === 'html' || (format === null && looksLikeHtml(body)));

	const nodes = $derived.by(() => {
		if (!isHtml) return [];
		try {
			return parseEmailHtml(body);
		} catch {
			// A parser failure must never take out the page. The plain fallback
			// below still shows the reader the content.
			return [];
		}
	});

	const rendered = $derived(isHtml && nodes.length > 0);

	const split = $derived(rendered ? null : splitBody(body));
	const paragraphs = $derived(split ? toParagraphs(split.body) : []);
	const quotedParagraphs = $derived(split?.quoted ? toParagraphs(split.quoted) : []);

	const hasImages = $derived(isHtml && /<img\b/i.test(body));
	const imageCount = $derived(hasImages ? (body.match(/<img\b/gi) ?? []).length : 0);
</script>

{#if rendered}
	{#if hasImages && !showImages}
		<p class="aside">
			<button type="button" onclick={() => (showImages = true)}>
				Show {imageCount} image{imageCount === 1 ? '' : 's'}
			</button>
			<span class="why">
				Not loaded yet. A remote image tells the sender you opened the mail, which is why
				they are held back until you ask.
			</span>
		</p>
	{/if}
	<div class="email">
		<EmailNodes {nodes} {showImages} />
	</div>
{:else if split}
	<div class="flowed">
		{#each paragraphs as paragraph, i (i)}
			<p>{paragraph}</p>
		{/each}

		{#if paragraphs.length === 0}
			<p class="aside">This message has no text of its own.</p>
		{/if}

		{#if split.quoted}
			<p class="aside">
				<button type="button" onclick={() => (showQuoted = !showQuoted)} aria-expanded={showQuoted}>
					{showQuoted ? 'Hide quoted text' : '...'}
				</button>
				{#if !showQuoted}
					<span class="why">{quotedParagraphs.length} quoted lines from earlier in the thread.</span>
				{/if}
			</p>
			{#if showQuoted}
				<blockquote class="quoted">
					{#each quotedParagraphs as paragraph, i (i)}
						<p>{paragraph}</p>
					{/each}
				</blockquote>
			{/if}
		{/if}

		{#if split.signature}
			<div class="signature">
				<button type="button" onclick={() => (showSignature = !showSignature)} aria-expanded={showSignature}>
					{showSignature ? 'Hide signature' : 'Signature'}
				</button>
				{#if showSignature}
					<pre>{split.signature}</pre>
				{/if}
			</div>
		{/if}
	</div>
{:else}
	<pre class="plain">{body}</pre>
{/if}

<style>
	.aside {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2);
		margin: 0 0 var(--space-3);
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.aside button,
	.signature button {
		font: inherit;
		color: var(--text-primary);
		background: none;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 1px 8px;
		cursor: pointer;
	}

	.why {
		flex: 1 1 12rem;
	}

	/* Plain text, flowed in the reading font at a comfortable measure rather
	   than reproducing the sender's 72-column hard wrap. */
	.flowed {
		font-size: var(--text-sm);
		line-height: 1.6;
		max-width: 68ch;
		overflow-wrap: anywhere;
	}

	.flowed p {
		margin: 0 0 var(--space-3);
	}

	.quoted {
		margin: 0 0 var(--space-3);
		padding-left: var(--space-3);
		border-left: 2px solid var(--border);
		color: var(--text-secondary);
	}

	.signature {
		margin-top: var(--space-3);
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.signature pre {
		margin: var(--space-2) 0 0;
		white-space: pre-wrap;
		font-family: var(--font-mono);
	}

	.email {
		font-size: var(--text-sm);
		line-height: 1.6;
		/* Mail carries very long unbroken tracking links and tables laid out for a
		   desktop client. Neither may push the page sideways: the suite checks for
		   horizontal scroll at 412px. */
		overflow-wrap: anywhere;
		overflow-x: auto;
	}

	.email :global(p) {
		margin: 0 0 var(--space-3);
	}

	.email :global(a) {
		color: var(--navy, #102a4c);
	}

	/* Quote trails inside rich mail arrive as blockquotes. Dimmed and indented
	   rather than collapsed, because the parser has already dropped the markup
	   that made them shout. */
	.email :global(blockquote) {
		margin: 0 0 var(--space-3);
		padding-left: var(--space-3);
		border-left: 2px solid var(--border);
		color: var(--text-secondary);
	}

	.email :global(table) {
		border-collapse: collapse;
		max-width: 100%;
	}

	.email :global(td),
	.email :global(th) {
		padding: 2px 6px;
		vertical-align: top;
		text-align: left;
	}

	.email :global(img) {
		max-width: 100%;
		height: auto;
	}

	.email :global(h3),
	.email :global(h4),
	.email :global(h5),
	.email :global(h6) {
		margin: var(--space-3) 0 var(--space-2);
		font-size: var(--text-base);
	}

	.email :global(ul),
	.email :global(ol) {
		margin: 0 0 var(--space-3);
		padding-left: var(--space-4);
	}

	.plain {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 32rem;
		overflow-y: auto;
	}
</style>
