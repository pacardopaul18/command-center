import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { Contact, Contract, Invoice, Project, Ticket } from '$lib/types';

interface Overview {
	client: {
		id: string;
		name: string;
		status: string;
		billing_terms: string | null;
		notes: string | null;
		default_rate_cents: number | null;
	};
	today: string;
	contacts: Contact[];
	contracts: Contract[];
	projects: (Project & { open_items: number; open_tickets: number })[];
	invoices: Invoice[];
	meetings: { id: string; title: string; meeting_date: string }[];
	tickets: Ticket[];
	money: {
		invoiced_cents: number;
		outstanding_cents: number;
		overdue_cents: number;
		overdue_count: number;
	};
}

export const load: PageLoad = async ({ fetch, params }) => {
	const res = await fetch(`/api/clients/${params.id}/overview`);

	if (res.status === 404) error(404, 'Client not found.');
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the client.');
	}

	return (await res.json()) as Overview;
};
