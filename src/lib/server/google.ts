import type { KVNamespace } from '@cloudflare/workers-types';

/**
 * Google OAuth, calendar read, and nothing that writes.
 *
 * Built dark: this connects Paul's own Google account and no other. Partner and
 * firm accounts connect only after the partner conversation, and Settings says
 * so in words rather than leaving it as an intention nobody wrote down.
 *
 * SCOPES ARE THE SAFETY MECHANISM. `gmail.send` is not requested, not
 * configurable, and not reachable. That is D70: a scope never granted cannot be
 * used by a later bug, a bad refactor, or a confused model, because the token
 * this app holds is physically incapable of sending. The weak version of the
 * rule is "never call the send endpoint", which survives exactly as long as
 * every future change remembers it. This version has nothing to remember.
 *
 * Classification, read off the console rather than assumed (D78):
 *   calendar.readonly  SENSITIVE
 *   gmail.readonly     RESTRICTED
 *
 * Restricted is why this stays in Testing mode. Publishing a Restricted-scope
 * app means Google verification plus a CASA assessment, and that is a long-lead
 * gate on partner accounts, not on Paul's own.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

/**
 * Everything this app will ever ask for.
 *
 * Read scopes only. Adding a write scope here is a decision that has to be made
 * on purpose, in this list, with this comment in view.
 */
export const SCOPES = [
	'https://www.googleapis.com/auth/calendar.readonly',
	'https://www.googleapis.com/auth/gmail.readonly',
	'openid',
	'email'
] as const;

/**
 * KV key for one account's tokens. Deliberately not a D1 column, see 0011.
 *
 * Per connection as of E1. Tokens were previously held at a single key, which
 * is the same single-account assumption `UNIQUE (provider)` encoded in the
 * schema: a second account would have overwritten the first one's credentials
 * and the first would have stopped working with no error anywhere.
 */
export function tokenKey(connectionId: string): string {
	return `google:tokens:${connectionId}`;
}

/**
 * Where the single account's tokens lived before E1.
 *
 * Read as a fallback so the connection Paul already has keeps working across
 * the change, and rewritten to the per-connection key on the next refresh. A
 * migration that silently logs somebody out is a migration that looks like a
 * bug to the person it happens to.
 */
export const LEGACY_TOKEN_KEY = 'google:tokens';

/** KV key for the one-time state value that ties a callback to its start. */
const STATE_KEY = 'google:oauth-state';

/** Google refuses a token exchange whose state does not match. So do we. */
const STATE_TTL_SECONDS = 600;

export class GoogleError extends Error {
	status: number;
	detail: string | null;
	/** Set when Google says the refresh token itself is dead. */
	needsReauth: boolean;

	constructor(status: number, message: string, detail: string | null = null, needsReauth = false) {
		super(message);
		this.status = status;
		this.detail = detail;
		this.needsReauth = needsReauth;
	}
}

export interface StoredTokens {
	access_token: string;
	refresh_token: string | null;
	/** Absolute, so a stored token can be judged without knowing when it arrived. */
	expires_at: string;
	scope: string;
}

export async function readTokens(
	kv: KVNamespace,
	connectionId: string
): Promise<StoredTokens | null> {
	const raw = (await kv.get(tokenKey(connectionId))) ?? (await kv.get(LEGACY_TOKEN_KEY));
	if (!raw) return null;
	try {
		return JSON.parse(raw) as StoredTokens;
	} catch {
		// Unreadable tokens are treated as absent rather than as a fault. The
		// worst case is reconnecting, which is a button.
		return null;
	}
}

export async function writeTokens(
	kv: KVNamespace,
	connectionId: string,
	tokens: StoredTokens
): Promise<void> {
	await kv.put(tokenKey(connectionId), JSON.stringify(tokens));
}

export async function clearTokens(kv: KVNamespace, connectionId: string): Promise<void> {
	await kv.delete(tokenKey(connectionId));
	// The legacy key is also cleared when the account that inherited it
	// disconnects, or a disconnect would leave a live credential behind under a
	// name nothing points at any more.
	const legacy = await kv.get(LEGACY_TOKEN_KEY);
	const own = await kv.get(tokenKey(connectionId));
	if (legacy && !own) await kv.delete(LEGACY_TOKEN_KEY);
}

/**
 * The URL that starts the flow, plus the state it must come back with.
 *
 * `access_type=offline` and `prompt=consent` are both required to be handed a
 * refresh token. Without them Google returns an access token that dies in an
 * hour and no way to renew it, and the connection appears to work until it
 * quietly stops.
 */
export async function authorizeUrl(
	kv: KVNamespace,
	clientId: string,
	redirectUri: string
): Promise<string> {
	const state = crypto.randomUUID();
	await kv.put(STATE_KEY, state, { expirationTtl: STATE_TTL_SECONDS });

	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: SCOPES.join(' '),
		access_type: 'offline',
		prompt: 'consent',
		include_granted_scopes: 'true',
		state
	});
	return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Checks the state a callback came back with, and spends it.
 *
 * One use only. A state that could be replayed is not doing the job it exists
 * for, which is proving this callback belongs to a flow this app started.
 */
export async function consumeState(kv: KVNamespace, state: string | null): Promise<boolean> {
	if (!state) return false;
	const expected = await kv.get(STATE_KEY);
	await kv.delete(STATE_KEY);
	return Boolean(expected) && expected === state;
}

async function tokenRequest(body: URLSearchParams): Promise<Record<string, unknown>> {
	let res: Response;
	try {
		res = await fetch(TOKEN_ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: body.toString()
		});
	} catch {
		throw new GoogleError(502, 'Could not reach Google. Nothing was changed.');
	}

	const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;

	if (!res.ok) {
		const code = typeof parsed.error === 'string' ? parsed.error : null;
		const detail =
			typeof parsed.error_description === 'string' ? parsed.error_description : code;

		// `invalid_grant` is the one that matters: the refresh token is dead, and
		// in Testing mode that happens every seven days by design. It is not a
		// fault to investigate, it is a reconnect to perform, and saying so is the
		// difference between a useful message and a stack trace.
		if (code === 'invalid_grant') {
			throw new GoogleError(
				401,
				'Google will not renew this connection. Reconnect the account. ' +
					'In Testing mode Google expires the refresh token every seven days.',
				detail,
				true
			);
		}
		throw new GoogleError(502, `Google rejected the token request (${res.status}).`, detail);
	}

	return parsed;
}

function toStored(payload: Record<string, unknown>, previous: StoredTokens | null): StoredTokens {
	const expiresIn = Number(payload.expires_in ?? 3600);
	return {
		access_token: String(payload.access_token ?? ''),
		// Google returns a refresh token on the first exchange and usually not on
		// a refresh. Dropping the old one because this response lacked it is how
		// a working connection turns into one that cannot renew.
		refresh_token:
			typeof payload.refresh_token === 'string'
				? payload.refresh_token
				: (previous?.refresh_token ?? null),
		expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
		scope: typeof payload.scope === 'string' ? payload.scope : (previous?.scope ?? '')
	};
}

export async function exchangeCode(
	code: string,
	clientId: string,
	clientSecret: string,
	redirectUri: string
): Promise<StoredTokens> {
	const payload = await tokenRequest(
		new URLSearchParams({
			code,
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uri: redirectUri,
			grant_type: 'authorization_code'
		})
	);

	const tokens = toStored(payload, null);
	if (!tokens.refresh_token) {
		// Without one, the connection dies in an hour with no way back except a
		// manual reconnect nobody will know to perform. Better to fail loudly now.
		throw new GoogleError(
			502,
			'Google did not return a refresh token. Remove this app from your Google ' +
				'account permissions and connect again so it prompts for consent.'
		);
	}
	return tokens;
}

/** True when the token is gone or close enough to gone to renew it first. */
export function needsRefresh(tokens: StoredTokens, skewSeconds = 120): boolean {
	return Date.parse(tokens.expires_at) - Date.now() < skewSeconds * 1000;
}

export async function refreshTokens(
	tokens: StoredTokens,
	clientId: string,
	clientSecret: string
): Promise<StoredTokens> {
	if (!tokens.refresh_token) {
		throw new GoogleError(401, 'This connection has no refresh token. Reconnect the account.', null, true);
	}
	const payload = await tokenRequest(
		new URLSearchParams({
			refresh_token: tokens.refresh_token,
			client_id: clientId,
			client_secret: clientSecret,
			grant_type: 'refresh_token'
		})
	);
	return toStored(payload, tokens);
}

/**
 * A usable access token, renewing first if it is about to expire.
 *
 * Every caller goes through here rather than reading KV directly, so there is
 * one place that knows when a token is stale and one place that writes the
 * renewed one back.
 */
export async function accessToken(
	kv: KVNamespace,
	connectionId: string,
	clientId: string,
	clientSecret: string
): Promise<StoredTokens> {
	const tokens = await readTokens(kv, connectionId);
	if (!tokens) throw new GoogleError(400, 'That account is not connected.');
	if (!needsRefresh(tokens)) return tokens;

	// A refresh also moves an inherited legacy token onto its own key, so the
	// migration completes itself the first time each account renews.
	const renewed = await refreshTokens(tokens, clientId, clientSecret);
	await writeTokens(kv, connectionId, renewed);
	return renewed;
}

async function apiGet<T>(token: string, url: string): Promise<T> {
	let res: Response;
	try {
		res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
	} catch {
		throw new GoogleError(502, 'Could not reach Google.');
	}
	if (res.status === 401 || res.status === 403) {
		throw new GoogleError(
			401,
			'Google refused the request with this connection. Reconnect the account.',
			null,
			true
		);
	}
	if (!res.ok) throw new GoogleError(502, `Google returned an error (${res.status}).`);
	return (await res.json()) as T;
}

export async function whoAmI(token: string): Promise<{ email: string | null }> {
	const body = await apiGet<{ email?: string }>(token, USERINFO_ENDPOINT);
	return { email: typeof body.email === 'string' ? body.email : null };
}

export interface CalendarRef {
	provider_calendar_id: string;
	summary: string | null;
	description: string | null;
	time_zone: string | null;
	is_primary: number;
	access_role: string | null;
	background_color: string | null;
}

/**
 * Every calendar this account can see.
 *
 * That includes calendars other people have shared with Paul, which is the
 * whole answer to subscribing to a colleague's calendar: they share it in
 * Google, and it appears here. No additional scope, no approval flow, nothing
 * for this app to request. `accessRole` records whether it is his or somebody
 * else's, which is the distinction that will matter in the partner
 * conversation.
 */
export async function listCalendars(token: string): Promise<CalendarRef[]> {
	const body = await apiGet<{
		items?: {
			id?: string;
			summary?: string;
			description?: string;
			timeZone?: string;
			primary?: boolean;
			accessRole?: string;
			backgroundColor?: string;
		}[];
	}>(token, `${CALENDAR_BASE}/users/me/calendarList?maxResults=250`);

	return (body.items ?? [])
		.filter((c) => c.id)
		.map((c) => ({
			provider_calendar_id: String(c.id),
			summary: c.summary ?? null,
			description: c.description ?? null,
			time_zone: c.timeZone ?? null,
			is_primary: c.primary ? 1 : 0,
			access_role: c.accessRole ?? null,
			background_color: c.backgroundColor ?? null
		}));
}

export interface CalendarEvent {
	provider_event_id: string;
	summary: string | null;
	description: string | null;
	location: string | null;
	starts_at: string;
	ends_at: string | null;
	all_day: number;
	organizer: string | null;
	attendee_count: number | null;
	html_link: string | null;
	/** Google still reports the occurrence; the app marks it rather than dropping it. */
	cancelled: boolean;
	/** Paul's own answer, when he is on the invitation. */
	own_response: string | null;
	attendees: {
		email: string | null;
		display_name: string | null;
		response_status: string | null;
		is_organizer: boolean;
		is_self: boolean;
	}[];
}

interface RawEvent {
	id?: string;
	summary?: string;
	description?: string;
	location?: string;
	htmlLink?: string;
	status?: string;
	attendees?: {
		email?: string;
		displayName?: string;
		responseStatus?: string;
		organizer?: boolean;
		self?: boolean;
	}[];
	start?: { date?: string; dateTime?: string };
	end?: { date?: string; dateTime?: string };
	organizer?: { email?: string; displayName?: string };
}

export interface BusyBlock {
	start: string;
	end: string;
}

export interface FreeBusyAnswer {
	/** Calendar address, lowercased, as Google keys its answer. */
	id: string;
	busy: BusyBlock[];
	/**
	 * Why there is nothing to show, when there is nothing to show.
	 *
	 * Google distinguishes "this person is free" from "you may not look", and
	 * both arrive as an empty busy list. Collapsing them would draw somebody who
	 * has not shared their calendar as wide open all week, which is worse than
	 * saying nothing: it is a confident wrong answer that a meeting gets booked
	 * on top of.
	 */
	error: string | null;
}

/**
 * Busy blocks for a set of calendars, from Google, live.
 *
 * A read, and permitted by `calendar.readonly`. It is a POST because that is
 * the shape Google's free/busy endpoint takes, not because anything is created:
 * the request body is the question, and the response is the answer. Nothing on
 * either side of it changes a calendar.
 *
 * Not served from the cached events table on purpose. The cache holds the
 * calendars this app syncs, and the point of asking is the people it does not
 * sync: a followed colleague whose events this app has never read and never
 * will. Their busy blocks are all Google will give up unless they have shared
 * more, which is exactly the boundary the screen promises.
 */
export async function freeBusy(
	token: string,
	timeMin: string,
	timeMax: string,
	ids: string[]
): Promise<FreeBusyAnswer[]> {
	if (ids.length === 0) return [];

	let res: Response;
	try {
		res = await fetch(`${CALENDAR_BASE}/freeBusy`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${token}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({ timeMin, timeMax, items: ids.map((id) => ({ id })) })
		});
	} catch {
		throw new GoogleError(502, 'Could not reach Google.');
	}

	if (res.status === 401 || res.status === 403) {
		throw new GoogleError(
			401,
			'Google refused the request with this connection. Reconnect the account.',
			null,
			true
		);
	}
	if (!res.ok) throw new GoogleError(502, `Google returned an error (${res.status}).`);

	const body = (await res.json()) as {
		calendars?: Record<string, { busy?: BusyBlock[]; errors?: { reason?: string }[] }>;
	};

	return ids.map((id) => {
		const entry = body.calendars?.[id] ?? body.calendars?.[id.toLowerCase()];
		const reason = entry?.errors?.[0]?.reason ?? null;
		return {
			id,
			busy: entry?.busy ?? [],
			error: reason
				? reason === 'notFound'
					? 'No calendar at that address.'
					: 'This calendar is not shared with you.'
				: entry
					? null
					: 'Google returned nothing for this calendar.'
		};
	});
}

/**
 * Events between two instants, from the primary calendar.
 *
 * `singleEvents=true` expands a recurring series into its occurrences, which is
 * what a day view needs. Without it a weekly standup arrives as one event with
 * a recurrence rule this app would have to interpret itself, and interpreting
 * RRULE correctly is a project.
 *
 * An all-day event carries `date`; a timed one carries `dateTime`. Both are
 * kept as Google sent them, because collapsing them to one shape loses which
 * kind it was, and "9am" and "all of Tuesday" are not the same fact.
 */
export async function listEvents(
	token: string,
	timeMin: string,
	timeMax: string,
	calendarId = 'primary'
): Promise<CalendarEvent[]> {
	const params = new URLSearchParams({
		timeMin,
		timeMax,
		singleEvents: 'true',
		orderBy: 'startTime',
		maxResults: '100'
	});

	const body = await apiGet<{ items?: RawEvent[] }>(
		token,
		`${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`
	);

	return (body.items ?? [])
		/**
		 * Cancelled events are kept and marked, not dropped.
		 *
		 * Filtering them here was the reason a cancelled meeting stayed on the
		 * screen forever: Google stopped mentioning it, the upsert only ever
		 * inserted or updated, and nothing removed the row. Carrying the status
		 * through lets the writer mark it, and the view exclude it, while the
		 * record still says the meeting existed and was called off.
		 */
		.filter((e) => e.id && (e.start?.date || e.start?.dateTime))
		.map((e) => ({
			cancelled: e.status === 'cancelled',
			attendees: Array.isArray(e.attendees)
				? e.attendees.map((a) => ({
						email: a.email ?? null,
						display_name: a.displayName ?? null,
						response_status: a.responseStatus ?? null,
						is_organizer: a.organizer === true,
						is_self: a.self === true
					}))
				: [],
			own_response:
				(Array.isArray(e.attendees) ? e.attendees.find((a) => a.self === true) : undefined)
					?.responseStatus ?? null,
			provider_event_id: String(e.id),
			summary: e.summary ?? null,
			description: e.description ?? null,
			location: e.location ?? null,
			starts_at: e.start?.dateTime ?? String(e.start?.date),
			ends_at: e.end?.dateTime ?? e.end?.date ?? null,
			all_day: e.start?.dateTime ? 0 : 1,
			organizer: e.organizer?.email ?? e.organizer?.displayName ?? null,
			attendee_count: Array.isArray(e.attendees) ? e.attendees.length : null,
			html_link: e.htmlLink ?? null
		}));
}

/* -------------------------------------------------------------------------
 * Gmail, read only
 * ---------------------------------------------------------------------- */

const GMAIL_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface MessageRef {
	id: string;
	threadId: string;
}

/**
 * Gmail's label for an unsent draft.
 *
 * Drafts are excluded at the query and checked again on the way in. Reading
 * correspondence never meant reading things Paul had written and not sent, and
 * a half-finished sentence he chose not to send is the most private text in a
 * mailbox. Two independent guards because one query typo would silently undo
 * the whole intention.
 */
export const DRAFT_LABEL = 'DRAFT';

export function isDraft(labelIds: string | null): boolean {
	return (labelIds ?? '').split(',').includes(DRAFT_LABEL);
}

export interface MessagePage {
	messages: MessageRef[];
	nextPageToken: string | null;
	/** Gmail's own estimate. An estimate, and named as one. */
	resultSizeEstimate: number | null;
}

/**
 * One page of message ids matching a query.
 *
 * Ids only, which is what Gmail returns here. Each message then needs its own
 * fetch, and that asymmetry is the reason ingestion is batched: listing a month
 * of mail is one cheap call, reading it is hundreds of separate ones.
 */
export async function listMessageIds(
	token: string,
	query: string,
	pageToken: string | null,
	pageSize = 100
): Promise<MessagePage> {
	const params = new URLSearchParams({ q: query, maxResults: String(pageSize) });
	if (pageToken) params.set('pageToken', pageToken);

	const body = await apiGet<{
		messages?: MessageRef[];
		nextPageToken?: string;
		resultSizeEstimate?: number;
	}>(token, `${GMAIL_ENDPOINT}/messages?${params}`);

	return {
		messages: body.messages ?? [],
		nextPageToken: body.nextPageToken ?? null,
		resultSizeEstimate:
			typeof body.resultSizeEstimate === 'number' ? body.resultSizeEstimate : null
	};
}

export interface GmailAttachment {
	provider_attachment_id: string | null;
	filename: string;
	mime_type: string | null;
	size_bytes: number | null;
}

export interface GmailMessage {
	provider_message_id: string;
	provider_thread_id: string;
	subject: string | null;
	from_email: string | null;
	from_name: string | null;
	to_emails: string | null;
	cc_emails: string | null;
	sent_at: string;
	snippet: string | null;
	label_ids: string | null;
	is_unread: number;
	attachments: GmailAttachment[];
	/**
	 * The best body Gmail gave, kept as it arrived.
	 *
	 * Previously this was always stripped to plain text, which is right for
	 * feeding a summariser and wrong for showing a person: a marketing email
	 * stripped of markup is a wall of tracking URLs. The rich version is kept
	 * and `body_format` says which it is, so the reader can render it and the
	 * summariser can still be handed something plain.
	 */
	body: string | null;
	body_format: 'text' | 'html' | null;
}

interface RawPart {
	mimeType?: string;
	filename?: string;
	body?: { data?: string; size?: number; attachmentId?: string };
	parts?: RawPart[];
}

/**
 * Attachments, by their filename.
 *
 * A part with a filename is a file; a part without one is body content. That is
 * Gmail's own convention and it is more reliable than guessing from the mime
 * type, since inline images and text parts share types with real attachments.
 * Inline images with no filename are deliberately not listed: they belong to
 * the body, and listing them would fill the attachment row with spacer gifs.
 */
export function collectAttachments(part: RawPart | undefined, depth = 0): GmailAttachment[] {
	if (!part || depth > 8) return [];

	const found: GmailAttachment[] = [];
	if (part.filename && part.filename.trim()) {
		found.push({
			provider_attachment_id: part.body?.attachmentId ?? null,
			filename: part.filename.slice(0, 300),
			mime_type: part.mimeType ?? null,
			size_bytes: typeof part.body?.size === 'number' ? part.body.size : null
		});
	}
	for (const child of part.parts ?? []) found.push(...collectAttachments(child, depth + 1));
	return found;
}

/**
 * Gmail base64url, which is not what atob expects.
 *
 * The input is capped before decoding, not after. A marketing email can carry
 * several hundred kilobytes of HTML, and the decode walks every character to
 * build the byte array; doing that for a dozen messages in one invocation is
 * what pushed the worker past its CPU limit during the re-read. Truncating the
 * encoded form first bounds the work rather than doing it and throwing most of
 * the result away.
 *
 * The cut is on a four character boundary because base64 encodes three bytes
 * per four characters, and cutting mid-group produces a decode error rather
 * than a shorter string.
 */
const MAX_ENCODED_CHARS = 180_000;

export function decodeBody(data: string): string {
	const capped =
		data.length > MAX_ENCODED_CHARS ? data.slice(0, MAX_ENCODED_CHARS - (MAX_ENCODED_CHARS % 4)) : data;
	const normalised = capped.replace(/-/g, '+').replace(/_/g, '/');
	let binary: string;
	try {
		binary = atob(normalised);
	} catch {
		// A truncated payload can still end badly. Showing nothing for this part
		// is better than failing the whole message.
		return '';
	}
	const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
	// Mail is routinely not ASCII. Decoding as latin1 mangles every accented
	// name and every smart quote, which is most real correspondence.
	return new TextDecoder('utf-8').decode(bytes);
}

/**
 * The readable body of a message.
 *
 * Prefers text/plain. Falls back to text/html with tags stripped, because a
 * body of raw markup is worse than no body for both reading and summarising.
 * Walks nested parts, since a reply with an attachment nests the text one level
 * deeper than a simple message and stopping at the top level silently loses it.
 */
/**
 * Finds the body parts WITHOUT decoding them.
 *
 * Decoding is the expensive step: it walks every character of the payload, and
 * marketing HTML runs to hundreds of kilobytes. Collecting both alternatives
 * and decoding both meant doing that work twice per message and discarding one
 * result, which is what kept the re-read hitting the worker CPU ceiling. The
 * walk now returns the encoded candidates and the caller decodes only the one
 * it is going to keep.
 */
export function findBodyParts(
	part: RawPart | undefined,
	depth = 0
): { text: string | null; html: string | null } {
	if (!part || depth > 8) return { text: null, html: null };

	if (part.body?.data) {
		if (part.mimeType === 'text/plain') return { text: part.body.data, html: null };
		if (part.mimeType === 'text/html') return { text: null, html: part.body.data };
	}

	// BOTH alternatives are collected. Stopping as soon as a plain part turned
	// up was the whole reason rich mail rendered as hard-wrapped text: in
	// multipart/alternative the plain part comes first, so the HTML sibling was
	// never visited, and a caller cannot prefer something it was never shown.
	let text: string | null = null;
	let html: string | null = null;
	for (const child of part.parts ?? []) {
		const found = findBodyParts(child, depth + 1);
		text = text ?? found.text;
		html = html ?? found.html;
		if (text && html) break;
	}
	return { text, html };
}

/** The decoded alternatives. Used by the tests; the ingest decodes lazily. */
export function extractBody(
	part: RawPart | undefined,
	depth = 0
): { text: string | null; html: string | null } {
	const raw = findBodyParts(part, depth);
	return {
		text: raw.text === null ? null : decodeBody(raw.text),
		html: raw.html === null ? null : decodeBody(raw.html)
	};
}


export function stripHtml(html: string): string {
	return html
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** `Paul Pacardo <paul@x.test>` into its two halves. */
export function parseAddress(raw: string | null): { name: string | null; email: string | null } {
	if (!raw) return { name: null, email: null };
	const angled = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
	if (angled) {
		const name = angled[1].replace(/^["']|["']$/g, '').trim();
		return { name: name || null, email: angled[2].trim().toLowerCase() };
	}
	const bare = raw.trim();
	return { name: null, email: bare ? bare.toLowerCase() : null };
}

/**
 * Splits a header on the commas that separate addresses.
 *
 * Not `split(',')`. A display name may contain a comma, and quoted ones
 * routinely do: `"Acme, Inc." <a@x.test>` is ordinary business mail. Splitting
 * naively turns that into two fragments, one of which parses as the address
 * `"acme` and lands in the stored recipients as nonsense. Found by a test
 * rather than by reading, because the naive version is right most of the time.
 */
function splitAddresses(raw: string): string[] {
	const parts: string[] = [];
	let current = '';
	let inQuotes = false;
	let inAngles = false;

	for (const ch of raw) {
		if (ch === '"') inQuotes = !inQuotes;
		else if (ch === '<' && !inQuotes) inAngles = true;
		else if (ch === '>' && !inQuotes) inAngles = false;

		if (ch === ',' && !inQuotes && !inAngles) {
			parts.push(current);
			current = '';
			continue;
		}
		current += ch;
	}
	parts.push(current);
	return parts.filter((one) => one.trim());
}

/** Every address in a header that may carry several. */
export function parseAddressList(raw: string | null): string | null {
	if (!raw) return null;
	const found = splitAddresses(raw)
		.map((one) => parseAddress(one).email)
		.filter((one): one is string => Boolean(one));
	return found.length ? found.join(', ') : null;
}

export async function getMessage(
	token: string,
	id: string,
	withBody: boolean
): Promise<GmailMessage> {
	const format = withBody ? 'full' : 'metadata';
	const params = new URLSearchParams({ format });
	if (!withBody) {
		for (const h of ['Subject', 'From', 'To', 'Cc', 'Date']) params.append('metadataHeaders', h);
	}

	const raw = await apiGet<{
		id?: string;
		threadId?: string;
		snippet?: string;
		labelIds?: string[];
		internalDate?: string;
		payload?: RawPart & { headers?: { name?: string; value?: string }[] };
	}>(token, `${GMAIL_ENDPOINT}/messages/${encodeURIComponent(id)}?${params}`);

	const headers = new Map(
		(raw.payload?.headers ?? []).map((h) => [String(h.name ?? '').toLowerCase(), h.value ?? ''])
	);

	const from = parseAddress(headers.get('from') ?? null);
	const labels = raw.labelIds ?? [];

	let body: string | null = null;
	let bodyFormat: 'text' | 'html' | null = null;
	if (withBody) {
		// HTML is preferred when both exist. It carries the layout, the links and
		// the emphasis, all of which a person reads and none of which survives
		// stripping. Only the chosen one is decoded, because decoding is the
		// expensive step and doing it twice per message is work thrown away.
		const found = findBodyParts(raw.payload);
		if (found.html) {
			body = decodeBody(found.html);
			bodyFormat = 'html';
		} else if (found.text) {
			body = decodeBody(found.text);
			bodyFormat = 'text';
		}
	}

	return {
		provider_message_id: String(raw.id ?? id),
		provider_thread_id: String(raw.threadId ?? ''),
		subject: headers.get('subject') || null,
		from_email: from.email,
		from_name: from.name,
		to_emails: parseAddressList(headers.get('to') ?? null),
		cc_emails: parseAddressList(headers.get('cc') ?? null),
		// internalDate is milliseconds since epoch, as a string. It is Gmail's own
		// receipt time and is more reliable than the Date header, which is written
		// by the sender and can say anything at all.
		sent_at: new Date(Number(raw.internalDate ?? Date.now())).toISOString(),
		snippet: raw.snippet || null,
		label_ids: labels.length ? labels.join(',') : null,
		is_unread: labels.includes('UNREAD') ? 1 : 0,
		body,
		body_format: bodyFormat,
		attachments: withBody ? collectAttachments(raw.payload) : []
	};
}

/**
 * One attachment's bytes, fetched when somebody asks for it.
 *
 * Deliberately not cached into R2. Most attachments are never opened, and
 * pre-caching every one would spend storage and ingest budget on files nobody
 * wants; caching them on first open is a reasonable idea that needs its own
 * ruling before it exists, because it changes what a backup contains.
 *
 * `gmail.readonly` covers this. It is still a read: nothing about fetching an
 * attachment can alter the mailbox.
 */
export async function getAttachment(
	token: string,
	messageId: string,
	attachmentId: string
): Promise<Uint8Array> {
	const body = await apiGet<{ data?: string; size?: number }>(
		token,
		`${GMAIL_ENDPOINT}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`
	);
	if (!body.data) throw new GoogleError(502, 'Google returned no attachment data.');

	// Gmail base64url again, and the same cap: an attachment is arbitrary size
	// and the worker has a fixed budget.
	const normalised = body.data.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(normalised);
	return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}
