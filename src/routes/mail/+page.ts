import type { PageLoad } from './$types';
import type { ThreadRow } from '$lib/types-mail';

/**
 * Which mailbox, and which slice of it.
 *
 * The URL wins, then the remembered choice, then the only account there is.
 * Explicit beats remembered beats implied, so a link to a specific account
 * always lands where it says regardless of what was last opened.
 */
const DEFAULT_TAB = 'needs';

export interface RosterAccount {
	id: string;
	account_email: string | null;
	status: string;
	reauth: { days_left: number | null; expired: boolean };
}

export const load: PageLoad = async ({ fetch, url }) => {
	const q = url.searchParams.get('q') ?? '';
	const clientId = url.searchParams.get('client_id') ?? '';
	const archived = url.searchParams.get('archived') === 'true';
	const accountParam = url.searchParams.get('account');

	/**
	 * The tab is the severity filter plus one computed view.
	 *
	 * "needs" is not a severity, it is urgent-or-important where the last
	 * message is not Paul's, so it is carried as its own parameter rather than
	 * being squeezed into the severity list where it would read as a category
	 * the classifier can assign.
	 */
	const tab = url.searchParams.get('tab') ?? url.searchParams.get('severity') ?? DEFAULT_TAB;

	const remembered = accountParam
		? null
		: await fetch('/api/connections/active-account')
				.then((r) => (r.ok ? r.json() : null))
				.catch(() => null);

	const account: string = accountParam ?? (remembered as { active?: string } | null)?.active ?? '';

	const params = new URLSearchParams({ limit: '100' });
	if (account) params.set('account', account);
	if (q) params.set('q', q);
	if (clientId) params.set('client_id', clientId);
	if (archived) params.set('archived', 'true');
	if (tab === 'needs') params.set('needs_you', 'true');
	else if (tab !== 'all') params.set('severity', tab);

	const [threadsRes, clientsRes, connectionsRes] = await Promise.all([
		fetch(`/api/email/threads?${params}`),
		fetch('/api/clients'),
		fetch('/api/connections')
	]);

	// No account connected is a state, not a failure. The screen knows how to
	// say nothing has been read yet; it only has to be allowed to. D113.
	if (threadsRes.status === 400 || threadsRes.status === 404) {
		return {
			threads: [] as ThreadRow[],
			counts: {} as Record<string, number>,
			needsYou: 0,
			scope: 'one' as const,
			roster: [] as RosterAccount[],
			account: '',
			clients: [] as { id: string; name: string }[],
			q,
			clientId,
			tab,
			archived,
			archivedCount: 0,
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
		needs_you: number;
		archived_count: number;
		scope: 'one' | 'all';
	};

	const roster = connectionsRes.ok
		? ((await connectionsRes.json()) as { accounts: RosterAccount[] }).accounts
		: [];

	const clients = clientsRes.ok
		? ((await clientsRes.json()) as { clients: { id: string; name: string }[] }).clients
		: [];

	// The archived count comes from the server, which counts archived rows
	// directly. Summing `counts` cannot answer it: that block describes
	// whichever side of the toggle is on screen, so it reported the inbox total
	// as the archive total.

	return {
		threads: payload.threads,
		counts: payload.counts,
		needsYou: payload.needs_you ?? 0,
		scope: payload.scope,
		roster,
		account: account || (roster[0]?.id ?? ''),
		clients,
		q,
		clientId,
		tab,
		archived,
		archivedCount: payload.archived_count ?? 0,
		noAccount: false
	};
};
