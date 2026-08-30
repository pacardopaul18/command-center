import { describe, expect, it, beforeAll, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Layer 4: the scheduled handler, folded in from the D56 and D57 work.
 *
 * These were previously one-off scripts run by hand, which is how the cron path
 * managed to be written, reviewed and deployed across two sessions without ever
 * executing. Being in the suite is the point: the branch that only runs at
 * 03:00 Mountain gets exercised on every run.
 *
 * The handler is imported from the built bundle rather than from source,
 * because the bundle is what Cloudflare runs and `scripts/wrap-worker.js`
 * stitches it together after the adapter. Testing the source would skip the one
 * step most likely to be wrong.
 */

const BUNDLE = resolve('.svelte-kit/cloudflare/_scheduled.js');
const CRON = '0 0,9,10,13,14,23 * * *';

let handleScheduled: (
	event: { scheduledTime: number; cron: string },
	env: unknown
) => Promise<void>;

beforeAll(async () => {
	if (!existsSync(BUNDLE)) {
		throw new Error('Built bundle missing. Run `npm run build` before the suite.');
	}
	({ handleScheduled } = await import(pathToFileURL(BUNDLE).href));
});

/** A database shaped like the real one, enough for a dump to succeed. */
function stubEnv(overrides: Record<string, unknown> = {}) {
	const master = [
		{ type: 'table', name: 'clients', tbl_name: 'clients', sql: 'CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT)' },
		{ type: 'table', name: 'projects', tbl_name: 'projects', sql: 'CREATE TABLE projects (id TEXT PRIMARY KEY, client_id TEXT REFERENCES clients(id), name TEXT)' },
		{ type: 'table', name: '_cf_METADATA', tbl_name: '_cf_METADATA', sql: 'CREATE TABLE _cf_METADATA (k INTEGER)' },
		{ type: 'index', name: 'idx_p', tbl_name: 'projects', sql: 'CREATE INDEX idx_p ON projects (client_id)' },
		{ type: 'trigger', name: 'trg_p', tbl_name: 'projects', sql: "CREATE TRIGGER trg_p BEFORE DELETE ON projects BEGIN SELECT RAISE(ABORT,'no'); END" }
	];
	const data: Record<string, unknown[]> = {
		clients: [{ id: 'c1', name: "O'Brien & Co" }],
		projects: [{ id: 'p1', client_id: 'c1', name: 'Launch' }]
	};
	const store: { key?: string; body?: string } = {};
	const deleted: string[] = [];

	return {
		env: {
			DB: {
				prepare(q: string) {
					return {
						bind() {
							return this;
						},
						async all() {
							if (q.includes('sqlite_master')) return { results: master };
							const t = q.match(/FROM "([^"]+)"/)?.[1] ?? '';
							return { results: data[t] ?? [] };
						},
						async first() {
							return null;
						}
					};
				}
			},
			SESSIONS: { get: async () => null, put: async () => {} },
			FILES: {
				put: async (k: string, body: string) => {
					store.key = k;
					store.body = body;
				},
				list: async () => ({
					objects: [{ key: 'backups/d1/2020-01-01.sql' }, { key: 'backups/d1/keepme.txt' }]
				}),
				delete: async (k: string) => {
					deleted.push(k);
				}
			},
			...overrides
		},
		store,
		deleted
	};
}

async function run(env: unknown, whenUtc: Date) {
	const logs: string[] = [];
	const log = vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.join(' ')));
	const err = vi.spyOn(console, 'error').mockImplementation((...a) => void logs.push('ERROR ' + a.join(' ')));
	let threw: unknown = null;
	try {
		await handleScheduled({ scheduledTime: whenUtc.getTime(), cron: CRON }, env);
	} catch (e) {
		threw = e;
	}
	log.mockRestore();
	err.mockRestore();
	return { logs, threw, text: logs.join('\n') };
}

const utc = (y: number, m: number, d: number, h: number) => new Date(Date.UTC(y, m, d, h, 0, 0));

/**
 * The wording changed from "nothing due" to "no digest due" when mail work
 * started riding these firings. A firing with no digest is no longer a firing
 * that does nothing: it is where the mail backlog gets worked, because nothing
 * else is competing for the invocation's budget.
 */
describe('layer 4: the schedule routes correctly in summer, MDT', () => {
	const cases: [number, RegExp][] = [
		[0, /no digest due/],
		[9, /nightly backup due/],
		[10, /no digest due/],
		[13, /morning digest due/],
		[14, /no digest due/],
		[23, /evening digest due/]
	];

	for (const [hour, want] of cases) {
		it(`${String(hour).padStart(2, '0')}:00Z matches ${want}`, async () => {
			const { env } = stubEnv();
			const { text } = await run(env, utc(2026, 7, 29, hour));
			expect(text).toMatch(want);
		});
	}
});

describe('layer 4: the schedule routes correctly in winter, MST', () => {
	const cases: [number, RegExp][] = [
		[0, /evening digest due/],
		[9, /no digest due/],
		[10, /nightly backup due/],
		[13, /no digest due/],
		[14, /morning digest due/],
		[23, /no digest due/]
	];

	for (const [hour, want] of cases) {
		it(`${String(hour).padStart(2, '0')}:00Z matches ${want}`, async () => {
			const { env } = stubEnv();
			const { text } = await run(env, utc(2026, 0, 15, hour));
			expect(text).toMatch(want);
		});
	}
});

describe('layer 4: exactly one of each job per Mountain day', () => {
	for (const [label, month, dayOfMonth] of [
		['summer', 7, 29],
		['winter', 0, 15]
	] as const) {
		it(`${label} fires one backup, one morning, one evening`, async () => {
			const seen = { backup: 0, morning: 0, evening: 0, noop: 0 };
			for (const hour of [0, 9, 10, 13, 14, 23]) {
				const { env } = stubEnv();
				const { text } = await run(env, utc(2026, month, dayOfMonth, hour));
				if (/nightly backup due/.test(text)) seen.backup++;
				else if (/morning digest due/.test(text)) seen.morning++;
				else if (/evening digest due/.test(text)) seen.evening++;
				else seen.noop++;
			}
			expect(seen).toEqual({ backup: 1, morning: 1, evening: 1, noop: 3 });
		});
	}
});

describe('layer 4: the backup branch', () => {
	it('writes a dump keyed to the Mountain day and prunes only dated keys', async () => {
		const { env, store, deleted } = stubEnv();
		const { text, threw } = await run(env, utc(2026, 7, 29, 9));

		expect(threw).toBeNull();
		expect(store.key).toMatch(/^backups\/d1\/\d{4}-\d{2}-\d{2}\.sql$/);
		expect(text).toMatch(/backup wrote/);
		expect(deleted).toEqual(['backups/d1/2020-01-01.sql']);
	});

	it('orders parents before children, so a restore does not break on foreign keys', async () => {
		const { env, store } = stubEnv();
		await run(env, utc(2026, 7, 29, 9));
		const body = store.body ?? '';
		expect(body.indexOf('INSERT INTO "clients"')).toBeLessThan(body.indexOf('INSERT INTO "projects"'));
	});

	it('installs triggers after the data, or a restore rejects its own rows', async () => {
		const { env, store } = stubEnv();
		await run(env, utc(2026, 7, 29, 9));
		const body = store.body ?? '';
		expect(body.indexOf('INSERT INTO "projects"')).toBeLessThan(body.indexOf('CREATE TRIGGER'));
	});

	it('excludes Cloudflare internals', async () => {
		const { env, store } = stubEnv();
		await run(env, utc(2026, 7, 29, 9));
		expect(store.body).not.toContain('_cf_METADATA');
	});

	it('escapes quotes in the data', async () => {
		const { env, store } = stubEnv();
		await run(env, utc(2026, 7, 29, 9));
		expect(store.body).toContain("'O''Brien & Co'");
	});

	it('refuses to write an empty backup, and fails the invocation when it does', async () => {
		const base = stubEnv();
		const env = {
			...base.env,
			DB: {
				prepare: () => ({
					bind() {
						return this;
					},
					async all() {
						return { results: [] };
					},
					async first() {
						return null;
					}
				})
			}
		};
		const { text, threw } = await run(env, utc(2026, 7, 29, 9));
		expect(threw).toBeTruthy();
		expect(text).toMatch(/backup threw/);
		expect(base.store.key).toBeUndefined();
	});

	it('rethrows a database fault so the firing records as failed', async () => {
		const base = stubEnv();
		const env = {
			...base.env,
			DB: {
				prepare: () => {
					throw new Error('D1_ERROR: connection lost');
				}
			}
		};
		const { text, threw } = await run(env, utc(2026, 7, 29, 9));
		expect(threw).toBeTruthy();
		expect(text).toMatch(/D1_ERROR/);
	});
});

describe('layer 4: the digest branch', () => {
	it('reaches runDigest and reports the outcome', async () => {
		const { env } = stubEnv();
		const { text } = await run(env, utc(2026, 7, 29, 13));
		expect(text).toMatch(/morning digest due, sending/);
		expect(text).toMatch(/morning digest (sent|skipped_no_key|failed)/);
	});

	it('skips cleanly with no Resend key rather than throwing', async () => {
		const { env } = stubEnv();
		const { threw, text } = await run(env, utc(2026, 7, 29, 13));
		expect(threw).toBeNull();
		expect(text).toMatch(/skipped_no_key/);
	});

	it('every firing logs, including the ones that do nothing', async () => {
		for (const hour of [0, 9, 10, 13, 14, 23]) {
			const { env } = stubEnv();
			const { logs } = await run(env, utc(2026, 7, 29, hour));
			expect(logs.length, `hour ${hour} logged nothing`).toBeGreaterThan(0);
		}
	});

	it('does not use waitUntil, so the firing owns its own outcome', async () => {
		const { env } = stubEnv();
		let used = false;
		await run({ ...env, waitUntil: () => (used = true) }, utc(2026, 7, 29, 13));
		expect(used).toBe(false);
	});
});
