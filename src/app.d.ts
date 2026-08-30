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
				// Transcripts, generated PDFs, SOP exports. Live since T-v1-0.
				FILES: import('@cloudflare/workers-types').R2Bucket;
				// Worker secrets, set with `wrangler secret put NAME`.
				RESEND_API_KEY?: string;
				ANTHROPIC_API_KEY?: string;
				ASANA_TOKEN?: string;
				GOOGLE_CLIENT_SECRET?: string;
				// Not a secret by nature: the OAuth client id is public by design
				// and appears in the consent URL every user sees. It is stored as
				// one anyway because that is where Paul put it, and a secret and a
				// var resolve identically here. Over-protecting a public value
				// costs nothing; the only real consequence is that it is not in
				// wrangler.toml, so it does not travel with the repo.
				GOOGLE_CLIENT_ID?: string;
				// Plain vars from wrangler.toml.
				DIGEST_FROM?: string;
				DIGEST_TO?: string;
			};
			cf?: import('@cloudflare/workers-types').CfProperties;
			ctx: import('@cloudflare/workers-types').ExecutionContext;
		}
	}
}

export {};
