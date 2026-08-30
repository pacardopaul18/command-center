import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiWrite } from '../src/lib/http';

/**
 * Layer 2, unit half: the client write guard from D66.
 *
 * The defect this exists to prevent is specific and was live in 26 places: a
 * response that is 2xx but not JSON was treated as success, so a write that
 * never happened reported that it had. These tests fix that behaviour in place
 * by driving the exact responses that used to slip through.
 */

function respond(body: string, init: ResponseInit & { type?: string } = {}) {
	const headers = new Headers(init.headers);
	if (init.type) headers.set('content-type', init.type);
	return new Response(body, { ...init, headers });
}

afterEach(() => vi.unstubAllGlobals());

function stub(fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
	vi.stubGlobal('fetch', vi.fn(fn));
}

describe('layer 2: apiWrite refuses to call a non-JSON 2xx a success', () => {
	it('the exact regression: 200 with an HTML sign-in page', async () => {
		stub(async () => respond('<!doctype html><h1>Sign in</h1>', { status: 200, type: 'text/html' }));
		const r = await apiWrite('/api/action-items', 'POST', { title: 'x' });

		expect(r.ok).toBe(false);
		expect(r.data).toBeNull();
		expect(r.error).toMatch(/session/i);
		expect(r.error).toMatch(/reload/i);
		// The message must tell the reader to check before retrying. Not saying so
		// is what produced five duplicate rows.
		expect(r.error).toMatch(/saved/i);
	});

	it('a 200 with an empty body is a failure too', async () => {
		stub(async () => respond('', { status: 200 }));
		const r = await apiWrite('/api/action-items', 'POST', { title: 'x' });
		expect(r.ok).toBe(false);
	});

	it('a 200 with truncated JSON is a failure', async () => {
		stub(async () => respond('{"item":', { status: 200, type: 'application/json' }));
		const r = await apiWrite('/api/action-items', 'POST', {});
		expect(r.ok).toBe(false);
	});

	it('a 302 followed to HTML is a failure, which is the live shape', async () => {
		// fetch follows redirects by default, so the caller sees the final 200.
		stub(async () => respond('<html>login</html>', { status: 200, type: 'text/html' }));
		const r = await apiWrite('/api/backups/run', 'POST');
		expect(r.ok).toBe(false);
	});
});

describe('layer 2: apiWrite still behaves on the ordinary paths', () => {
	it('a 201 with JSON succeeds and returns the parsed body', async () => {
		stub(async () => respond(JSON.stringify({ item: { id: 'abc' } }), { status: 201, type: 'application/json' }));
		const r = await apiWrite<{ item: { id: string } }>('/api/action-items', 'POST', { title: 'x' });
		expect(r.ok).toBe(true);
		expect(r.status).toBe(201);
		expect(r.data?.item.id).toBe('abc');
		expect(r.error).toBeNull();
	});

	it('a 4xx surfaces the API error message verbatim', async () => {
		stub(async () => respond(JSON.stringify({ error: 'Title is required.' }), { status: 400, type: 'application/json' }));
		const r = await apiWrite('/api/action-items', 'POST', {});
		expect(r.ok).toBe(false);
		expect(r.error).toBe('Title is required.');
	});

	it('a 4xx with no usable body still produces a readable message', async () => {
		stub(async () => respond('nope', { status: 409, type: 'text/plain' }));
		const r = await apiWrite('/api/action-items/x/asana', 'POST');
		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/409/);
	});

	it('a network failure is reported as such, not as a server error', async () => {
		stub(async () => {
			throw new TypeError('Failed to fetch');
		});
		const r = await apiWrite('/api/action-items', 'POST', { title: 'x' });
		expect(r.ok).toBe(false);
		expect(r.status).toBe(0);
		expect(r.error).toMatch(/could not reach/i);
	});

	it('sends no content-type when there is no body, so DELETE stays honest', async () => {
		let seen: RequestInit | undefined;
		stub(async (_i, init) => {
			seen = init;
			return respond(JSON.stringify({ ok: true }), { status: 200, type: 'application/json' });
		});
		await apiWrite('/api/action-items/abc', 'DELETE');
		expect(seen?.headers).toBeUndefined();
		expect(seen?.body).toBeUndefined();
	});

	it('serialises the body and sets the content type when there is one', async () => {
		let seen: RequestInit | undefined;
		stub(async (_i, init) => {
			seen = init;
			return respond(JSON.stringify({ ok: true }), { status: 200, type: 'application/json' });
		});
		await apiWrite('/api/action-items', 'POST', { title: 'hello' });
		expect(seen?.body).toBe('{"title":"hello"}');
		expect((seen?.headers as Record<string, string>)['content-type']).toBe('application/json');
	});
});
