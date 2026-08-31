import type { PageLoad } from './$types';
import { monthKey, monthWindow, previousMonth } from '$lib/ledger';

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

/**
 * The ledger, a month at a time.
 *
 * A month rather than a free range, because that is the unit the books are kept
 * in and the unit every question about them is asked in. An explicit `from` and
 * `to` still work and still win, so a link out of a report into a specific
 * window lands where it says.
 *
 * The previous month's totals are fetched alongside, because "net for August"
 * on its own does not say whether August was better or worse than July, and
 * that comparison is the reason to look at all.
 */
export const load: PageLoad = async ({ fetch, url }) => {
	const explicitFrom = url.searchParams.get('from') ?? '';
	const explicitTo = url.searchParams.get('to') ?? '';
	const custom = Boolean(explicitFrom || explicitTo);

	const month = url.searchParams.get('month') ?? monthKey(new Date());
	const window = monthWindow(month);

	const from = custom ? explicitFrom : window.from;
	const to = custom ? explicitTo : window.to;

	const scope = new URLSearchParams();
	if (from) scope.set('from', from);
	if (to) scope.set('to', to);
	const q = scope.toString() ? `?${scope}` : '';

	const prior = monthWindow(previousMonth(month));
	const priorQuery = `?from=${prior.from}&to=${prior.to}`;

	const [txRes, catRes, totalsRes, priorRes, clientsRes] = await Promise.all([
		fetch(`/api/ledger/transactions${q}&limit=500`.replace('?&', '?')),
		fetch('/api/ledger/categories?include_archived=true'),
		fetch(`/api/ledger/totals${q}`),
		// Only meaningful for a month view; a custom range has no "month before".
		custom ? Promise.resolve(null) : fetch(`/api/ledger/totals${priorQuery}`),
		fetch('/api/clients')
	]);

	if (!txRes.ok) {
		const body = (await txRes.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the ledger.');
	}

	return {
		transactions: ((await txRes.json()) as { transactions: LedgerTransaction[] }).transactions,
		clients: clientsRes.ok
			? ((await clientsRes.json()) as { clients: { id: string; name: string }[] }).clients
			: [],
		categories: catRes.ok
			? ((await catRes.json()) as { categories: LedgerCategory[] }).categories
			: [],
		totals: totalsRes.ok ? ((await totalsRes.json()) as { totals: CurrencyTotal[] }).totals : [],
		priorTotals: priorRes?.ok
			? ((await priorRes.json()) as { totals: CurrencyTotal[] }).totals
			: [],
		month,
		custom,
		from,
		to
	};
};
