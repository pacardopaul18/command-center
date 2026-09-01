import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { DIGEST_HOURS, digestDueAt, runDigest } from '../digest';
import type { DigestKind } from '../digest';
import { ApiError } from './validate';
import { todayInWorkingZone, WORKING_TIME_ZONE } from '../dates';
import { getSettingsOrDefaults } from '../settings';

/**
 * HTTP access to the digests.
 *
 * The cron path does not go through here, but this is how the digest gets
 * exercised without waiting for a scheduled firing, and it gives Paul a manual
 * send when a cron is missed. Cron Triggers do not retry, so a manual trigger is
 * part of the mitigation rather than a convenience.
 *
 * These routes sit behind Cloudflare Access like everything else, so no
 * additional auth is layered on. If the app ever gains a second user, that
 * changes.
 */
export const digests = new Hono<ApiEnv>();

function parseKind(raw: string | undefined): DigestKind {
	if (raw === 'morning' || raw === 'evening') return raw;
	throw new ApiError(400, 'kind must be morning or evening.');
}

/** What the digest would say right now, without sending anything. */
digests.get('/preview', async (c) => {
	const kind = parseKind(c.req.query('kind') ?? 'morning');
	const result = await runDigest(c.env, kind, { dryRun: true });
	return c.json(result);
});

/** Where the schedule currently stands, for checking the DST arithmetic. */
digests.get('/status', async (c) => {
	const day = todayInWorkingZone();
	const now = new Date();

	const marks = await Promise.all(
		(['morning', 'evening'] as DigestKind[]).map(async (kind) => ({
			kind,
			target_hour_mt: DIGEST_HOURS[kind],
			sent_at: await c.env.SESSIONS.get(`digest:${day}:${kind}`)
		}))
	);

	return c.json({
		today: day,
		time_zone: WORKING_TIME_ZONE,
		mountain_hour_now: new Intl.DateTimeFormat('en-GB', {
			timeZone: WORKING_TIME_ZONE,
			hour: '2-digit',
			hour12: false
		}).format(now),
		due_now: digestDueAt(now),
		digests: marks,
		resend_key_present: Boolean(c.env.RESEND_API_KEY),
		from: c.env.DIGEST_FROM ?? 'onboarding@resend.dev',

		// Null, not a hard-coded address. This screen reports configuration, and
		// reporting a fallback that the sender no longer applies would be the
		// screen and the code disagreeing about where mail goes.
		to: c.env.DIGEST_TO?.trim() || null
	});
});

/**
 * Sends for real. Idempotent per Mountain day and kind unless force is passed,
 * which exists so a genuinely missed digest can be re-sent on purpose.
 */
digests.post('/run', async (c) => {
	const kind = parseKind(c.req.query('kind') ?? undefined);
	const force = c.req.query('force') === '1';
	const result = await runDigest(c.env, kind, { force });

	/*
	 * What the schedule preference says, reported alongside what was done.
	 *
	 * Sending on purpose is a different act from a schedule, so this route still
	 * sends when the preference is off: asking for a digest now is not undone by
	 * having turned off the daily one. But the Settings screen must not be able
	 * to say digests are off while a path sends one and says nothing, so the
	 * result carries the preference and, when the two disagree, a sentence
	 * saying so. D164's other half: a setting has to be visible where it is
	 * being overridden, not only where it is obeyed.
	 */
	const prefs = await getSettingsOrDefaults(c.env.SESSIONS);
	const scheduled = kind === 'morning' ? prefs.morning_digest : prefs.evening_digest;

	return c.json(
		{
			...result,
			scheduled_digest_enabled: scheduled,
			note:
				!scheduled && result.status === 'sent'
					? `The ${kind} digest is switched off in Settings. This was sent because it ` +
						'was asked for directly, which the schedule preference does not govern.'
					: null
		},
		result.status === 'failed' ? 502 : 200
	);
});
