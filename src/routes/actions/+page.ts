import type { PageLoad } from './$types';
import { ACTION_VIEWS } from '$lib/types';
import type { ActionItem, ActionItemCounts, ActionView, Paging, Project } from '$lib/types';

export const load: PageLoad = async ({ fetch, url }) => {
	const raw = url.searchParams.get('view') ?? 'open';
	const view: ActionView = (ACTION_VIEWS as readonly string[]).includes(raw)
		? (raw as ActionView)
		: 'open';

	const q = url.searchParams.get('q') ?? '';
	const projectId = url.searchParams.get('project_id') ?? '';
	const owner = url.searchParams.get('owner') ?? '';
	// The sort is validated by the route against a closed map, so an unknown
	// value here is passed through and lands on the default rather than being
	// second-guessed in two places.
	const sort = url.searchParams.get('sort') ?? 'deadline';

	const query = new URLSearchParams({ view, sort });
	if (q) query.set('q', q);
	if (projectId) query.set('project_id', projectId);
	if (owner) query.set('owner', owner);
	// Paging lives in the URL so a page is linkable and survives a reload.
	const pageNum = url.searchParams.get('page');
	const pageSize = url.searchParams.get('page_size');
	if (pageNum) query.set('page', pageNum);
	if (pageSize) query.set('page_size', pageSize);

	const [itemsRes, projectsRes, asanaRes, ownersRes] = await Promise.all([
		fetch(`/api/action-items?${query}`),
		fetch('/api/projects'),
		fetch('/api/asana'),
		fetch('/api/people/owners')
	]);

	if (!itemsRes.ok) {
		const body = (await itemsRes.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load action items.');
	}

	const data = (await itemsRes.json()) as {
		today: string;
		view: ActionView;
		items: ActionItem[];
		counts: ActionItemCounts & { done_week: number };
		owners: string[];
		paging: Paging;
	};

	const projects = projectsRes.ok
		? ((await projectsRes.json()) as { projects: Project[] }).projects
		: [];

	// Whether Asana is usable at all. Fetched here so the push control can say
	// why it is unavailable instead of failing when clicked. A failure to read
	// this must never stop action items loading, so it degrades to "not ready".
	const asana = asanaRes.ok
		? ((await asanaRes.json()) as {
				token_present: boolean;
				ready: boolean;
				blocked_because: string | null;
			})
		: { token_present: false, ready: false, blocked_because: 'Could not read the Asana settings.' };

	/**
	 * Owners for the picker, from two sources merged.
	 *
	 * `/api/people/owners` knows who could own something; the list route knows
	 * who does. A filter that cannot offer a name it is showing is a filter with
	 * a hole in it, and history that names somebody who was never a user in this
	 * system is still history.
	 */
	const roster = ownersRes.ok ? ((await ownersRes.json()) as { owners: string[] }).owners : [];
	const owners = [...new Set([...roster, ...data.owners])].sort((a, b) =>
		a.localeCompare(b, 'en', { sensitivity: 'base' })
	);

	return { ...data, view, q, projectId, owner, sort, projects, asana, owners };
};
