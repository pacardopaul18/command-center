import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { ApiEnv } from './env';
import { todayInWorkingZone, workingDayStartUtc } from '../dates';
import { ApiError } from './validate';
import { REPORT_TYPES } from '$lib/types';
import type { ReportType } from '$lib/types';

/**
 * Reports.
 *
 * Architecture section D names five. Four are built here. The fifth, partner
 * time saved, needs the TimeSavedLog and SlipsCaught tables and a baseline time
 * audit that has not been run, and the build plan puts that dashboard in v2.
 * See D52.
 *
 * Every report is a parameterised query answered live. Nothing is stored. The
 * `reports` table in section E exists to hold an `r2_key` for a generated PDF
 * and a `share_token` for a public link, and both of those are v2. See D51.
 *
 * Anything derived from "today" is derived here, in Mountain Time, from the same
 * todayInWorkingZone() the rest of the app uses. Aging in particular is computed
 * at read time and never stored, matching Invoicing exactly: both use the same
 * bucket boundaries, so the two screens cannot disagree.
 */

export const reports = new Hono<ApiEnv>();

/** Shared shape with Invoicing. ?1 is today. Changing a boundary changes both. */
const OUTSTANDING = `
  SELECT i.id, i.invoice_number, i.issue_date, i.due_date, i.status,
    cl.id AS client_id, cl.name AS client_name,
    i.amount_cents, i.amount_paid_cents,
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
`;

/**
 * Report 1: billing and payment status with aging.
 *
 * Outstanding by client and by bucket, plus days sales outstanding.
 *
 * DSO is the collection-period form, receivables divided by billed, times the
 * days in the window, computed over a window rather than all time so it moves.
 * It is null rather than zero when nothing was billed in the window, because a
 * DSO of zero means "collected instantly" and an absent DSO means "no basis to
 * say". Those are different facts, and showing the first for the second would
 * be a lie on a document Paul might hand to a partner.
 */
async function billingReport(db: D1Database, day: string, from: string, to: string) {
	const [rows, bands, byClient, billed] = await Promise.all([
		db.prepare(`${OUTSTANDING} ORDER BY days_overdue DESC, cl.name COLLATE NOCASE`).bind(day).all(),
		db
			.prepare(
				`SELECT aging_bucket, COUNT(*) AS invoice_count, SUM(outstanding_cents) AS outstanding_cents
         FROM (${OUTSTANDING}) GROUP BY aging_bucket`
			)
			.bind(day)
			.all(),
		db
			.prepare(
				`SELECT client_id, client_name, COUNT(*) AS invoice_count,
                SUM(outstanding_cents) AS outstanding_cents,
                MAX(days_overdue) AS worst_days_overdue
         FROM (${OUTSTANDING})
         GROUP BY client_id, client_name
         ORDER BY outstanding_cents DESC`
			)
			.bind(day)
			.all(),
		db
			.prepare(
				`SELECT COALESCE(SUM(amount_cents), 0) AS billed_cents, COUNT(*) AS invoice_count
         FROM invoices WHERE issue_date >= ?1 AND issue_date <= ?2`
			)
			.bind(from, to)
			.first<{ billed_cents: number; invoice_count: number }>()
	]);

	const outstanding = (rows.results ?? []) as Record<string, number>[];
	const totalOutstanding = outstanding.reduce(
		(sum, r) => sum + Number(r.outstanding_cents ?? 0),
		0
	);

	const billedCents = Number(billed?.billed_cents ?? 0);
	const windowDays =
		Math.round(
			(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
		) + 1;
	const dso = billedCents > 0 ? Math.round((totalOutstanding / billedCents) * windowDays) : null;

	// Section D asks for "discrepancies open" alongside the money. The concrete
	// form of that here is a reconciliation gap: a billing period still open or
	// reconciled after its window has closed, meaning hours are sitting unbilled.
	const stalled = await db
		.prepare(
			`SELECT bp.id, bp.period_start, bp.period_end, bp.status, cl.name AS client_name,
              COALESCE(SUM(te.hours), 0) AS total_hours,
              COALESCE(SUM(CASE WHEN te.billable = 1 THEN te.hours ELSE 0 END), 0) AS billable_hours,
              CAST(julianday(?1) - julianday(bp.period_end) AS INTEGER) AS days_since_close
       FROM billing_periods bp
       JOIN clients cl ON cl.id = bp.client_id
       LEFT JOIN time_entries te ON te.billing_period_id = bp.id
       WHERE bp.status IN ('open', 'reconciled') AND julianday(bp.period_end) < julianday(?1)
       GROUP BY bp.id
       ORDER BY days_since_close DESC`
		)
		.bind(day)
		.all();

	return {
		outstanding,
		bands: bands.results ?? [],
		by_client: byClient.results ?? [],
		unbilled_periods: stalled.results ?? [],
		totals: {
			outstanding_cents: totalOutstanding,
			invoice_count: outstanding.length,
			billed_cents: billedCents,
			billed_invoice_count: Number(billed?.invoice_count ?? 0),
			window_days: windowDays,
			dso
		}
	};
}

/** Report 2: project status roll-up. Phase, status, next milestone, at-risk flags. */
async function projectsReport(db: D1Database, day: string) {
	const [rows, byPhase, byStatus] = await Promise.all([
		db
			.prepare(
				`SELECT p.id, p.name, p.phase, p.status, p.next_milestone, p.target_close,
                cl.name AS client_name,
                CASE WHEN p.target_close IS NOT NULL AND p.status != 'done'
                     THEN CAST(julianday(p.target_close) - julianday(?1) AS INTEGER) END AS days_to_close,
                (SELECT COUNT(*) FROM action_items a
                  WHERE a.project_id = p.id AND a.status != 'done') AS open_actions,
                (SELECT COUNT(*) FROM action_items a
                  WHERE a.project_id = p.id AND a.status != 'done'
                    AND a.deadline IS NOT NULL AND julianday(a.deadline) < julianday(?1)) AS overdue_actions
         FROM projects p
         LEFT JOIN clients cl ON cl.id = p.client_id
         ORDER BY
           CASE p.status WHEN 'blocked' THEN 0 WHEN 'at_risk' THEN 1 WHEN 'on_track' THEN 2 ELSE 3 END,
           p.name COLLATE NOCASE`
			)
			.bind(day)
			.all(),
		db.prepare('SELECT phase, COUNT(*) AS n FROM projects GROUP BY phase').all(),
		db.prepare('SELECT status, COUNT(*) AS n FROM projects GROUP BY status').all()
	]);

	const projects = (rows.results ?? []) as Record<string, unknown>[];

	return {
		projects,
		by_phase: byPhase.results ?? [],
		by_status: byStatus.results ?? [],
		totals: {
			project_count: projects.length,
			// At risk is the two attention statuses plus anything carrying an
			// overdue action item, because a project can read on track while the
			// work underneath it is already late.
			at_risk_count: projects.filter(
				(p) =>
					p.status === 'at_risk' ||
					p.status === 'blocked' ||
					Number(p.overdue_actions ?? 0) > 0
			).length
		}
	};
}

interface CompletedRow {
	id: string;
	title: string;
	owner: string | null;
	deadline: string | null;
	completed_at: string;
	source: string;
	project_name: string | null;
	resolution_days: number | null;
}

/**
 * Report 3: action item completion.
 *
 * On-time delivery counts only items that had a deadline to be measured
 * against. An item with no deadline cannot be late, and folding those into the
 * denominator would inflate the percentage every time somebody logged a task
 * without a date.
 *
 * Two things here are about time zones, and both were wrong in the first
 * version of this function.
 *
 * `completed_at` is a UTC instant and the window is a pair of Mountain Time
 * calendar dates, so `date(completed_at)` is the wrong date for anything
 * finished after 6pm local. The window is therefore bounded by the UTC instants
 * of Mountain midnight, from workingDayStartUtc, exactly as the Today cockpit
 * and the digests already do. ISO 8601 UTC strings compare chronologically, so
 * a plain string comparison is a correct instant comparison.
 *
 * On time compares against the Mountain Time date of the completion, resolved
 * in JavaScript, because SQLite cannot apply a zone whose offset changes with
 * daylight saving. The item counts as on time when it was finished on or before
 * its deadline date in Paul's own calendar, which is the only reading that
 * matches how the deadline was set.
 */
async function actionsReport(db: D1Database, day: string, from: string, to: string) {
	const windowStart = workingDayStartUtc(from);
	// Exclusive upper bound at the start of the day after `to`, so the whole of
	// the last day is inside the window whatever hour the work finished.
	const windowEnd = workingDayStartUtc(addDays(to, 1));

	const completed = await db
		.prepare(
			`SELECT a.id, a.title, a.owner, a.deadline, a.completed_at, a.source,
              p.name AS project_name,
              CAST(ROUND(julianday(a.completed_at) - julianday(a.created_at)) AS INTEGER) AS resolution_days
       FROM action_items a
       LEFT JOIN projects p ON p.id = a.project_id
       WHERE a.status = 'done' AND a.completed_at IS NOT NULL
         AND a.completed_at >= ?1 AND a.completed_at < ?2
       ORDER BY a.completed_at DESC`
		)
		.bind(windowStart, windowEnd)
		.all();

	const open = await db
		.prepare(
			`SELECT status, COUNT(*) AS n,
              SUM(CASE WHEN deadline IS NOT NULL AND julianday(deadline) < julianday(?1) THEN 1 ELSE 0 END) AS overdue
       FROM action_items WHERE status != 'done' GROUP BY status`
		)
		.bind(day)
		.all();

	// on_time is decided here rather than in SQL, against the Mountain Time date
	// of the completion. Attached to each row so the printed table and the
	// headline percentage come from the same judgement.
	const rows = ((completed.results ?? []) as unknown as CompletedRow[]).map((r) => {
		const completedDay = todayInWorkingZone(new Date(String(r.completed_at)));
		return {
			...r,
			completed_day: completedDay,
			on_time: r.deadline == null ? null : completedDay <= r.deadline ? 1 : 0
		};
	});

	const measurable = rows.filter((r) => r.on_time !== null);
	const onTime = measurable.filter((r) => Number(r.on_time) === 1).length;
	const resolutions = rows
		.map((r) => Number(r.resolution_days))
		.filter((n) => Number.isFinite(n) && n >= 0);

	const openRows = (open.results ?? []) as { status: string; n: number; overdue: number }[];

	return {
		completed: rows,
		open_by_status: openRows,
		totals: {
			completed_count: rows.length,
			open_count: openRows.reduce((s, r) => s + Number(r.n ?? 0), 0),
			overdue_count: openRows.reduce((s, r) => s + Number(r.overdue ?? 0), 0),
			measurable_count: measurable.length,
			on_time_count: onTime,
			// Null rather than 100 when nothing had a deadline. Same reasoning as DSO.
			on_time_pct: measurable.length > 0 ? Math.round((onTime / measurable.length) * 100) : null,
			avg_resolution_days:
				resolutions.length > 0
					? Math.round((resolutions.reduce((s, n) => s + n, 0) / resolutions.length) * 10) / 10
					: null
		}
	};
}

/**
 * Report 5: what is slipping.
 *
 * One page, deliberately mixed across modules, because the question "what is
 * slipping" does not respect module boundaries. Each group is sorted worst
 * first.
 */
async function slippingReport(db: D1Database, day: string) {
	const [actions, invoices, projects, ambiguous, proposals] = await Promise.all([
		db
			.prepare(
				`SELECT a.id, a.title, a.owner, a.deadline, a.status,
                p.name AS project_name,
                CAST(julianday(?1) - julianday(a.deadline) AS INTEGER) AS days_late
         FROM action_items a
         LEFT JOIN projects p ON p.id = a.project_id
         WHERE a.status != 'done' AND a.deadline IS NOT NULL
           AND julianday(a.deadline) < julianday(?1)
         ORDER BY days_late DESC`
			)
			.bind(day)
			.all(),
		db
			.prepare(`${OUTSTANDING} AND julianday(i.due_date) < julianday(?1) ORDER BY days_overdue DESC`)
			.bind(day)
			.all(),
		db
			.prepare(
				`SELECT p.id, p.name, p.status, p.phase, p.next_milestone, p.target_close,
                cl.name AS client_name,
                CASE WHEN p.target_close IS NOT NULL
                     THEN CAST(julianday(?1) - julianday(p.target_close) AS INTEGER) END AS days_late
         FROM projects p
         LEFT JOIN clients cl ON cl.id = p.client_id
         WHERE p.status IN ('at_risk', 'blocked')
            OR (p.status != 'done' AND p.target_close IS NOT NULL
                AND julianday(p.target_close) < julianday(?1))
         ORDER BY (p.status = 'blocked') DESC, days_late DESC`
			)
			.bind(day)
			.all(),
		// Ambiguous items slip quietly: nobody owns them and nothing chases them.
		// D46 makes ambiguity a real state, so it belongs on this page.
		db
			.prepare(
				`SELECT id, title, owner, deadline, status FROM action_items
         WHERE status = 'ambiguous' ORDER BY created_at`
			)
			.all(),
		// A pending proposal is extracted work nobody has decided on yet. It is
		// invisible everywhere else until somebody opens that meeting.
		db
			.prepare(
				`SELECT mp.id, mp.title, mp.owner, mp.deadline, mp.meeting_id,
                m.title AS meeting_title, m.meeting_date,
                CAST(julianday(?1) - julianday(m.meeting_date) AS INTEGER) AS days_waiting
         FROM meeting_action_proposals mp
         JOIN meetings m ON m.id = mp.meeting_id
         WHERE mp.status = 'pending'
         ORDER BY days_waiting DESC`
			)
			.bind(day)
			.all()
	]);

	const a = (actions.results ?? []) as Record<string, unknown>[];
	const i = (invoices.results ?? []) as Record<string, unknown>[];
	const p = (projects.results ?? []) as Record<string, unknown>[];
	const am = (ambiguous.results ?? []) as Record<string, unknown>[];
	const pr = (proposals.results ?? []) as Record<string, unknown>[];

	return {
		overdue_actions: a,
		overdue_invoices: i,
		at_risk_projects: p,
		ambiguous_actions: am,
		pending_proposals: pr,
		totals: {
			total_count: a.length + i.length + p.length + am.length + pr.length,
			overdue_actions: a.length,
			overdue_invoices: i.length,
			at_risk_projects: p.length,
			ambiguous_actions: am.length,
			pending_proposals: pr.length
		}
	};
}

/** YYYY-MM-DD or a 400. A report takes a window, and a bad one must not run. */
function readDate(raw: string | undefined, fallback: string, label: string): string {
	if (!raw) return fallback;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
		throw new ApiError(400, `${label} must be a date in YYYY-MM-DD form.`);
	}
	return raw;
}

/**
 * Calendar arithmetic on a plain YYYY-MM-DD, with no zone involved.
 *
 * Safe against daylight saving because it never touches a wall clock: the date
 * is anchored at UTC midnight, shifted by whole days, and read back as a date.
 * Turning it into a real instant is workingDayStartUtc's job, not this one's.
 */
function addDays(day: string, n: number): string {
	return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

reports.get('/:type', async (c) => {
	const type = c.req.param('type') as ReportType;
	if (!REPORT_TYPES.includes(type)) {
		throw new ApiError(404, 'That report does not exist.');
	}

	const day = todayInWorkingZone();
	const to = readDate(c.req.query('to'), day, 'The end date');
	const from = readDate(c.req.query('from'), addDays(to, -29), 'The start date');
	if (from > to) throw new ApiError(400, 'The start date is after the end date.');

	const db = c.env.DB;
	const data =
		type === 'billing'
			? await billingReport(db, day, from, to)
			: type === 'projects'
				? await projectsReport(db, day)
				: type === 'actions'
					? await actionsReport(db, day, from, to)
					: await slippingReport(db, day);

	// generated_at stamps the printed page. A PDF with no as-of date is a PDF
	// somebody misreads three weeks later.
	return c.json({
		type,
		today: day,
		from,
		to,
		generated_at: new Date().toISOString(),
		data
	});
});
