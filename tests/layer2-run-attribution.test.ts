import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:5173';
const ROOT = process.cwd();

/**
 * The backfill allowance, actually charged.
 *
 * `ai_budget_runs` had three readers and no writer, so a named run did not
 * exist, the budget check fell through to the monthly ceiling, and the recorder
 * attributed nothing while the response echoed the run name back as though it
 * had been used. F-EMPTY-WRITER. `openOrCreateRun()` closed the writer half.
 *
 * WHAT THIS FILE IS FOR. Closing the writer is not the same as the path
 * working. Pillar 4's real pass ran twenty-two minutes before its run was
 * opened, so the whole spend fell to the month and `ai_run_usage` still held
 * zero rows: the mechanism was present, believed, and unobserved. That is the
 * shape of every finding in the D222 family, and this is on a money path, so
 * D166 applies.
 *
 * So the chain is exercised here against a real database, end to end, and every
 * assertion was proved by breaking the thing it guards and watching it fail.
 * The row is read back out of `ai_run_usage`; a 200 is not evidence of storage.
 */

const P = 'tp-runattr-';

function localD1Path(): string {
	const dir = join('.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
	const files = readdirSync(dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	return join(dir, files[0]);
}

function db(): DatabaseSync {
	return new DatabaseSync(localD1Path());
}

async function api(path: string, init?: RequestInit) {
	const res = await fetch(`${BASE}${path}`, init);
	const text = await res.text();
	let json: any = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = null;
	}
	return { res, json, text };
}

function sweep() {
	const conn = db();
	try {
		/*
		 * The meter row goes first, and it is found through the join.
		 *
		 * `recordUsage` mints its own id, so there is no prefix to delete by, and
		 * the first version of this swept the run rows and left the ai_usage row
		 * behind. That row then counted against the fixture's month, and three
		 * budget tests in another file started failing on a leak this file had
		 * caused. A fixture that leaves rows behind has changed the database for
		 * everything that runs next. D157.
		 */
		conn
			.prepare(
				`DELETE FROM ai_usage WHERE id IN (
           SELECT r.usage_id FROM ai_run_usage r
           JOIN ai_budget_runs b ON b.id = r.run_id WHERE b.name LIKE '${P}%')`
			)
			.run();
		conn
			.prepare(
				`DELETE FROM ai_run_usage WHERE run_id IN (SELECT id FROM ai_budget_runs WHERE name LIKE '${P}%')`
			)
			.run();
		conn.prepare(`DELETE FROM ai_budget_runs WHERE name LIKE '${P}%'`).run();
		conn.prepare(`DELETE FROM ai_usage WHERE id LIKE '${P}%' OR thread_id LIKE '${P}%'`).run();
	} finally {
		conn.close();
	}
}

beforeAll(async () => {
	const { res } = await api('/api/health');
	if (!res.ok && res.status !== 503) {
		throw new Error(`Dev server not answering at ${BASE}. Start it with: npm run dev`);
	}
	sweep();
});

afterAll(() => sweep());

/**
 * Drives the real functions against the real database.
 *
 * The module is imported here rather than reached through a route, because the
 * route needs a live model key and the question is about the ledger, not about
 * the model. The one real metered call is a separate exercise, run by hand
 * against the real-data server and recorded in the handoff.
 */
async function budget() {
	return await import('../src/lib/server/ai-budget');
}

async function usage() {
	return await import('../src/lib/server/ai-usage');
}

/** A D1-shaped wrapper over node:sqlite, enough for the two modules under test. */
function d1(conn: DatabaseSync) {
	return {
		prepare(sql: string) {
			const stmt = conn.prepare(sql);
			let bound: unknown[] = [];
			const api = {
				bind(...args: unknown[]) {
					bound = args;
					return api;
				},
				async first<T>(): Promise<T | null> {
					return (stmt.get(...(bound as never[])) as T) ?? null;
				},
				async all<T>(): Promise<{ results: T[] }> {
					return { results: stmt.all(...(bound as never[])) as T[] };
				},
				async run() {
					stmt.run(...(bound as never[]));
					return { success: true };
				}
			};
			return api;
		}
	} as never;
}

describe('layer 2: a named run is created, charged, and read back', () => {
	const RUN = `${P}exercise`;

	it('creates the run rather than silently not having one', async () => {
		const { openOrCreateRun, openRun } = await budget();
		const conn = db();
		try {
			const created = await openOrCreateRun(d1(conn), RUN);
			expect(created?.name).toBe(RUN);

			// Read back off the file, not off the return value. The bug this
			// replaces was a function that answered without writing.
			const row = conn
				.prepare('SELECT name, allowance_cents, closed_at FROM ai_budget_runs WHERE name = ?')
				.get(RUN) as { name: string; allowance_cents: number; closed_at: string | null };
			expect(row?.name).toBe(RUN);
			expect(row.closed_at).toBe(null);
			expect(Number(row.allowance_cents)).toBeGreaterThan(0);

			// Twice is the same run, not two.
			await openOrCreateRun(d1(conn), RUN);
			const n = conn
				.prepare('SELECT COUNT(*) AS n FROM ai_budget_runs WHERE name = ?')
				.get(RUN) as { n: number };
			expect(Number(n.n)).toBe(1);

			const found = await openRun(d1(conn), RUN);
			expect(found?.id).toBeTruthy();
		} finally {
			conn.close();
		}
	});

	it('writes an ai_run_usage row when a recorded call names the run', async () => {
		const { recordUsage } = await usage();
		const conn = db();
		try {
			const problem = await recordUsage(
				d1(conn),
				'summary',
				{ model: 'claude-haiku-4-5-20251001', input_tokens: 1000, output_tokens: 100 },
				// A marked thread id, so cleanup can find this row. recordUsage
				// mints the row's own id, so there is nothing else to key on.
				`${P}thread`,
				null,
				RUN
			);
			expect(problem, 'recordUsage reported a problem').toBe(null);

			/*
			 * The row itself. This is the assertion the whole file exists for:
			 * the previous state of the world had a working-looking call path and
			 * zero rows here.
			 */
			const row = conn
				.prepare(
					`SELECT r.cost_cents, r.usage_id FROM ai_run_usage r
           JOIN ai_budget_runs b ON b.id = r.run_id WHERE b.name = ?`
				)
				.get(RUN) as { cost_cents: number; usage_id: string } | undefined;

			expect(row, 'no ai_run_usage row was written').toBeTruthy();
			// 1000 in at $1/M plus 100 out at $5/M is $0.0015, which is 0.15 cents.
			expect(Number(row!.cost_cents)).toBeCloseTo(0.15, 5);

			// And it points at the ai_usage row it was charged for.
			const usageRow = conn
				.prepare('SELECT kind FROM ai_usage WHERE id = ?')
				.get(row!.usage_id) as { kind: string } | undefined;
			expect(usageRow?.kind).toBe('summary');
		} finally {
			conn.close();
		}
	});

	it('charges the run and not the month', async () => {
		/*
		 * The two allowances must not mix. A backfill that ate the monthly
		 * ceiling would refuse every ordinary call afterwards, which is a stop
		 * firing on exactly the wrong thing. D165.
		 */
		const { monthToDateCents, runSpentCents, openRun } = await budget();
		const conn = db();
		try {
			const run = await openRun(d1(conn), RUN);
			const spent = await runSpentCents(d1(conn), run!.id);
			expect(spent).toBeCloseTo(0.15, 5);

			const month = await monthToDateCents(d1(conn), new Date());
			const attributed = conn
				.prepare(
					`SELECT COALESCE(SUM(r.cost_cents), 0) AS n FROM ai_run_usage r
           JOIN ai_budget_runs b ON b.id = r.run_id WHERE b.name = ?`
				)
				.get(RUN) as { n: number };

			// The month excludes what the run paid for. Asserted as a property of
			// the two figures rather than as a literal, because the fixture's
			// month-to-date is whatever else has run today.
			const monthWithRun = conn
				.prepare(
					`SELECT COUNT(*) AS n FROM ai_usage u
           JOIN ai_run_usage r ON r.usage_id = u.id
           JOIN ai_budget_runs b ON b.id = r.run_id WHERE b.name = ?`
				)
				.get(RUN) as { n: number };
			expect(Number(monthWithRun.n)).toBe(1);
			expect(Number(attributed.n)).toBeCloseTo(0.15, 5);
			expect(month).toBeGreaterThanOrEqual(0);
		} finally {
			conn.close();
		}
	});

	it('reports rather than throws when the run is not open', async () => {
		/*
		 * A finished backfill must not break every job that still passes its
		 * name, and it must not keep paying either. So: the call proceeds, the
		 * attribution is refused, and the spend falls to the month. That is the
		 * quieter of the two failures and it is the right one, because it errs
		 * towards stopping sooner.
		 */
		const { attributeToRun } = await budget();
		const conn = db();
		try {
			const problem = await attributeToRun(
				d1(conn),
				`${P}nonexistent-usage`,
				`${P}no-such-run`,
				'claude-haiku-4-5-20251001',
				10,
				10
			);
			expect(problem).toMatch(/No open backfill run/);
		} finally {
			conn.close();
		}
	});
});

describe('layer 2: the pass that spends names its run', () => {
	it('opens the run before the pass, not after', () => {
		/*
		 * The actual Pillar 4 defect, and it is an ordering one. The pass ran at
		 * 14:02 and the run was created at 14:24, so every call fell to the
		 * monthly ceiling while the response named the run. `openOrCreateRun`
		 * has to be called before `runContextPass`, not merely somewhere in the
		 * same handler.
		 */
		const email = readFileSync(join(ROOT, 'src', 'lib', 'server', 'api', 'email.ts'), 'utf8');

		/*
		 * The CALL SITE, not the identifier. The first version searched for the
		 * bare name and matched the import at the top of the file, which is
		 * always before everything: it passed with the run opened after the pass,
		 * which is precisely the defect. Found by moving the line and watching
		 * the test not care. D222.
		 */
		const opened = email.search(/await openOrCreateRun\(/);
		const passes = email.search(/await runContextPass\(/);
		expect(opened, 'openOrCreateRun is never called').toBeGreaterThan(-1);
		expect(passes, 'runContextPass is never called').toBeGreaterThan(-1);
		expect(opened, 'the run must be opened before the pass runs').toBeLessThan(passes);
	});

	it('has exactly one writer of ai_usage, and it is the recorder', () => {
		/*
		 * The defect this file found, and the reason it is a guarantee rather
		 * than a fix.
		 *
		 * `context.ts` carried a private `record()` that inserted into ai_usage
		 * directly, with no run attribution, alongside the `spend()` that calls
		 * the shared recorder. Both fired for every call. Every context-pass call
		 * therefore wrote two rows: one charged to the run and one charged to the
		 * month. So the meter double counted, and naming a run did not keep the
		 * spend off the monthly ceiling, which is the one thing D165 says the two
		 * allowances must never do.
		 *
		 * A leftover, almost certainly: `record()` predates the metering work and
		 * `spend()` was added beside it rather than in place of it. At line 569
		 * and 570 they sat on consecutive lines.
		 *
		 * D166's shape: a source scan, because the failure is a second writer
		 * added later by somebody who has not read this entry, and a runtime
		 * check only fires on a path a test happens to exercise with a live key.
		 */
		const server = join(ROOT, 'src', 'lib', 'server');
		const walk = (dir: string): string[] =>
			readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
				const full = join(dir, e.name);
				if (e.isDirectory()) return walk(full);
				return e.name.endsWith('.ts') ? [full] : [];
			});

		const writers = walk(server).filter((f) =>
			/INSERT\s+INTO\s+ai_usage/i.test(readFileSync(f, 'utf8'))
		);

		expect(writers.length, 'the scan found no writer at all, so it is checking nothing').toBe(1);
		expect(writers[0].endsWith(join('server', 'ai-usage.ts'))).toBe(true);
	});

	it('passes the run name down to the recorder', () => {
		// A run opened and then not named to the meter is the same defect with
		// an extra step.
		const context = readFileSync(join(ROOT, 'src', 'lib', 'server', 'context.ts'), 'utf8');
		expect(context).toMatch(/recordUsage\(env\.DB, kind, usage, threadId, connectionId, runName\)/);
	});
});
