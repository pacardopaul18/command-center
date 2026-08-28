<script lang="ts">
	import './control.css';
	import type { HTMLInputAttributes } from 'svelte/elements';

	type Props = HTMLInputAttributes & { value?: string; mono?: boolean; invalid?: boolean };

	let { value = $bindable(''), mono = false, invalid = false, ...rest }: Props = $props();
</script>

<input
	class="control"
	class:mono
	class:invalid
	aria-invalid={invalid ? 'true' : undefined}
	bind:value
	{...rest}
/>
