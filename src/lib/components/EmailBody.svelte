<script lang="ts">
	import { looksLikeHtml, parseEmailHtml } from '$lib/email-html';
	import EmailNodes from './EmailNodes.svelte';

	/**
	 * One email body, rendered the way a mail client renders it.
	 *
	 * The previous version showed the stripped-text extraction, which for any
	 * marketing email is a wall of tracking URLs. It was accurate and unreadable,
	 * which is its own kind of wrong.
	 *
	 * Nothing here constructs HTML. The source is parsed into a validated tree
	 * and rendered as Svelte elements, so markup in an email has no path to
	 * becoming markup on the page. See email-html.ts.
	 */

	let {
		body,
		format = null
	}: { body: string; format?: 'text' | 'html' | null } = $props();

	let showImages = $state(false);

	// A body recorded as html is html. One with no recorded format predates the
	// change that started keeping the rich version, so it is sniffed instead.
	const isHtml = $derived(format === 'html' || (format === null && looksLikeHtml(body)));

	const nodes = $derived.by(() => {
		if (!isHtml) return [];
		try {
			return parseEmailHtml(body);
		} catch {
			// A parser failure must never take out the page. Showing the raw text
			// is the honest fallback: the reader still sees the content.
			return [];
		}
	});

	const hasImages = $derived(
		isHtml && /<img\b/i.test(body)
	);
</script>

{#if isHtml && nodes.length > 0}
	{#if hasImages && !showImages}
		<p class="images">
			Images are not loaded.
			<button type="button" onclick={() => (showImages = true)}>Show images</button>
			<span class="why">
				A remote image in an email is a tracking pixel as often as it is a picture, and
				loading one tells the sender you opened the mail.
			</span>
		</p>
	{/if}
	<div class="email">
		<EmailNodes {nodes} {showImages} />
	</div>
{:else}
	<pre class="plain">{body}</pre>
{/if}

<style>
	.images {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2);
		margin: 0 0 var(--space-3);
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.images button {
		font: inherit;
		color: var(--text-primary);
		background: none;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 2px 8px;
		cursor: pointer;
	}

	.why {
		flex: 1 1 100%;
	}

	.email {
		font-size: var(--text-sm);
		line-height: 1.6;
		/* Mail is full of very long unbroken tracking links, and wide tables laid
		   out for a desktop client. Neither may push the page sideways: the suite
		   checks for horizontal scroll at 412px. */
		overflow-wrap: anywhere;
		overflow-x: auto;
	}

	.email :global(p) {
		margin: 0 0 var(--space-3);
	}

	.email :global(a) {
		color: var(--navy, #102a4c);
	}

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
