import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { ActionItem, Client, Meeting, Project, Proposal } from '$lib/types';

/** The calendar event this record is about, when one is linked. */
export interface LinkedCall {
	id: string;
	summary: string | null;
	starts_at: string;
	ends_at: string | null;
	all_day: number;
	html_link: string | null;
	location: string | null;
	organizer: string | null;
	attendee_count: number | null;
	account_email: string | null;
	account_id: string;
}

/**
 * One person on the linked call, as Google reports them.
 *
 * Only ever present when a call is linked. The typed `attendees` line on the
 * meeting is the other source and the two are never merged: the screen says
 * which one it is showing, because "five people" from a guest list and "five
 * people" from a sentence somebody typed are not the same claim.
 */
export interface CalendarAttendee {
	email: string | null;
	display_name: string | null;
	response_status: string | null;
	is_organizer: number;
	is_self: number;
}

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

	/**
	 * The call and the people on it come from the same request, because both
	 * are facts about this meeting and a second round trip for a sidebar would
	 * make the sidebar arrive after the page.
	 */
	const data = (await res.json()) as {
		meeting: Meeting;
		action_items: ActionItem[];
		call: LinkedCall | null;
		attendees: CalendarAttendee[];
	};
	const proposals = proposalsRes.ok
		? ((await proposalsRes.json()) as { proposals: Proposal[] }).proposals
		: [];
	const clients = clientsRes.ok ? ((await clientsRes.json()) as { clients: Client[] }).clients : [];
	const projects = projectsRes.ok
		? ((await projectsRes.json()) as { projects: Project[] }).projects
		: [];

	return { ...data, proposals, clients, projects };
};
