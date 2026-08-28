<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';

	let { children } = $props();

	// Stage 1 ships Action Items. The rest of the site map from the architecture
	// doc arrives module by module, so it is not linked yet.
	const nav = [{ href: '/actions', label: 'Action Items' }];
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<a class="skip" href="#main">Skip to content</a>

<div class="shell">
	<header>
		<div class="bar">
			<a class="brand" href="/actions">
				<span class="mark" aria-hidden="true"></span>
				<span class="brand-text">Command Center</span>
			</a>
			<nav aria-label="Main">
				{#each nav as item (item.href)}
					<a
						href={item.href}
						class="nav-link"
						aria-current={page.url.pathname.startsWith(item.href) ? 'page' : undefined}
					>
						{item.label}
					</a>
				{/each}
			</nav>
		</div>
	</header>

	<main id="main">
		{@render children()}
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
		color: var(--cream);
	}

	.skip:focus {
		left: 0;
	}

	.shell {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
	}

	header {
		background: var(--navy);
		border-bottom: 2px solid var(--gold);
	}

	.bar {
		max-width: 1040px;
		margin: 0 auto;
		padding: var(--space-3) var(--space-4);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3) var(--space-5);
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--cream);
		text-decoration: none;
		font-weight: 700;
		letter-spacing: -0.01em;
	}

	.mark {
		width: 10px;
		height: 10px;
		border-radius: 2px;
		background: var(--gold);
	}

	.brand-text {
		font-size: 1rem;
	}

	nav {
		display: flex;
		gap: var(--space-1);
	}

	.nav-link {
		display: inline-flex;
		align-items: center;
		min-height: 36px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-sm);
		color: #d8dee8;
		text-decoration: none;
		font-size: 0.9375rem;
	}

	.nav-link:hover {
		color: var(--cream);
		background: rgba(255, 255, 255, 0.08);
	}

	.nav-link[aria-current='page'] {
		color: var(--navy);
		background: var(--cream);
		font-weight: 500;
	}

	main {
		flex: 1;
		width: 100%;
		max-width: 1040px;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4) var(--space-6);
	}

	@media (min-width: 720px) {
		.bar {
			padding-inline: var(--space-5);
		}
		main {
			padding-inline: var(--space-5);
		}
	}
</style>
