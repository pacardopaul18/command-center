import type { PageLoad } from './$types';
import type {
	BillingPeriod,
	Client,
	ClientMoney,
	Invoice,
	InvoicingHeadline
} from '$lib/types';

/**
 * Invoicing loads in two steps: everybody, then one client.
 *
 * The screen is client first, so the rail and the four headline figures come
 * from one query over every invoice, and the documents come from the client the
 * URL names. The selected client lives in the URL rather than in component
 * state so a client's invoicing is linkable, the back button works, and a
 * reload lands where the reader was. Same reasoning as the report windows and
 * the pager.
 */
export const load: PageLoad = async ({ fetch, url }) => {
	const overviewRes = await fetch('/api/invoicing/overview');
	if (!overviewRes.ok) {
		const body = (await overviewRes.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load invoicing.');
	}

	const overview = (await overviewRes.json()) as {
		today: string;
		headline: InvoicingHeadline;
		clients: ClientMoney[];
		year_start: string;
	};

	const requested = url.searchParams.get('client');
	// A client id in the URL that no longer exists falls back to the first row
	// rather than showing an empty screen with no way out of it.
	const known = overview.clients.some((c) => c.id === requested);
	const selectedId = known ? requested : (overview.clients[0]?.id ?? null);

	let detail: {
		client: Client;
		money: {
			open_cents: number;
			overdue_cents: number;
			invoice_count: number;
			collected_year_cents: number;
			collected_year_count: number;
			avg_days_to_pay: number | null;
		};
		invoices: Invoice[];
		periods: BillingPeriod[];
	} | null = null;

	if (selectedId) {
		const res = await fetch(`/api/invoicing/clients/${selectedId}`);
		if (res.ok) detail = await res.json();
	}

	return {
		today: overview.today,
		headline: overview.headline,
		clients: overview.clients,
		selectedId,
		detail,
		tab: url.searchParams.get('tab') ?? 'overview'
	};
};
