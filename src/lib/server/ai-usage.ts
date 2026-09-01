import type { D1Database } from '@cloudflare/workers-types';
import { nowUtc } from './dates';
import type { Usage } from './ai';
import { attributeToRun } from './ai-budget';

/**
 * Every AI call, recorded in one place.
 *
 * There were two recorders and one of them was missing, which is how the spend
 * meter came to read zero while the app had summarised 583 threads. The one in
 * mail-jobs omitted `connection_id`, so what it did record could not be
 * attributed to an account; the drafting route recorded nothing at all, and
 * drafts are the most expensive call in the app.
 *
 * Pillar 4 is a cost decision before it is anything else, and a ceiling nobody
 * can read is not a ceiling. So: one function, every caller, every field.
 *
 * Deliberately not fatal. A failed write to the meter must not lose Paul the
 * answer he paid for, so it is caught and reported rather than thrown. The
 * error is returned so a caller can surface it instead of it vanishing.
 */

/**
 * The kinds the database will actually accept.
 *
 * Migration 0015 constrains this column to three values. The union used to name
 * six, and the three extra ones had no caller, so nothing had ever hit the
 * constraint. The first code to use one would have had its insert refused, and
 * `recordUsage` swallows a failed write on purpose, so the spend would have gone
 * unrecorded and therefore unstoppable: the exact hole the ceiling exists to
 * close.
 *
 * Narrowed to the truth rather than widened by a table rebuild tonight.
 * `profile`, `digest` and `voice` are worth having and are queued with the
 * Thursday ALTERs; until then the context pass records its work as `summary`,
 * which is what it is, and the total the ceiling reads is complete.
 */
export type UsageKind = 'triage' | 'summary' | 'draft';

export async function recordUsage(
	db: D1Database,
	kind: UsageKind,
	usage: Usage,
	threadId: string | null,
	connectionId: string | null,
	/**
	 * The backfill run this call belongs to, when it belongs to one.
	 *
	 * Attribution happens here rather than at the call site, because this is
	 * where the usage id exists. Handing the id back so a caller could attribute
	 * it would make attribution a second step every caller has to remember, and
	 * a call that forgot would silently draw on the monthly ceiling instead.
	 */
	runName: string | null = null
): Promise<string | null> {
	try {
		const id = crypto.randomUUID();
		await db
			.prepare(
				`INSERT INTO ai_usage
         (id, kind, model, input_tokens, output_tokens, thread_id, connection_id, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				id,
				kind,
				usage.model,
				usage.input_tokens,
				usage.output_tokens,
				threadId,
				connectionId,
				nowUtc()
			)
			.run();

		if (runName) {
			const problem = await attributeToRun(
				db,
				id,
				runName,
				usage.model,
				usage.input_tokens,
				usage.output_tokens
			);
			// Reported, never thrown: a failed attribution must not lose the
			// answer that was already paid for. An unattributed call falls to the
			// monthly ceiling, which errs towards stopping sooner.
			if (problem) return problem;
		}

		return null;
	} catch (err) {
		return err instanceof Error ? err.message : 'Could not record usage.';
	}
}

/**
 * What a call costs, in cents, from the tokens it reported.
 *
 * Priced per million tokens. Kept beside the recorder rather than in the view,
 * so the number on screen and the number in a budget check come from the same
 * table and cannot drift.
 *
 * These are list prices and they change. When one moves, it moves here.
 */
const PRICING: Record<string, { input: number; output: number }> = {
	'claude-sonnet-5': { input: 3, output: 15 },
	'claude-haiku-4-5-20251001': { input: 1, output: 5 },
	'claude-opus-5': { input: 5, output: 25 }
};

/** Falls back to the dearest known model, so an unknown one never flatters. */
export function costCents(model: string, inputTokens: number, outputTokens: number): number {
	const price = PRICING[model] ?? { input: 5, output: 25 };
	const dollars = (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
	return dollars * 100;
}
