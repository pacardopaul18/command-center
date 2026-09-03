import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spendDeltaSentence, type SpendDelta } from '../src/lib/server/spend-delta';

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:5173';
const ROOT = process.cwd();
const P = 'tp-delta-';

/**
 * A figure known to be wrong says so where it is read.
 *
 * D226 found the double-write, quantified it, and left the rows in place, which
 * was right. It recorded the correction only in the decision log, which was
 * not: the meter went on rendering a number known to be high as though it were
 * right, which is the failure D214 exists to prevent. Being correct in a
 * document does not fix a screen.
 */

function localD1Path(): string {
	const dir = join('.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
	const files = readdirSync(dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	return join(dir, files[0]);
}

/*
 * The fixture has two connected accounts, so this route insists on being told
 * which. The delta is about ai_usage, which is not per account, but the route
 * refuses before it gets there. Resolved once here rather than in each test.
 */
let account = '';

async function api(path: string) {
	const sep = path.includes('?') ? '&' : '?';
	const res = await fetch(`${BASE}${path}${account ? sep + 'account=' + account : ''}`);
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
	const conn = new DatabaseSync(localD1Path());
	try {
		conn.prepare(`DELETE FROM ai_usage WHERE id LIKE '${P}%'`).run();
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

	const conns = await api('/api/connections');
	const first = (conns.json?.accounts ?? [])[0];
	if (first?.id) account = first.id;
});

afterAll(() => sweep());

describe('layer 2: the sentence is built from the rows, not written down', () => {
	it('says nothing at all when nothing is wrong', () => {
		// The fixture has no duplicates, so the screen must be silent rather than
		// reassuring. A permanent "no known errors" banner is noise.
		expect(spendDeltaSentence(null)).toBe(null);
		expect(spendDeltaSentence(null, 1234)).toBe(null);
	});

	it('states the count, the amount and the date it stopped', () => {
		const delta: SpendDelta = {
			rows: 6,
			cents: 7.4908,
			first_at: '2026-09-02T14:21:29Z',
			last_at: '2026-09-03T20:43:37Z'
		};
		const sentence = spendDeltaSentence(delta) ?? '';
		expect(sentence).toContain('6');
		expect(sentence).toContain('$0.0749');
		// The date matters: a known error with no end reads as an ongoing one.
		expect(sentence).toContain('2026-09-03');
		expect(sentence).toMatch(/no more can be added/);
		// And why the rows are still there, so nobody deletes them to tidy up.
		expect(sentence).toMatch(/should not be edited by the thing that got it wrong/);
	});

	it('carries no hardcoded figure anywhere in the module', () => {
		/*
		 * The whole point. HANDOFF_04's spend table had real values and recalled
		 * captions, and read as fully evidenced because the hard part visibly was.
		 * A constant six here would reproduce that failure inside the fix for it.
		 */
		const src = readFileSync(join(ROOT, 'src', 'lib', 'server', 'spend-delta.ts'), 'utf8')
			.replace(/\/\*[\s\S]*?\*\//g, ' ')
			.replace(/(^|[^:])\/\/.*$/gm, '$1');
		expect(src).not.toContain('0.0749');
		expect(src).not.toMatch(/rows: 6\b/);
		expect(src).not.toMatch(/cents: 7\./);
	});
});

describe('layer 2: the route reports it, and detects it rather than recalling it', () => {
	it('finds a duplicate pair that was not there before', async () => {
		/*
		 * Written into the fixture on purpose, then read back through the route.
		 * A detector tested only against a database that already has the answer
		 * is a detector nobody has seen work.
		 */
		const before = await api('/api/email/summarise');
		expect(before.json.known_delta, 'the fixture should start clean').toBe(null);

		const conn = new DatabaseSync(localD1Path());
		try {
			const insert = conn.prepare(
				`INSERT INTO ai_usage (id, kind, model, input_tokens, output_tokens, thread_id, connection_id, at)
         VALUES (?, 'summary', 'claude-haiku-4-5-20251001', 2000, 200, NULL, NULL, ?)`
			);
			insert.run(`${P}first`, '2026-09-02T10:00:00Z');
			insert.run(`${P}twin`, '2026-09-02T10:00:01Z');
		} finally {
			conn.close();
		}

		const after = await api('/api/email/summarise');
		expect(after.json.known_delta, 'the duplicate was not detected').toBeTruthy();
		expect(after.json.known_delta.rows).toBe(1);
		// 2000 in at $1/M plus 200 out at $5/M is $0.003, which is 0.3 cents.
		expect(after.json.known_delta.cents).toBeCloseTo(0.3, 5);
		expect(after.json.known_delta_note).toContain('$0.0030');
	});

	it('does not call two genuinely different calls a duplicate', async () => {
		// Same model, different tokens, and far apart. Nothing to correct.
		const conn = new DatabaseSync(localD1Path());
		try {
			conn
				.prepare(
					`INSERT INTO ai_usage (id, kind, model, input_tokens, output_tokens, thread_id, connection_id, at)
           VALUES (?, 'summary', 'claude-haiku-4-5-20251001', 999, 111, NULL, NULL, '2026-09-02T11:00:00Z')`
				)
				.run(`${P}alone`);
		} finally {
			conn.close();
		}
		const after = await api('/api/email/summarise');
		expect(after.json.known_delta.rows, 'a lone call was counted as a duplicate').toBe(1);
	});

	it('stops at the date the second writer was removed', () => {
		/*
		 * A detector with no upper bound would report any future coincidence as a
		 * known error, turning a closed correction into a permanent alarm. The
		 * bound is what makes it safe to leave on.
		 */
		const src = readFileSync(join(ROOT, 'src', 'lib', 'server', 'spend-delta.ts'), 'utf8');
		expect(src).toMatch(/DOUBLE_WRITE_FIXED_AT/);
		expect(src).toMatch(/WHERE u\.at < \?/);
	});
});
