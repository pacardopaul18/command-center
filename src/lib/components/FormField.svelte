<script lang="ts">
	import type { Snippet } from 'svelte';

	// Ported from docs/design/components/forms/FormField.jsx.
	// The label is 11px uppercase mono per the design system. It wraps the
	// control rather than using `for`, so the association holds without ids.

	let {
		label,
		hint,
		error,
		children
	}: { label: string; hint?: string; error?: string; children: Snippet } = $props();
</script>

<label class="field">
	<span class="label-mono label">{label}</span>
	{@render children()}
	{#if error}
		<span class="msg error">{error}</span>
	{:else if hint}
		<span class="msg hint">{hint}</span>
	{/if}
</label>

<style>
	.field {
		display: block;
		min-width: 0;
	}

	.label {
		display: block;
		margin-bottom: var(--space-2);
	}

	.msg {
		display: block;
		margin-top: var(--space-2);
		font-size: var(--text-sm);
	}

	.hint {
		color: var(--text-secondary);
	}

	.error {
		color: var(--red);
	}
</style>
