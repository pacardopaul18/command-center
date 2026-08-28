<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';

	// Ported from docs/design/components/shell/Sidebar.jsx.
	//
	// D22: the export is desktop first with a fixed 224px sidebar and no media
	// query anywhere. Below 960px that sidebar is replaced by a top bar, so the
	// 412px layout is a single column with the nav above the content.
	//
	// Only Action Items exists. The rest of the site map in architecture section
	// B gets a nav entry when its module ships, not before. No dead links.

	let { children }: { children: Snippet } = $props();

	const nav = [{ href: '/actions', label: 'Action items' }];
</script>

<a class="skip" href="#main">Skip to content</a>

<div class="shell">
	<nav class="sidebar" aria-label="Main">
		<a class="brand" href="/actions">
			<span class="mark" aria-hidden="true"></span>
			Command Center
		</a>
		<ul>
			{#each nav as item (item.href)}
				<li>
					<a
						href={item.href}
						class="nav-link"
						aria-current={page.url.pathname.startsWith(item.href) ? 'page' : undefined}
					>
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
