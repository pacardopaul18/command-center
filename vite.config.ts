import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
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
