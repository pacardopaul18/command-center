import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The context pass runner, exercised with the model stubbed.
 *
 * The pass has never executed. It runs for the first time tomorrow against
 * Paul's real mail and a shared spend cap, which is the worst moment to
 * discover that the orchestration is wrong: a bad prompt costs one call, a bad
 * loop costs all of them.
 *
 * So everything except the model's words is proved here. Which threads it
 * reaches for, that it does not redo work when nothing changed, that it stops
 * at its call ceiling, that a transient failure leaves rows untouched, that a
 * permanent one is skipped rather than retried forever, and that every call is
 * attributed to the account that paid for it.
 *
 * This is the same approach the Asana sync used, and for the same reason: an AI
 * pass is mostly not AI, and the not-AI part is testable today.
 */

const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const ACC = 'run-a';
const NOW = '2026-08-31T00:00:00Z';

function openDb(): DatabaseSync {
	const file = readdirSync(DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	if (!file) throw new Error('Local D1 not found.');
	return new DatabaseSync(join(DIR, file));
}

let db: DatabaseSync;

function d1(database: DatabaseSync) {
	return {
		prepare(sql: string) {
			let bound: unknown[] = [];
			const api = {
				bind(...args: unknown[]) {
					bound = args;
					return api;
				},
				async run() {
					const r = database.prepare(sql).run(...(bound as never[]));
					return { meta: { changes: Number(r.changes) } };
				},
				async all<T>() {
					return { results: database.prepare(sql).all(...(bound as never[])) as T[] };
				},
				async first<T>() {
					return (database.prepare(sql).get(...(bound as never[])) as T) ?? null;
				}
			};
			return api;
		}
	};
}

/**
 * R2 with a body for every key.
 *
 * Deliberately long enough to clear the runner's minimum. The first version of
 * this stub returned about fifty characters and the voice pass skipped every
 * time, which looked like a runner bug and was the runner being right: it
 * refuses to learn how somebody writes from a one-line reply. That refusal is
 * asserted separately below rather than being lost to a longer fixture.
 */
const LONG_BODY =
	'Hi there, thanks for sending this across. I have read through the scope note ' +
	'and it looks broadly right to me. There are two things I would want to firm up ' +
	'before we commit to the dates, and I will come back to you on both by the end ' +
	'of the week. Happy to jump on a call if that is easier.';

const files = {
	async get(key: string) {
		return { async text() { return `${LONG_BODY} (${key})`; } };
	}
};

/** R2 that returns only very short bodies, for the refusal case. */
const shortFiles = {
	async get() {
		return { async text() { return 'ok'; } };
	}
};

const usage = { model: 'stub-model', input_tokens: 100, output_tokens: 20 };

/** Counts calls so the ceiling and the no-rework rule can be asserted. */
const calls = { digest: 0, commitments: 0, profile: 0, voice: 0 };

class StubAiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

let digestBehaviour: 'ok' | 'transient' | 'permanent' = 'ok';

vi.mock('../src/lib/server/ai', async () => {
	return {
		AiError: class AiError extends Error {
			status: number;
			constructor(status: number, message: string) {
				super(message);
				this.status = status;
			}
		},
		buildVoiceProfile: async () => {
			calls.voice += 1;
			return {
				voice: {
					greetings: 'Hi [name],',
					sign_offs: 'Thanks,',
					sentence_length: 'short, 12 words',
					formality: 'plain',
					recurring_phrases: 'happy to',
					notes: 'no em dashes'
				},
				model: 'stub-model',
				usage
			};
		},
		buildThreadDigest: async () => {
			calls.digest += 1;
			const mod = await import('../src/lib/server/ai');
			if (digestBehaviour === 'transient') throw new (mod as never as { AiError: typeof StubAiError }).AiError(429, 'rate limited');
			if (digestBehaviour === 'permanent') throw new (mod as never as { AiError: typeof StubAiError }).AiError(400, 'bad thread');
			return {
				digest: {
					summary: 'A summary.',
					decisions: 'none',
					open_asks: 'none',
					paul_commitments: 'none',
					next_move: 'paul' as const
				},
				model: 'stub-model',
				usage
			};
		},
		extractCommitments: async () => {
			calls.commitments += 1;
			return {
				commitments: [
					{ owed_by: 'paul' as const, owed_to: 'someone', what: 'send the note', due_signal: '' }
				],
				model: 'stub-model',
				usage
			};
		},
		buildContactProfile: async () => {
			calls.profile += 1;
			return {
				profile: {
					relationship: 'a client contact',
					usual_topics: 'scope',
					expected_tone: 'plain',
					open_commitments: 'none'
				},
				model: 'stub-model',
				usage
			};
		}
	};
});

let run: typeof import('../src/lib/server/context')['runContextPass'];
let seed: typeof import('../src/lib/server/context')['seedContacts'];

function build(threadCount: number) {
	cleanup();
	db.prepare(
		`INSERT INTO connections (id, provider, account_email, status, created_at, updated_at)
     VALUES (?, 'google', ?, 'connected', ?, ?)`
	).run(ACC, 'run-a@runner.test', NOW, NOW);

	for (let i = 0; i < threadCount; i++) {
		const tid = `run-t${i}`;
		db.prepare(
			`INSERT INTO email_threads
         (id, connection_id, provider_thread_id, subject, message_count, first_at, last_at,
          category, severity, created_at, updated_at)
       VALUES (?, ?, ?, ?, 2, ?, ?, 'correspondence', 'important', ?, ?)`
		).run(tid, ACC, `${tid}-pt`, `Subject ${i}`, NOW, NOW, NOW, NOW);

		// One from a correspondent, one from Paul, so the reply signal exists.
		db.prepare(
			`INSERT INTO email_messages
         (id, connection_id, thread_id, provider_message_id, provider_thread_id,
          from_email, sent_at, body_key, body_bytes, body_format, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 900, 'text', ?)`
		).run(`${tid}-m1`, ACC, tid, `${tid}-p1`, `${tid}-pt`, `person${i}@runner.test`, NOW, `k/${tid}-1`, NOW);

		db.prepare(
			`INSERT INTO email_messages
         (id, connection_id, thread_id, provider_message_id, provider_thread_id,
          from_email, sent_at, body_key, body_bytes, body_format, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 900, 'text', ?)`
		).run(`${tid}-m2`, ACC, tid, `${tid}-p2`, `${tid}-pt`, 'run-a@runner.test', NOW, `k/${tid}-2`, NOW);
	}
}

function cleanup() {
	db.prepare('DELETE FROM commitments WHERE connection_id = ?').run(ACC);
	db.prepare('DELETE FROM thread_digests WHERE connection_id = ?').run(ACC);
	db.prepare('DELETE FROM contact_profiles WHERE connection_id = ?').run(ACC);
	db.prepare('DELETE FROM voice_profiles WHERE connection_id = ?').run(ACC);
	db.prepare('DELETE FROM mail_contacts WHERE connection_id = ?').run(ACC);
	db.prepare('DELETE FROM ai_usage WHERE connection_id = ?').run(ACC);
	db.prepare('DELETE FROM email_messages WHERE connection_id = ?').run(ACC);
	db.prepare('DELETE FROM email_threads WHERE connection_id = ?').run(ACC);
	db.prepare('DELETE FROM connections WHERE id = ?').run(ACC);
}

function env(bodies: typeof files | typeof shortFiles = files) {
	return { DB: d1(db), FILES: bodies, ANTHROPIC_API_KEY: 'stub' } as never;
}

/**
 * The D1 shim on its own, for the seeding calls.
 *
 * `env()` is cast to never so it satisfies the runner's binding types, which
 * also makes its fields unreachable to the checker. Reaching in for `.DB` was
 * spreading that cast through every test; taking the shim directly keeps it at
 * the boundary where it belongs.
 */
function database() {
	return d1(db) as never;
}

function reset() {
	calls.digest = 0;
	calls.commitments = 0;
	calls.profile = 0;
	calls.voice = 0;
	digestBehaviour = 'ok';
}

beforeAll(async () => {
	db = openDb();
	const mod = await import('../src/lib/server/context');
	run = mod.runContextPass;
	seed = mod.seedContacts;
});

afterAll(() => {
	cleanup();
	db.close();
});

describe('layer 2: the context pass runner', () => {
	it('builds voice once, then a digest and commitments per thread', async () => {
		build(3);
		reset();
		await seed(database(), ACC, 'run-a@runner.test');

		const out = await run(env(), ACC, 'run-a@runner.test', 100);

		expect(out.voice).toBe(1);
		expect(out.digests).toBe(3);
		expect(out.commitments).toBe(3);
		expect(calls.voice).toBe(1);
		expect(out.failed).toBe(0);
	});

	it('refuses to learn a voice from messages too short to carry one', async () => {
		// Better to have no voice profile than one inferred from "ok, thanks".
		// A confident profile built on nothing would then shape every draft.
		build(2);
		reset();
		await seed(database(), ACC, 'run-a@runner.test');

		const out = await run(env(shortFiles), ACC, 'run-a@runner.test', 100);
		expect(out.voice, 'a voice profile was built from trivial messages').toBe(0);
		expect(calls.voice).toBe(0);
		expect(out.skipped).toBeGreaterThan(0);
	});

	it('does no work at all on a second pass when nothing has changed', async () => {
		// The whole cost model rests on this. If a re-run redid the work, the
		// scheduled version would pay full price on every firing forever.
		//
		// Self-contained: an earlier version leaned on the previous test having
		// left rows behind, and inserting a test between them broke it. D77, and
		// I walked into it again. Each test builds what it needs.
		build(3);
		await seed(database(), ACC, 'run-a@runner.test');
		reset();
		await run(env(), ACC, 'run-a@runner.test', 100);

		reset();
		const out = await run(env(), ACC, 'run-a@runner.test', 100);

		expect(calls.digest, 're-ran digests for unchanged threads').toBe(0);
		expect(calls.voice, 'rebuilt the voice profile with no new sent mail').toBe(0);
		expect(calls.profile, 'rebuilt contact profiles with no new mail').toBe(0);
		expect(out.digests).toBe(0);
	});

	it('redoes exactly one thread when exactly one thread gains a message', async () => {
		build(3);
		await seed(database(), ACC, 'run-a@runner.test');
		reset();
		await run(env(), ACC, 'run-a@runner.test', 100);

		reset();
		db.prepare(
			`INSERT INTO email_messages
         (id, connection_id, thread_id, provider_message_id, provider_thread_id,
          from_email, sent_at, body_key, body_bytes, body_format, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 900, 'text', ?)`
		).run('run-t0-m3', ACC, 'run-t0', 'run-t0-p3', 'run-t0-pt', 'person0@runner.test', '2026-09-02T00:00:00Z', 'k/run-t0-3', NOW);

		const out = await run(env(), ACC, 'run-a@runner.test', 100);
		expect(out.digests, 'identity keying redid the wrong number of threads').toBe(1);
	});

	it('stops at the call ceiling rather than running to the wall', async () => {
		build(10);
		reset();
		await seed(database(), ACC, 'run-a@runner.test');

		const out = await run(env(), ACC, 'run-a@runner.test', 5);
		expect(out.calls).toBeLessThanOrEqual(5);
		expect(out.stopped_early, 'the ceiling was hit without saying so').toContain('ceiling');
	});

	it('a transient failure stops the pass and writes nothing', async () => {
		build(3);
		reset();
		await seed(database(), ACC, 'run-a@runner.test');
		digestBehaviour = 'transient';

		const out = await run(env(), ACC, 'run-a@runner.test', 100);

		expect(out.digests).toBe(0);
		expect(out.failed, 'a transient failure was counted as a permanent one').toBe(0);
		expect(out.stopped_early).toBeTruthy();

		const written = db
			.prepare('SELECT COUNT(*) AS n FROM thread_digests WHERE connection_id = ?')
			.get(ACC) as { n: number };
		expect(Number(written.n), 'a stopped pass left rows behind').toBe(0);
	});

	it('a permanent failure is counted and the pass continues', async () => {
		build(3);
		reset();
		await seed(database(), ACC, 'run-a@runner.test');
		digestBehaviour = 'permanent';

		const out = await run(env(), ACC, 'run-a@runner.test', 100);

		// Every thread is attempted rather than the first one blocking the rest,
		// which is the lesson from the triage drain.
		expect(out.failed).toBe(3);
		expect(out.stopped_early).toBeNull();
	});

	it('every call is attributed to the account that paid for it', async () => {
		build(2);
		reset();
		await seed(database(), ACC, 'run-a@runner.test');
		await run(env(), ACC, 'run-a@runner.test', 100);

		const rows = db
			.prepare('SELECT connection_id, input_tokens FROM ai_usage WHERE connection_id = ?')
			.all(ACC) as { connection_id: string; input_tokens: number }[];

		expect(rows.length, 'no spend was recorded').toBeGreaterThan(0);
		expect(rows.every((r) => r.connection_id === ACC)).toBe(true);
		expect(rows.every((r) => r.input_tokens > 0), 'spend was recorded as zero tokens').toBe(true);
	});

	it('re-running a thread replaces its commitments rather than stacking them', async () => {
		build(1);
		await seed(database(), ACC, 'run-a@runner.test');
		reset();
		await run(env(), ACC, 'run-a@runner.test', 100);

		db.prepare(
			`INSERT INTO email_messages
         (id, connection_id, thread_id, provider_message_id, provider_thread_id,
          from_email, sent_at, body_key, body_bytes, body_format, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 900, 'text', ?)`
		).run('run-t0-m9', ACC, 'run-t0', 'run-t0-p9', 'run-t0-pt', 'person0@runner.test', '2026-09-03T00:00:00Z', 'k/run-t0-9', NOW);

		await run(env(), ACC, 'run-a@runner.test', 100);

		const n = db
			.prepare('SELECT COUNT(*) AS n FROM commitments WHERE connection_id = ?')
			.get(ACC) as { n: number };
		// One commitment from the stub, not two. A ledger that stacks duplicates
		// on every re-read would have Paul owing the same thing repeatedly.
		expect(Number(n.n), 'commitments accumulated across re-runs').toBe(1);
	});
});
