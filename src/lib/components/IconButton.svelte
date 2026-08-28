<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	// Ported from docs/design/components/actions/IconButton.jsx.
	// Deviation D22: the export defaults to 32px and ActionItemsScreen calls it
	// at 26. Both are below the floor. The visual box stays small but the hit
	// area is always 44x44, so the control looks light and still passes.

	type Props = HTMLButtonAttributes & {
		/** Required. This is the button's only accessible name. */
		label: string;
		/** Visual size of the icon box. The tap target stays 44x44 regardless. */
		box?: number;
		children: Snippet;
	};

	let { label, box = 32, children, type = 'button', ...rest }: Props = $props();
</script>

<button {type} class="icon-btn" aria-label={label} title={label} {...rest}>
	<span class="box" style="width:{box}px;height:{box}px">
		{@render children()}
	</span>
</button>

<style>
	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: var(--tap);
		min-height: var(--tap);
		padding: 0;
		background: none;
		border: none;
		color: var(--muted);
		cursor: pointer;
	}

	.box {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		transition: background-color var(--transition-fast);
	}

	.icon-btn:hover .box {
		background: var(--surface-hover);
		color: var(--ink);
	}

	.icon-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>
