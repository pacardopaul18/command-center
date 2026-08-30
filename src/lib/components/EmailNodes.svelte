<script lang="ts">
	import type { EmailNode } from '$lib/email-html';
	import Self from './EmailNodes.svelte';

	/**
	 * Renders a parsed email tree as Svelte elements.
	 *
	 * Recursive, and deliberately a long explicit branch rather than a dynamic
	 * `<svelte:element this={tag}>`. The explicit list is the second lock: even
	 * if a tag somehow survived parsing that should not have, there is no branch
	 * here that would render it. Nothing is interpolated into markup and
	 * `{@html}` never appears.
	 *
	 * Images are shown but never loaded from the network by default. A remote
	 * image in an email is a tracking pixel as often as it is a picture, and
	 * loading it tells the sender the mail was opened. `showImages` is opt in,
	 * per thread, by the reader.
	 */

	let {
		nodes,
		showImages = false
	}: { nodes: EmailNode[]; showImages?: boolean } = $props();
</script>

{#each nodes as node, i (i)}
	{#if node.kind === 'text'}
		{node.text}
	{:else if node.tag === 'br'}
		<br />
	{:else if node.tag === 'hr'}
		<hr />
	{:else if node.tag === 'img'}
		{#if showImages && node.src}
			<img src={node.src} alt={node.alt ?? ''} loading="lazy" referrerpolicy="no-referrer" />
		{:else}
			<span class="blocked" title={node.src ? new URL(node.src).hostname : undefined}>
				{node.alt ? `Image: ${node.alt}` : 'Image'}
				{#if node.src}<span class="host">from {new URL(node.src).hostname}</span>{/if}
			</span>
		{/if}
	{:else if node.tag === 'a'}
		<a href={node.href} target="_blank" rel="noopener noreferrer nofollow">
			<Self nodes={node.children} {showImages} />
		</a>
	{:else if node.tag === 'p'}
		<p><Self nodes={node.children} {showImages} /></p>
	{:else if node.tag === 'div'}
		<div><Self nodes={node.children} {showImages} /></div>
	{:else if node.tag === 'span'}
		<span><Self nodes={node.children} {showImages} /></span>
	{:else if node.tag === 'strong'}
		<strong><Self nodes={node.children} {showImages} /></strong>
	{:else if node.tag === 'em'}
		<em><Self nodes={node.children} {showImages} /></em>
	{:else if node.tag === 'u'}
		<u><Self nodes={node.children} {showImages} /></u>
	{:else if node.tag === 's'}
		<s><Self nodes={node.children} {showImages} /></s>
	{:else if node.tag === 'small'}
		<small><Self nodes={node.children} {showImages} /></small>
	{:else if node.tag === 'sub'}
		<sub><Self nodes={node.children} {showImages} /></sub>
	{:else if node.tag === 'sup'}
		<sup><Self nodes={node.children} {showImages} /></sup>
	{:else if node.tag === 'ul'}
		<ul><Self nodes={node.children} {showImages} /></ul>
	{:else if node.tag === 'ol'}
		<ol><Self nodes={node.children} {showImages} /></ol>
	{:else if node.tag === 'li'}
		<li><Self nodes={node.children} {showImages} /></li>
	{:else if node.tag === 'blockquote'}
		<blockquote><Self nodes={node.children} {showImages} /></blockquote>
	{:else if node.tag === 'pre'}
		<pre><Self nodes={node.children} {showImages} /></pre>
	{:else if node.tag === 'code'}
		<code><Self nodes={node.children} {showImages} /></code>
	{:else if node.tag === 'h3'}
		<h3><Self nodes={node.children} {showImages} /></h3>
	{:else if node.tag === 'h4'}
		<h4><Self nodes={node.children} {showImages} /></h4>
	{:else if node.tag === 'h5'}
		<h5><Self nodes={node.children} {showImages} /></h5>
	{:else if node.tag === 'h6'}
		<h6><Self nodes={node.children} {showImages} /></h6>
	{:else if node.tag === 'table'}
		<table><Self nodes={node.children} {showImages} /></table>
	{:else if node.tag === 'thead'}
		<thead><Self nodes={node.children} {showImages} /></thead>
	{:else if node.tag === 'tbody'}
		<tbody><Self nodes={node.children} {showImages} /></tbody>
	{:else if node.tag === 'tr'}
		<tr><Self nodes={node.children} {showImages} /></tr>
	{:else if node.tag === 'td'}
		<td><Self nodes={node.children} {showImages} /></td>
	{:else if node.tag === 'th'}
		<th><Self nodes={node.children} {showImages} /></th>
	{:else if node.tag === 'caption'}
		<caption><Self nodes={node.children} {showImages} /></caption>
	{:else}
		<Self nodes={node.children} {showImages} />
	{/if}
{/each}

<style>
	/* A held-back image says what it is and who it would have called. A bare
	   [image] tells the reader nothing about what they are missing or why. */
	.blocked {
		display: inline-flex;
		gap: 4px;
		align-items: baseline;
		font-size: var(--text-xs);
		color: var(--text-secondary);
		border: 1px dashed var(--border);
		border-radius: var(--radius-sm);
		padding: 0 6px;
		max-width: 100%;
		overflow-wrap: anywhere;
	}

	.host {
		opacity: 0.75;
	}
</style>
