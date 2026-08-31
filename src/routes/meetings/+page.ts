import type { PageLoad } from './$types';
import type { Client, Meeting, Project } from '$lib/types';
import { accountQuery, resolveAccountScope, scopedError } from '$lib/account-scope';
import { MEETING_VIEWS, type MeetingCounts, type MeetingView, type UpcomingEvent } from '$lib/meetings';

export const load: PageLoad = async ({ fetch, url }) => {
	const q = url.searchParams.get('q') ?? '';

	const asked = url.searchParams.get('view');
	const view: MeetingView = (MEETING_VIEWS as readonly string[]).includes(asked ?? '')
		? (asked as MeetingView)
		: 'all';

	const params = new URLSearchParams();
	if (q) params.set('q', q);
	if (view !== 'all') params.set('view', view);
	// Paging lives in the URL so a page of the log is a link, same as the
	// tracker. Passed through rather than parsed here: the route owns which
	// sizes are legal and says so in its own error.
	for (const key of ['page', 'page_size']) {
		const value = url.searchParams.get(key);
		if (value) params.set(key, value);
	}
	const query = params.toString() ? `?${params}` : '';

	// The calendar belongs to an account. Asking for it without saying which was
	// correct for exactly as long as there was only one. D127.
	const scope = await resolveAccountScope(fetch, url);

	/**
	 * The window Coming up draws, asked for rather than assumed.
	 *
	 * From the start of today, not from now: a call at nine that you are looking
	 * at the page during is still today's call, and a window opening at the
	 * current instant makes it vanish the moment it starts.
	 */
	const from = new Date();
	from.setHours(0, 0, 0, 0);
	const to = new Date(from.getTime() + 14 * 86_400_000);

	const calendarQuery = new URLSearchParams({
		from: from.toISOString(),
		to: to.toISOString()
	});

	const [meetingsRes, clientsRes, projectsRes, calendarRes, connectionsRes] = await Promise.all([
		fetch(`/api/meetings${query}`),
		fetch('/api/clients'),
		fetch('/api/projects'),
		fetch(
			`/api/connections/google/calendar?${calendarQuery}${accountQuery(scope.account, '&')}`
		),
		scope.connected ? fetch('/api/connections') : Promise.resolve(null)
	]);

	if (!meetingsRes.ok) {
		const body = (await meetingsRes.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load meetings.');
	}

	const { meetings, counts, paging } = (await meetingsRes.json()) as {
		meetings: Meeting[];
		counts: MeetingCounts;
		paging: { page: number; page_size: number; total: number; page_count: number; sizes: number[] };
	};

	const clients = clientsRes.ok ? ((await clientsRes.json()) as { clients: Client[] }).clients : [];
	const projects = projectsRes.ok
		? ((await projectsRes.json()) as { projects: Project[] }).projects
		: [];

	const accountEmail = connectionsRes?.ok
		? ((await connectionsRes.json()) as { accounts?: { id: string; account_email: string | null }[] })
				.accounts?.find((a) => a.id === scope.account)?.account_email ?? null
		: null;

	return {
		meetings,
		counts,
		paging,
		clients,
		projects,
		q,
		view,
		account: scope.account,
		accountEmail,
		calendarConnected: scope.connected,
		// The calendar is context: a failure reading it must not stop the
		// meetings list rendering. It must still be said out loud. Returning an
		// empty list for a failed read is how a broken calendar looks exactly
		// like an empty fortnight.
		calendarError: scope.connected ? await scopedError(calendarRes, 'the calendar') : null,
		calendar: calendarRes.ok
			? ((await calendarRes.json()) as { events: UpcomingEvent[]; last_read_at: string | null })
			: { events: [] as UpcomingEvent[], last_read_at: null }
	};
};
