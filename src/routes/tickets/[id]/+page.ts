import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { TimeEntry, Ticket } from '$lib/types';

export const load: PageLoad = async ({ fetch, params }) => {
	const [res, ownersRes] = await Promise.all([
		fetch(`/api/tickets/${params.id}`),
		fetch('/api/people/owners')
	]);

	if (res.status === 404) error(404, 'Ticket not found.');
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the ticket.');
	}

	const data = (await res.json()) as { ticket: Ticket; entries: TimeEntry[] };

	// The roster is supporting detail. A failure must not stop the ticket
	// loading, so it degrades to an empty picker.
	const owners = ownersRes.ok
		? ((await ownersRes.json()) as { owners: string[] }).owners
		: [];

	return { ...data, owners };
};
