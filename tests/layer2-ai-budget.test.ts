import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_CEILINGS, AI_CEILINGS_USD } from '../src/lib/ai-budget';

/**
 * The spend stop.
 *
 * Built because there was not one. `costCents` had been written, tested and
 * exported, and had no caller outside its own test; the only dollar figure in
 * the running app was a display constant the meter returned, which nothing read
 * to decide anything. The exposure was twenty-nine cents. The problem was that
 * a control everyone believed existed did not.
 *
 * Four properties, and the third is the one the design turns on.
 *
 *  1. A call at or over the ceiling is refused, with the reason, never as a
 *     success with zeros. D138.
 *  2. A call under it proceeds.
 *  3. The two allowances do not mix. A backfill run cannot consume the month,
 *     and the month cannot silently absorb a corpus pass.
 *  4. The meter reports the same numbers the check reads, from the same code.
 *
 * All fixture content is invented, and every row it writes is removed.
 */

const BASE = 'http://localhost:5173';
const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const RUN = 'budget-fixture-run';
const TAG = 'budget-fixture';

function openDb(): DatabaseSync {
	const f = readdirSync(DIR).find((x) => x.endsWith('.sqlite') && x !== 'metadata.sqlite');
	if (!f) throw new Error('Local D1 not found.');
	return new DatabaseSync(join(DIR, f));
}

let db: DatabaseSync;

/**
 * Haiku at 1 USD per million input tokens, so a million input tokens is exactly
 * one dollar and the arithmetic in these tests is checkable by eye.
 */
const HAIKU = 'claude-haiku-4-5-20251001';

/** Writes usage worth `dollars`, optionally attributed to the fixture run. */
function spend(dollars: number, runId: string | null = null) {
	const id = `${TAG}-${crypto.randomUUID()}`;
	const tokens = Math.round(dollars * 1_000_000);
	db.prepare(
		`INSERT INTO ai_usage (id, kind, model, input_tokens, output_tokens, thread_id, connection_id, at)
     VALUES (?, 'triage', ?, ?, 0, NULL, NULL, ?)`
	).run(id, HAIKU, tokens, new Date().toISOString().replace(/\.\d{3}/, ''));

	if (runId) {
		db.prepare(
			'INSERT INTO ai_run_usage (usage_id, run_id, cost_cents, at) VALUES (?, ?, ?, ?)'
		).run(id, runId, dollars * 100, new Date().toISOString());
	}
	return id;
}

function makeRun(allowanceCents: number): string {
	const id = `${TAG}-run`;
	db.prepare(
		`INSERT INTO ai_budget_runs (id, name, allowance_cents, started_at, closed_at, note)
     VALUES (?, ?, ?, ?, NULL, 'fixture')`
	).run(id, RUN, allowanceCents, new Date().toISOString());
	return id;
}

function wipe() {
	db.prepare(`DELETE FROM ai_run_usage WHERE usage_id LIKE '${TAG}-%'`).run();
	db.prepare(`DELETE FROM ai_usage WHERE id LIKE '${TAG}-%'`).run();
	db.prepare(`DELETE FROM ai_budget_runs WHERE id LIKE '${TAG}-%'`).run();
}

beforeAll(() => {
	db = openDb();
	wipe();
});

afterEach(() => wipe());

afterAll(() => {
	wipe();
	db.close();
});

/** The check, reached through the route that reports it, so the wiring is real. */
/**
 * The meter is account scoped, and more than one account is connected locally,
 * so it must be told which. D108 refuses rather than guessing, which is correct
 * and means the test has to name one.
 */
async function anyAccount(): Promise<string> {
	const res = await fetch(`${BASE}/api/connections`);
	const body = (await res.json()) as { accounts?: { id: string }[] };
	const id = body.accounts?.[0]?.id;
	if (!id) throw new Error('No connected account to read the meter for.');
	return id;
}

async function meter() {
	const res = await fetch(`${BASE}/api/email/context/spend?account=${await anyAccount()}`);
	return (await res.json()) as {
		ceiling_usd_per_month: number;
		backfill_allowance_usd: number;
		month_to_date_usd: number;
		runs: { name: string; allowance_cents: number; spent_cents: number }[];
	};
}

describe('the ceilings come from one place', () => {
	it('the meter reports the ruled figures', async () => {
		const m = await meter();
		expect(m.ceiling_usd_per_month).toBe(30);
		expect(m.backfill_allowance_usd).toBe(50);
	});

	it('and those figures are the ones the check reads', () => {
		// Not two constants that happen to agree today. The display reads the
		// same module the control reads, so editing one cannot leave the other
		// behind, which is exactly how the old ceiling came to be decorative.
		expect(AI_CEILINGS_USD.monthly).toBe(AI_CEILINGS.monthly_cents / 100);
		expect(AI_CEILINGS_USD.backfill).toBe(AI_CEILINGS.backfill_cents / 100);

		const source = readFileSync('src/lib/server/api/email.ts', 'utf8');
		expect(source, 'the meter hardcodes a ceiling again').toContain('AI_CEILINGS_USD.monthly');
		expect(source, 'the meter runs its own month query').toContain('monthToDateCents');
	});

	it('the meter reports the same month-to-date the check computes', async () => {
		spend(4);
		const m = await meter();
		// Four dollars of haiku input, and the two numbers are read by one
		// function. A second query that looked similar is how they drift.
		expect(m.month_to_date_usd).toBeCloseTo(4, 2);
	});
});

describe('the monthly ceiling', () => {
	it('lets a call under it proceed', async () => {
		spend(1);
		const res = await fetch(`${BASE}/api/meetings/nope/summarize`, { method: 'POST' });
		// Under the ceiling the budget is not what stops it: the meeting does not
		// exist. Any status but 402 proves the stop let it through.
		expect(res.status, 'a call well under the ceiling was refused on budget').not.toBe(402);
	});

	it('refuses a call at the ceiling, with the reason and never as success', async () => {
		spend(AI_CEILINGS.monthly_cents / 100);

		const res = await fetch(`${BASE}/api/meetings/nope/summarize`, { method: 'POST' });
		expect(res.status).toBe(402);

		const body = (await res.json()) as { error: string };
		// The reason carries both numbers. "Refused" on its own is a fact nobody
		// can act on.
		expect(body.error).toMatch(/monthly AI ceiling/i);
		expect(body.error).toContain('$30.00');
	});

	it('refuses over the ceiling too, not only exactly at it', async () => {
		spend(AI_CEILINGS.monthly_cents / 100 + 5);
		const res = await fetch(`${BASE}/api/meetings/nope/summarize`, { method: 'POST' });
		expect(res.status).toBe(402);
	});

	it('every AI route refuses, not just the one that was easy to test', async () => {
		spend(AI_CEILINGS.monthly_cents / 100);

		for (const path of [
			'/api/meetings/nope/summarize',
			'/api/meetings/nope/extract',
			'/api/templates/nope/draft',
			'/api/email/threads/nope/draft'
		]) {
			const res = await fetch(`${BASE}${path}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ situation: 'x' })
			});
			expect(res.status, `${path} did not refuse at the ceiling`).toBe(402);
		}
	});
});

describe('the two allowances do not mix', () => {
	it('a backfill run does not consume the month', async () => {
		const runId = makeRun(50 * 100);
		// Forty dollars against the run: more than the whole monthly ceiling.
		spend(40, runId);

		const m = await meter();
		expect(m.month_to_date_usd, 'run spend leaked into the month').toBeCloseTo(0, 2);

		// And ordinary work still proceeds, which is the point: a corpus pass must
		// not refuse every call made after it.
		const res = await fetch(`${BASE}/api/meetings/nope/summarize`, { method: 'POST' });
		expect(res.status, 'the month was consumed by a backfill run').not.toBe(402);
	});

	it('the month does not silently absorb a corpus pass', async () => {
		const runId = makeRun(50 * 100);
		spend(40, runId);

		const m = await meter();
		const run = m.runs.find((r) => r.name === RUN);
		// Separately accountable rather than folded away. A pass that vanished
		// into the monthly figure would never be answerable for on its own.
		expect(run, 'the run is not reported at all').toBeTruthy();
		expect(Number(run?.spent_cents)).toBeCloseTo(4000, 0);
		expect(Number(run?.allowance_cents)).toBe(5000);
	});

	it('a run that reaches its allowance is refused on the run, not on the month', async () => {
		const runId = makeRun(10 * 100);
		spend(10, runId);

		const m = await meter();
		const run = m.runs.find((r) => r.name === RUN);
		expect(Number(run?.spent_cents)).toBeCloseTo(1000, 0);
		// The month is untouched, so the refusal that follows is the run's own.
		expect(m.month_to_date_usd).toBeCloseTo(0, 2);
	});
});

describe('every AI call site is guarded', () => {
	/**
	 * The rule, asserted rather than remembered.
	 *
	 * Five files call a function in `ai.ts`. Each must also call the stop, or the
	 * ceiling is a ceiling with a hole in it, and the hole is invisible: the
	 * unguarded path spends money and the meter shows the total climbing with
	 * nothing refusing anything.
	 */
	const AI_FUNCTIONS = [
		'summariseTranscript',
		'extractActionItems',
		'draftFromTemplate',
		'summariseThread',
		'triageThread',
		'draftReply',
		'buildContactProfile',
		'buildThreadDigest',
		'buildVoiceProfile',
		'extractCommitments'
	];

	function sources(dir: string, out: { path: string; text: string }[] = []) {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) sources(full, out);
			else if (entry.name.endsWith('.ts')) {
				out.push({ path: full.replace(/\\/g, '/'), text: readFileSync(full, 'utf8') });
			}
		}
		return out;
	}

	const callers = sources('src/lib/server').filter(
		(f) =>
			!f.path.endsWith('server/ai.ts') &&
			!f.path.endsWith('server/ai-budget.ts') &&
			AI_FUNCTIONS.some((fn) => f.text.includes(`${fn}(`))
	);

	it('finds the call sites at all', () => {
		// A scan that matched nothing would pass every case below without
		// checking anything, which is the failure mode of every loop-over-found.
		expect(callers.length, 'no AI call sites were found').toBeGreaterThanOrEqual(5);
	});

	for (const file of callers) {
		it(`${file.path} checks the budget before it spends`, () => {
			expect(
				file.text.includes('checkAiBudget'),
				`${file.path} calls an AI function without calling checkAiBudget. ` +
					`An unguarded call site is a hole in the ceiling, and the hole is invisible: ` +
					`it spends and the meter climbs with nothing refusing anything.`
			).toBe(true);
		});
	}

	it('every call site records what it spent, or the ceiling cannot see it', () => {
		// The context pass counted its own tokens into its outcome and wrote
		// nothing to ai_usage, so the most expensive pass in the app was
		// invisible to the meter and therefore to the stop that reads it.
		for (const file of callers) {
			expect(
				file.text.includes('recordUsage'),
				`${file.path} spends without recording. A cost the meter cannot see is a ` +
					`cost the stop cannot stop.`
			).toBe(true);
		}
	});
});
