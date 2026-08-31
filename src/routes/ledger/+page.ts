import type { PageLoad } from './$types';

export interface LedgerCategory {
	id: string;
	name: string;
	kind: 'income' | 'expense' | 'overhead';
	parent_id: string | null;
	parent_name: string | null;
	transaction_count: number;
	archived_at: string | null;
}

export interface LedgerTransaction {
	id: string;
	category_id: string;
	category_name: string;
	category_kind: 'income' | 'expense' | 'overhead';
	client_id: string | null;
	client_name: string | null;
	project_id: string | null;
	project_name: string | null;
	txn_date: string;
	amount_cents: number;
	currency: string;
	provenance: 'manual' | 'invoice' | 'import';
	notes: string | null;
}

export interface CurrencyTotal {
	currency: string;
	amount_cents: number;
	income_cents: number;
	expense_cents: number;
	overhead_cents: number;
	entries: number;
}

export const load: PageLoad = async ({ fetch, url }) => {
	const from = url.searchParams.get('from') ?? '';
	const to = url.searchParams.get('to') ?? '';
	const params = new URLSearchParams();
	if (from) params.set('from', from);
	if (to) params.set('to', to);
	const q = params.toString() ? `?${params}` : '';

	const [txRes, catRes, totalsRes, clientsRes] = await Promise.all([
		fetch(`/api/ledger/transactions${q}`),
		fetch('/api/ledger/categories?include_archived=true'),
		fetch(`/api/ledger/totals${q}`),
		fetch('/api/clients')
	]);

	if (!txRes.ok) {
		const body = (await txRes.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the ledger.');
	}

	return {
		transactions: ((await txRes.json()) as { transactions: LedgerTransaction[] }).transactions,
		categories: catRes.ok
			? ((await catRes.json()) as { categories: LedgerCategory[] }).categories
			: [],
		totals: totalsRes.ok ? ((await totalsRes.json()) as { totals: CurrencyTotal[] }).totals : [],
		clients: clientsRes.ok
			? ((await clientsRes.json()) as { clients: { id: string; name: string }[] }).clients
			: [],
		from,
		to
	};
};
