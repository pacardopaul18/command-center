<script lang="ts">
	import './control.css';
	import type { Snippet } from 'svelte';
	import type { HTMLSelectAttributes } from 'svelte/elements';

	// Ported from docs/design/components/forms/Select.jsx.
	// The chevron is inlined as a background image rather than a Lucide call so
	// the control needs no icon runtime and no external request.

	type Props = HTMLSelectAttributes & { value?: string; children: Snippet };

	let { value = $bindable(''), children, ...rest }: Props = $props();
</script>

<select class="control select" bind:value {...rest}>
	{@render children()}
</select>

<style>
	.select {
		appearance: none;
		padding-right: var(--space-7);
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%235B6470' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right var(--space-3) center;
		cursor: pointer;
	}
</style>
