<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import { page } from '$app/state';
	import { hydration } from '$lib/hydrated.svelte';
	import favicon from '$lib/assets/favicon.svg';
	import AppShell from '$lib/components/AppShell.svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	/**
	 * Print routes render without the shell.
	 *
	 * A printed report should carry the report and nothing else: no sidebar, no
	 * quick add, no nav. Matching on the route id rather than the URL string means
	 * a client called "print" cannot accidentally strip its own chrome.
	 */
	const bare = $derived(page.route.id?.endsWith('/print') ?? false);

	/**
	 * Mail is laid out as two columns against the full width, per the CR-1
	 * design. Decided here from the route rather than by each page, so a page
	 * cannot render in the wrong container by forgetting to say so.
	 */
	const wide = $derived(page.route.id?.startsWith('/mail') ?? false);

	// One place decides the whole app is live. onMount runs after hydration, so
	// anything gated on this cannot be touched during the window where a keypress
	// would be swallowed. See src/lib/hydrated.svelte.ts.
	onMount(() => hydration.markReady());
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if bare}
	{@render children()}
{:else}
	<AppShell today={data.today} {wide} settings={data.settings}>
		{@render children()}
	</AppShell>
{/if}
