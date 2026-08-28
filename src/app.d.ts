// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}

		// Cloudflare bindings declared in wrangler.toml. During `vite dev` and
		// `vite preview` these are miniflare emulations backed by .wrangler/state.
		interface Platform {
			env: {
				DB: import('@cloudflare/workers-types').D1Database;
				SESSIONS: import('@cloudflare/workers-types').KVNamespace;
				FILES: import('@cloudflare/workers-types').R2Bucket;
			};
			cf?: import('@cloudflare/workers-types').CfProperties;
			ctx: import('@cloudflare/workers-types').ExecutionContext;
		}
	}
}

export {};
