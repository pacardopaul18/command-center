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
	 * Width is decided here, from the route, and the default is full width.
	 *
	 * D129 made full width an opt-in and this inverts it, which needs saying
	 * plainly. The opt-in list was the thing that got forgotten: twelve pages
	 * shipped centred inside a 1200px cap, on designs that are full width, and
	 * every one of them was a page whose author would have had to remember to
	 * join a list. A default that is right for the app cannot be forgotten by
	 * the next page; a list can, and was.
	 *
	 * D129's principle stands and is why this is here rather than in each page:
	 * the route decides, and the change is proved by measuring both kinds. What
	 * changes is which way round the default sits, because almost every screen
	 * in this app is a table or a two-column board, and the handful that are
	 * prose are nameable.
	 *
	 * NARROW is for reading, not for tables. A procedure is a document somebody
	 * reads start to finish, and prose measured at 1700px is bad typography
	 * whatever the screen allows. Everything else earns the width: eight-column
	 * tables, boards with a rail, grids of tiles.
	 *
	 * Print routes are not listed because they render without the shell at all.
	 */
	const NARROW_ROUTES = [
		// One SOP page: markdown prose, read top to bottom.
		'/sops/[id]'
	];

	const wide = $derived(!NARROW_ROUTES.includes(page.route.id ?? ''));

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
	<AppShell today={data.today} {wide} settings={data.settings} dataEnvironment={data.dataEnvironment}>
		{@render children()}
	</AppShell>
{/if}
