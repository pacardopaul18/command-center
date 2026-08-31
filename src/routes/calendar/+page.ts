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
	meeting_id: string | null;
}

/** One calendar this account owns, and whether it is being read. */
export interface CalendarListRow {
	id: string;
	summary: string | null;
	provider_calendar_id: string;
	is_primary: number;
	sync_enabled: number;
	background_color: string | null;
	account_email: string | null;
	event_count: number;
}

/**
 * Somebody this app follows, which is a row in this app and nowhere else.
 *
 * Following changes what this screen shows and never touches the user's Google
 * CalendarList, which is the D70 translation of the prototype's Follow button.
 */
export interface FollowRow {
	id: string;
	email: string;
	display_name: string | null;
	color: string | null;
}

/** The first of the month containing a day. */
function monthStart(day: Date): Date {
	const d = new Date(day);
	d.setUTCDate(1);
	d.setUTCHours(0, 0, 0, 0);
	return d;
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

	const requested = url.searchParams.get('view');
	const view: 'agenda' | 'day' | 'week' | 'month' =
		requested === 'week' || requested === 'day' || requested === 'month' ? requested : 'agenda';
	const anchorParam = url.searchParams.get('day');
	const anchor = anchorParam ? new Date(`${anchorParam}T00:00:00Z`) : new Date();

	/**
	 * The window is asked for rather than assumed, and matches what is drawn.
	 * The endpoint used to have no lower bound, so it returned every past event
	 * ever stored while the writer never refreshed them.
	 */
	const from =
		view === 'week'
			? weekStart(anchor)
			: view === 'month'
				? monthStart(anchor)
				: new Date(anchor);
	from.setUTCHours(0, 0, 0, 0);

	const to = new Date(from);
	if (view === 'week') to.setUTCDate(to.getUTCDate() + 7);
	else if (view === 'day') to.setUTCDate(to.getUTCDate() + 1);
	else if (view === 'month') to.setUTCMonth(to.getUTCMonth() + 1);
	else to.setUTCDate(to.getUTCDate() + 21);

	/**
	 * A month grid is drawn from the Monday before the first, so the leading and
	 * trailing days of neighbouring months are on screen and fetched with it.
	 * Without the padding those cells would be empty by construction rather than
	 * because nothing is happening.
	 */
	if (view === 'month') {
		const gridFrom = weekStart(from);

		// The grid ends at the start of the week after the one holding the last
		// day of the month. Adding a flat seven days overshoots whenever the
		// month does not end on a Sunday, and the grid came out 43 cells: not a
		// whole number of weeks, so the last row was ragged.
		const lastDay = new Date(to);
		lastDay.setUTCDate(lastDay.getUTCDate() - 1);
		const gridTo = weekStart(lastDay);
		gridTo.setUTCDate(gridTo.getUTCDate() + 7);

		from.setTime(gridFrom.getTime());
		to.setTime(gridTo.getTime());
	}

	const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
	const acct = accountQuery(scope.account, '&');

	/**
	 * The rail loads with the page, not after it.
	 *
	 * D127: the scope is resolved here and passed to every request, so a
	 * correctly scoped route cannot be reached by a page that forgot to name the
	 * account. The calendars and follows requests are scoped to one account even
	 * when the events are the union, because the rail is a list of what this
	 * account owns and follows and a union of two people's contacts is exactly
	 * the leak D110 was.
	 */
	const [eventsRes, connectionsRes] = await Promise.all([
		fetch(`/api/connections/google/calendar?${params}${acct}`),
		fetch('/api/connections')
	]);

	const roster = connectionsRes.ok
		? ((await connectionsRes.json()) as { accounts: RosterAccount[] }).accounts
		: [];

	/**
	 * The rail is always about exactly one account, even when the grid is not.
	 *
	 * Events can be unioned because every row carries the account it came from,
	 * which is what D111 asks for. A list of calendars and followed people
	 * cannot: it is an address book, the union of two of them is two clients'
	 * contacts in one list, and no per-row label makes that the right thing to
	 * draw. So the union view keeps its unioned grid and the rail names the one
	 * account it belongs to, which the header says out loud.
	 */
	const railAccount = scope.account === 'all' ? (roster[0]?.id ?? '') : scope.account;
	const one = accountQuery(railAccount, '?');

	// No account connected is a state, not a failure. D113.
	if (!scope.connected || eventsRes.status === 400 || eventsRes.status === 404) {
		return {
			events: [] as CalendarEventRow[],
			calendars: [] as CalendarListRow[],
			follows: [] as FollowRow[],
			roster,
			account: scope.account,
			railAccount: '',
			scope: 'one' as const,
			view,
			from: from.toISOString(),
			to: to.toISOString(),
			day: from.toISOString().slice(0, 10),
			error: null as string | null,
			noAccount: true
		};
	}

	const [calendarsRes, followsRes] = await Promise.all([
		fetch(`/api/connections/google/calendars${one}`),
		fetch(`/api/connections/google/calendar/follows${one}`)
	]);

	const error = await scopedError(eventsRes, 'the calendar');
	const payload = eventsRes.ok
		? ((await eventsRes.json()) as { events: CalendarEventRow[]; scope: 'one' | 'all' })
		: { events: [] as CalendarEventRow[], scope: 'one' as const };

	const calendars = calendarsRes.ok
		? ((await calendarsRes.json()) as { calendars: CalendarListRow[] }).calendars
		: [];

	const follows = followsRes.ok
		? ((await followsRes.json()) as { follows: FollowRow[] }).follows
		: [];

	return {
		events: payload.events,
		calendars,
		follows,
		roster,
		account: scope.account,
		railAccount,
		scope: payload.scope,
		view,
		from: from.toISOString(),
		to: to.toISOString(),
		day: (anchorParam ?? anchor.toISOString().slice(0, 10)).slice(0, 10),
		error,
		noAccount: false
	};
};
