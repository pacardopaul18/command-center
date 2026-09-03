import type { D1Database } from '@cloudflare/workers-types';
import { costCents } from './ai-usage';

/**
 * The part of the meter that is known to be wrong, and by how much.
 *
 * `context.ts` carried a private writer alongside the shared recorder, so every
 * call the context pass made wrote two `ai_usage` rows: one attributed to its
 * backfill run and one not. D226. The second writer is gone and the rows it
 * wrote are not, because a spend ledger should not be edited by the thing that
 * got it wrong.
 *
 * WHY THIS EXISTS RATHER THAN A NOTE IN THE DECISION LOG. It was recorded there
 * first, which put the correction somewhere nobody reading the meter would
 * look. A figure known to be wrong that renders as if right is exactly what
 * D214 exists to prevent, and being right in a document does not fix a screen.
 *
 * DERIVED, NOT RECALLED. The count, the amount and the last date are all
 * computed from the rows every time. Writing them here as constants would make
 * this a caption whose value came from memory sitting beside figures that came
 * from storage, which is the failure this correction itself produced in
 * HANDOFF_04: the numbers were real and the labels were recall, and the table
 * read as fully evidenced because the hard part visibly was.
 *
 * So: no hardcoded six, no hardcoded $0.0749. On a database with no duplicates,
 * such as the fixture, this answers null and the screen says nothing.
 */

export interface SpendDelta {
	/** How many rows are duplicates of a call that happened once. */
	rows: number;
	/** What those rows add to the meter, in cents. */
	cents: number;
	/** The first and last duplicate, so the window is stated rather than implied. */
	first_at: string;
	last_at: string;
}

/**
 * The window is closed, and closing it is the point.
 *
 * Duplicates stopped when the second writer was removed. A detector with no
 * upper bound would keep reporting any future coincidence as a known error,
 * which would turn a closed correction into a permanent alarm and train the
 * reader to ignore it.
 */
export const DOUBLE_WRITE_FIXED_AT = '2026-09-03T21:10:14Z';

/** Two rows are the same call if everything about them matches within a breath. */
const SAME_CALL_SECONDS = 2;

/**
 * Which rows to look at, and it matters.
 *
 * `monthToDateCents` excludes anything attributed to a backfill run, so the
 * delta on that figure must exclude them too or the correction is wrong in the
 * other direction. The Settings meter counts every row, so its delta counts
 * every duplicate. Same duplicates, two scopes, one function: the alternative
 * is two detectors that will disagree about the same rows one day.
 */
export interface DeltaScope {
	/** True for the monthly figure, false for a meter that counts everything. */
	excludeRunAttributed?: boolean;
}

export async function knownSpendDelta(
	db: D1Database,
	scope: DeltaScope = {}
): Promise<SpendDelta | null> {
	/*
	 * Only the rows the month figure counts.
	 *
	 * `monthToDateCents` excludes anything attributed to a backfill run, so a
	 * phantom that happens to be the attributed half of its pair is not in the
	 * number this sentence annotates, and subtracting it would make the
	 * correction wrong in the other direction. The same LEFT JOIN, so the two
	 * cannot drift apart.
	 *
	 * This is therefore the delta on the monthly figure, which is a narrower
	 * claim than the total number of duplicate rows in the ledger. The ledger
	 * holds six; the month counts the ones below.
	 */
	const { results } = await db
		.prepare(
			scope.excludeRunAttributed
				? `SELECT u.id, u.model, u.input_tokens, u.output_tokens, u.connection_id, u.at
           FROM ai_usage u
           LEFT JOIN ai_run_usage r ON r.usage_id = u.id
           WHERE u.at < ? AND r.usage_id IS NULL
           ORDER BY u.at`
				: `SELECT u.id, u.model, u.input_tokens, u.output_tokens, u.connection_id, u.at
           FROM ai_usage u WHERE u.at < ? ORDER BY u.at`
		)
		.bind(DOUBLE_WRITE_FIXED_AT)
		.all<{
			id: string;
			model: string;
			input_tokens: number;
			output_tokens: number;
			connection_id: string | null;
			at: string;
		}>();

	const rows = results ?? [];
	const seen = new Map<string, { at: string }>();
	const duplicates: { at: string; cents: number }[] = [];

	for (const row of rows) {
		const key = `${row.model}|${row.input_tokens}|${row.output_tokens}|${row.connection_id ?? ''}`;
		const previous = seen.get(key);
		if (previous && withinSeconds(previous.at, row.at, SAME_CALL_SECONDS)) {
			duplicates.push({
				at: row.at,
				cents: costCents(row.model, row.input_tokens, row.output_tokens)
			});
		}
		seen.set(key, { at: row.at });
	}

	if (duplicates.length === 0) return null;

	return {
		rows: duplicates.length,
		cents: duplicates.reduce((total, d) => total + d.cents, 0),
		first_at: duplicates[0].at,
		last_at: duplicates[duplicates.length - 1].at
	};
}

function withinSeconds(a: string, b: string, seconds: number): boolean {
	const gap = Math.abs(Date.parse(b) - Date.parse(a));
	return Number.isFinite(gap) && gap <= seconds * 1000;
}

/**
 * The sentence a person reads, built from the numbers rather than beside them.
 *
 * In words, because "$0.5349 (delta $0.0749)" makes the reader do the
 * arithmetic and the correction is the part that matters. The date it stopped
 * is included because a known error with no end looks like an ongoing one.
 */
export function spendDeltaSentence(
	delta: SpendDelta | null,
	trueTotalCents?: number
): string | null {
	if (!delta) return null;
	const usd = (cents: number) => `$${(cents / 100).toFixed(4)}`;
	const day = delta.last_at.slice(0, 10);
	const tail =
		trueTotalCents === undefined
			? ''
			: ` Truly spent: ${usd(trueTotalCents - delta.cents)}.`;
	return (
		`These figures are high. ${delta.rows} of the calls counted here happened once and were ` +
		`recorded twice, by a second writer that has since been removed, which adds ` +
		`${usd(delta.cents)} and ${delta.rows} calls that never happened. The last one was on ` +
		`${day} and no more can be added; the rows are kept rather than deleted, because a ` +
		`spend ledger should not be edited by the thing that got it wrong.${tail}`
	);
}
