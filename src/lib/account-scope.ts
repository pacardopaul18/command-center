/**
 * Which account a page is reading, resolved the same way everywhere.
 *
 * D127: a correctly scoped route reached by a page that never passes the scope
 * is still a broken surface. The routes cannot enforce what they are not told,
 * so the telling has to be consistent, and consistent means one function rather
 * than the same three lines copied into each loader with small differences.
 *
 * The order is explicit beats remembered beats the only one there is. A link
 * naming an account always lands where it says, regardless of what was last
 * opened.
 *
 * The final fallback matters more than it looks. Without it a reader who has
 * two accounts and has never picked one sends an unscoped request, and
 * `resolveAccount` correctly refuses it with a 400. That refusal is right at the
 * route and useless at the page, which has to render something. Naming the
 * first connected account means the page always asks a question the route can
 * answer, and the picker on the page is how the reader changes the answer.
 */

export type ScopeFetch = (input: string) => Promise<Response>;

export interface AccountScope {
	/** The account id to send, or '' when no account is connected at all. */
	account: string;
	/** Whether anything is connected. An empty state, not a failure. See D113. */
	connected: boolean;
}

export async function resolveAccountScope(
	fetch: ScopeFetch,
	url: URL,
	/**
	 * Whether 'all' is a scope this page understands.
	 *
	 * Mail can union accounts and label every row with its account, so 'all' is
	 * a real answer there. Settings and Meetings cannot, and the remembered
	 * preference is shared, so handing them a stored 'all' would send them to a
	 * route that correctly 404s an account id that is not one. Off by default:
	 * a page opts in to the union rather than inheriting it.
	 */
	allowAll = false
): Promise<AccountScope> {
	const named = url.searchParams.get('account');
	if (named && (allowAll || named !== 'all')) return { account: named, connected: true };

	const remembered = await fetch('/api/connections/active-account')
		.then((r) => (r.ok ? (r.json() as Promise<{ active?: string | null }>) : null))
		.catch(() => null);

	const active = remembered?.active;
	if (active && (allowAll || active !== 'all')) return { account: active, connected: true };

	// A stored 'all' on a page that cannot union. The preference is real and
	// must not be overwritten, so the page reads the first account for this
	// visit without touching what Paul chose.
	if (active === 'all') {
		const roster = await fetch('/api/connections')
			.then((r) => (r.ok ? (r.json() as Promise<{ accounts?: { id: string }[] }>) : null))
			.catch(() => null);
		const first = roster?.accounts?.[0]?.id ?? '';
		if (first) return { account: first, connected: true };
	}

	// No roster fallback here, deliberately.
	//
	// An earlier version of this asked /api/connections and took the first
	// account when nothing was remembered. That is a default in the request
	// path, and D108 is the rule against exactly that: it would have made a
	// loader that forgot to pass scope look healthy, which is how F1 survived.
	//
	// The first-use default belongs to the preference, not to the resolver, so
	// it lives in GET /api/connections/active-account, which persists the
	// choice and reports that it made one. By the time this function reads that
	// route, a connected account has already produced an answer.
	return { account: '', connected: false };
}

/** The query suffix for a scoped request, empty when nothing is connected. */
export function accountQuery(account: string, separator: '?' | '&' = '?'): string {
	return account ? `${separator}account=${encodeURIComponent(account)}` : '';
}

/**
 * The message for a scoped request that failed.
 *
 * Returned rather than thrown, because these calls are context on pages whose
 * main content must still render, and swallowed rather than shown is the
 * failure this exists to prevent: the page goes blank in exactly the place a
 * reader would look to find out why.
 */
export async function scopedError(res: Response, what: string): Promise<string | null> {
	if (res.ok) return null;
	const body = (await res.json().catch(() => ({}))) as { error?: string };
	return body.error ?? `Could not load ${what} (${res.status}).`;
}
