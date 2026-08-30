import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What the mail screen counts, and against which set.
 *
 * The redesign surfaced a number that had never been asked for before: how many
 * threads are in the archive. The list endpoint answers a related but different
 * question in `counts`, which describes whichever side of the archived toggle
 * is on screen. Summing it for the archive total silently returned the inbox
 * total instead, and it read as plausible because both are just numbers.
 *
 * So both are asserted here: the archive total is its own figure, and the chip
 * counts follow the toggle rather than being pinned to the inbox.
 *
 * Its own account and its own rows. Leaning on another file's fixture is how
 * D77 and D119 happened, twice.
 */

const BASE = 'http://localhost:5173';
const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const ACC = 'counts-a';
const NOW = '2026-08-31T00:00:00Z';

/** Three in the inbox, two archived, chosen so the totals cannot coincide. */
const INBOX = 3;
const ARCHIVED = 2;

function openDb(): DatabaseSync {
	const file = readdirSync(DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	if (!file) throw new Error('Local D1 not found.');
	return new DatabaseSync(join(DIR, file));
}

let db: DatabaseSync;

function cleanup() {
	db.prepare('DELETE FROM email_messages WHERE connection_id = ?').run(ACC);
	db.prepare('DELETE FROM email_threads WHERE connection_id = ?').run(ACC);
	db.prepare('DELETE FROM connections WHERE id = ?').run(ACC);
}

function seed() {
	cleanup();
	db.prepare(
		`INSERT INTO connections (id, provider, account_email, status, connected_at, created_at, updated_at)
     VALUES (?, 'google', ?, 'connected', ?, ?, ?)`
	).run(ACC, 'counts@segregation.test', NOW, NOW, NOW);

	for (let i = 0; i < INBOX + ARCHIVED; i++) {
		const archivedAt = i >= INBOX ? NOW : null;
		db.prepare(
			`INSERT INTO email_threads
       (id, connection_id, provider_thread_id, subject, message_count, first_at, last_at,
        severity, category, gist, archived_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, 'urgent', 'correspondence', ?, ?, ?, ?)`
		).run(
			`${ACC}-t${i}`,
			ACC,
			`${ACC}-pt${i}`,
			`COUNTS FIXTURE ${i}`,
			NOW,
			NOW,
			`COUNTS GIST ${i}`,
			archivedAt,
			NOW,
			NOW
		);
	}
}

async function list(params: string) {
	const res = await fetch(`${BASE}/api/email/threads?account=${ACC}&${params}`);
	expect(res.ok).toBe(true);
	return (await res.json()) as {
		threads: unknown[];
		counts: Record<string, number>;
		archived_count: number;
	};
}

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((n, v) => n + v, 0);

beforeAll(() => {
	db = openDb();
	seed();
});

afterAll(() => {
	cleanup();
	db.close();
});

describe('mail counts describe the set they claim to', () => {
	it('the archive total is the number of archived threads, not the inbox total', async () => {
		const inbox = await list('limit=100');
		expect(inbox.threads).toHaveLength(INBOX);
		expect(inbox.archived_count).toBe(ARCHIVED);
	});

	it('the archive total is the same figure while the archive is on screen', async () => {
		const archived = await list('limit=100&archived=true');
		expect(archived.threads).toHaveLength(ARCHIVED);
		expect(archived.archived_count).toBe(ARCHIVED);
	});

	it('the severity chips count the side of the toggle being shown', async () => {
		const inbox = await list('limit=100');
		const archived = await list('limit=100&archived=true');
		expect(sum(inbox.counts)).toBe(INBOX);
		expect(sum(archived.counts)).toBe(ARCHIVED);
	});
});
