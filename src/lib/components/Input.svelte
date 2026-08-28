<script lang="ts">
	import './control.css';
	import type { HTMLInputAttributes } from 'svelte/elements';

	type Props = HTMLInputAttributes & {
		value?: string;
		mono?: boolean;
		invalid?: boolean;
		/** Bind to reach the underlying element, for focus management. */
		element?: HTMLInputElement | null;
	};

	let {
		value = $bindable(''),
		element = $bindable(null),
		mono = false,
		invalid = false,
		...rest
	}: Props = $props();
</script>

<input
	bind:this={element}
	class="control"
	class:mono
	class:invalid
	aria-invalid={invalid ? 'true' : undefined}
	bind:value
	{...rest}
/>
