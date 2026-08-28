<script lang="ts">
	import type { Snippet } from 'svelte';

	// The export ships no dialog, though it reserves --shadow-pop for one.
	// Built on <dialog> so focus trapping, Escape and inertness come from the
	// platform rather than from hand written key handling.

	let {
		open = $bindable(false),
		title,
		children
	}: { open?: boolean; title: string; children: Snippet } = $props();

	let dialog = $state<HTMLDialogElement | null>(null);

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});
</script>

<dialog bind:this={dialog} onclose={() => (open = false)} aria-label={title}>
	<div class="panel">
		<header>
			<h2>{title}</h2>
			<button type="button" class="close" onclick={() => (open = false)} aria-label="Close">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
					<path d="M18 6 6 18M6 6l12 12" />
				</svg>
			</button>
		</header>
		{@render children()}
	</div>
</dialog>

<style>
	dialog {
		width: min(560px, calc(100vw - 2 * var(--space-4)));
		padding: 0;
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-lg);
		background: var(--surface-card);
		color: var(--text-body);
		box-shadow: var(--shadow-pop);
	}

	dialog::backdrop {
		background: rgba(16, 42, 76, 0.32);
	}

	.panel {
		padding: var(--space-4);
	}

	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}

	.close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: var(--tap);
		height: var(--tap);
		margin: calc(var(--space-2) * -1) calc(var(--space-2) * -1) 0 0;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--muted);
		cursor: pointer;
	}

	.close:hover {
		background: var(--surface-hover);
		color: var(--ink);
	}
</style>
