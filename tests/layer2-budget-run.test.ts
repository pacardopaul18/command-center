import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function code(...parts: string[]): string {
	return readFileSync(join(ROOT, ...parts), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * A named backfill run exists because it was named.
 *
 * The defect this covers: `ai_budget_runs` was created in migration 0031, read
 * by `openRun`, consulted by the budget check and attributed to by the
 * recorder, and written by nothing at all. Passing a run name therefore found
 * no run, fell through to the monthly ceiling, and echoed the name back in the
 * response as though the backfill allowance were in effect.
 *
 * Nothing errored. The parameter was accepted, reported, and inert, which is
 * the shape D138 is about: the run said it did something it had not done. It
 * cost twelve cents to find and would have cost the whole monthly ceiling on a
 * real corpus, which is precisely the mixing D165 exists to prevent.
 */

describe('layer 2: a run named is a run created', () => {
	const budget = code('src', 'lib', 'server', 'ai-budget.ts');

	it('has a path that writes ai_budget_runs, not only paths that read it', () => {
		/*
		 * The whole defect in one assertion. Three readers and no writer is a
		 * table that is always empty, and every reader of an always-empty table
		 * silently takes its fallback.
		 */
		expect(
			budget,
			'nothing inserts into ai_budget_runs, so a named run can never exist'
		).toMatch(/INSERT INTO ai_budget_runs/);
	});

	it('reopens an existing run by name rather than starting a second', () => {
		// A resumed pass must draw on the allowance it has already been spending,
		// not open a fresh one and get the whole allowance again.
		expect(budget).toMatch(/const existing = await openRun\(db, name\);\s*\n?\s*if \(existing\) return existing;/);
	});

	it('refuses rather than carrying on if the run cannot be read back', () => {
		// Carrying on would charge the month while the response claimed a run.
		expect(budget).toMatch(/could not be started/);
	});

	it('defaults the allowance to the ruled backfill figure', () => {
		expect(budget).toMatch(/allowanceCents: number = AI_CEILINGS\.backfill_cents/);
	});
});

describe('layer 2: the response reports the run, not the request', () => {
	const email = code('src', 'lib', 'server', 'api', 'email.ts');

	it('creates the run before the pass names it', () => {
		expect(email).toMatch(/await openOrCreateRun\(c\.env\.DB, runName\)/);
	});

	it('returns the run that exists, not the string that was asked for', () => {
		/*
		 * The old response echoed `run: runName`, which was true about the request
		 * and false about what happened. An id means the spend was attributed; a
		 * null means the month paid.
		 */
		expect(email).not.toMatch(/run: runName,/);
		expect(email).toMatch(/run: run \? \{ id: run\.id, name: run\.name, allowance_cents: run\.allowance_cents \} : null/);
	});
});

describe('layer 2: the budget tables still line up', () => {
	it('has exactly one migration creating the run tables', () => {
		const migrations = readdirSync(join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql'));
		const creating = migrations.filter((f) =>
			readFileSync(join(ROOT, 'migrations', f), 'utf8').includes('CREATE TABLE ai_budget_runs')
		);
		expect(creating).toHaveLength(1);
	});

	it('keys attribution so one call cannot belong to two runs', () => {
		const schema = readFileSync(join(ROOT, 'migrations', '0031_ai_budget.sql'), 'utf8');
		const body = schema.split('CREATE TABLE ai_run_usage (')[1].split(');')[0];
		expect(body).toMatch(/usage_id TEXT PRIMARY KEY/);
	});
});
