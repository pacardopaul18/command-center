import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { ActionItem, Client, Meeting, Project, Proposal } from '$lib/types';

export const load: PageLoad = async ({ fetch, params }) => {
	const [res, proposalsRes, clientsRes, projectsRes] = await Promise.all([
		fetch(`/api/meetings/${params.id}`),
		fetch(`/api/meetings/${params.id}/proposals`),
		fetch('/api/clients'),
		fetch('/api/projects')
	]);

	if (res.status === 404) error(404, 'Meeting not found.');
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the meeting.');
	}

	const data = (await res.json()) as { meeting: Meeting; action_items: ActionItem[] };
	const proposals = proposalsRes.ok
		? ((await proposalsRes.json()) as { proposals: Proposal[] }).proposals
		: [];
	const clients = clientsRes.ok ? ((await clientsRes.json()) as { clients: Client[] }).clients : [];
	const projects = projectsRes.ok
		? ((await projectsRes.json()) as { projects: Project[] }).projects
		: [];

	return { ...data, proposals, clients, projects };
};
