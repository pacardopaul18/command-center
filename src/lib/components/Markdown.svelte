<script lang="ts">
	import { marked } from 'marked';
	import type { Tokens, TokensList } from 'marked';
	import MarkdownTokens from './MarkdownTokens.svelte';

	/**
	 * The one markdown renderer, closing D36. Used by SOP bodies, meeting
	 * summaries and AI drafted content, so the safety decision is made once.
	 *
	 * All content is treated as untrusted regardless of who authored it. An AI
	 * summary of a client transcript is untrusted by definition, and "Paul wrote
	 * it" is not a security property when the text arrives via an import.
	 *
	 * The safety approach is stronger than sanitising. This component never
	 * produces an HTML string and never uses {@html}. Markdown is lexed to tokens
	 * and the tokens are rendered as Svelte elements, so markup in the source has
	 * no path to becoming markup on the page. There is nothing to sanitise
	 * because no HTML is ever constructed. Raw HTML blocks in the source are
	 * rendered as visible text, not interpreted.
	 *
	 * See the interpretation note in docs/DECISIONS.md for why this satisfies the
	 * "sanitizer mandatory" ruling by construction rather than by filtering.
	 */

	let { source, class: className = '' }: { source: string; class?: string } = $props();

	const tokens = $derived.by((): TokensList | Tokens.Generic[] => {
		try {
			return marked.lexer(source ?? '', { gfm: true, breaks: false });
		} catch {
			// A lexer failure must never take out the page. Showing the raw text is
			// the honest fallback: the reader still sees the content.
			return [{ type: 'paragraph', raw: source, text: source } as Tokens.Generic];
		}
	});
</script>

<div class="markdown {className}">
	<MarkdownTokens {tokens} />
</div>

<style>
	.markdown {
		line-height: 1.6;
		overflow-wrap: anywhere;
	}

	.markdown :global(h1),
	.markdown :global(h2),
	.markdown :global(h3) {
		margin: var(--space-5) 0 var(--space-2);
	}

	.markdown :global(h1:first-child),
	.markdown :global(h2:first-child),
	.markdown :global(h3:first-child) {
		margin-top: 0;
	}

	.markdown :global(h1) {
		font-size: var(--text-lg);
	}
	.markdown :global(h2) {
		font-size: var(--text-md);
	}
	.markdown :global(h3) {
		font-size: var(--text-base);
	}

	.markdown :global(p) {
		margin: 0 0 var(--space-3);
	}

	.markdown :global(ul),
	.markdown :global(ol) {
		margin: 0 0 var(--space-3);
		padding-left: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.markdown :global(li) {
		overflow-wrap: anywhere;
	}

	.markdown :global(blockquote) {
		margin: 0 0 var(--space-3);
		padding-left: var(--space-3);
		border-left: 2px solid var(--gold);
		color: var(--text-secondary);
	}

	.markdown :global(pre) {
		margin: 0 0 var(--space-3);
		padding: var(--space-3);
		background: var(--surface-hover);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-sm);
		overflow-x: auto;
	}

	.markdown :global(code) {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}

	.markdown :global(p > code),
	.markdown :global(li > code) {
		padding: 1px var(--space-1);
		background: var(--surface-hover);
		border-radius: var(--radius-sm);
	}

	.markdown :global(hr) {
		margin: var(--space-4) 0;
		border: none;
		border-top: 1px solid var(--border-thin);
	}

	.markdown :global(table) {
		width: 100%;
		margin: 0 0 var(--space-3);
		border-collapse: collapse;
		font-size: var(--text-sm);
	}

	.markdown :global(th),
	.markdown :global(td) {
		padding: var(--space-2);
		border-bottom: 1px solid var(--border-thin);
		text-align: left;
	}

	.markdown :global(*:last-child) {
		margin-bottom: 0;
	}
</style>
