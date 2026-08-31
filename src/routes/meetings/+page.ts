import type { EventRow } from '$lib/components/CalendarWeek.svelte';
import type { PageLoad } from './$types';
import type { Client, Meeting, Project } from '$lib/types';
import { accountQuery, resolveAccountScope, scopedError } from '$lib/account-scope';

export const load: PageLoad = async ({ fetch, url }) => {
	const q = url.searchParams.get('q') ?? '';
	const query = q ? `?q=${encodeURIComponent(q)}` : '';

	// The calendar belongs to an account. Asking for it without saying which was
	// correct for exactly as long as there was only one. D127.
	const scope = await resolveAccountScope(fetch, url);

	const [meetingsRes, clientsRes, projectsRes, calendarRes] = await Promise.all([
		fetch(`/api/meetings${query}`),
		fetch('/api/clients'),
		fetch('/api/projects'),
		fetch(`/api/connections/google/calendar?days=14${accountQuery(scope.account, '&')}`)
	]);

	if (!meetingsRes.ok) {
		const body = (await meetingsRes.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load meetings.');
	}

	const { meetings } = (await meetingsRes.json()) as { meetings: Meeting[] };
	const clients = clientsRes.ok ? ((await clientsRes.json()) as { clients: Client[] }).clients : [];
	const projects = projectsRes.ok
		? ((await projectsRes.json()) as { projects: Project[] }).projects
		: [];

	return {
		meetings,
		clients,
		projects,
		q,
		account: scope.account,
		calendarConnected: scope.connected,
		// The calendar is context: a failure reading it must not stop the
		// meetings list rendering. It must still be said out loud. Returning an
		// empty list for a failed read is how a broken calendar looks exactly
		// like an empty week.
		calendarError: scope.connected ? await scopedError(calendarRes, 'the calendar') : null,
		calendar: calendarRes.ok
			? ((await calendarRes.json()) as { events: EventRow[]; last_read_at: string | null })
			: { events: [] as EventRow[], last_read_at: null }
	};
};
