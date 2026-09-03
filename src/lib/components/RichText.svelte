<script lang="ts">
	import { parseRichText } from '$lib/rich-text';
	import RichNodes from './RichNodes.svelte';

	/**
	 * One rich-text value, read.
	 *
	 * Takes the HTML column and the plain column and shows whichever is really
	 * there. A row nobody has edited since the editor shipped has no HTML, and
	 * it renders as the plain text it has always been rather than as an empty
	 * space, which is what a naive `{#if html}` would have produced on every
	 * record in the database.
	 *
	 * Nothing here constructs HTML. The value is parsed into a tree and drawn as
	 * real elements by `RichNodes.svelte`. See `rich-text.ts` for why that is the
	 * approach rather than sanitising a string.
	 */

	let {
		html = null,
		text = null,
		empty = 'Nothing written yet.'
	}: { html?: string | null; text?: string | null; empty?: string } = $props();

	const nodes = $derived.by(() => {
		if (!html) return [];
		try {
			return parseRichText(html);
		} catch {
			// A parser failure must never take out the page. The plain fallback
			// below still shows the reader the content.
			return [];
		}
	});

	const rendered = $derived(nodes.length > 0);
	/* Blank-line blocks, so an old plain value keeps the shape it was written in. */
	const paragraphs = $derived(
		rendered ? [] : (text ?? '').replace(/\r\n?/g, '\n').split(/\n{2,}/).filter((p) => p.trim())
	);
</script>

{#if rendered}
	<div class="rich">
		<RichNodes {nodes} />
	</div>
{:else if paragraphs.length > 0}
	<div class="rich">
		{#each paragraphs as paragraph, i (i)}
			<p>{paragraph}</p>
		{/each}
	</div>
{:else}
	<p class="empty">{empty}</p>
{/if}

<style>
	.rich {
		max-width: 72ch;
	}

	/* Whitespace is preserved inside a plain paragraph so a list written with
	   hyphens and newlines still reads as a list. */
	.rich :global(p) {
		margin: 0 0 var(--space-3);
		white-space: pre-wrap;
	}

	.rich :global(p:last-child) {
		margin-bottom: 0;
	}

	.rich :global(h3),
	.rich :global(h4) {
		margin: var(--space-4) 0 var(--space-2);
		font-size: 1rem;
	}

	.rich :global(h3:first-child),
	.rich :global(h4:first-child) {
		margin-top: 0;
	}

	.rich :global(ul),
	.rich :global(ol) {
		margin: 0 0 var(--space-3);
		padding-left: var(--space-5);
	}

	.rich :global(li) {
		margin-bottom: 2px;
	}

	.rich :global(blockquote) {
		margin: 0 0 var(--space-3);
		padding-left: var(--space-3);
		border-left: 3px solid var(--border-thin);
		color: var(--text-secondary);
	}

	.rich :global(pre) {
		margin: 0 0 var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-2);
		background: var(--surface-hover);
		font-family: var(--font-mono, monospace);
		font-size: 0.8125rem;
		overflow-x: auto;
		white-space: pre;
	}

	.rich :global(code) {
		font-family: var(--font-mono, monospace);
		font-size: 0.875em;
	}

	.rich :global(hr) {
		margin: var(--space-4) 0;
		border: 0;
		border-top: 1px solid var(--border-thin);
	}

	.rich :global(table) {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9375rem;
	}

	.rich :global(td) {
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-thin);
		text-align: left;
	}

	.empty {
		margin: 0;
		color: var(--text-secondary);
	}
</style>
