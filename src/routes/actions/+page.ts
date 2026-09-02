import type { PageLoad } from './$types';
import { ACTION_VIEWS } from '$lib/types';
import type { ActionItem, ActionItemCounts, ActionView, Paging, Project } from '$lib/types';

/**
 * Something a model read out of a transcript or an email, offered for review.
 *
 * Never an action item until a person says so. A commitment is a reading of a
 * sentence and some readings are wrong; the screen that says what Paul owes
 * people stops being believed the first week it fills with things he does not.
 */
export interface Proposal {
	source: 'mail' | 'meeting';
	id: string;
	title: string;
	context: string | null;
	owner: string | null;
	deadline: string | null;
	due_signal: string | null;
	ambiguous: number;
	ambiguity_note: string | null;
	/** The sentence it was read from. Without this there is nothing to review. */
	evidence: string | null;
	status: string;
	created_at: string;
	client_name: string | null;
	project_name: string | null;
	/** The thread subject or meeting title it came from. */
	origin: string | null;
}

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

	/*
	 * The review queue, on the page the reviewing is for.
	 *
	 * Proposals were reviewable only on the screen that produced them, so the
	 * loop was invisible from the one page that says what Paul owes people. A
	 * queue nobody passes is a queue nobody empties.
	 *
	 * Supporting detail: a failure must not stop the action items loading.
	 */
	const proposalsRes = await fetch('/api/action-items/proposals?status=pending');
	const proposals = proposalsRes.ok
		? ((await proposalsRes.json()) as {
				proposals: Proposal[];
				counts: { pending: number; accepted: number; rejected: number };
			})
		: { proposals: [] as Proposal[], counts: { pending: 0, accepted: 0, rejected: 0 } };

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

	return { ...data, view, q, projectId, owner, sort, projects, asana, owners, proposals };
};
