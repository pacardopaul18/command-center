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

	// 'all' is an explicit choice and means no filter. Absent means the default.
	const severity = severityParam ?? DEFAULT_SEVERITY;

	const params = new URLSearchParams({ limit: '100' });
	if (q) params.set('q', q);
	if (clientId) params.set('client_id', clientId);
	if (severity !== 'all') params.set('severity', severity);
	if (archived) params.set('archived', 'true');

	const [threadsRes, ingestRes, clientsRes] = await Promise.all([
		fetch(`/api/email/threads?${params}`),
		fetch('/api/email/ingest'),
		fetch('/api/clients')
	]);

	if (!threadsRes.ok) {
		const body = (await threadsRes.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load mail.');
	}

	const payload = (await threadsRes.json()) as {
		threads: ThreadRow[];
		counts: Record<string, number>;
	};

	// Ingest state is context, not content. A failure reading it must not stop
	// the list rendering.
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
		untriaged: payload.counts.untriaged ?? 0,
		ingest,
		clients,
		q,
		clientId,
		severity,
		archived
	};
};
