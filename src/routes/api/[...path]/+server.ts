import type { RequestHandler } from './$types';
import { api } from '$lib/server/api';

/**
 * Bridge from SvelteKit to Hono. Every /api request, any method, lands here and
 * is handed to the Hono app with the Cloudflare bindings as its env.
 *
 * platform is present in production on Pages and is emulated by
 * adapter-cloudflare during vite dev and vite preview.
 */
const handle: RequestHandler = ({ request, platform }) => {
	if (!platform?.env?.DB) {
		return new Response(
			JSON.stringify({
				error:
					'No Cloudflare bindings available. Run the local migration first: npm run db:migrate:local'
			}),
			{ status: 503, headers: { 'content-type': 'application/json' } }
		);
	}

	return api.fetch(request, platform.env, platform.ctx);
};

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
