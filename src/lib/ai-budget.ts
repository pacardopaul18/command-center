/**
 * What the AI is allowed to spend. One source, read by the control and by the
 * display.
 *
 * The whole reason this file is separate: the meter route used to return a
 * `ceiling_usd_per_month: 30` that nothing read, while the code that could have
 * enforced it had no caller. A number on a screen and a number in a check that
 * come from different places are two numbers, and they will disagree the first
 * time one of them is edited. Here they cannot.
 *
 * Ruled figures, not chosen here:
 *
 *   MONTHLY   30 USD, hard. The ongoing cost of the app running: triage on new
 *             mail, the occasional draft, a meeting summarised. Recurring, and
 *             it should stay small.
 *
 *   BACKFILL  50 USD, per named run. A corpus pass is a one-off over mail that
 *             already exists. It gets its own allowance so it cannot eat the
 *             month, and the month cannot silently absorb it.
 *
 * Calibrated against real usage on 2026-09-01: 1.54 USD per 1,000 threads
 * blended, 1.16 triage-only. A full pass over the 775-thread corpus is about
 * 1.19 USD, so the monthly ceiling is roughly twenty-five full passes and the
 * backfill allowance is far more than one pass needs. Both are deliberately
 * generous: a stop that fires in normal use gets raised until it stops firing,
 * and then it is not a stop.
 */

export const AI_CEILINGS = {
	/** Hard monthly ceiling, in cents. Calls at or over it are refused. */
	monthly_cents: 30 * 100,

	/** Default allowance for a new backfill run, in cents. Stored per run. */
	backfill_cents: 50 * 100
} as const;

export const AI_CEILINGS_USD = {
	monthly: AI_CEILINGS.monthly_cents / 100,
	backfill: AI_CEILINGS.backfill_cents / 100
} as const;

/** Which allowance a call is drawing on. */
export type Allowance = 'monthly' | 'backfill';

/**
 * The answer to "may this call happen".
 *
 * Carries the reason whether or not it is allowed, because a refusal that
 * reaches a job as a bare false becomes a run that did nothing with no way to
 * say which nothing it was. D138.
 */
export interface BudgetVerdict {
	ok: boolean;
	allowance: Allowance;
	/** The run this was measured against, when it was measured against one. */
	run: string | null;
	spent_cents: number;
	ceiling_cents: number;
	/** Present whether allowed or refused. A sentence, already readable. */
	reason: string;
}

/** Cents as a plain dollar string, for a reason a person reads. */
export function usd(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}
