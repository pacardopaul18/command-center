/**
 * The one way the client talks to the API.
 *
 * Every write in the app used to do this:
 *
 *   const res = await fetch(...);
 *   const payload = (await res.json().catch(() => ({})));
 *   if (!res.ok) { errorMessage = payload.error ?? '...'; return; }
 *   await invalidateAll();
 *
 * which is correct for the two cases it thought about and silent for a third.
 * A response that is 2xx but not JSON falls straight through: `res.ok` is true,
 * `res.json()` throws and is swallowed into an empty object, the error branch is
 * skipped, and the caller reports success. The user sees nothing at all.
 *
 * That third case is not exotic. It is what an expired auth session returns when
 * the login page is served in place of the API, what a proxy or an edge error
 * page returns, and what any HTML response looks like. The one thing all of them
 * have in common is that the write did not do what the caller believes it did.
 *
 * So: a body that cannot be parsed is a failure, and it says so. There is no
 * path through this function that returns success without a parsed JSON body.
 */

export interface WriteResult<T = Record<string, unknown>> {
	ok: boolean;
	/** Present only when ok. */
	data: T | null;
	/** Present only when the write failed. Always suitable to show a person. */
	error: string | null;
	status: number;
}

/** Reads a response body once, and says whether it was JSON. */
async function readBody(res: Response): Promise<{ json: unknown | null; text: string }> {
	const text = await res.text().catch(() => '');
	if (!text) return { json: null, text: '' };
	try {
		return { json: JSON.parse(text), text };
	} catch {
		return { json: null, text };
	}
}

/**
 * Sends a JSON request and insists on a JSON answer.
 *
 * `body` is omitted entirely for methods that carry none, so a DELETE does not
 * send a content-type it has no content for.
 */
export async function apiWrite<T = Record<string, unknown>>(
	path: string,
	method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
	body?: unknown
): Promise<WriteResult<T>> {
	let res: Response;
	try {
		res = await fetch(path, {
			method,
			headers: body === undefined ? undefined : { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
	} catch {
		return {
			ok: false,
			data: null,
			status: 0,
			error: 'Could not reach the server. Nothing was saved.'
		};
	}

	const { json } = await readBody(res);
	const payload = json as { error?: string } | null;

	if (!res.ok) {
		return {
			ok: false,
			data: null,
			status: res.status,
			error: payload?.error ?? `The request failed (${res.status}). Nothing was saved.`
		};
	}

	// 2xx with a body that is not JSON. Previously this returned success.
	if (json === null) {
		return {
			ok: false,
			data: null,
			status: res.status,
			error:
				'The server answered with something other than data, which usually means the session ' +
				'expired and a sign-in page came back instead. Reload the page, sign in again, and check ' +
				'whether the change was saved before repeating it.'
		};
	}

	return { ok: true, data: json as T, status: res.status, error: null };
}
