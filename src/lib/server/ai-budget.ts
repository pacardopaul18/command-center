import type { D1Database } from '@cloudflare/workers-types';
import { nowUtc } from './dates';
import { costCents } from './ai-usage';
import { AI_CEILINGS, usd, type BudgetVerdict } from '../ai-budget';

/**
 * The spend stop.
 *
 * Called before every AI call site, and the point of it is that "before" is
 * load bearing: a check after the call has already spent the money.
 *
 * Two allowances that do not mix. Ordinary work draws on the monthly ceiling;
 * a named backfill run draws on its own, and usage attributed to a run is
 * excluded from the monthly figure. Without that exclusion a corpus pass would
 * consume the month and every ordinary call after it would be refused, which is
 * a stop firing on exactly the wrong thing.
 */

/** The first instant of the month containing `now`, as the app stores instants. */
export function monthStartUtc(now: Date = new Date()): string {
	return `${now.toISOString().slice(0, 7)}-01T00:00:00Z`;
}

/**
 * Month-to-date spend, in cents, excluding anything attributed to a run.
 *
 * Grouped by model and costed in TypeScript rather than summed in SQL, because
 * the price list lives beside the recorder and a second copy of it in a query
 * is a second place for it to go stale. Grouping keeps that to one row per
 * model rather than one per call.
 *
 * Recomputed from current prices on purpose. This is a live budget, not a
 * record of what a completed run cost, so it should move when a price moves.
 */
export async function monthToDateCents(db: D1Database, now: Date = new Date()): Promise<number> {
	const { results } = await db
		.prepare(
			`SELECT u.model, SUM(u.input_tokens) AS input_tokens, SUM(u.output_tokens) AS output_tokens
       FROM ai_usage u
       LEFT JOIN ai_run_usage r ON r.usage_id = u.id
       WHERE u.at >= ? AND r.usage_id IS NULL
       GROUP BY u.model`
		)
		.bind(monthStartUtc(now))
		.all<{ model: string; input_tokens: number; output_tokens: number }>();

	return (results ?? []).reduce(
		(total, row) =>
			total + costCents(row.model, Number(row.input_tokens), Number(row.output_tokens)),
		0
	);
}

export interface BudgetRun {
	id: string;
	name: string;
	allowance_cents: number;
	started_at: string;
	closed_at: string | null;
}

/** An open run by name, or null. A closed run is not found on purpose. */
export async function openRun(db: D1Database, name: string): Promise<BudgetRun | null> {
	return db
		.prepare(
			`SELECT id, name, allowance_cents, started_at, closed_at
       FROM ai_budget_runs WHERE name = ? AND closed_at IS NULL`
		)
		.bind(name)
		.first<BudgetRun>();
}

/**
 * What a run has spent, from what was attributed to it.
 *
 * Summed from stored per-call costs rather than recomputed. A run's spend is a
 * historical fact about money actually incurred, and recomputing it from
 * today's prices would rewrite what a finished run cost.
 */
export async function runSpentCents(db: D1Database, runId: string): Promise<number> {
	const row = await db
		.prepare('SELECT COALESCE(SUM(cost_cents), 0) AS n FROM ai_run_usage WHERE run_id = ?')
		.bind(runId)
		.first<{ n: number }>();
	return Number(row?.n ?? 0);
}

/**
 * May this call happen.
 *
 * Naming a run that is not open is not an error and is not a refusal: the call
 * falls through to the monthly ceiling, which is where an ordinary call belongs.
 * Treating it as an error would mean a finished backfill breaking every job that
 * still passed its name; treating it as permission would let a closed
 * allowance keep paying.
 */
export async function checkAiBudget(
	db: D1Database,
	options: { run?: string | null } = {},
	now: Date = new Date()
): Promise<BudgetVerdict> {
	const run = options.run ? await openRun(db, options.run) : null;

	if (run) {
		const spent = await runSpentCents(db, run.id);
		const ok = spent < run.allowance_cents;
		return {
			ok,
			allowance: 'backfill',
			run: run.name,
			spent_cents: spent,
			ceiling_cents: run.allowance_cents,
			reason: ok
				? `Backfill run "${run.name}" has spent ${usd(spent)} of ${usd(run.allowance_cents)}.`
				: `Backfill run "${run.name}" has reached its allowance: ${usd(spent)} of ${usd(run.allowance_cents)}. Raise the allowance or close the run.`
		};
	}

	const spent = await monthToDateCents(db, now);
	const ceiling = AI_CEILINGS.monthly_cents;
	const ok = spent < ceiling;

	return {
		ok,
		allowance: 'monthly',
		run: null,
		spent_cents: spent,
		ceiling_cents: ceiling,
		reason: ok
			? `${usd(spent)} of ${usd(ceiling)} spent this month.`
			: `The monthly AI ceiling is reached: ${usd(spent)} of ${usd(ceiling)}. No further calls will be made until the month rolls over or the ceiling is raised.`
	};
}

/**
 * Attributes a recorded call to a run, so it draws on that allowance.
 *
 * Called after `recordUsage`, with the id it returned. Deliberately not fatal
 * for the same reason the meter is not: a failed attribution must not lose the
 * answer that was already paid for. It is reported instead, and an unattributed
 * call falls to the monthly ceiling, which errs towards stopping sooner rather
 * than later.
 */
export async function attributeToRun(
	db: D1Database,
	usageId: string,
	runName: string,
	model: string,
	inputTokens: number,
	outputTokens: number
): Promise<string | null> {
	try {
		const run = await openRun(db, runName);
		if (!run) return `No open backfill run called "${runName}".`;

		await db
			.prepare(
				`INSERT INTO ai_run_usage (usage_id, run_id, cost_cents, at)
         VALUES (?, ?, ?, ?)`
			)
			.bind(usageId, run.id, costCents(model, inputTokens, outputTokens), nowUtc())
			.run();
		return null;
	} catch (err) {
		return err instanceof Error ? err.message : 'Could not attribute usage to the run.';
	}
}
