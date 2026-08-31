import type { D1Database } from '@cloudflare/workers-types';
import { nowUtc } from './dates';
import type { Usage } from './ai';

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

export type UsageKind = 'triage' | 'summary' | 'draft' | 'profile' | 'digest' | 'voice';

export async function recordUsage(
	db: D1Database,
	kind: UsageKind,
	usage: Usage,
	threadId: string | null,
	connectionId: string | null
): Promise<string | null> {
	try {
		await db
			.prepare(
				`INSERT INTO ai_usage
         (id, kind, model, input_tokens, output_tokens, thread_id, connection_id, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				crypto.randomUUID(),
				kind,
				usage.model,
				usage.input_tokens,
				usage.output_tokens,
				threadId,
				connectionId,
				nowUtc()
			)
			.run();
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
