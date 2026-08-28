<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import QuickAdd from './QuickAdd.svelte';

	// Ported from docs/design/components/shell/Sidebar.jsx.
	//
	// D22: the export is desktop first with a fixed 224px sidebar and no media
	// query anywhere. Below 960px that sidebar is replaced by a top bar, so the
	// 412px layout is a single column with the nav above the content.
	//
	// Only Action Items exists. The rest of the site map in architecture section
	// B gets a nav entry when its module ships, not before. No dead links.

	let { children, today }: { children: Snippet; today: string } = $props();

	const nav = [
		{ href: '/', label: 'Today', exact: true },
		{ href: '/actions', label: 'Action items', exact: false },
		{ href: '/projects', label: 'Projects', exact: false }
	];

	let quickAddOpen = $state(false);

	function isCurrent(item: { href: string; exact: boolean }) {
		return item.exact
			? page.url.pathname === item.href
			: page.url.pathname.startsWith(item.href);
	}

	/**
	 * Global quick add on N, per the architecture's keyboard-first principle.
	 * Ignored while typing, while a modifier is held, and while the dialog is
	 * already open, so it never eats a keystroke meant for a field.
	 */
	function onKeydown(event: KeyboardEvent) {
		if (quickAddOpen) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.key !== 'n' && event.key !== 'N') return;

		const target = event.target as HTMLElement | null;
		if (target?.isContentEditable) return;
		if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

		event.preventDefault();
		quickAddOpen = true;
	}
</script>

<svelte:window onkeydown={onKeydown} />

<a class="skip" href="#main">Skip to content</a>

<div class="shell">
	<nav class="sidebar" aria-label="Main">
		<a class="brand" href="/actions">
			<span class="mark" aria-hidden="true"></span>
			Command Center
		</a>
		<button type="button" class="quick-add" onclick={() => (quickAddOpen = true)}>
			<span class="plus" aria-hidden="true">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
					<path d="M12 5v14M5 12h14" />
				</svg>
			</span>
			Quick add
			<kbd class="mono">N</kbd>
		</button>

		<ul>
			{#each nav as item (item.href)}
				<li>
					<a href={item.href} class="nav-link" aria-current={isCurrent(item) ? 'page' : undefined}>
						{item.label}
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	<main id="main">
		<div class="content">
			{@render children()}
		</div>
	</main>
</div>

<QuickAdd bind:open={quickAddOpen} {today} />

<style>
	.skip {
		position: absolute;
		left: -9999px;
		top: 0;
		z-index: 10;
		padding: var(--space-3);
		background: var(--navy);
		color: var(--text-inverse);
	}

	.skip:focus {
		left: 0;
	}

	.shell {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
	}

	/* Mobile first: the nav is a top bar. */
	.sidebar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-5);
		padding: var(--space-3) var(--space-4);
		background: var(--surface-sidebar);
		border-bottom: 2px solid var(--gold);
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--tap);
		color: #ffffff;
		font-size: var(--text-md);
		font-weight: var(--weight-bold);
		text-decoration: none;
	}

	.brand:hover {
		color: #ffffff;
		text-decoration: none;
	}

	.mark {
		width: 10px;
		height: 10px;
		border-radius: 2px;
		background: var(--gold);
	}

	.quick-add {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--tap);
		padding: 0 var(--space-3);
		border: none;
		border-radius: var(--radius-sm);
		background: #ffffff;
		color: var(--navy);
		font-family: var(--font-sans);
		font-size: var(--text-base);
		font-weight: var(--weight-medium);
		cursor: pointer;
	}

	.quick-add:hover {
		background: var(--cream);
	}

	.plus {
		display: inline-flex;
	}

	kbd {
		padding: 1px var(--space-2);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		color: var(--muted);
	}

	ul {
		display: flex;
		gap: var(--space-1);
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.nav-link {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0 var(--space-3);
		border-radius: var(--radius-sm);
		color: var(--text-inverse-muted);
		text-decoration: none;
		transition:
			background-color var(--transition-fast),
			color var(--transition-fast);
	}

	.nav-link:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--text-inverse);
		text-decoration: none;
	}

	.nav-link[aria-current='page'] {
		background: rgba(255, 255, 255, 0.16);
		color: #ffffff;
		font-weight: var(--weight-medium);
	}

	main {
		flex: 1;
		min-width: 0;
	}

	.content {
		max-width: var(--content-max);
		margin: 0 auto;
		padding: var(--space-5) var(--space-4) var(--space-7);
	}

	/* The export's persistent sidebar, restored once there is room for it. */
	@media (min-width: 960px) {
		.shell {
			flex-direction: row;
		}

		.sidebar {
			width: var(--sidebar-width);
			min-width: var(--sidebar-width);
			flex-direction: column;
			align-items: stretch;
			gap: var(--space-5);
			padding: var(--space-5) var(--space-3);
			border-bottom: none;
			border-right: 1px solid rgba(255, 255, 255, 0.12);
		}

		.brand {
			padding-inline: var(--space-3);
		}

		.quick-add {
			justify-content: space-between;
		}

		ul {
			flex-direction: column;
		}

		.nav-link {
			justify-content: flex-start;
		}

		.content {
			padding: var(--space-6) var(--space-6) var(--space-8);
		}
	}
</style>
