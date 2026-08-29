import type { PageLoad } from './$types';
import type { Client, Meeting, Project } from '$lib/types';

export const load: PageLoad = async ({ fetch, url }) => {
	const q = url.searchParams.get('q') ?? '';
	const query = q ? `?q=${encodeURIComponent(q)}` : '';

	const [meetingsRes, clientsRes, projectsRes] = await Promise.all([
		fetch(`/api/meetings${query}`),
		fetch('/api/clients'),
		fetch('/api/projects')
	]);

	if (!meetingsRes.ok) {
		const body = (await meetingsRes.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load meetings.');
	}

	const { meetings } = (await meetingsRes.json()) as { meetings: Meeting[] };
	const clients = clientsRes.ok ? ((await clientsRes.json()) as { clients: Client[] }).clients : [];
	const projects = projectsRes.ok
		? ((await projectsRes.json()) as { projects: Project[] }).projects
		: [];

	return { meetings, clients, projects, q };
};
