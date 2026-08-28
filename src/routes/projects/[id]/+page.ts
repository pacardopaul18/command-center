import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { ActionItem, Client, Project } from '$lib/types';

export const load: PageLoad = async ({ fetch, params }) => {
	const [res, clientsRes] = await Promise.all([
		fetch(`/api/projects/${params.id}`),
		fetch('/api/clients')
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

	return { ...data, clients };
};
