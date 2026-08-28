import type { PageLoad } from './$types';
import type { Client, Project } from '$lib/types';

export const load: PageLoad = async ({ fetch }) => {
	const [projectsRes, clientsRes] = await Promise.all([
		fetch('/api/projects'),
		fetch('/api/clients')
	]);

	if (!projectsRes.ok) {
		const body = (await projectsRes.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load projects.');
	}

	const { projects } = (await projectsRes.json()) as { projects: Project[] };
	const clients = clientsRes.ok
		? ((await clientsRes.json()) as { clients: Client[] }).clients
		: [];

	return { projects, clients };
};
