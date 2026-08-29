import { readdirSync } from 'node:fs';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

/**
 * The highest-numbered migration present in the tree being built.
 *
 * Baked into the bundle so the running Worker can say which schema it was built
 * against, and report drift when the live database is behind it. See
 * src/lib/server/schema-version.ts for why this exists.
 *
 * Read at config time, not build time, so it is a plain string constant in the
 * output with no filesystem access left in the Worker.
 */
function latestMigration(): string {
	const files = readdirSync('migrations')
		.filter((f: string) => f.endsWith('.sql'))
		.sort();
	if (files.length === 0) throw new Error('No migrations found. Refusing to build a schema-blind bundle.');
	return files[files.length - 1];
}

export default defineConfig({
	define: {
		__EXPECTED_MIGRATION__: JSON.stringify(latestMigration())
	},
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Cloudflare Pages. The adapter also emulates the wrangler.toml bindings
			// (D1, KV, R2) during `vite dev` and `vite preview`, backed by local
			// miniflare state under .wrangler/state.
			adapter: adapter({
				platformProxy: {
					configPath: 'wrangler.toml',
					persist: true
				}
			})
		})
	]
});
