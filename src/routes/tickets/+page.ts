import type { PageLoad } from './$types';
import type { Ticket } from '$lib/types';
import type { TicketView } from './views';


export const load: PageLoad = async ({ fetch, url }) => {
	/*
	 * Overdue is the default, and that is the whole point of this page.
	 *
	 * 247 open tickets were past due, correct in the Projects API and reaching
	 * no reader anywhere, because there was no list for them to reach. A page
	 * that opened on everything would bury them again under 2,597 rows.
	 */
	const view = (url.searchParams.get('view') ?? 'overdue') as TicketView;
	const assignee = url.searchParams.get('assignee') ?? '';
	const projectId = url.searchParams.get('project') ?? '';

	const query = new URLSearchParams();
	if (view === 'overdue' || view === 'due_today') query.set('view', view);
	if (view === 'all') query.set('status', 'all');
	if (assignee) query.set('assignee', assignee);
	if (projectId) query.set('project_id', projectId);

	const res = await fetch(`/api/tickets?${query}`);
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the tickets.');
	}

	const body = (await res.json()) as {
		tickets: Ticket[];
		today: string;
		views: { overdue: number; due_today: number; open: number; all: number };
		assignees: { assignee: string; n: number }[];
	};

	return { ...body, view, assignee, projectId };
};
