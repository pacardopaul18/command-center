import type { D1Database } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { nowUtc } from '../dates';
import { ApiError } from './validate';
import {
	GoogleError,
	SCOPES,
	accessToken,
	authorizeUrl,
	clearTokens,
	consumeState,
	exchangeCode,
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

async function row(db: D1Database) {
	return db.prepare('SELECT * FROM connections WHERE provider = ?').bind(GOOGLE_ID).first();
}

/**
 * Records that the connection needs attention, without discarding it.
 *
 * Same shape as the Asana ambiguous marker: the note says why, and nothing is
 * cleared. A dead refresh token is a reconnect, not a reason to forget which
 * account was linked.
 */
async function markNeedsReauth(db: D1Database, why: string): Promise<void> {
	await db
		.prepare(
			`UPDATE connections SET status = 'needs_reauth', status_note = ?, updated_at = ?
       WHERE provider = ?`
		)
		.bind(why, nowUtc(), GOOGLE_ID)
		.run();
}

connections.get('/', async (c) => {
	const record = await row(c.env.DB);
	const tokens = await readTokens(c.env.SESSIONS);

	return c.json({
		connection: record,
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
		await writeTokens(c.env.SESSIONS, tokens);

		const now = nowUtc();
		await c.env.DB.prepare(
			`INSERT INTO connections
         (id, provider, account_email, granted_scopes, status, status_note,
          connected_at, last_refresh_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'connected', NULL, ?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET
         account_email = excluded.account_email,
         granted_scopes = excluded.granted_scopes,
         status = 'connected',
         status_note = NULL,
         connected_at = excluded.connected_at,
         last_refresh_at = excluded.last_refresh_at,
         updated_at = excluded.updated_at`
		)
			.bind(crypto.randomUUID(), GOOGLE_ID, me.email, tokens.scope, now, now, now, now)
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
	await clearTokens(c.env.SESSIONS);
	await c.env.DB.prepare(
		`UPDATE connections
     SET status = 'disconnected', status_note = 'Disconnected here.', updated_at = ?
     WHERE provider = ?`
	)
		.bind(nowUtc(), GOOGLE_ID)
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
	const record = await row(c.env.DB);
	if (!record) throw new ApiError(400, 'No Google account is connected.');

	const connectionId = String((record as { id: string }).id);
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
		'SELECT id, provider_calendar_id, summary FROM calendars WHERE sync_enabled = 1'
	).all<{ id: string; provider_calendar_id: string; summary: string | null }>();

	const targets = (chosen.results ?? []).length
		? (chosen.results ?? [])
		: [{ id: null as string | null, provider_calendar_id: 'primary', summary: 'Primary' }];

	let fetched = 0;

	try {
		const tokens = await accessToken(c.env.SESSIONS, clientId, clientSecret);

		for (const target of targets) {
			const events = await listEvents(
				tokens.access_token,
				from.toISOString(),
				to.toISOString(),
				target.provider_calendar_id
			);

			for (const e of events) {
				await c.env.DB.prepare(
					`INSERT INTO calendar_events
             (id, connection_id, calendar_id, provider_event_id, summary, description, location,
              starts_at, ends_at, all_day, organizer, attendee_count, html_link, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(connection_id, provider_event_id) DO UPDATE SET
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
						e.summary,
						e.description,
						e.location,
						e.starts_at,
						e.ends_at,
						e.all_day,
						e.organizer,
						e.attendee_count,
						e.html_link,
						at
					)
					.run();
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
			await markNeedsReauth(c.env.DB, err.message);
		}
		throw asApiError(err);
	}

	await c.env.DB.prepare(
		`UPDATE connections SET last_read_at = ?, last_refresh_at = ?, status = 'connected',
       status_note = NULL, updated_at = ? WHERE provider = ?`
	)
		.bind(at, at, at, GOOGLE_ID)
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
	const days = Math.min(Math.max(Number(c.req.query('days') ?? 7), 1), 60);
	const until = new Date(Date.now() + days * 86_400_000).toISOString();

	const { results } = await c.env.DB.prepare(
		`SELECT e.*, m.title AS meeting_title
     FROM calendar_events e
     LEFT JOIN meetings m ON m.id = e.meeting_id
     WHERE e.starts_at <= ?
     ORDER BY e.starts_at ASC`
	)
		.bind(until)
		.all();

	const record = await row(c.env.DB);
	return c.json({
		events: results ?? [],
		last_read_at: (record as { last_read_at?: string } | null)?.last_read_at ?? null
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
connections.post('/google/calendars/refresh', async (c) => {
	const { clientId, clientSecret } = requireConfig(c.env);
	const record = await row(c.env.DB);
	if (!record) throw new ApiError(400, 'No Google account is connected.');

	const connectionId = String((record as { id: string }).id);
	const at = nowUtc();

	try {
		const tokens = await accessToken(c.env.SESSIONS, clientId, clientSecret);
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
			await markNeedsReauth(c.env.DB, err.message);
		}
		throw asApiError(err);
	}
});

connections.get('/google/calendars', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT c.*, (SELECT COUNT(*) FROM calendar_events e WHERE e.calendar_id = c.id) AS event_count
     FROM calendars c
     ORDER BY c.is_primary DESC, c.summary COLLATE NOCASE`
	).all();
	return c.json({ calendars: results ?? [] });
});

connections.post('/google/calendars/:id/toggle', async (c) => {
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
