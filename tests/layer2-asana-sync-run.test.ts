import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { syncFromAsana, CURSOR_KEY } from '../src/lib/server/asana-sync';

/**
 * The sync run itself, against the real schema.
 *
 * `planUpdate` is tested separately as a pure function. This exercises what is
 * left: the two passes, which links the sweep picks up, the cursor, and above
 * all D69 — that a task Asana no longer has leaves the item's status and its
 * gid exactly as they were.
 *
 * That last one is the reason this test exists rather than being folded into
 * the API tests. D69 is a promise about what does NOT happen, and the only way
 * to test a promise of that shape is to run the code that could break it and
 * then look at the row.
 *
 * Asana is stubbed. The alternative is a live token, which would make the suite
 * depend on a network, a secret and somebody's real task list.
 */

const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';

function openDb(): DatabaseSync {
	const file = readdirSync(DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	if (!file) throw new Error('Local D1 not found. Run `npm run seed:load` first.');
	return new DatabaseSync(join(DIR, file));
}

/**
 * The slice of the D1 interface this module uses, over node:sqlite.
 *
 * Deliberately small. A fuller fake would be a second implementation to keep
 * correct, and anything it got wrong would show up as a passing test.
 */
function d1(db: DatabaseSync) {
	return {
		prepare(sql: string) {
			let bound: unknown[] = [];
			const api = {
				bind(...args: unknown[]) {
					bound = args;
					return api;
				},
				async run() {
					const r = db.prepare(sql).run(...(bound as never[]));
					return { meta: { changes: Number(r.changes) } };
				},
				async all<T>() {
					return { results: db.prepare(sql).all(...(bound as never[])) as T[] };
				},
				async first<T>() {
					return (db.prepare(sql).get(...(bound as never[])) as T) ?? null;
				}
			};
			return api;
		}
	};
}

/** KV, as far as this module is concerned: one string in, one string out. */
function kv(initial: Record<string, string> = {}) {
	const store = new Map(Object.entries(initial));
	return {
		store,
		async get(key: string) {
			return store.get(key) ?? null;
		},
		async put(key: string, value: string) {
			store.set(key, value);
		}
	};
}

const SETTINGS = JSON.stringify({
	workspace_gid: 'ws-1',
	workspace_name: 'Test workspace',
	project_gid: null,
	project_name: null,
	assignee: 'me'
});

/** Canned Asana. `tasks` is what a poll returns; `byGid` is what a direct fetch finds. */
function stubAsana(tasks: unknown[], byGid: Record<string, unknown | null>) {
	return vi.fn(async (url: string) => {
		const path = String(url);
		if (path.includes('/tasks?')) {
			return new Response(JSON.stringify({ data: tasks }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
		const gid = path.split('/tasks/')[1]?.split('?')[0];
		const found = gid ? byGid[gid] : undefined;
		if (!found) {
			return new Response(JSON.stringify({ errors: [{ message: 'Not a task.' }] }), {
				status: 404,
				headers: { 'content-type': 'application/json' }
			});
		}
		return new Response(JSON.stringify({ data: found }), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	});
}

let db: DatabaseSync;

/**
 * Two linked items in a known state. One Asana still has, one it does not, and
 * both are stale enough that the sweep will look at them.
 *
 * Called by every test rather than once, because a sync writes
 * `asana_synced_at`. Sharing setup across these would mean the second test runs
 * against links the first one just refreshed, which is not stale any more and
 * so never reaches the sweep at all. That exact interdependence made a real
 * assertion here pass for the wrong reason.
 */
function seedLinked() {
	cleanup();
	const old = '2020-01-01T00:00:00.000Z';
	for (const [id, gid, title] of [
		['sync-live', 'gid-live', 'SYNC live item'],
		['sync-gone', 'gid-gone', 'SYNC vanished item']
	]) {
		db.prepare(
			`INSERT INTO action_items
         (id, title, status, source, owner, deadline, created_at, updated_at,
          asana_task_gid, asana_sync_state, asana_sync_note, asana_synced_at)
       VALUES (?, ?, 'open', 'manual', 'Paul', '2026-09-04', ?, ?, ?, 'ok', NULL, ?)`
		).run(id, title, old, old, gid, old);
	}
}

beforeAll(() => {
	db = openDb();
	cleanup();
});

function cleanup() {
	db.prepare(`DELETE FROM action_items WHERE id IN ('sync-live','sync-gone')`).run();
}

afterAll(() => {
	cleanup();
	db.close();
	vi.unstubAllGlobals();
});

describe('layer 2: a sync run', () => {
	it('pulls a completion, marks a vanished task ambiguous, and advances the cursor', async () => {
		seedLinked();
		const store = kv({ 'asana:settings': SETTINGS });
		const fetchStub = stubAsana(
			[
				{
					gid: 'gid-live',
					name: 'SYNC live item',
					completed: true,
					completed_at: '2026-08-29T18:00:00.000Z',
					due_on: '2026-09-04',
					modified_at: '2026-08-30T01:00:00.000Z',
					assignee: { name: 'Paul' }
				}
			],
			{ 'gid-live': null }
		);
		vi.stubGlobal('fetch', fetchStub);

		const outcome = await syncFromAsana(
			d1(db) as never,
			store as never,
			'test-token'
		);

		expect(outcome.matched).toBe(1);
		expect(outcome.updated).toBe(1);
		expect(outcome.ambiguous).toBe(1);

		const live = db
			.prepare(`SELECT status, asana_sync_state FROM action_items WHERE id = 'sync-live'`)
			.get() as { status: string; asana_sync_state: string };
		expect(live.status).toBe('done');
		expect(live.asana_sync_state).toBe('ok');

		// D69, the whole point. The task is gone from Asana and the item is
		// untouched apart from being labelled.
		const gone = db
			.prepare(
				`SELECT status, asana_task_gid, asana_sync_state, asana_sync_note
         FROM action_items WHERE id = 'sync-gone'`
			)
			.get() as {
			status: string;
			asana_task_gid: string;
			asana_sync_state: string;
			asana_sync_note: string;
		};
		expect(gone.status).toBe('open');
		expect(gone.asana_task_gid).toBe('gid-gone');
		expect(gone.asana_sync_state).toBe('ambiguous');
		expect(gone.asana_sync_note).toMatch(/no longer has/i);

		// The cursor moves only after a run that finished.
		expect(store.store.get(CURSOR_KEY)).toBeTruthy();
	});

	it('leaves the cursor where it was when the poll fails', async () => {
		seedLinked();
		const before = '2026-08-01T00:00:00.000Z';
		const store = kv({ 'asana:settings': SETTINGS, [CURSOR_KEY]: before });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 401 }))
		);

		await expect(
			syncFromAsana(d1(db) as never, store as never, 'dead-token')
		).rejects.toThrow();

		// A run that failed must not claim to have covered the window. Advancing
		// here would step silently over every change nobody saw.
		expect(store.store.get(CURSOR_KEY)).toBe(before);
	});

	it('does not mark anything ambiguous when the token is the problem', async () => {
		seedLinked();
		const store = kv({ 'asana:settings': SETTINGS, [CURSOR_KEY]: '2026-08-01T00:00:00.000Z' });
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) =>
				String(url).includes('/tasks?')
					? new Response(JSON.stringify({ data: [] }), { status: 200 })
					: new Response('{}', { status: 401 })
			)
		);

		await expect(
			syncFromAsana(d1(db) as never, store as never, 'dead-token')
		).rejects.toThrow();

		// One expired token must not brand every linked item as ambiguous. This
		// is why fetchTask returns null only on a 404 and throws on anything else.
		const marked = db
			.prepare(
				`SELECT COUNT(*) AS n FROM action_items
         WHERE id = 'sync-live' AND asana_sync_state = 'ambiguous'`
			)
			.get() as { n: number };
		expect(Number(marked.n)).toBe(0);
	});
});
