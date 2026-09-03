import type { PageLoad } from './$types';
import type { Client, Project } from '$lib/types';

export const load: PageLoad = async ({ fetch, url }) => {
	/*
	 * Which projects to show, from the URL rather than from component state.
	 *
	 * The view is a fact about the page, so it belongs in the address: a link to
	 * the archived list has to be a link somebody can send, and going back has
	 * to land where they were.
	 */
	const archived = url.searchParams.get('archived') ?? 'no';

	const [projectsRes, clientsRes, freshnessRes, sectionsRes] = await Promise.all([
		fetch(`/api/projects?archived=${encodeURIComponent(archived)}`),
		fetch('/api/clients'),
		// How old the mirrored data is. Supporting detail: a failure must not
		// stop the page, so it degrades to showing no claim rather than a wrong one.
		fetch('/api/asana/freshness'),
		// How much of the section reconciliation is left. Supporting detail on the
		// same terms: no claim rather than a wrong one.
		fetch('/api/sections')
	]);

	if (!projectsRes.ok) {
		const body = (await projectsRes.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load projects.');
	}

	const body = (await projectsRes.json()) as {
		projects: Project[];
		archived: string;
		counts: { live: number; archived: number };
	};
	const clients = clientsRes.ok
		? ((await clientsRes.json()) as { clients: Client[] }).clients
		: [];

	const freshness = freshnessRes.ok ? await freshnessRes.json() : null;

	/*
	 * Undefined, not zero, when the count could not be read.
	 *
	 * Zero here would draw no link, which is the same thing the screen does when
	 * everything is decided. The two are different facts and the link is hidden
	 * either way, so undefined is what the page carries. D214.
	 */
	const sectionsUndecided = sectionsRes.ok
		? ((await sectionsRes.json()) as { progress: { unmapped: number } }).progress.unmapped
		: undefined;

	return {
		sections_undecided: sectionsUndecided,
		projects: body.projects,
		clients,
		archived: body.archived,
		counts: body.counts,
		freshness
	};
};
