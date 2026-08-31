import type { PageLoad } from './$types';
import { accountQuery, resolveAccountScope, scopedError } from '$lib/account-scope';
import type { RosterAccount } from '../mail/+page';

export interface CalendarEventRow {
	id: string;
	account_id: string;
	account_email: string | null;
	summary: string | null;
	description: string | null;
	location: string | null;
	starts_at: string;
	ends_at: string | null;
	all_day: number;
	organizer: string | null;
	attendee_count: number | null;
	attendees_known: number;
	html_link: string | null;
	calendar_name: string | null;
	calendar_color: string | null;
	own_response: string | null;
	cancelled_at: string | null;
	meeting_title: string | null;
}

/** Monday of the week containing a day, since a work week starts there. */
function weekStart(day: Date): Date {
	const d = new Date(day);
	const shift = (d.getUTCDay() + 6) % 7;
	d.setUTCDate(d.getUTCDate() - shift);
	d.setUTCHours(0, 0, 0, 0);
	return d;
}

export const load: PageLoad = async ({ fetch, url }) => {
	/**
	 * All-calendars is opted into, never arrived at.
	 *
	 * The union is legitimate under D111 only because it is asked for and
	 * because every row it returns names the account it came from.
	 */
	const scope = await resolveAccountScope(fetch, url, true);

	const view = url.searchParams.get('view') === 'week' ? 'week' : 'agenda';
	const anchorParam = url.searchParams.get('day');
	const anchor = anchorParam ? new Date(`${anchorParam}T00:00:00Z`) : new Date();

	/**
	 * The window is asked for rather than assumed, and matches what is drawn.
	 * The endpoint used to have no lower bound, so it returned every past event
	 * ever stored while the writer never refreshed them.
	 */
	const from = view === 'week' ? weekStart(anchor) : new Date(anchor);
	if (view === 'agenda') from.setUTCHours(0, 0, 0, 0);
	const to = new Date(from);
	to.setUTCDate(to.getUTCDate() + (view === 'week' ? 7 : 21));

	const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
	const acct = accountQuery(scope.account, '&');

	const [eventsRes, connectionsRes] = await Promise.all([
		fetch(`/api/connections/google/calendar?${params}${acct}`),
		fetch('/api/connections')
	]);

	const roster = connectionsRes.ok
		? ((await connectionsRes.json()) as { accounts: RosterAccount[] }).accounts
		: [];

	// No account connected is a state, not a failure. D113.
	if (!scope.connected || eventsRes.status === 400 || eventsRes.status === 404) {
		return {
			events: [] as CalendarEventRow[],
			roster,
			account: scope.account,
			scope: 'one' as const,
			view,
			from: from.toISOString(),
			to: to.toISOString(),
			day: from.toISOString().slice(0, 10),
			error: null as string | null,
			noAccount: true
		};
	}

	const error = await scopedError(eventsRes, 'the calendar');
	const payload = eventsRes.ok
		? ((await eventsRes.json()) as { events: CalendarEventRow[]; scope: 'one' | 'all' })
		: { events: [] as CalendarEventRow[], scope: 'one' as const };

	return {
		events: payload.events,
		roster,
		account: scope.account,
		scope: payload.scope,
		view,
		from: from.toISOString(),
		to: to.toISOString(),
		day: from.toISOString().slice(0, 10),
		error,
		noAccount: false
	};
};
