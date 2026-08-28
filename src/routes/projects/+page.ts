import type { PageLoad } from './$types';
import type { Project } from '$lib/types';

export const load: PageLoad = async ({ fetch }) => {
	const res = await fetch('/api/projects');
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load projects.');
	}
	const { projects } = (await res.json()) as { projects: Project[] };
	return { projects };
};
