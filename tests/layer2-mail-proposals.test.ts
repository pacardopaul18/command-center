import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:5173';

/**
 * A commitment becomes something Paul reviews, never something he owes.
 *
 * The Action items screen is the one place that says what Paul owes people. The
 * context pass reads commitments out of sentences in email, and some of those
 * readings are wrong. Writing them straight into action items would fill that
 * screen with things he may not owe anybody, and once it stops being believed
 * no amount of later accuracy brings it back.
 *
 * So the chain is commitment, proposal, human, action item. These tests are
 * about the shape of that chain rather than about the model's accuracy, because
 * the shape is what stops a bad reading becoming a false obligation.
 */

const ROOT = process.cwd();

function code(...parts: string[]): string {
	return readFileSync(join(ROOT, ...parts), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const proposals = code('src', 'lib', 'server', 'mail-proposals.ts');

function localD1Path(): string {
	const dir = join('.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
	const files = readdirSync(dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	return join(dir, files[0]);
}

/** Everything this file writes carries this prefix, so cleanup is exact. D157. */
const P = 'tp-proposal-';

function db(): DatabaseSync {
	return new DatabaseSync(localD1Path());
}

/**
 * Cleans up its own rows, both before and after.
 *
 * After, because a fixture that leaves rows behind is a fixture that has
 * changed the database for everything that runs next. Before, because a run
 * that failed part way through left rows the next run then collides with, and
 * a test that can only pass on a clean machine is a test that stops being run.
 */
function clean(): void {
	/*
	 * Removed in dependency order, and only rows this file wrote.
	 *
	 * A fixture that deletes by table rather than by prefix would take the real
	 * corpus with it, which on a machine holding somebody's mail is not a
	 * recoverable mistake.
	 */
	const conn = db();

	/*
	 * The action item is read first and deleted last.
	 *
	 * Deleting it first sets `action_item_id` to null on the proposal that
	 * points at it, and the table's own CHECK refuses an accepted proposal
	 * pointing at nothing. The constraint is right and the teardown was wrong:
	 * a proposal claiming it became work that does not exist is exactly the
	 * state that CHECK is there to make impossible.
	 */
	const orphans = conn
		.prepare(
			`SELECT action_item_id FROM mail_action_proposals
       WHERE action_item_id IS NOT NULL AND (id LIKE '${P}%' OR commitment_id LIKE '${P}%')`
		)
		.all() as { action_item_id: string }[];

	for (const sql of [
		`DELETE FROM mail_action_proposals WHERE id LIKE '${P}%' OR commitment_id LIKE '${P}%'`,
		`DELETE FROM commitments WHERE id LIKE '${P}%'`,
		`DELETE FROM email_messages WHERE id LIKE '${P}%'`,
		`DELETE FROM email_threads WHERE id LIKE '${P}%'`
	]) {
		conn.exec(sql);
	}

	for (const row of orphans) {
		conn.prepare('DELETE FROM action_items WHERE id = ?').run(row.action_item_id);
	}

	conn.close();
}

beforeAll(clean);
afterAll(clean);

describe('layer 2: the chain from a sentence to an action item has a person in it', () => {
	it('proposes rather than creating, and accepting is what creates', async () => {
		const conn = db();

		// The connection the mail fixture already uses. Borrowed rather than
		// created: connections are account identity and inventing one would put a
		// mailbox in the app that nobody connected.
		const connection = conn
			.prepare('SELECT id FROM connections LIMIT 1')
			.get() as { id: string } | undefined;
		expect(connection, 'no mail connection exists to hang a fixture on').toBeTruthy();

		conn.exec(`
      INSERT INTO email_threads
        (id, connection_id, provider_thread_id, subject, category, last_at, message_count, created_at, updated_at)
      VALUES ('${P}thread', '${connection!.id}', '${P}pt', 'Fixture thread', 'correspondence',
              '2026-09-01T10:00:00Z', 1, '2026-09-01T10:00:00Z', '2026-09-01T10:00:00Z');
    `);
		conn.exec(`
      INSERT INTO email_messages
        (id, connection_id, thread_id, provider_message_id, provider_thread_id,
         from_email, to_emails, sent_at, snippet, fetched_at)
      VALUES ('${P}msg', '${connection!.id}', '${P}thread', '${P}pm', '${P}pt',
              'someone@example.invalid', 'paul@example.invalid', '2026-09-01T10:00:00Z',
              'A fixture snippet.', '2026-09-01T10:00:00Z');
    `);
		conn.exec(`
      INSERT INTO commitments
        (id, connection_id, thread_id, source_message_id, owed_by, owed_to, what, due_signal,
         evidence, status, built_at, created_at, updated_at)
      VALUES ('${P}owed', '${connection!.id}', '${P}thread', '${P}msg', 'paul', 'someone@example.invalid',
              'Send the revised figures', 'by the end of the week',
              'I will send the revised figures by the end of the week.', 'open',
              '2026-09-01T10:00:00Z', '2026-09-01T10:00:00Z', '2026-09-01T10:00:00Z');
    `);

		// And one Paul does not owe, which must not become his problem.
		conn.exec(`
      INSERT INTO commitments
        (id, connection_id, thread_id, source_message_id, owed_by, owed_to, what,
         evidence, status, built_at, created_at, updated_at)
      VALUES ('${P}theirs', '${connection!.id}', '${P}thread', '${P}msg', 'them', 'paul',
              'They will send the contract', 'We will send the contract over.', 'open',
              '2026-09-01T10:00:00Z', '2026-09-01T10:00:00Z', '2026-09-01T10:00:00Z');
    `);
		conn.close();

		const actionsBefore = (await (
			await fetch(`${BASE}/api/action-items?view=all&page_size=10`)
		).json()) as { paging: { total: number } };

		const run = (await (
			await fetch(`${BASE}/api/email/context/proposals`, { method: 'POST' })
		).json()) as {
			proposals_created: number;
			skipped_owed_by_them: number;
			skipped_no_evidence: number;
		};

		expect(run.proposals_created).toBeGreaterThanOrEqual(1);
		expect(
			run.skipped_owed_by_them,
			"a commitment somebody else made is not Paul's action item"
		).toBeGreaterThanOrEqual(1);

		// Nothing has been created yet. This is the whole property.
		const actionsAfter = (await (
			await fetch(`${BASE}/api/action-items?view=all&page_size=10`)
		).json()) as { paging: { total: number } };
		expect(
			actionsAfter.paging.total,
			'proposing created an action item. A model reading a sentence must not be able ' +
				'to put an obligation on the screen that says what Paul owes people.'
		).toBe(actionsBefore.paging.total);

		const listed = (await (
			await fetch(`${BASE}/api/email/context/proposals?status=pending`)
		).json()) as {
			proposals: {
				id: string;
				commitment_id: string;
				evidence: string | null;
				title: string;
				status: string;
				due_signal: string | null;
				deadline: string | null;
				ambiguous: number;
			}[];
		};

		const mine = listed.proposals.find((p) => p.commitment_id === `${P}owed`);
		expect(mine, 'the proposal was not offered for review').toBeTruthy();
		expect(mine!.evidence, 'a reviewer cannot judge a claim they cannot check').toBeTruthy();

		// "By the end of the week" is not a date. Carried as a signal, flagged
		// ambiguous, and never turned into a deadline nobody stated.
		expect(mine!.due_signal).toBe('by the end of the week');
		expect(mine!.deadline).toBe(null);
		expect(mine!.ambiguous).toBe(1);

		// Rename it so the cleanup prefix finds it.
		const conn2 = db();
		conn2.exec(
			`UPDATE mail_action_proposals SET id = '${P}accepted' WHERE commitment_id = '${P}owed'`
		);
		conn2.close();

		const accepted = await fetch(`${BASE}/api/email/context/proposals/${P}accepted/accept`, {
			method: 'POST'
		});
		expect(accepted.ok).toBe(true);
		const body = (await accepted.json()) as { action_item_id: string };
		expect(body.action_item_id).toBeTruthy();

		// Now, and only now, it exists as work.
		const actionsFinal = (await (
			await fetch(`${BASE}/api/action-items?view=all&page_size=10`)
		).json()) as { paging: { total: number } };
		expect(actionsFinal.paging.total).toBe(actionsBefore.paging.total + 1);

		// Accepting twice does not create a second one.
		const again = await fetch(`${BASE}/api/email/context/proposals/${P}accepted/accept`, {
			method: 'POST'
		});
		expect(again.status, 'a proposal already reviewed was accepted a second time').toBe(404);
	});
});

describe('layer 2: the proposal generator is bookkeeping, not a second opinion', () => {
	it('makes no AI call', () => {
		for (const call of ['messages.create', 'Anthropic', 'ANTHROPIC_API_KEY', 'client(']) {
			expect(
				proposals.includes(call),
				`mail-proposals.ts names ${call}. The model did its reading when it extracted ` +
					'the commitment; a second call to judge the first is paying twice for the same guess.'
			).toBe(false);
		}
	});

	it('is idempotent, so a rejected sentence is never offered again', () => {
		const schema = readFileSync(
			join(ROOT, 'migrations', '0039_mail_action_proposals.sql'),
			'utf8'
		);
		expect(schema).toMatch(/UNIQUE \(commitment_id\)/);
		expect(proposals).toMatch(/ON CONFLICT\(commitment_id\) DO NOTHING/);
	});

	it('cannot record an accepted proposal that became nothing', () => {
		const schema = readFileSync(
			join(ROOT, 'migrations', '0039_mail_action_proposals.sql'),
			'utf8'
		);
		expect(schema).toMatch(/CHECK \(status != 'accepted' OR action_item_id IS NOT NULL\)/);
	});

	it('refuses to guess a client from a free mail domain', () => {
		// One gmail.com contact would otherwise file every personal correspondent
		// under that client.
		for (const free of ['gmail.com', 'outlook.com', 'yahoo.com']) {
			expect(proposals).toContain(free);
		}
		expect(proposals).toMatch(/map\.delete\(free\)/);
	});

	it('leaves a proposal unfiled rather than choosing between two projects', () => {
		expect(proposals).toMatch(/LIMIT 2/);
		expect(proposals).toMatch(/results \?\? \[\]\)\.length === 1/);
	});
});
