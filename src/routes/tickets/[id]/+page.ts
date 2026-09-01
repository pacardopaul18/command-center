import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { TimeEntry, Ticket } from '$lib/types';

/**
 * One line on the ticket's history: a person's comment or the app's own note
 * about a change. One list because on screen it is one list, read in one order.
 * Migration 0029.
 */
export interface TicketEvent {
	id: string;
	kind: string;
	detail: string;
	author: string | null;
	created_at: string;
}

/**
 * Another ticket this one is about. Stored once per pair and read in both
 * directions, so `relation` is already the right way round for this ticket.
 */
export interface TicketLink {
	id: string;
	kind: string;
	direction: 'forward' | 'reverse';
	relation: string;
	other_id: string;
	title: string;
	status: string;
	priority: string;
}

/**
 * Effort against the ticket, which is not the billable time above.
 *
 * `time_entries` answers "what do we bill"; this answers "what did this
 * actually take". Stored in minutes, because hours as a float means totals
 * ending in 0.30000000000000004.
 */
export interface EffortEntry {
	id: string;
	minutes: number;
	logged_on: string;
	who: string | null;
	note: string | null;
	created_at: string;
}

/**
 * What Asana says about this ticket, when the ticket came from Asana.
 *
 * The section name is the verbatim status vocabulary, kept because the app's own
 * status is coarse on purpose: mapping 103 section names onto six values now
 * would guess the answer Thursday's reconciliation exists to ask. Showing both
 * puts the guess beside the fact. D171.
 */
export interface AsanaSource {
	asana_gid: string;
	linked_at: string;
	section_name: string | null;
	completed: number;
	source_modified_at: string | null;
	asana_assignee: string | null;
}

/**
 * One line of Asana's own history: a person's comment or a system event.
 *
 * Read from the mirror rather than projected into the app, because these are
 * comments and not commitments. Ten thousand of them in `action_items` would
 * bury the screen that says what Paul owes people.
 */
export interface AsanaStory {
	gid: string;
	created_at: string | null;
	type: string | null;
	text: string | null;
	author: string | null;
}

export interface Subtask {
	id: string;
	title: string;
	status: string;
	due_date: string | null;
	assignee: string | null;
}

export const load: PageLoad = async ({ fetch, params }) => {
	const [res, ownersRes, eventsRes, linksRes, effortRes] = await Promise.all([
		fetch(`/api/tickets/${params.id}`),
		fetch('/api/people/owners'),
		fetch(`/api/tickets/${params.id}/events`),
		fetch(`/api/tickets/${params.id}/links`),
		fetch(`/api/tickets/${params.id}/time`)
	]);

	if (res.status === 404) error(404, 'Ticket not found.');
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the ticket.');
	}

	const data = (await res.json()) as {
		ticket: Ticket;
		entries: TimeEntry[];
		mirrored: boolean;
		source: AsanaSource | null;
		activity: AsanaStory[];
		subtasks: Subtask[];
		parent: { id: string; title: string } | null;
	};

	// The roster is supporting detail. A failure must not stop the ticket
	// loading, so it degrades to an empty picker.
	const owners = ownersRes.ok
		? ((await ownersRes.json()) as { owners: string[] }).owners
		: [];

	/**
	 * Everything below is supporting detail on the same footing as the roster: a
	 * failure in any of them must not stop the ticket loading, so each degrades
	 * to empty.
	 */
	/**
	 * The other tickets on the same project, for the link picker.
	 *
	 * Fetched after the ticket rather than beside it, because the project id is
	 * not known until the ticket comes back. One extra round trip on a detail
	 * page, against a picker that would otherwise be empty.
	 */
	const siblingsRes = data.ticket.project_id
		? await fetch(`/api/tickets?project_id=${data.ticket.project_id}&status=all`)
		: null;
	const siblings = siblingsRes?.ok
		? ((await siblingsRes.json()) as { tickets: { id: string; title: string }[] }).tickets.filter(
				(t) => t.id !== params.id
			)
		: [];

	const events = eventsRes.ok
		? ((await eventsRes.json()) as { events: TicketEvent[] }).events
		: [];
	const links = linksRes.ok ? ((await linksRes.json()) as { links: TicketLink[] }).links : [];
	const effort = effortRes.ok
		? ((await effortRes.json()) as { entries: EffortEntry[]; total_minutes: number })
		: { entries: [] as EffortEntry[], total_minutes: 0 };

	return { ...data, owners, events, links, effort, siblings };
};
