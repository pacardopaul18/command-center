import type { D1Database } from '@cloudflare/workers-types';
import { costCents } from './ai-usage';
import { AI_CEILINGS, usd } from '../ai-budget';

/**
 * What a corpus pass would cost, worked out before it spends anything.
 *
 * The ruling is that the projected cost is reported before the run starts
 * spending, and that the run stops and says so if the projection exceeds its
 * allowance. Both halves matter. A budget stop that only fires part way through
 * has already spent the money it was protecting, and a projection nobody sees
 * is a number that existed and changed nothing.
 *
 * Calibrated against real usage rather than guessed. The figures below come
 * from the 2026-09-01 measurement recorded in `ai-budget.ts`: 1.54 USD per
 * 1,000 threads blended, 1.16 triage-only. The per-thread token averages here
 * are the same measurement expressed the way an estimate needs it.
 */

/**
 * Average tokens per thread, per pass, from the recorded run.
 *
 * Deliberately averages and labelled as such. A thread with forty messages
 * costs more than one with two, and an estimate that pretended otherwise would
 * be precise and wrong. What it has to be is close enough to answer "will this
 * fit in the allowance", and the allowance is 50 USD against a projection in
 * single dollars.
 */
const PER_THREAD = {
	digest: { model: 'claude-haiku-4-5-20251001', input: 2_400, output: 260 },
	commitment: { model: 'claude-haiku-4-5-20251001', input: 2_400, output: 180 }
} as const;

/** Per contact, not per thread: a profile reads that contact's threads once. */
const PER_CONTACT = {
	profile: { model: 'claude-sonnet-5', input: 5_200, output: 420 }
} as const;

/** Once for the whole corpus. */
const VOICE = { model: 'claude-sonnet-5', input: 18_000, output: 900 } as const;

export interface CostEstimate {
	threads_eligible: number;
	contacts_eligible: number;
	/** Every call this pass would make, if nothing stopped it. */
	calls: number;
	input_tokens: number;
	output_tokens: number;
	cents: number;
	usd: string;
	allowance_cents: number;
	allowance_usd: string;
	/** True when the projection fits. False means the run must not start. */
	within_allowance: boolean;
	/** Always present, whether it fits or not. D138. */
	verdict: string;
	by_pass: { pass: string; calls: number; cents: number }[];
}

/**
 * Projects the cost of a full context pass over what is currently eligible.
 *
 * Counts from the same predicates the pass itself uses, so the estimate is
 * about the work that would actually happen rather than about the corpus as a
 * whole. Automated, newsletter and notification mail never reaches the context
 * AI, and an estimate that counted them would overstate the bill and then look
 * wrong when the real run came in under it.
 */
export async function estimateContextPass(
	db: D1Database,
	connectionId: string,
	allowanceCents = AI_CEILINGS.backfill_cents
): Promise<CostEstimate> {
	const threads = await db
		.prepare(
			`SELECT COUNT(*) AS n FROM email_threads
       WHERE connection_id = ? AND category = 'correspondence'`
		)
		.bind(connectionId)
		.first<{ n: number }>();

	const contacts = await db
		.prepare('SELECT COUNT(*) AS n FROM mail_contacts WHERE connection_id = ?')
		.bind(connectionId)
		.first<{ n: number }>();

	const threadCount = threads?.n ?? 0;
	const contactCount = contacts?.n ?? 0;

	const rows: { pass: string; calls: number; cents: number; input: number; output: number }[] = [];

	for (const [pass, spec] of Object.entries(PER_THREAD)) {
		const input = spec.input * threadCount;
		const output = spec.output * threadCount;
		rows.push({
			pass,
			calls: threadCount,
			cents: costCents(spec.model, input, output),
			input,
			output
		});
	}

	for (const [pass, spec] of Object.entries(PER_CONTACT)) {
		const input = spec.input * contactCount;
		const output = spec.output * contactCount;
		rows.push({
			pass,
			calls: contactCount,
			cents: costCents(spec.model, input, output),
			input,
			output
		});
	}

	rows.push({
		pass: 'voice',
		calls: 1,
		cents: costCents(VOICE.model, VOICE.input, VOICE.output),
		input: VOICE.input,
		output: VOICE.output
	});

	const cents = rows.reduce((sum, r) => sum + r.cents, 0);
	const calls = rows.reduce((sum, r) => sum + r.calls, 0);
	const within = cents <= allowanceCents;

	return {
		threads_eligible: threadCount,
		contacts_eligible: contactCount,
		calls,
		input_tokens: rows.reduce((s, r) => s + r.input, 0),
		output_tokens: rows.reduce((s, r) => s + r.output, 0),
		cents,
		usd: usd(cents),
		allowance_cents: allowanceCents,
		allowance_usd: usd(allowanceCents),
		within_allowance: within,
		verdict: within
			? `${calls} calls over ${threadCount} threads and ${contactCount} contacts, projected at ${usd(cents)} against an allowance of ${usd(allowanceCents)}.`
			: `Projected at ${usd(cents)}, which is over the ${usd(allowanceCents)} allowance. The run must not start; raise the allowance deliberately or narrow what is eligible.`,
		by_pass: rows.map((r) => ({ pass: r.pass, calls: r.calls, cents: r.cents }))
	};
}
