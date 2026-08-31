import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { daysAgoUtc, todayInWorkingZone, workingDayStartUtc } from '../dates';

/**
 * The Today cockpit.
 *
 * One endpoint, one round trip, because this is the screen Paul lands on and it
 * should not fan out into four requests.
 *
 * The design's cockpit has four cards. All four exist now: Meetings and
 * Invoicing shipped in v1, which unblocked the two that were held back under
 * D27 while the modules they read from did not exist.
 *
 * Both new cards show only what is actually stored. The design mocks meeting
 * times, "09:30" and "14:00", and an "agenda drafted" state. Neither is in the
 * schema: `meetings` carries a date, not a time, and there are no agendas. So
 * the meeting rows carry the client and the follow-up counts instead, which are
 * real. D27 forbids referencing an affordance that does not exist, and a mocked
 * time rendered as fact is exactly that.
 */

/**
 * How many rows any one dashboard card shows.
 *
 * The cockpit used to return every matching row: at volume that is 816 overdue
 * items and 502 invoice alerts in a payload for a screen that can show a
 * handful. A dashboard is a glance, not a list, and every card links to the
 * screen that owns the full set.
 */
const CARD_LIMIT = 6;

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

	// Today's meetings. Counts travel on the row so the card never re-derives
	// them, and a meeting with nothing outstanding is still shown: "you have a
	// meeting today" is the point of the card, not "you have work from it".
	const meetings = await db
		.prepare(
			`SELECT m.id, m.title, m.meeting_date, m.summary_reviewed_at,
              cl.name AS client_name,
              p.name AS project_name,
              (m.summary IS NOT NULL AND m.summary != '') AS has_summary,
              (SELECT COUNT(*) FROM action_items a
                WHERE a.meeting_id = m.id AND a.status != 'done') AS open_follow_ups,
              (SELECT COUNT(*) FROM meeting_action_proposals mp
                WHERE mp.meeting_id = m.id AND mp.status = 'pending') AS pending_proposals
       FROM meetings m
       LEFT JOIN clients cl ON cl.id = m.client_id
       LEFT JOIN projects p ON p.id = m.project_id
       WHERE m.meeting_date = ?1
       ORDER BY m.created_at ASC`
		)
		.bind(day)
		.all();

	// Invoice alerts. Past due only, because an alert about something inside its
	// terms is not an alert. The bucket boundaries are the same expression
	// Invoicing and Reports use, so the three screens cannot disagree about which
	// band an invoice sits in.
	const invoiceAlerts = await db
		.prepare(
			`SELECT i.id, i.invoice_number, cl.name AS client_name,
              (i.amount_cents - i.amount_paid_cents) AS outstanding_cents,
              CAST(julianday(?1) - julianday(i.due_date) AS INTEGER) AS days_overdue,
              CASE
                WHEN julianday(?1) - julianday(i.due_date) <= 30 THEN 'b0_30'
                WHEN julianday(?1) - julianday(i.due_date) <= 60 THEN 'b31_60'
                WHEN julianday(?1) - julianday(i.due_date) <= 90 THEN 'b61_90'
                ELSE 'b90_plus'
              END AS aging_bucket
       FROM invoices i
       JOIN clients cl ON cl.id = i.client_id
       WHERE i.amount_paid_cents < i.amount_cents
         AND julianday(?1) > julianday(i.due_date)
         -- Receivables only. An estimate, a credit note or a voided invoice is
         -- not money past due. Migration 0024.
         AND i.kind = 'invoice' AND i.voided_at IS NULL
       ORDER BY days_overdue DESC`
		)
		.bind(day)
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

	// Due in the next week, so the shape of the week is visible rather than just
	// what is already late.
	const week = await db
		.prepare(
			`SELECT a.*, p.name AS project_name
       FROM action_items a
       LEFT JOIN projects p ON p.id = a.project_id
       WHERE a.status != 'done' AND a.deadline > ?1 AND a.deadline <= ?2
       ORDER BY a.deadline ASC
       LIMIT ?3`
		)
		.bind(day, soon, CARD_LIMIT)
		.all();

	// What was closed today, which is the only positive number on the screen.
	const finished = await db
		.prepare(
			`SELECT a.title, a.completed_at, p.name AS project_name
       FROM action_items a
       LEFT JOIN projects p ON p.id = a.project_id
       WHERE a.status = 'done' AND a.completed_at >= ?1
       ORDER BY a.completed_at DESC
       LIMIT ?2`
		)
		.bind(dayStart, CARD_LIMIT)
		.all();

	const overdueAll = attentionRows.filter((r) => String(r.deadline) < day);
	const dueTodayAll = attentionRows.filter((r) => String(r.deadline) === day);

	// True sizes, counted before anything is sliced for display.
	const sizes = await db
		.prepare(
			`SELECT
         (SELECT COUNT(*) FROM action_items
           WHERE status != 'done' AND deadline > ?1 AND deadline <= ?2) AS week,
         (SELECT COUNT(*) FROM meetings WHERE meeting_date = ?1) AS meetings,
         (SELECT COUNT(*) FROM invoices
           WHERE amount_paid_cents < amount_cents AND julianday(?1) > julianday(due_date)
             AND kind = 'invoice' AND voided_at IS NULL) AS alerts,
         (SELECT COUNT(*) FROM meeting_action_proposals WHERE status = 'pending') AS proposals,
         (SELECT COUNT(*) FROM action_items WHERE status = 'ambiguous') AS ambiguous,
         (SELECT COALESCE(SUM(amount_cents - amount_paid_cents), 0) FROM invoices
           WHERE amount_paid_cents < amount_cents AND julianday(?1) > julianday(due_date)
             AND kind = 'invoice' AND voided_at IS NULL) AS past_due_cents`
		)
		.bind(day, soon)
		.first<Record<string, number>>();

	return c.json({
		today: day,
		stale_days: STALE_DAYS,
		soon_days: SOON_DAYS,
		card_limit: CARD_LIMIT,
		// Cards show a few rows and report the true count separately, so a number
		// on a card never means "as many as would fit".
		overdue: overdueAll.slice(0, CARD_LIMIT),
		due_today: dueTodayAll.slice(0, CARD_LIMIT),
		week: week.results ?? [],
		finished: finished.results ?? [],
		counts: {
			overdue: overdueAll.length,
			due_today: dueTodayAll.length,
			week: Number(sizes?.week ?? 0),
			meetings: Number(sizes?.meetings ?? 0),
			invoice_alerts: Number(sizes?.alerts ?? 0),
			// Everything waiting on a decision from Paul specifically, which is the
			// number that decides whether the day starts with triage.
			awaiting_decision: Number(sizes?.proposals ?? 0) + Number(sizes?.ambiguous ?? 0),
			past_due_cents: Number(sizes?.past_due_cents ?? 0)
		},
		slipping: (slipping.results ?? []).slice(0, CARD_LIMIT),
		meetings: meetings.results ?? [],
		invoice_alerts: (invoiceAlerts.results ?? []).slice(0, CARD_LIMIT),
		totals: {
			open: totals?.open_count ?? 0,
			done_today: totals?.done_today ?? 0
		}
	});
});
