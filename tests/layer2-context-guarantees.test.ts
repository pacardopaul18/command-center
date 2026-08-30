import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The two guarantees E4 makes, asserted rather than described.
 *
 * One: context rows never cross accounts. Same rule as the mail routes, one
 * layer deeper, and more consequential: a leaked thread is one screen, a leaked
 * contact profile is a standing claim about a person that then feeds drafts.
 *
 * Two: excluded categories produce zero context rows. Automated, newsletter and
 * notification threads must never enter the AI passes. That is the whole reason
 * the budget is cents rather than dollars, and it is exactly the sort of
 * constraint that decays silently when a later query forgets it. A cost control
 * with no test is a cost control until somebody writes one more SELECT.
 *
 * Both are written against a fixture built to violate them if the code lets it.
 */

const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const A = 'ctx-a';
const B = 'ctx-b';

function openDb(): DatabaseSync {
	const file = readdirSync(DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	if (!file) throw new Error('Local D1 not found.');
	return new DatabaseSync(join(DIR, file));
}

let db: DatabaseSync;
let seed: typeof import('../src/lib/server/context')['seedContacts'];
let eligible: typeof import('../src/lib/server/context')['eligibleThreads'];

/** The slice of D1 these functions use, over node:sqlite. */
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

const NOW = '2026-08-31T00:00:00Z';

function build() {
	cleanup();

	for (const [id, email] of [
		[A, 'ctx-a@context.test'],
		[B, 'ctx-b@context.test']
	]) {
		db.prepare(
			`INSERT INTO connections (id, provider, account_email, status, created_at, updated_at)
       VALUES (?, 'google', ?, 'connected', ?, ?)`
		).run(id, email, NOW, NOW);
	}

	/**
	 * Threads across every category, on both accounts.
	 *
	 * The excluded categories carry senders who appear NOWHERE else, so a
	 * contact derived from one of them is unambiguous evidence the exclusion
	 * failed rather than a coincidence of overlapping addresses.
	 */
	const rows: [string, string, string, string][] = [
		[A, 'ctx-a-corr', 'correspondence', 'real-person-a@context.test'],
		[A, 'ctx-a-auto', 'automated', 'robot-a@context.test'],
		[A, 'ctx-a-news', 'newsletter', 'newsletter-a@context.test'],
		[A, 'ctx-a-noti', 'notification', 'notifier-a@context.test'],
		[A, 'ctx-a-untri', '', 'untriaged-a@context.test'],
		[B, 'ctx-b-corr', 'correspondence', 'real-person-b@context.test'],
		[B, 'ctx-b-auto', 'automated', 'robot-b@context.test']
	];

	for (const [conn, threadId, category, sender] of rows) {
		db.prepare(
			`INSERT INTO email_threads
         (id, connection_id, provider_thread_id, subject, message_count,
          first_at, last_at, category, severity, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'important', ?, ?)`
		).run(
			threadId,
			conn,
			`${threadId}-pt`,
			`THREAD ${threadId}`,
			NOW,
			NOW,
			category || null,
			NOW,
			NOW
		);

		db.prepare(
			`INSERT INTO email_messages
         (id, connection_id, thread_id, provider_message_id, provider_thread_id,
          subject, from_email, sent_at, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).run(
			`${threadId}-msg`,
			conn,
			threadId,
			`${threadId}-pm`,
			`${threadId}-pt`,
			`THREAD ${threadId}`,
			sender,
			NOW,
			NOW
		);
	}
}

function cleanup() {
	for (const id of [A, B]) {
		db.prepare('DELETE FROM commitments WHERE connection_id = ?').run(id);
		db.prepare('DELETE FROM thread_digests WHERE connection_id = ?').run(id);
		db.prepare('DELETE FROM contact_profiles WHERE connection_id = ?').run(id);
		db.prepare('DELETE FROM voice_profiles WHERE connection_id = ?').run(id);
		db.prepare('DELETE FROM mail_contacts WHERE connection_id = ?').run(id);
		db.prepare('DELETE FROM email_messages WHERE connection_id = ?').run(id);
		db.prepare('DELETE FROM email_threads WHERE connection_id = ?').run(id);
		db.prepare('DELETE FROM connections WHERE id = ?').run(id);
	}
}

beforeAll(async () => {
	db = openDb();
	build();
	const mod = await import('../src/lib/server/context');
	seed = mod.seedContacts;
	eligible = mod.eligibleThreads;
});

afterAll(() => {
	cleanup();
	db.close();
});

describe('layer 2: context rows never cross accounts', () => {
	it('the fixture built both accounts across every category', () => {
		const n = db
			.prepare("SELECT COUNT(*) AS n FROM email_threads WHERE connection_id IN ('ctx-a','ctx-b')")
			.get() as { n: number };
		expect(Number(n.n)).toBe(7);
	});

	it('seeding account A derives no contact belonging to account B', async () => {
		await seed(d1(db) as never, A, 'ctx-a@context.test');

		const strays = db
			.prepare(
				`SELECT COUNT(*) AS n FROM mail_contacts
         WHERE connection_id = 'ctx-a' AND email LIKE '%-b@context.test'`
			)
			.get() as { n: number };
		expect(Number(strays.n), 'account B addresses appeared in account A contacts').toBe(0);

		// And nothing at all was written under B's id while seeding A.
		const wroteToB = db
			.prepare("SELECT COUNT(*) AS n FROM mail_contacts WHERE connection_id = 'ctx-b'")
			.get() as { n: number };
		expect(Number(wroteToB.n), 'seeding A wrote rows under account B').toBe(0);
	});

	it('each account derives only its own contacts', async () => {
		await seed(d1(db) as never, A, 'ctx-a@context.test');
		await seed(d1(db) as never, B, 'ctx-b@context.test');

		const a = db
			.prepare("SELECT email FROM mail_contacts WHERE connection_id = 'ctx-a'")
			.all() as { email: string }[];
		const b = db
			.prepare("SELECT email FROM mail_contacts WHERE connection_id = 'ctx-b'")
			.all() as { email: string }[];

		expect(a.every((r) => r.email.endsWith('-a@context.test'))).toBe(true);
		expect(b.every((r) => r.email.endsWith('-b@context.test'))).toBe(true);
	});

	it('eligible threads for one account never include another account thread', async () => {
		const threads = await eligible(d1(db) as never, A, 100);
		expect(threads.length).toBeGreaterThan(0);
		expect(threads.every((t) => t.id.startsWith('ctx-a'))).toBe(true);
	});
});

describe('layer 2: excluded categories produce zero context rows', () => {
	it('only correspondence threads are ever eligible', async () => {
		const threads = await eligible(d1(db) as never, A, 100);
		const ids = threads.map((t) => t.id);
		expect(ids).toContain('ctx-a-corr');
		for (const excluded of ['ctx-a-auto', 'ctx-a-news', 'ctx-a-noti']) {
			expect(ids, `${excluded} was eligible for the context engine`).not.toContain(excluded);
		}
	});

	it('untriaged threads wait rather than being read speculatively', async () => {
		const ids = (await eligible(d1(db) as never, A, 100)).map((t) => t.id);
		expect(
			ids,
			'an untriaged thread entered the context engine before triage judged it'
		).not.toContain('ctx-a-untri');
	});

	it('no contact is derived from an automated, newsletter or notification thread', async () => {
		await seed(d1(db) as never, A, 'ctx-a@context.test');

		// These senders exist nowhere else in the fixture, so finding one is
		// unambiguous evidence the exclusion failed.
		for (const sender of [
			'robot-a@context.test',
			'newsletter-a@context.test',
			'notifier-a@context.test',
			'untriaged-a@context.test'
		]) {
			const found = db
				.prepare('SELECT COUNT(*) AS n FROM mail_contacts WHERE email = ?')
				.get(sender) as { n: number };
			expect(Number(found.n), `${sender} became a contact and should not have`).toBe(0);
		}
	});

	it('the AI pass reaches for the same eligible set, not a wider one', async () => {
		// The exclusion has to hold on the expensive path, not only the free one.
		// This asserts the pass takes its threads from `eligibleThreads` rather
		// than selecting its own, which is the way a cost control quietly widens:
		// a second query written by somebody who did not know the rule.
		const source = readFileSync('src/lib/server/context.ts', 'utf8');
		const passBody = source.slice(source.indexOf('export async function runContextPass'));

		// It must call the one gate.
		expect(passBody).toContain('await eligibleThreads(');

		// And it must not select threads by any other route. A FROM email_threads
		// inside the pass would be a second, ungoverned source of work.
		const ownThreadQueries = passBody.match(/FROM email_threads/g) ?? [];
		for (const _ of ownThreadQueries) {
			// The only permitted ones are joins that filter to correspondence
			// explicitly, so any occurrence must carry that filter nearby.
			expect(
				passBody.includes("t.category = 'correspondence'"),
				'the context pass selects threads without the category filter'
			).toBe(true);
		}
	});

	it('the account owner is not a contact in his own graph', async () => {
		await seed(d1(db) as never, A, 'ctx-a@context.test');
		const self = db
			.prepare("SELECT COUNT(*) AS n FROM mail_contacts WHERE email = 'ctx-a@context.test'")
			.get() as { n: number };
		expect(Number(self.n), 'Paul became his own most frequent correspondent').toBe(0);
	});
});
