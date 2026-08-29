<script lang="ts">
	import type { Tokens } from 'marked';
	import Self from './MarkdownTokens.svelte';

	/**
	 * Renders marked's token tree as Svelte elements. Recursive, via Self.
	 *
	 * There is no {@html} anywhere in this file, and that is the entire security
	 * design. Every branch below emits a known element with text content, so a
	 * token whose text contains markup renders that markup as visible characters.
	 *
	 * Anything unrecognised falls through to plain text rather than being
	 * skipped, so a token type this component does not know about degrades to
	 * readable content instead of vanishing.
	 */

	let { tokens }: { tokens: unknown[] } = $props();

	type Any = Tokens.Generic & Record<string, unknown>;

	/**
	 * Only these schemes may appear in a link or image. Anything else, including
	 * javascript: and data:, renders as text instead of becoming a link.
	 */
	function safeHref(raw: unknown): string | null {
		if (typeof raw !== 'string') return null;
		const trimmed = raw.trim();
		if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
		// Relative links stay inside the app, so they are allowed.
		if (/^\/(?!\/)/.test(trimmed)) return trimmed;
		return null;
	}

	function children(token: Any): unknown[] {
		return Array.isArray(token.tokens) ? (token.tokens as unknown[]) : [];
	}

	function text(token: Any): string {
		return typeof token.text === 'string' ? token.text : '';
	}
</script>

{#each tokens as token (token)}
	{@const t = token as Any}
	{#if t.type === 'space'}
		<!-- nothing to render -->
	{:else if t.type === 'heading'}
		{#if t.depth === 1}
			<h1><Self tokens={children(t)} /></h1>
		{:else if t.depth === 2}
			<h2><Self tokens={children(t)} /></h2>
		{:else}
			<h3><Self tokens={children(t)} /></h3>
		{/if}
	{:else if t.type === 'paragraph'}
		<p><Self tokens={children(t)} /></p>
	{:else if t.type === 'text'}
		{#if children(t).length > 0}
			<Self tokens={children(t)} />
		{:else}
			{text(t)}
		{/if}
	{:else if t.type === 'strong'}
		<strong><Self tokens={children(t)} /></strong>
	{:else if t.type === 'em'}
		<em><Self tokens={children(t)} /></em>
	{:else if t.type === 'del'}
		<del><Self tokens={children(t)} /></del>
	{:else if t.type === 'codespan'}
		<code>{text(t)}</code>
	{:else if t.type === 'code'}
		<pre><code>{text(t)}</code></pre>
	{:else if t.type === 'br'}
		<br />
	{:else if t.type === 'hr'}
		<hr />
	{:else if t.type === 'blockquote'}
		<blockquote><Self tokens={children(t)} /></blockquote>
	{:else if t.type === 'list'}
		{#if t.ordered}
			<ol start={typeof t.start === 'number' ? t.start : undefined}>
				{#each (t.items as Any[]) ?? [] as item (item)}
					<li><Self tokens={children(item)} /></li>
				{/each}
			</ol>
		{:else}
			<ul>
				{#each (t.items as Any[]) ?? [] as item (item)}
					<li><Self tokens={children(item)} /></li>
				{/each}
			</ul>
		{/if}
	{:else if t.type === 'link'}
		{@const href = safeHref(t.href)}
		{#if href}
			<a {href} rel="noopener noreferrer nofollow" target="_blank">
				<Self tokens={children(t)} />
			</a>
		{:else}
			<!-- Unsafe or unknown scheme. The label still shows; the link does not. -->
			<Self tokens={children(t)} />
		{/if}
	{:else if t.type === 'image'}
		{@const src = safeHref(t.src)}
		{#if src}
			<img {src} alt={typeof t.text === 'string' ? t.text : ''} />
		{:else}
			{text(t)}
		{/if}
	{:else if t.type === 'table'}
		<table>
			<thead>
				<tr>
					{#each (t.header as Any[]) ?? [] as cell (cell)}
						<th><Self tokens={children(cell)} /></th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each (t.rows as Any[][]) ?? [] as row, i (i)}
					<tr>
						{#each row as cell (cell)}
							<td><Self tokens={children(cell)} /></td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	{:else if t.type === 'html'}
		<!-- Raw HTML is never interpreted. It renders as the characters it is. -->
		<p class="raw">{t.raw ?? text(t)}</p>
	{:else if children(t).length > 0}
		<Self tokens={children(t)} />
	{:else}
		{text(t) || t.raw || ''}
	{/if}
{/each}

<style>
	.raw {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}

	img {
		max-width: 100%;
		height: auto;
	}
</style>
