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
	/** Signed contract documents, bytes in R2 and a row here. Migration 0027. */
	files: {
		id: string;
		contract_id: string | null;
		contract_title: string | null;
		filename: string;
		mime_type: string | null;
		size_bytes: number;
		uploaded_at: string;
	}[];
	/**
	 * What has happened on this client lately, merged from the records
	 * themselves rather than from a log. Nothing writes these; they are read
	 * back out of invoices, payments, meetings, projects and filed contracts, so
	 * the feed cannot be stale or missing an entry somebody forgot to write.
	 */
	activity: { at: string; kind: string; ref: string; detail: string }[];
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
