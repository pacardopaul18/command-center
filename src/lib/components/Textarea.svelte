<script lang="ts">
	import { onMount } from 'svelte';
	import './control.css';
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	type Props = HTMLTextareaAttributes & { value?: string };

	let { value = $bindable(''), ...rest }: Props = $props();

	let element = $state<HTMLTextAreaElement | null>(null);

	/**
	 * Adopts text that was typed before this component was listening.
	 *
	 * Narrow on purpose: it only fires when the bound value is empty and the
	 * element is not, which is the one case where the component's own default
	 * would destroy something a person typed. It can never overwrite a value the
	 * caller set.
	 *
	 * Honest about its own evidence. The symptom was real and observed, a fill
	 * immediately after a cold load submitting an empty form while the same fill
	 * passed after a reload. But held under a deliberate hydration delay, with
	 * the client entry module blocked until after typing, the value reaches state
	 * and the form submits correctly both with and without this. So the race was
	 * not reproducible and this is a cheap guard rather than a proven fix. If it
	 * never fires, it costs one comparison on mount.
	 */
	onMount(() => {
		if (element && !value && element.value) value = element.value;
	});
</script>

<textarea bind:this={element} class="control" bind:value {...rest}></textarea>
