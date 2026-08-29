import type { PageLoad } from './$types';
import { ACTION_VIEWS } from '$lib/types';
import type { ActionItem, ActionItemCounts, ActionView, Project } from '$lib/types';

export const load: PageLoad = async ({ fetch, url }) => {
	const raw = url.searchParams.get('view') ?? 'open';
	const view: ActionView = (ACTION_VIEWS as readonly string[]).includes(raw)
		? (raw as ActionView)
		: 'open';

	const q = url.searchParams.get('q') ?? '';
	const projectId = url.searchParams.get('project_id') ?? '';

	const query = new URLSearchParams({ view });
	if (q) query.set('q', q);
	if (projectId) query.set('project_id', projectId);

	const [itemsRes, projectsRes, asanaRes] = await Promise.all([
		fetch(`/api/action-items?${query}`),
		fetch('/api/projects'),
		fetch('/api/asana')
	]);

	if (!itemsRes.ok) {
		const body = (await itemsRes.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load action items.');
	}

	const data = (await itemsRes.json()) as {
		today: string;
		view: ActionView;
		items: ActionItem[];
		counts: ActionItemCounts;
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

	return { ...data, view, q, projectId, projects, asana };
};
