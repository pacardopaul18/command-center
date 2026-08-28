<script lang="ts">
	import type { Snippet } from 'svelte';

	// Ported from docs/design/components/data/Card.jsx.
	// White surface, 1px thin border, soft card shadow, 12px radius.
	// The thin border is decorative, so its 1.25:1 is fine; it never carries
	// meaning on its own.

	let {
		title,
		subtitle,
		actions,
		padded = true,
		children
	}: {
		title?: string;
		subtitle?: string;
		actions?: Snippet;
		padded?: boolean;
		children: Snippet;
	} = $props();
</script>

<section class="card">
	{#if title || actions}
		<header>
			<div class="titles">
				{#if title}<h2>{title}</h2>{/if}
				{#if subtitle}<p class="subtitle">{subtitle}</p>{/if}
			</div>
			{#if actions}
				<div class="actions">{@render actions()}</div>
			{/if}
		</header>
	{/if}
	<div class:body={padded}>
		{@render children()}
	</div>
</section>

<style>
	.card {
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
	}

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-4) 0;
	}

	.titles {
		min-width: 0;
	}

	.subtitle {
		margin-top: var(--space-1);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.actions {
		display: flex;
		gap: var(--space-2);
	}

	.body {
		padding: var(--space-4);
	}
</style>
