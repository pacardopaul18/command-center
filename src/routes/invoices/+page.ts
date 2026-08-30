import type { PageLoad } from './$types';
import type { AgingBucket, BillingPeriod, Client, Invoice, Paging } from '$lib/types';

export const load: PageLoad = async ({ fetch, url }) => {
	const query = new URLSearchParams();
	for (const key of ['page', 'page_size']) {
		const v = url.searchParams.get(key);
		if (v) query.set(key, v);
	}

	const [invRes, clientsRes] = await Promise.all([
		fetch(`/api/invoicing?${query}`),
		fetch('/api/clients')
	]);

	if (!invRes.ok) {
		const body = (await invRes.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load invoicing.');
	}

	const data = (await invRes.json()) as {
		today: string;
		periods: BillingPeriod[];
		invoices: Invoice[];
		bands: { aging_bucket: AgingBucket; invoice_count: number; outstanding_cents: number }[];
		paging: Paging;
	};

	const clients = clientsRes.ok
		? ((await clientsRes.json()) as { clients: Client[] }).clients
		: [];

	return { ...data, clients };
};
