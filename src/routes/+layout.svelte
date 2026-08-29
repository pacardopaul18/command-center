<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
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
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if bare}
	{@render children()}
{:else}
	<AppShell today={data.today}>
		{@render children()}
	</AppShell>
{/if}
