import type { PageLoad } from './$types';

export interface ThreadRow {
	id: string;
	subject: string | null;
	message_count: number;
	actual_count: number;
	first_at: string | null;
	last_at: string | null;
	client_id: string | null;
	client_name: string | null;
	latest_from: string | null;
	latest_snippet: string | null;
	summary: string | null;
	summary_at: string | null;
}

export const load: PageLoad = async ({ fetch, url }) => {
	const q = url.searchParams.get('q') ?? '';
	const clientId = url.searchParams.get('client_id') ?? '';
	const unlinked = url.searchParams.get('unlinked') === 'true';

	const params = new URLSearchParams({ limit: '100' });
	if (q) params.set('q', q);
	if (clientId) params.set('client_id', clientId);
	if (unlinked) params.set('unlinked', 'true');

	const [threadsRes, ingestRes, clientsRes] = await Promise.all([
		fetch(`/api/email/threads?${params}`),
		fetch('/api/email/ingest'),
		fetch('/api/clients')
	]);

	if (!threadsRes.ok) {
		const body = (await threadsRes.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load mail.');
	}

	// The ingest state is context, not content. A failure reading it must not
	// stop the mail list rendering.
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
		threads: ((await threadsRes.json()) as { threads: ThreadRow[] }).threads,
		ingest,
		clients,
		q,
		clientId,
		unlinked
	};
};
