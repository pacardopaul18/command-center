import type { EventRow } from '$lib/components/CalendarWeek.svelte';
import type { PageLoad } from './$types';
import type { Client, Meeting, Project } from '$lib/types';

export const load: PageLoad = async ({ fetch, url }) => {
	const q = url.searchParams.get('q') ?? '';
	const query = q ? `?q=${encodeURIComponent(q)}` : '';

	const [meetingsRes, clientsRes, projectsRes, calendarRes] = await Promise.all([
		fetch(`/api/meetings${query}`),
		fetch('/api/clients'),
		fetch('/api/projects'),
		fetch('/api/connections/google/calendar?days=14')
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

	return { meetings, clients, projects, q ,
		// The calendar is context. A failure reading it must not stop the
		// meetings list rendering.
		calendar: calendarRes.ok
			? ((await calendarRes.json()) as { events: EventRow[]; last_read_at: string | null })
			: { events: [] as EventRow[], last_read_at: null }
	};
};
