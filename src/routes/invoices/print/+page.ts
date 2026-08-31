import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { Client, Invoice } from '$lib/types';

interface Payment {
	id: string;
	paid_on: string;
	amount_cents: number;
	method: string | null;
}

/**
 * The printable sheet: one document, or one client's statement.
 *
 * PDF export is the browser's own print to PDF over clean printable HTML, which
 * is what the architecture asks for and what keeps this off Cloudflare's paid
 * Browser Rendering product. Same decision as the reports, D53.
 *
 * The route id ends in /print, which is how the layout knows to render without
 * the shell. A printed invoice carries the invoice and nothing else.
 *
 * One shape is returned for both modes rather than a union. A union here reads
 * neatly and then forces every field in the template through a narrowing that
 * the compiler cannot follow across the two branches, so the page ends up
 * asserting types it already knows. One shape with nulls is honest and quiet.
 */
export const load: PageLoad = async ({ fetch, url }) => {
	const invoiceId = url.searchParams.get('invoice');
	const clientId = url.searchParams.get('client');

	const empty = {
		invoice: null as Invoice | null,
		invoices: [] as Invoice[],
		payments: [] as Payment[],
		today: ''
	};

	if (invoiceId) {
		const res = await fetch(`/api/invoicing/invoices/${invoiceId}/document`);
		if (!res.ok) error(404, 'That document could not be found.');
		const body = (await res.json()) as {
			invoice: Invoice;
			client: Client;
			payments: Payment[];
		};
		return {
			...empty,
			mode: 'document' as const,
			client: body.client,
			invoice: body.invoice,
			payments: body.payments
		};
	}

	if (clientId) {
		const res = await fetch(`/api/invoicing/clients/${clientId}`);
		if (!res.ok) error(404, 'That client could not be found.');
		const body = (await res.json()) as { today: string; client: Client; invoices: Invoice[] };
		return {
			...empty,
			mode: 'statement' as const,
			client: body.client,
			invoices: body.invoices,
			today: body.today
		};
	}

	error(400, 'Name an invoice or a client to print.');
};
