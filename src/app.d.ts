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
				// Optional until R2 is enabled on the account and the binding in
				// wrangler.toml is uncommented. Nothing before v1 uses it.
				FILES?: import('@cloudflare/workers-types').R2Bucket;
				// Worker secret, set with `wrangler secret put RESEND_API_KEY`.
				RESEND_API_KEY?: string;
				// Plain vars from wrangler.toml, not secrets.
				DIGEST_FROM?: string;
				DIGEST_TO?: string;
			};
			cf?: import('@cloudflare/workers-types').CfProperties;
			ctx: import('@cloudflare/workers-types').ExecutionContext;
		}
	}
}

export {};
