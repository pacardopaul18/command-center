import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { daysAgoUtc, todayInWorkingZone, workingDayStartUtc } from '../dates';

/**
 * The Today cockpit.
 *
 * One endpoint, one round trip, because this is the screen Paul lands on and it
 * should not fan out into four requests.
 *
 * The design's cockpit has four cards. Two of them, today's meetings and invoice
 * alerts, read from modules that do not exist yet, so they are neither built nor
 * referenced anywhere in the UI. See D27.
 */

/** A waiting item nobody has touched in this many days counts as stalled. */
const STALE_DAYS = 5;

/** How far ahead "could slip this week" looks. */
const SOON_DAYS = 7;

function addDays(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

export const today = new Hono<ApiEnv>();

today.get('/', async (c) => {
	const db = c.env.DB;
	const day = todayInWorkingZone();
	const soon = addDays(day, SOON_DAYS);
	const stale = daysAgoUtc(STALE_DAYS);
	const dayStart = workingDayStartUtc(day);

	// Needs attention now: anything live whose deadline has arrived or passed.
	// Split into overdue and due today in one pass rather than two queries.
	const attention = await db
		.prepare(
			`SELECT a.*, p.name AS project_name
       FROM action_items a
       LEFT JOIN projects p ON p.id = a.project_id
       WHERE a.status != 'done'
         AND a.deadline IS NOT NULL
         AND a.deadline <= ?
       ORDER BY a.deadline ASC, a.created_at DESC`
		)
		.bind(day)
		.all();

	const attentionRows = (attention.results ?? []) as Array<Record<string, unknown>>;

	// What will slip: still live, not already demanding attention above, and
	// heading for trouble for one of four reasons. The reason travels on the row
	// so the UI never re-derives it.
	const slipping = await db
		.prepare(
			`SELECT a.*, p.name AS project_name,
         CASE
           WHEN a.status = 'ambiguous' THEN 'ambiguous'
           WHEN a.status = 'blocked' THEN 'blocked'
           WHEN a.status = 'waiting' AND a.updated_at < ?2 THEN 'stalled'
           ELSE 'due_soon'
         END AS reason
       FROM action_items a
       LEFT JOIN projects p ON p.id = a.project_id
       WHERE a.status != 'done'
         AND NOT (a.deadline IS NOT NULL AND a.deadline <= ?1)
         AND (
           a.status IN ('ambiguous', 'blocked')
           OR (a.status = 'waiting' AND a.updated_at < ?2)
           OR (a.deadline IS NOT NULL AND a.deadline <= ?3)
         )
       ORDER BY
         CASE
           WHEN a.status = 'ambiguous' THEN 0
           WHEN a.status = 'blocked' THEN 1
           WHEN a.status = 'waiting' THEN 2
           ELSE 3
         END,
         CASE WHEN a.deadline IS NULL THEN 1 ELSE 0 END,
         a.deadline ASC,
         a.updated_at ASC`
		)
		.bind(day, stale, soon)
		.all();

	// done_today compares against Mountain midnight expressed in UTC, not
	// against midnight UTC, or work finished yesterday evening would count.
	const totals = await db
		.prepare(
			`SELECT
         SUM(CASE WHEN status != 'done' THEN 1 ELSE 0 END) AS open_count,
         SUM(CASE WHEN status = 'done' AND completed_at >= ?1 THEN 1 ELSE 0 END) AS done_today
       FROM action_items`
		)
		.bind(dayStart)
		.first<Record<string, number | null>>();

	return c.json({
		today: day,
		stale_days: STALE_DAYS,
		soon_days: SOON_DAYS,
		overdue: attentionRows.filter((r) => String(r.deadline) < day),
		due_today: attentionRows.filter((r) => String(r.deadline) === day),
		slipping: slipping.results ?? [],
		totals: {
			open: totals?.open_count ?? 0,
			done_today: totals?.done_today ?? 0
		}
	});
});
