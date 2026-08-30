import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { ActionItem, Client, Project, Ticket } from '$lib/types';

export const load: PageLoad = async ({ fetch, params }) => {
	const [res, clientsRes, ticketsRes, ownersRes] = await Promise.all([
		fetch(`/api/projects/${params.id}`),
		fetch('/api/clients'),
		fetch(`/api/tickets?project_id=${params.id}&status=all`),
		fetch('/api/people/owners')
	]);

	if (res.status === 404) error(404, 'Project not found.');
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the project.');
	}

	const data = (await res.json()) as { project: Project; action_items: ActionItem[] };
	const clients = clientsRes.ok
		? ((await clientsRes.json()) as { clients: Client[] }).clients
		: [];

	// Tickets and the owner roster are supporting detail. A failure in either
	// must not stop the project loading, so both degrade to empty.
	const tickets = ticketsRes.ok
		? ((await ticketsRes.json()) as { tickets: Ticket[] }).tickets
		: [];
	const owners = ownersRes.ok
		? ((await ownersRes.json()) as { owners: string[] }).owners
		: [];

	return { ...data, clients, tickets, owners };
};
