<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	// Ported from docs/design/components/actions/Button.jsx.
	// Deviation D22: the export's md button is about 32px tall. Every size here
	// clears the 44x44 floor, sm included, by padding out the hit area.

	type Props = HTMLButtonAttributes & {
		variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
		size?: 'sm' | 'md';
		href?: string;
		children: Snippet;
	};

	let {
		variant = 'primary',
		size = 'md',
		href,
		children,
		type = 'button',
		...rest
	}: Props = $props();
</script>

{#if href}
	<a {href} class="btn {variant} {size}" {...rest as Record<string, unknown>}>
		{@render children()}
	</a>
{:else}
	<button {type} class="btn {variant} {size}" {...rest}>
		{@render children()}
	</button>
{/if}

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: var(--tap);
		min-width: var(--tap);
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		font-family: var(--font-sans);
		font-weight: var(--weight-medium);
		line-height: 1;
		text-decoration: none;
		cursor: pointer;
		white-space: nowrap;
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.btn:hover {
		text-decoration: none;
	}

	.md {
		padding: 0 var(--space-4);
		font-size: var(--text-base);
	}

	.sm {
		padding: 0 var(--space-3);
		font-size: var(--text-sm);
	}

	.primary {
		background: var(--navy);
		color: var(--text-inverse);
	}
	.primary:hover {
		background: var(--navy-700);
	}

	.secondary {
		background: var(--surface-card);
		color: var(--ink);
		border-color: var(--border-control);
	}
	.secondary:hover {
		background: var(--surface-hover);
	}

	.ghost {
		background: transparent;
		color: var(--navy-700);
	}
	.ghost:hover {
		background: var(--navy-50);
	}

	.danger {
		background: transparent;
		color: var(--red);
	}
	.danger:hover {
		background: var(--red-100);
	}

	.btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>
