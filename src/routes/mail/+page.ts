import type { PageLoad } from './$types';
import type { ThreadRow } from '$lib/types-mail';

/**
 * The default view is what needs Paul, not everything.
 *
 * A mailbox opened on all of itself is the problem, not the feature. Urgent and
 * Important first; the rest is one chip away and nothing is ever hidden for
 * good.
 */
const DEFAULT_SEVERITY = 'urgent,important';

export const load: PageLoad = async ({ fetch, url }) => {
	const q = url.searchParams.get('q') ?? '';
	const clientId = url.searchParams.get('client_id') ?? '';
	const severityParam = url.searchParams.get('severity');
	const archived = url.searchParams.get('archived') === 'true';

	/**
	 * Which mailbox. The URL wins, then the remembered choice, then whichever
	 * single account exists. Explicit beats remembered beats implied, so a link
	 * to a specific account always lands where it says.
	 */
	const accountParam = url.searchParams.get('account');

	// 'all' is an explicit choice and means no filter. Absent means the default.
	const severity = severityParam ?? DEFAULT_SEVERITY;

	const remembered = accountParam
		? null
		: await fetch('/api/connections/active-account')
				.then((r) => (r.ok ? r.json() : null))
				.catch(() => null);

	const account: string =
		accountParam ?? (remembered as { active?: string } | null)?.active ?? '';

	const params = new URLSearchParams({ limit: '100' });
	if (account) params.set('account', account);
	if (q) params.set('q', q);
	if (clientId) params.set('client_id', clientId);
	if (severity !== 'all') params.set('severity', severity);
	if (archived) params.set('archived', 'true');

	const [threadsRes, ingestRes, clientsRes] = await Promise.all([
		fetch(`/api/email/threads?${params}`),
		fetch('/api/email/ingest'),
		fetch('/api/clients')
	]);

	/**
	 * No account connected is a state, not a failure.
	 *
	 * The page threw a 500 here, which is what Paul would have seen before ever
	 * connecting an account and again the moment he disconnected the last one.
	 * The screen already knows how to say "nothing has been read yet"; it just
	 * was not being allowed to.
	 */
	if (threadsRes.status === 400 || threadsRes.status === 404) {
		return {
			threads: [] as ThreadRow[],
			counts: {} as Record<string, number>,
			scope: 'one' as const,
			roster: [] as {
				id: string;
				account_email: string | null;
				status: string;
				reauth: { days_left: number | null; expired: boolean };
			}[],
			account: '',
			untriaged: 0,
			ingest: null,
			clients: [],
			q,
			clientId,
			severity,
			archived,
			noAccount: true
		};
	}

	if (!threadsRes.ok) {
		const body = (await threadsRes.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load mail.');
	}

	const payload = (await threadsRes.json()) as {
		threads: ThreadRow[];
		counts: Record<string, number>;
		scope: 'one' | 'all';
		accounts: { id: string; account_email: string | null }[];
	};

	// Ingest state is context, not content. A failure reading it must not stop
	// the list rendering.
	// The roster, with each account's own expiry, for the switcher.
	const connectionsRes = await fetch('/api/connections');
	const roster = connectionsRes.ok
		? ((await connectionsRes.json()) as {
				accounts: {
					id: string;
					account_email: string | null;
					status: string;
					reauth: { days_left: number | null; expired: boolean };
				}[];
			}).accounts
		: [];

	const ingest = ingestRes.ok
		? ((await ingestRes.json()) as {
				account: string | null;
				stored: { messages: number; threads: number };
			})
		: null;

	const clients = clientsRes.ok
		? ((await clientsRes.json()) as { clients: { id: string; name: string }[] }).clients
		: [];

	return {
		threads: payload.threads,
		counts: payload.counts,
		scope: payload.scope,
		roster,
		account: account || (roster[0]?.id ?? ''),
		untriaged: payload.counts.untriaged ?? 0,
		ingest,
		clients,
		q,
		clientId,
		severity,
		archived,
		noAccount: false
	};
};
