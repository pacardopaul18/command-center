<script lang="ts">
	import type { RichNode } from '$lib/rich-text';
	import Self from './RichNodes.svelte';

	/**
	 * Renders a parsed rich-text tree as Svelte elements.
	 *
	 * Recursive, and a long explicit branch rather than a dynamic
	 * `<svelte:element this={tag}>`, for the same reason as `EmailNodes.svelte`:
	 * the explicit list is the second lock. Even if a tag somehow survived the
	 * parse that should not have, there is no branch here that would draw it.
	 * Nothing is interpolated into markup and `{@html}` never appears.
	 *
	 * HEADINGS ARE DEMOTED AT DRAW TIME. The stored HTML keeps Asana's h1 and h2
	 * because that is what the workspace holds, but every page that renders a
	 * description already owns its single h1, and a second one breaks the
	 * document outline for anyone reading by headings. So an h1 in the content
	 * draws as an h3 and an h2 as an h4, which keeps the levels in the right
	 * order relative to the page. The stored value is untouched. D22 baseline.
	 */

	let { nodes }: { nodes: RichNode[] } = $props();
</script>

{#each nodes as node, i (i)}
	{#if node.kind === 'text'}
		{node.text}
	{:else if node.tag === 'br'}
		<br />
	{:else if node.tag === 'hr'}
		<hr />
	{:else if node.tag === 'a'}
		<a href={node.href} target="_blank" rel="noopener noreferrer">
			<Self nodes={node.children} />
		</a>
	{:else if node.tag === 'p'}
		<p><Self nodes={node.children} /></p>
	{:else if node.tag === 'h1'}
		<h3><Self nodes={node.children} /></h3>
	{:else if node.tag === 'h2'}
		<h4><Self nodes={node.children} /></h4>
	{:else if node.tag === 'strong'}
		<strong><Self nodes={node.children} /></strong>
	{:else if node.tag === 'em'}
		<em><Self nodes={node.children} /></em>
	{:else if node.tag === 'u'}
		<u><Self nodes={node.children} /></u>
	{:else if node.tag === 's'}
		<s><Self nodes={node.children} /></s>
	{:else if node.tag === 'code'}
		<code><Self nodes={node.children} /></code>
	{:else if node.tag === 'pre'}
		<pre><Self nodes={node.children} /></pre>
	{:else if node.tag === 'blockquote'}
		<blockquote><Self nodes={node.children} /></blockquote>
	{:else if node.tag === 'ul'}
		<ul><Self nodes={node.children} /></ul>
	{:else if node.tag === 'ol'}
		<ol><Self nodes={node.children} /></ol>
	{:else if node.tag === 'li'}
		<li><Self nodes={node.children} /></li>
	{:else if node.tag === 'table'}
		<div class="scroller">
			<table><tbody><Self nodes={node.children} /></tbody></table>
		</div>
	{:else if node.tag === 'tr'}
		<tr><Self nodes={node.children} /></tr>
	{:else if node.tag === 'td'}
		<td><Self nodes={node.children} /></td>
	{/if}
{/each}

<style>
	/* Wide content scrolls inside its own box; the page never scrolls sideways. */
	.scroller {
		overflow-x: auto;
	}
</style>
