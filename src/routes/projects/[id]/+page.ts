import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { ActionItem, Project } from '$lib/types';

export const load: PageLoad = async ({ fetch, params }) => {
	const res = await fetch(`/api/projects/${params.id}`);
	if (res.status === 404) error(404, 'Project not found.');
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the project.');
	}
	return (await res.json()) as { project: Project; action_items: ActionItem[] };
};
