<script lang="ts">
	import './control.css';
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	type Props = HTMLTextareaAttributes & { value?: string };

	let { value = $bindable(''), ...rest }: Props = $props();
</script>

<textarea class="control" bind:value {...rest}></textarea>
