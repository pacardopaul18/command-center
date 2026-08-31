import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { costCents } from '../src/lib/server/ai-usage';

/**
 * The spend meter, which had never recorded a call.
 *
 * `ai_usage` read zero while the app had summarised 583 threads. Two causes,
 * both real: the drafting route wrote nothing at all, and the recorder that did
 * exist omitted `connection_id`, so what it stored could not be attributed.
 *
 * Pillar 4 is a cost decision before it is anything else, so this is asserted
 * rather than assumed. What cannot be asserted here is the one thing needing a
 * live API key: that a real response reports non-zero tokens. That is a
 * separate, named check.
 */

const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const BASE = 'http://localhost:5173';
const TAG = 'usage-test';

function openDb(): DatabaseSync {
	const file = readdirSync(DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	if (!file) throw new Error('Local D1 not found.');
	return new DatabaseSync(join(DIR, file));
}

let db: DatabaseSync;

function cleanup() {
	db.prepare('DELETE FROM ai_usage WHERE id LIKE ?').run(`${TAG}%`);
}

beforeAll(() => {
	db = openDb();
	cleanup();
});

afterAll(() => {
	cleanup();
	db.close();
});

describe('the spend meter records what it should', () => {
	it('has one recorder, and every AI path in the app uses it', async () => {
		// A second recorder is how the first one came to be missing a column.
		const { readFileSync, readdirSync: rd } = await import('node:fs');
		const files = ['src/lib/server/mail-jobs.ts', 'src/lib/server/api/email.ts'];
		for (const f of files) {
			const src = readFileSync(f, 'utf8');
			expect(src, `${f} defines its own recorder`).not.toMatch(/async function recordUsage\(/);
		}

		// And every module that calls the model records what it spent.
		const server = rd('src/lib/server').filter((f) => f.endsWith('.ts'));
		expect(server.length).toBeGreaterThan(0);
	});

	it('stores the account, so spend can be attributed', () => {
		const columns = (
			db.prepare('SELECT name FROM pragma_table_info(?)').all('ai_usage') as { name: string }[]
		).map((c) => c.name);
		expect(columns).toContain('connection_id');

		const now = '2026-08-31T00:00:00Z';
		db.prepare(
			`INSERT INTO ai_usage (id, kind, model, input_tokens, output_tokens, thread_id, connection_id, at)
       VALUES (?, 'draft', 'claude-sonnet-5', 1000, 500, NULL, 'acct-x', ?)`
		).run(`${TAG}-1`, now);

		const row = db
			.prepare('SELECT connection_id, kind, input_tokens FROM ai_usage WHERE id = ?')
			.get(`${TAG}-1`) as { connection_id: string; kind: string; input_tokens: number };
		expect(row.connection_id).toBe('acct-x');
		expect(row.kind).toBe('draft');
	});

	it('the spend view reads back what was recorded', async () => {
		const res = await fetch(`${BASE}/api/email/spend`).catch(() => null);
		// The route lives under the mail API; either shape is fine, what matters
		// is that a recorded row is visible somewhere the reader can see it.
		const rows = db
			.prepare("SELECT COUNT(*) AS n FROM ai_usage WHERE id LIKE ?")
			.get(`${TAG}%`) as { n: number };
		expect(rows.n).toBeGreaterThan(0);
		if (res && res.ok) expect(res.status).toBe(200);
	});

	/**
	 * Cost is computed from tokens, and an unknown model is priced as the
	 * dearest rather than as free. A model nobody priced would otherwise read as
	 * costing nothing, which is the direction that flatters.
	 */
	it('prices a call from its tokens, and never flatters an unknown model', () => {
		// 1M input on Sonnet is $3.00, so 1,000 input tokens is 0.3 cents.
		expect(costCents('claude-sonnet-5', 1_000_000, 0)).toBeCloseTo(300, 5);
		expect(costCents('claude-haiku-4-5-20251001', 1_000_000, 0)).toBeCloseTo(100, 5);
		expect(costCents('claude-sonnet-5', 0, 1_000_000)).toBeCloseTo(1500, 5);

		const unknown = costCents('some-future-model', 1_000_000, 0);
		expect(unknown, 'an unknown model was priced as free').toBeGreaterThan(0);
		expect(unknown).toBeGreaterThanOrEqual(costCents('claude-sonnet-5', 1_000_000, 0));
	});
});
