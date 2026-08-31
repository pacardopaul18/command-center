/**
 * A Google Calendar event form, opened with the invite already filled in.
 *
 * The same boundary as the Gmail compose link, for the same reason. The
 * prototype drew a New invite dialog whose footnote said writes go through the
 * Google Calendar API. This app holds `calendar.readonly` and will never hold
 * more: a scope never granted cannot be used by a later bug, which is the whole
 * argument of D70. So the button keeps its job and loses its verb. It opens
 * Google's own event form with the title, time, guests, location and
 * description already in it, and the person presses Save there.
 *
 * What is lost is real and worth naming: Google's form takes no reminder, no
 * recurrence and no Meet toggle through a URL, so those three controls are not
 * drawn. A control that silently does nothing is worse than one that is absent,
 * D27, and a reminder field the reader fills and Google ignores is exactly
 * that.
 *
 * Everything here runs in the browser, from data already on the page. Building
 * it on the server would put a meeting title and a guest list into a request
 * that could land in a log, which is the one way this feature could quietly
 * become a place calendar content is recorded. D89.
 */

export interface DraftInviteFields {
	/** The calendar to create it on, which pins the account. */
	authuser: string | null;
	title: string;
	/** UTC instants. An all-day draft is not offered; a time is always chosen. */
	startsAt: Date;
	endsAt: Date;
	/** Addresses, already separated. Empty means an event with no guests. */
	guests: string[];
	location?: string;
	description?: string;
}

/**
 * The point above which the URL is not trusted.
 *
 * Google truncates rather than refusing, so an over-long description arrives
 * cut off and the draft looks fine. Conservative on purpose: making the person
 * paste a description is a smaller failure than a silently shortened agenda.
 */
export const MAX_DRAFT_URL = 1800;

/**
 * `YYYYMMDDTHHMMSSZ`, which is the only shape Google's `dates` parameter reads.
 *
 * Not `toISOString().replace(...)` by hand at each call site: the format has
 * exactly one correct spelling and a second spelling of it somewhere else is
 * how a draft ends up an hour out with nothing on screen to show it.
 */
export function googleStamp(value: Date): string {
	return value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function buildDraftInviteUrl(fields: DraftInviteFields): string {
	const pairs: [string, string][] = [
		['action', 'TEMPLATE'],
		['text', fields.title]
	];

	// One `add` per guest. A comma separated list works in most clients and is
	// not documented to, and a guest list that silently drops everyone after the
	// first comma is the kind of wrong that looks fine.
	for (const guest of fields.guests) if (guest) pairs.push(['add', guest]);

	if (fields.location) pairs.push(['location', fields.location]);
	if (fields.description) pairs.push(['details', fields.description]);

	/**
	 * The window separator is a literal slash, not an encoded one.
	 *
	 * `dates` is one parameter holding two instants joined by `/`, and Google
	 * reads the raw character. Percent encoded it arrives as `%2F` inside a
	 * single value, which parses as one malformed timestamp: the form opens with
	 * an empty time and the reader fills it in again without ever knowing the
	 * app had it right. Both stamps are digits, T and Z, so nothing in the value
	 * needs encoding anyway.
	 */
	const dates = `dates=${googleStamp(fields.startsAt)}/${googleStamp(fields.endsAt)}`;

	/**
	 * Everything else is percent encoded by hand, deliberately not through
	 * URLSearchParams, for the reason given in gmail-compose: `+` for a space is
	 * correct under form encoding and ambiguous here, and a description full of
	 * literal plus signs is corruption nobody checks for because the link
	 * visibly worked.
	 */
	const query = [dates, ...pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`)].join('&');

	const base = fields.authuser
		? `https://calendar.google.com/calendar/u/0/r/eventedit?authuser=${encodeURIComponent(fields.authuser)}&`
		: 'https://calendar.google.com/calendar/u/0/r/eventedit?';

	return `${base}${query}`;
}

/** Whether the URL is short enough to trust Google with. */
export function draftFits(fields: DraftInviteFields): boolean {
	return buildDraftInviteUrl(fields).length <= MAX_DRAFT_URL;
}
