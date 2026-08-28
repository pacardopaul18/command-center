/**
 * Hono binding types for the Command Center API.
 *
 * The bindings come from wrangler.toml. In production Cloudflare Pages injects
 * them; in `vite dev` and `vite preview` the SvelteKit Cloudflare adapter
 * emulates them with miniflare against local state in .wrangler/state.
 */
export interface ApiEnv {
	Bindings: App.Platform['env'];
}
