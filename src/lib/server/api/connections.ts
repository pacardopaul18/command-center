import type { D1Database } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { nowUtc } from '../dates';
import { ApiError, readJsonObject } from './validate';
import {
	assertOwned,
	listAccounts,
	reauthClock,
	resolveAccount,
	resolveScope,
	scopePlaceholders
} from '../accounts';
import {
	GoogleError,
	SCOPES,
	accessToken,
	authorizeUrl,
	clearTokens,
	consumeState,
	exchangeCode,
	freeBusy,
	listCalendars,
	listEvents,
	readTokens,
	whoAmI,
	writeTokens
} from '../google';

/**
 * Connections to outside accounts. Google, built dark.
 *
 * "Built dark" is enforced here rather than intended. This connects one Google
 * account, Paul's own, and the Settings copy says so in the same words. Partner
 * and firm accounts connect only after the partner conversation, and the app
 * should not be the thing that quietly makes that easy before it happens.
 *
 * Nothing in this file writes to Google. Not a draft, not a label, not an
 * event. The token cannot send mail because `gmail.send` was never requested,
 * which is D70: the guarantee is structural, not remembered.
 */

export const connections = new Hono<ApiEnv>();

const GOOGLE_ID = 'google';

function requireConfig(env: { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string }) {
	if (!env.GOOGLE_CLIENT_ID) {
		throw new ApiError(
			503,
			'No Google client id is configured. Set GOOGLE_CLIENT_ID in wrangler.toml.'
		);
	}
	if (!env.GOOGLE_CLIENT_SECRET) {
		throw new ApiError(
			503,
			'No Google client secret is configured. Set it with `wrangler secret put GOOGLE_CLIENT_SECRET`.'
		);
	}
	return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}

/** The redirect URI, derived from the request so dev and production agree. */
function redirectUri(url: string): string {
	return new URL('/api/connections/google/callback', url).toString();
}

function asApiError(err: unknown): unknown {
	if (err instanceof GoogleError) {
		return new ApiError(err.status, err.detail ? `${err.message} Google said: ${err.detail}` : err.message);
	}
	return err;
}

/**
 * The connection a request is about.
 *
 * Was: whichever row had `provider = 'google'`, which was safe only because the
 * schema permitted exactly one. With that constraint gone, taking the first row
 * would quietly answer about an arbitrary account.
 */
async function row(db: D1Database, named?: string) {
	const account = await resolveAccount(db, named);
	return db.prepare('SELECT * FROM connections WHERE id = ?').bind(account.id).first();
}

/**
 * Records that the connection needs attention, without discarding it.
 *
 * Same shape as the Asana ambiguous marker: the note says why, and nothing is
 * cleared. A dead refresh token is a reconnect, not a reason to forget which
 * account was linked.
 */
async function markNeedsReauth(db: D1Database, accountId: string, why: string): Promise<void> {
	await db
		.prepare(
			`UPDATE connections SET status = 'needs_reauth', status_note = ?, updated_at = ?
       WHERE id = ?`
		)
		.bind(why, nowUtc(), accountId)
		.run();
}

connections.get('/', async (c) => {
	const named = c.req.query('account');
	const record = (await row(c.env.DB, named).catch(() => null)) as {
		id: string;
	} | null;
	const tokens = record ? await readTokens(c.env.SESSIONS, record.id) : null;

	return c.json({
		connection: record,
		// Every account, so a picker can be drawn without a second request. Each
		// carries its own expiry: Google's Testing-mode clock runs per account,
		// so two connected on different days expire on different days, and one
		// number for the app would be wrong for at least one of them.
		accounts: await accountsWithClocks(c.env.DB),
		// Whether a credential exists, never any part of it. Same rule the Asana
		// status follows.
		token_present: Boolean(tokens),
		client_id_present: Boolean(c.env.GOOGLE_CLIENT_ID),
		client_secret_present: Boolean(c.env.GOOGLE_CLIENT_SECRET),
		scopes: SCOPES,
		granted_scopes: tokens?.scope ?? null,
		expires_at: tokens?.expires_at ?? null,
		// Stated in the API, not only in the page, so it cannot drift from what
		// the code actually does.
		writes_anything: false,
		testing_mode_note:
			'Google expires the refresh token every seven days while the app is in Testing mode. ' +
			'Reconnecting takes a few seconds and is expected, not a fault.'
	});
});

/**
 * Starts the flow. Returns the URL rather than redirecting, so the caller
 * decides when to leave the page and the response stays inspectable.
 */
connections.post('/google/start', async (c) => {
	const { clientId } = requireConfig(c.env);
	const url = await authorizeUrl(c.env.SESSIONS, clientId, redirectUri(c.req.url));
	return c.json({ url });
});

/**
 * Where Google sends the browser back.
 *
 * This is a page navigation, not an API call, so it answers with a redirect to
 * Settings carrying a readable outcome rather than JSON nobody will see. It
 * passes through Cloudflare Access because the browser already holds the Access
 * cookie; a server-to-server callback would not.
 */
connections.get('/google/callback', async (c) => {
	const settings = new URL('/settings', c.req.url);
	const denied = c.req.query('error');
	if (denied) {
		settings.searchParams.set('google', `Google did not grant access: ${denied}`);
		return c.redirect(settings.toString());
	}

	const code = c.req.query('code');
	const state = c.req.query('state');

	// The state proves this callback belongs to a flow this app started, and it
	// is spent on use so it cannot be replayed.
	if (!(await consumeState(c.env.SESSIONS, state ?? null))) {
		settings.searchParams.set('google', 'That sign-in did not match a request from this app. Try again.');
		return c.redirect(settings.toString());
	}
	if (!code) {
		settings.searchParams.set('google', 'Google did not return an authorization code.');
		return c.redirect(settings.toString());
	}

	try {
		const { clientId, clientSecret } = requireConfig(c.env);
		const tokens = await exchangeCode(code, clientId, clientSecret, redirectUri(c.req.url));
		const me = await whoAmI(tokens.access_token);

		// Tokens to KV, never to D1: the nightly backup dumps every D1 table to
		// R2, and a refresh token is a long-lived credential. See migration 0011.
		const now = nowUtc();

		// Keyed on the account, not on the provider. Under the old constraint a
		// second account overwrote the first, taking its mail with it on the next
		// cascade; now each is its own row.
		const existing = await c.env.DB.prepare(
			'SELECT id FROM connections WHERE provider = ? AND account_email IS ?'
		)
			.bind(GOOGLE_ID, me.email)
			.first<{ id: string }>();

		const connectionId = existing?.id ?? crypto.randomUUID();
		await writeTokens(c.env.SESSIONS, connectionId, tokens);

		await c.env.DB.prepare(
			`INSERT INTO connections
         (id, provider, account_email, granted_scopes, status, status_note,
          connected_at, last_refresh_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'connected', NULL, ?, ?, ?, ?)
       ON CONFLICT(provider, account_email) DO UPDATE SET
         account_email = excluded.account_email,
         granted_scopes = excluded.granted_scopes,
         status = 'connected',
         status_note = NULL,
         connected_at = excluded.connected_at,
         last_refresh_at = excluded.last_refresh_at,
         updated_at = excluded.updated_at`
		)
			.bind(connectionId, GOOGLE_ID, me.email, tokens.scope, now, now, now, now)
			.run();

		settings.searchParams.set('google', `Connected ${me.email ?? 'your Google account'}.`);
	} catch (err) {
		const message = err instanceof GoogleError ? err.message : 'Could not complete the connection.';
		settings.searchParams.set('google', message);
	}

	return c.redirect(settings.toString());
});

/**
 * Disconnects.
 *
 * The tokens go. The connection row stays, marked disconnected, because the
 * record that an account was once linked is worth keeping and costs nothing.
 */
connections.post('/google/disconnect', async (c) => {
	const account = await resolveAccount(c.env.DB, c.req.query('account'));
	await clearTokens(c.env.SESSIONS, account.id);
	await c.env.DB.prepare(
		`UPDATE connections
     SET status = 'disconnected', status_note = 'Disconnected here.', updated_at = ?
     WHERE id = ?`
	)
		.bind(nowUtc(), account.id)
		.run();
	return c.json({ ok: true });
});

/**
 * Reads the calendar into the local cache.
 *
 * Explicit, like the Asana sync and for the same reason: reading somebody's
 * calendar is something Paul asks for and sees the result of, not something
 * that happens quietly on a timer. Nothing here is wired to cron.
 */
connections.post('/google/calendar/refresh', async (c) => {
	const { clientId, clientSecret } = requireConfig(c.env);
	const account = await resolveAccount(c.env.DB, c.req.query('account'));
	const connectionId = account.id;
	const days = Math.min(Math.max(Number(c.req.query('days') ?? 14), 1), 60);
	const from = new Date();
	const to = new Date(Date.now() + days * 86_400_000);
	const at = nowUtc();

	/**
	 * Only the calendars Paul turned on.
	 *
	 * When none are chosen this falls back to the primary calendar, so the
	 * feature works before he has visited the calendar list. Reading every
	 * calendar an account can see would pull holidays, week numbers and whatever
	 * else Google adds by default.
	 */
	const chosen = await c.env.DB.prepare(
		`SELECT id, provider_calendar_id, summary, access_role
     FROM calendars WHERE sync_enabled = 1 AND connection_id = ?`
	)
		.bind(connectionId)
		.all<{
			id: string;
			provider_calendar_id: string;
			summary: string | null;
			access_role: string | null;
		}>();

	const targets = (chosen.results ?? []).length
		? (chosen.results ?? [])
		: [
				{
					id: null as string | null,
					provider_calendar_id: 'primary',
					summary: 'Primary',
					access_role: 'owner'
				}
			];

	/**
	 * How far back to reach.
	 *
	 * Sync used to start at now, so the past was never fetched and a week view
	 * could not show Monday if today was Wednesday. The first sync of a calendar
	 * reaches back 90 days; after that the recorded floor means later syncs do
	 * not refetch a quarter of history every time.
	 */
	const BACKFILL_DAYS = 90;

	let fetched = 0;
	const syncedAt = nowUtc();

	try {
		const tokens = await accessToken(c.env.SESSIONS, connectionId, clientId, clientSecret);

		for (const target of targets) {
			/*
			 * A calendar somebody else owns is stored as free and busy only.
			 *
			 * Paul subscribes to his partners' calendars, and scheduling against
			 * them needs to know when they are busy. It does not need to know what
			 * they are doing, and this app has no business holding the titles,
			 * descriptions, locations or attendee lists of meetings that belong to
			 * other people. The times are the whole of what scheduling requires.
			 *
			 * Decided from Google's own `accessRole`, which is recorded on the
			 * calendar when the list is read. Inferring it from the name would be
			 * guessing, and a calendar named after a person is not evidence about
			 * who owns it.
			 */
			const ownedByPaul = (target.access_role ?? 'owner') === 'owner';

			/*
			 * Anything already stored for a calendar Paul does not own is cleared.
			 *
			 * A calendar synced before this rule existed, or one whose access role
			 * changed after a share was narrowed, would otherwise keep detail that
			 * the rule says must not be here. Running it every sync costs one
			 * statement and makes the property true of the database rather than
			 * only of new writes.
			 */
			if (!ownedByPaul && target.id) {
				await c.env.DB.prepare(
					`UPDATE calendar_events
           SET summary = NULL, description = NULL, location = NULL,
               organizer = NULL, attendee_count = NULL, html_link = NULL,
               conference_url = NULL
           WHERE calendar_id = ?`
				)
					.bind(target.id)
					.run();

				await c.env.DB.prepare(
					`DELETE FROM calendar_event_attendees
           WHERE event_id IN (SELECT id FROM calendar_events WHERE calendar_id = ?)`
				)
					.bind(target.id)
					.run();
			}

			const state = target.id
				? await c.env.DB.prepare(
						'SELECT backfilled_from FROM calendar_sync_state WHERE calendar_id = ?'
					)
						.bind(target.id)
						.first<{ backfilled_from: string | null }>()
				: null;

			const floor = state?.backfilled_from
				? new Date(state.backfilled_from)
				: new Date(Date.now() - BACKFILL_DAYS * 86_400_000);

			const events = await listEvents(
				tokens.access_token,
				floor.toISOString(),
				to.toISOString(),
				target.provider_calendar_id
			);

			if (target.id) {
				await c.env.DB.prepare(
					`INSERT INTO calendar_sync_state (calendar_id, backfilled_from, last_synced_at, updated_at)
           VALUES (?1, ?2, ?3, ?3)
           ON CONFLICT(calendar_id) DO UPDATE SET
             backfilled_from = COALESCE(calendar_sync_state.backfilled_from, excluded.backfilled_from),
             last_synced_at = excluded.last_synced_at,
             updated_at = excluded.updated_at`
				)
					.bind(target.id, floor.toISOString(), syncedAt)
					.run();
			}

			for (const e of events) {
				await c.env.DB.prepare(
					`INSERT INTO calendar_events
             (id, connection_id, calendar_id, provider_event_id, summary, description, location,
              starts_at, ends_at, all_day, organizer, attendee_count, html_link, fetched_at,
              conference_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(connection_id, provider_event_id) DO UPDATE SET
             conference_url = excluded.conference_url,
             calendar_id = excluded.calendar_id,
             summary = excluded.summary,
             description = excluded.description,
             location = excluded.location,
             starts_at = excluded.starts_at,
             ends_at = excluded.ends_at,
             all_day = excluded.all_day,
             organizer = excluded.organizer,
             attendee_count = excluded.attendee_count,
             html_link = excluded.html_link,
             fetched_at = excluded.fetched_at`
				)
					.bind(
						crypto.randomUUID(),
						connectionId,
						target.id,
						e.provider_event_id,
						// Free/busy only on a calendar Paul does not own. The nulls are
						// the rule, not a gap: nothing about what the meeting is enters
						// this database.
						ownedByPaul ? e.summary : null,
						ownedByPaul ? e.description : null,
						ownedByPaul ? e.location : null,
						e.starts_at,
						e.ends_at,
						e.all_day,
						ownedByPaul ? e.organizer : null,
						ownedByPaul ? e.attendee_count : null,
						ownedByPaul ? e.html_link : null,
						at,
						// A partner's meeting link is a door into a room. The app knows
						// when they are busy and nothing about what they are doing, and
						// a join link is the furthest thing from free/busy there is.
						ownedByPaul ? e.conference_url : null
					)
					.run();
				/**
				 * The cancellation and the answer, in the side table.
				 *
				 * `calendar_events` is on the rehearsal freeze list, so these two
				 * facts live beside it rather than on it. Written every time, so an
				 * event that is un-cancelled in Google clears here too.
				 */
				const eventRow = await c.env.DB.prepare(
					'SELECT id FROM calendar_events WHERE connection_id = ? AND provider_event_id = ?'
				)
					.bind(connectionId, e.provider_event_id)
					.first<{ id: string }>();

				if (eventRow) {
					await c.env.DB.prepare(
						`INSERT INTO calendar_event_state (event_id, cancelled_at, own_response, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(event_id) DO UPDATE SET
               cancelled_at = excluded.cancelled_at,
               own_response = excluded.own_response,
               updated_at = excluded.updated_at`
					)
						.bind(eventRow.id, e.cancelled ? nowUtc() : null, e.own_response, nowUtc())
						.run();

					// Replaced rather than merged: an attendee removed from the
					// invitation must leave, and a diff would keep them.
					//
					// The delete runs for every calendar, including the ones Paul does
					// not own. On those the loop below writes nothing, so the delete is
					// what makes the rule true for anything synced before it existed.
					await c.env.DB.prepare('DELETE FROM calendar_event_attendees WHERE event_id = ?')
						.bind(eventRow.id)
						.run();

					for (const a of ownedByPaul ? e.attendees : []) {
						if (!a.email && !a.display_name) continue;
						await c.env.DB.prepare(
							`INSERT INTO calendar_event_attendees
               (id, event_id, email, display_name, response_status, is_organizer, is_self, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT DO NOTHING`
						)
							.bind(
								crypto.randomUUID(),
								eventRow.id,
								a.email,
								a.display_name,
								a.response_status,
								a.is_organizer ? 1 : 0,
								a.is_self ? 1 : 0,
								nowUtc()
							)
							.run();
					}
				}

				fetched += 1;
			}

			if (target.id) {
				await c.env.DB.prepare('UPDATE calendars SET last_synced_at = ? WHERE id = ?')
					.bind(at, target.id)
					.run();
			}
		}
	} catch (err) {
		if (err instanceof GoogleError && err.needsReauth) {
			await markNeedsReauth(c.env.DB, connectionId, err.message);
		}
		throw asApiError(err);
	}

	await c.env.DB.prepare(
		`UPDATE connections SET last_read_at = ?, last_refresh_at = ?, status = 'connected',
       status_note = NULL, updated_at = ? WHERE id = ?`
	)
		.bind(at, at, at, connectionId)
		.run();

	return c.json({
		ok: true,
		fetched,
		calendars: targets.length,
		window_days: days,
		at
	});
});

/** The cached calendar, read from D1. Never calls Google. */
connections.get('/google/calendar', async (c) => {
	// Same scoping as mail, for the same reason: a day view that silently mixed
	// a work calendar into a personal one would be wrong in exactly the way
	// D110 was wrong, and here it would be wrong on the screen Paul plans from.
	const scope = await resolveScope(c.env.DB, c.req.query('account'));
	const days = Math.min(Math.max(Number(c.req.query('days') ?? 7), 1), 60);

	/**
	 * The window, bounded at both ends.
	 *
	 * The read had no lower bound, so it returned every past event ever stored
	 * while the writer never refreshed them: the further back you looked, the
	 * staler it got, silently. A view asks for the range it means to draw.
	 */
	const fromParam = c.req.query('from');
	const toParam = c.req.query('to');
	const since = fromParam ?? new Date(Date.now() - 86_400_000).toISOString();
	const until = toParam ?? new Date(Date.now() + days * 86_400_000).toISOString();

	// A cancelled meeting is kept as a record and excluded from the view, unless
	// the caller asks to see what was called off.
	const includeCancelled = c.req.query('include_cancelled') === 'true';

	const { results } = await c.env.DB.prepare(
		`SELECT e.*, m.title AS meeting_title,
        st.cancelled_at, st.own_response,
        cal.summary AS calendar_name, cal.background_color AS calendar_color,
        (SELECT COUNT(*) FROM calendar_event_attendees a WHERE a.event_id = e.id) AS attendees_known,
        /*
         * Whether this row is free/busy only, from the calendar's access role.
         *
         * Derived rather than stored on the event: a copy on every row would be
         * a second answer that goes stale the moment a share is narrowed. The
         * screen needs it so a busy block reads as busy rather than as an event
         * whose title failed to load.
         */
        CASE WHEN COALESCE(cal.access_role, 'owner') = 'owner' THEN 0 ELSE 1 END AS free_busy_only,
        cal.summary AS calendar_name,
        conn.account_email AS account_email,
        e.connection_id AS account_id
     FROM calendar_events e
     LEFT JOIN meetings m ON m.id = e.meeting_id
     LEFT JOIN calendars cal ON cal.id = e.calendar_id
     LEFT JOIN connections conn ON conn.id = e.connection_id
     LEFT JOIN calendar_event_state st ON st.event_id = e.id
     WHERE e.connection_id IN (${scopePlaceholders(scope)})
       AND e.starts_at <= ?
       AND (e.ends_at IS NULL OR e.ends_at >= ? OR e.starts_at >= ?)
       ${includeCancelled ? '' : 'AND st.cancelled_at IS NULL'}
     ORDER BY e.starts_at ASC`
	)
		.bind(...scope.ids, until, since, since)
		.all();

	const record =
		scope.kind === 'one' ? await row(c.env.DB, scope.account.id).catch(() => null) : null;
	return c.json({
		scope: scope.kind,
		events: results ?? [],
		last_read_at: (record as { last_read_at?: string } | null)?.last_read_at ?? null
	});
});

/* -------------------------------------------------------------------------
 * Followed calendars, and finding a time
 * ---------------------------------------------------------------------- */

/**
 * The colours a followed person is drawn in.
 *
 * Fixed and small, assigned in order, so two followed people are never the same
 * colour until there are more than six of them and so the colour a person has
 * does not change when somebody else is unfollowed.
 */
const FOLLOW_COLORS = ['#2E7D5B', '#8A4B2A', '#4C5FA8', '#8A2E5B', '#5B6470', '#A8792E'];

/** A calendar address, normalised the way Google compares them. */
function normaliseAddress(raw: unknown): string {
	const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
	// Deliberately loose. This is an address book entry, not an authentication
	// boundary, and a real address Google accepts that this rejected would be a
	// worse failure than a typo that comes back "not shared with you".
	if (!value || !value.includes('@') || /\s/.test(value)) {
		throw new ApiError(400, 'A followed calendar needs an email address.');
	}
	return value;
}

/** Who this account follows. Local to this app, never Google's CalendarList. */
connections.get('/google/calendar/follows', async (c) => {
	const account = await resolveAccount(c.env.DB, c.req.query('account'));
	const { results } = await c.env.DB.prepare(
		`SELECT id, email, display_name, color, created_at
     FROM followed_calendars WHERE connection_id = ?
     ORDER BY COALESCE(display_name, email)`
	)
		.bind(account.id)
		.all();
	return c.json({ account: account.id, follows: results ?? [] });
});

connections.post('/google/calendar/follows', async (c) => {
	const account = await resolveAccount(c.env.DB, c.req.query('account'));
	const body = await readJsonObject(c.req.raw);
	const email = normaliseAddress(body.email);
	const name = typeof body.display_name === 'string' ? body.display_name.trim() : '';
	const at = nowUtc();

	const existing = await c.env.DB.prepare(
		'SELECT id FROM followed_calendars WHERE connection_id = ? AND email = ?'
	)
		.bind(account.id, email)
		.first<{ id: string }>();

	// Following someone already followed is not an error, it is a no-op with a
	// name update. A duplicate row would show the same person twice.
	if (existing) {
		if (name) {
			await c.env.DB.prepare('UPDATE followed_calendars SET display_name = ? WHERE id = ?')
				.bind(name, existing.id)
				.run();
		}
		return c.json({ id: existing.id, email, already: true });
	}

	const taken = await c.env.DB.prepare(
		'SELECT COUNT(*) AS n FROM followed_calendars WHERE connection_id = ?'
	)
		.bind(account.id)
		.first<{ n: number }>();

	const id = crypto.randomUUID();
	await c.env.DB.prepare(
		`INSERT INTO followed_calendars (id, connection_id, email, display_name, color, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
	)
		.bind(
			id,
			account.id,
			email,
			name || null,
			FOLLOW_COLORS[Number(taken?.n ?? 0) % FOLLOW_COLORS.length],
			at
		)
		.run();

	return c.json({ id, email, already: false }, 201);
});

/**
 * Unfollow, asserted rather than filtered.
 *
 * D108: asking to delete another account's row is refused, not answered with a
 * cheerful ok that deleted nothing. Two different promises, and the second is
 * the one segregation needs.
 */
connections.delete('/google/calendar/follows/:id', async (c) => {
	const account = await resolveAccount(c.env.DB, c.req.query('account'));
	const row = await c.env.DB.prepare(
		'SELECT connection_id FROM followed_calendars WHERE id = ?'
	)
		.bind(c.req.param('id'))
		.first<{ connection_id: string }>();

	if (!row || row.connection_id !== account.id) {
		throw new ApiError(404, 'No followed calendar with that id on this account.');
	}

	await c.env.DB.prepare('DELETE FROM followed_calendars WHERE id = ?')
		.bind(c.req.param('id'))
		.run();
	return c.json({ ok: true });
});

/**
 * Free space across a set of calendars.
 *
 * Live, not from the cache, and the reason is in `freeBusy`: the point of
 * asking is the people this app does not sync. Busy blocks are all that comes
 * back, and only for calendars whose owner has shared their free and busy.
 *
 * Every address that could not be read is named in the answer rather than
 * dropped. A slot list computed over four calendars when one of them refused is
 * a confident wrong answer, and the screen has to be able to say so.
 */
connections.post('/google/calendar/free-busy', async (c) => {
	const { clientId, clientSecret } = requireConfig(c.env);
	const account = await resolveAccount(c.env.DB, c.req.query('account'));
	const body = await readJsonObject(c.req.raw);

	const asked = Array.isArray(body.emails) ? body.emails : [];
	const emails = [...new Set(asked.map((e) => normaliseAddress(e)))];
	if (emails.length === 0) throw new ApiError(400, 'Pick at least one calendar to match against.');
	if (emails.length > 20) throw new ApiError(400, 'That is more calendars than one query can match.');

	const from = typeof body.from === 'string' ? body.from : new Date().toISOString();
	const to =
		typeof body.to === 'string'
			? body.to
			: new Date(Date.now() + 14 * 86_400_000).toISOString();

	if (new Date(to).getTime() - new Date(from).getTime() > 45 * 86_400_000) {
		throw new ApiError(400, 'Match a window of 45 days or less.');
	}

	const tokens = await accessToken(c.env.SESSIONS, account.id, clientId, clientSecret);
	const answers = await freeBusy(tokens.access_token, from, to, emails);

	return c.json({
		account: account.id,
		account_email: account.account_email,
		from,
		to,
		calendars: answers,
		// Named so the caller can say which addresses the answer is missing
		// rather than quietly matching against fewer calendars than were asked.
		unreadable: answers.filter((a) => a.error).map((a) => ({ id: a.id, error: a.error }))
	});
});

/* -------------------------------------------------------------------------
 * Calendars
 * ---------------------------------------------------------------------- */

/**
 * Refreshes the list of calendars this account can see.
 *
 * Reads the list only. Whether each one syncs is Paul's choice and is never
 * changed by a refresh: a calendar he turned on stays on, and a new one arrives
 * off, because a list that switches itself on would quietly start reading
 * somebody else's diary.
 */

/**
 * One event, with the people on it.
 *
 * Ownership is asserted rather than filtered: asking for an event belonging to
 * another account is refused, not answered with nothing. Two different
 * promises, and the second is the one segregation needs. D108.
 */
connections.get('/google/calendar/events/:id', async (c) => {
	const account = await resolveAccount(c.env.DB, c.req.query('account'));

	const event = await c.env.DB.prepare(
		`SELECT e.*, st.cancelled_at, st.own_response,
        cal.summary AS calendar_name, cal.background_color AS calendar_color,
        CASE WHEN COALESCE(cal.access_role, 'owner') = 'owner' THEN 0 ELSE 1 END AS free_busy_only,
        conn.account_email AS account_email,
        m.title AS meeting_title
     FROM calendar_events e
     LEFT JOIN calendar_event_state st ON st.event_id = e.id
     LEFT JOIN calendars cal ON cal.id = e.calendar_id
     LEFT JOIN connections conn ON conn.id = e.connection_id
     LEFT JOIN meetings m ON m.id = e.meeting_id
     WHERE e.id = ?`
	)
		.bind(c.req.param('id'))
		.first<{ connection_id: string }>();

	if (!event || event.connection_id !== account.id) {
		throw new ApiError(404, 'No event with that id in this calendar.');
	}

	const { results } = await c.env.DB.prepare(
		`SELECT email, display_name, response_status, is_organizer, is_self
     FROM calendar_event_attendees WHERE event_id = ?
     ORDER BY is_organizer DESC, is_self DESC, COALESCE(display_name, email)`
	)
		.bind(c.req.param('id'))
		.all();

	return c.json({ event, attendees: results ?? [] });
});

connections.post('/google/calendars/refresh', async (c) => {
	const { clientId, clientSecret } = requireConfig(c.env);
	const account = await resolveAccount(c.env.DB, c.req.query('account'));
	const connectionId = account.id;
	const at = nowUtc();

	try {
		const tokens = await accessToken(c.env.SESSIONS, connectionId, clientId, clientSecret);
		const calendars = await listCalendars(tokens.access_token);

		for (const cal of calendars) {
			await c.env.DB.prepare(
				`INSERT INTO calendars
           (id, connection_id, provider_calendar_id, summary, description, time_zone,
            is_primary, access_role, background_color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, provider_calendar_id) DO UPDATE SET
           summary = excluded.summary,
           description = excluded.description,
           time_zone = excluded.time_zone,
           is_primary = excluded.is_primary,
           access_role = excluded.access_role,
           background_color = excluded.background_color,
           updated_at = excluded.updated_at`
			)
				.bind(
					crypto.randomUUID(),
					connectionId,
					cal.provider_calendar_id,
					cal.summary,
					cal.description,
					cal.time_zone,
					cal.is_primary,
					cal.access_role,
					cal.background_color,
					at,
					at
				)
				.run();
		}

		return c.json({ ok: true, found: calendars.length });
	} catch (err) {
		if (err instanceof GoogleError && err.needsReauth) {
			await markNeedsReauth(c.env.DB, connectionId, err.message);
		}
		throw asApiError(err);
	}
});

connections.get('/google/calendars', async (c) => {
	// Was unfiltered, which returned every calendar across every account. With
	// one account that read as harmless; with two it is a cross-account leak,
	// and it would have shipped as one.
	const scope = await resolveScope(c.env.DB, c.req.query('account'));
	const { results } = await c.env.DB.prepare(
		`SELECT c.*, conn.account_email AS account_email,
        (SELECT COUNT(*) FROM calendar_events e WHERE e.calendar_id = c.id) AS event_count
     FROM calendars c
     LEFT JOIN connections conn ON conn.id = c.connection_id
     WHERE c.connection_id IN (${scopePlaceholders(scope)})
     ORDER BY conn.account_email, c.is_primary DESC, c.summary COLLATE NOCASE`
	)
		.bind(...scope.ids)
		.all();
	return c.json({ scope: scope.kind, calendars: results ?? [] });
});

connections.post('/google/calendars/:id/toggle', async (c) => {
	// The account follows the calendar row, so ownership is asserted rather
	// than inferred: toggling somebody else's calendar is a write across
	// accounts, which is worse than reading across them.
	const account = await resolveAccount(c.env.DB, c.req.query('account'));
	await assertOwned(c.env.DB, 'calendars', c.req.param('id'), account.id);

	const on = c.req.query('on') === 'true';
	const result = await c.env.DB.prepare(
		'UPDATE calendars SET sync_enabled = ?, updated_at = ? WHERE id = ?'
	)
		.bind(on ? 1 : 0, nowUtc(), c.req.param('id'))
		.run();
	if (!result.meta.changes) throw new ApiError(404, 'Calendar not found.');

	// Turning a calendar off removes what it put here. Leaving the events behind
	// would mean a calendar Paul stopped watching still filling his day view,
	// with no way to tell where those entries came from.
	if (!on) {
		await c.env.DB.prepare('DELETE FROM calendar_events WHERE calendar_id = ?')
			.bind(c.req.param('id'))
			.run();
	}

	return c.json({ ok: true, sync_enabled: on });
});

/* -------------------------------------------------------------------------
 * Re-auth clocks and the remembered account
 * ---------------------------------------------------------------------- */

/** Accounts with their own expiry attached. */
async function accountsWithClocks(db: D1Database) {
	const { results } = await db
		.prepare(
			`SELECT id, provider, account_email, status, connected_at
       FROM connections ORDER BY created_at`
		)
		.all<{
			id: string;
			provider: string;
			account_email: string | null;
			status: string;
			connected_at: string | null;
		}>();

	return (results ?? []).map((row) => ({
		id: row.id,
		provider: row.provider,
		account_email: row.account_email,
		status: row.status,
		reauth: reauthClock(row.connected_at)
	}));
}

/** KV key for the account the mail screens open on. */
const ACTIVE_ACCOUNT_KEY = 'mail:active-account';

/**
 * The account Paul was last looking at.
 *
 * Kept server side rather than in the browser, because this is a single-user
 * app reached from more than one machine and "which mailbox am I in" should not
 * depend on which laptop is open. Validated on read: an account that has since
 * been disconnected is not returned, or the mail screen would open on a
 * mailbox that no longer exists and report an error Paul did not cause.
 */
connections.get('/active-account', async (c) => {
	const stored = await c.env.SESSIONS.get(ACTIVE_ACCOUNT_KEY);
	const accounts = await listAccounts(c.env.DB);

	// 'all' is a choice, not an account id. Validating it as one meant the
	// unified view could be selected and never restored: written happily,
	// reported stale on the way back, and silently dropped.
	const valid =
		stored === 'all' || (stored && accounts.some((a) => a.id === stored)) ? stored : null;

	/**
	 * A first-use default, and deliberately only that.
	 *
	 * D108 says a caller that omits scope with several accounts connected is
	 * refused, because there is no sane default for a request. That stands, and
	 * `resolveAccount` is untouched. This is the other half of the same problem:
	 * a person who has never chosen a mailbox is not a caller omitting scope,
	 * they are a preference that has never been set, and answering them with an
	 * error is the D113 fault of reporting an empty precondition as a breakage.
	 *
	 * The distinction is where the default lives. Here it produces a stored,
	 * visible choice that the switcher shows and the reader can change. In
	 * `resolveAccount` it would produce a silent answer about somebody else's
	 * mailbox on every unscoped request, which is exactly how F1 stayed
	 * invisible: a page that forgot to pass scope would have looked healthy.
	 *
	 * Persisted on read, so the choice exists as a fact rather than being
	 * recomputed per page. Idempotent: it writes only when nothing valid is
	 * stored, and first connection order is stable.
	 */
	const defaulted = !valid && accounts.length > 0;
	if (defaulted) await c.env.SESSIONS.put(ACTIVE_ACCOUNT_KEY, accounts[0].id);

	return c.json({
		active: valid ?? (accounts.length > 0 ? accounts[0].id : null),
		remembered: stored,
		stale: Boolean(stored && !valid),
		// Whether the answer was chosen just now rather than by Paul, so a page
		// can say so instead of presenting it as a decision he made.
		defaulted
	});
});

connections.put('/active-account', async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as { account?: unknown };
	const wanted = typeof body.account === 'string' ? body.account : null;

	if (wanted === null) {
		await c.env.SESSIONS.delete(ACTIVE_ACCOUNT_KEY);
		return c.json({ ok: true, active: null });
	}

	// 'all' is a real choice, not an account id, so it is allowed through
	// without existing as a row.
	if (wanted !== 'all') {
		const accounts = await listAccounts(c.env.DB);
		if (!accounts.some((a) => a.id === wanted)) {
			throw new ApiError(404, 'No connected account with that id.');
		}
	}

	await c.env.SESSIONS.put(ACTIVE_ACCOUNT_KEY, wanted);
	return c.json({ ok: true, active: wanted });
});
