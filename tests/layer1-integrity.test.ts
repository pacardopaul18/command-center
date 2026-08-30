import { describe, expect, it, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Layer 1: data integrity, asserted against generation-time expectations.
 *
 * The point of this layer is that it never asks the app anything. It reads the
 * local SQLite file that miniflare backs D1 with, and compares it to
 * `seed/expected.json`, which the generator wrote from the values it used to
 * build the rows.
 *
 * That independence is the whole design. An app can be wrong in a way its own
 * API agrees with, and a test that asks the API what the data is will happily
 * confirm it. Two sources that were never derived from each other cannot make
 * the same mistake by accident.
 */

interface Expected {
	counts: Record<string, number>;
	action_status: Record<string, number>;
	action_bands: Record<string, number>;
	invoice_bands: Record<string, number>;
	invoice_status: Record<string, number>;
	project_status: Record<string, number>;
	project_phase: Record<string, number>;
	totals: Record<string, number>;
	fingerprint: string;
	today_mt: string;
	per_client_outstanding: Record<string, number>;
	sop_version_counts: Record<string, number>;
}

const expected: Expected = JSON.parse(readFileSync('seed/expected.json', 'utf8'));

/**
 * The Mountain day the seed was anchored to.
 *
 * Not `date('now')`. SQLite's `now` is UTC, and for the seven hours each
 * evening when the Mountain date is still yesterday, every band computed
 * against UTC disagrees with what the app reports. The suite found that on its
 * first run and it is the reason this constant exists.
 */
const TODAY = expected.today_mt;

/** The miniflare D1 file. Named by hash, so it is found rather than hardcoded. */
function localD1Path(): string {
	const dir = join('.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
	const files = readdirSync(dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	if (files.length !== 1) {
		throw new Error(
			`Expected exactly one local D1 database, found ${files.length}. ` +
				'Reset local state and re-run the migrations.'
		);
	}
	return join(dir, files[0]);
}

let db: DatabaseSync;

beforeAll(() => {
	db = new DatabaseSync(localD1Path(), { readOnly: true });
});

function one<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T {
	return db.prepare(sql).get(...(params as never[])) as T;
}
function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
	return db.prepare(sql).all(...(params as never[])) as T[];
}
function grouped(sql: string): Record<string, number> {
	const out: Record<string, number> = {};
	for (const r of all<{ k: string; n: number }>(sql)) out[String(r.k)] = Number(r.n);
	return out;
}

describe('layer 1: the loaded data came from the current seed', () => {
	it('the seed is still anchored to today, in Mountain Time', () => {
		const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(
			new Date()
		);
		expect(
			expected.today_mt,
			'The seed was generated for a different Mountain day, so every deadline band ' +
				'in it now means something else. Regenerate and reload: ' +
				'npm run seed:generate && npm run seed:load'
		).toBe(today);
	});

	it('the seed fingerprint in the database matches expected.json', () => {
		const row = one<{ display_name: string }>(
			"SELECT display_name FROM users WHERE id = 'v-u-seed'"
		);
		expect(
			row?.display_name,
			'The database was loaded from a different generation of the seed. ' +
				'Reload it: npm run seed:generate && npm run seed:load'
		).toBe(expected.fingerprint);
	});
});

describe('layer 1: row counts match what was generated', () => {
	for (const [table, n] of Object.entries(expected.counts)) {
		it(`${table} has ${n} rows`, () => {
			const { c } = one<{ c: number }>(`SELECT COUNT(*) AS c FROM "${table}"`);
			expect(Number(c)).toBe(n);
		});
	}
});

describe('layer 1: action item distributions', () => {
	it('status counts match', () => {
		expect(grouped('SELECT status AS k, COUNT(*) AS n FROM action_items GROUP BY status')).toEqual(
			expected.action_status
		);
	});

	it('deadline bands match, computed the same way the app computes them', () => {
		const bands = grouped(`
      SELECT CASE
               WHEN status = 'done' THEN 'done'
               WHEN deadline IS NULL THEN 'no_deadline'
               WHEN deadline < '${TODAY}' THEN 'overdue'
               WHEN deadline = '${TODAY}' THEN 'due_today'
               ELSE 'future'
             END AS k,
             COUNT(*) AS n
      FROM action_items GROUP BY k`);
		expect(bands).toEqual(expected.action_bands);
	});

	it('open count is the complement of done', () => {
		const { c } = one<{ c: number }>(
			"SELECT COUNT(*) AS c FROM action_items WHERE status != 'done'"
		);
		expect(Number(c)).toBe(expected.totals.action_items_open);
	});

	it('every ambiguous item really has no owner', () => {
		const { c } = one<{ c: number }>(
			"SELECT COUNT(*) AS c FROM action_items WHERE status = 'ambiguous' AND owner IS NOT NULL"
		);
		expect(Number(c)).toBe(0);
	});
});

describe('layer 1: invoices and money', () => {
	it('aging band counts match', () => {
		const bands = grouped(`
      SELECT CASE
               WHEN julianday('${TODAY}') - julianday(due_date) <= 30 THEN 'b0_30'
               WHEN julianday('${TODAY}') - julianday(due_date) <= 60 THEN 'b31_60'
               WHEN julianday('${TODAY}') - julianday(due_date) <= 90 THEN 'b61_90'
               ELSE 'b90_plus'
             END AS k,
             COUNT(*) AS n
      FROM invoices WHERE amount_paid_cents < amount_cents GROUP BY k`);
		const want = Object.fromEntries(
			Object.entries(expected.invoice_bands).filter(([k]) => !k.endsWith('_cents'))
		);
		expect(bands).toEqual(want);
	});

	it('outstanding per band matches to the cent', () => {
		const bands = grouped(`
      SELECT CASE
               WHEN julianday('${TODAY}') - julianday(due_date) <= 30 THEN 'b0_30_cents'
               WHEN julianday('${TODAY}') - julianday(due_date) <= 60 THEN 'b31_60_cents'
               WHEN julianday('${TODAY}') - julianday(due_date) <= 90 THEN 'b61_90_cents'
               ELSE 'b90_plus_cents'
             END AS k,
             SUM(amount_cents - amount_paid_cents) AS n
      FROM invoices WHERE amount_paid_cents < amount_cents GROUP BY k`);
		const want = Object.fromEntries(
			Object.entries(expected.invoice_bands).filter(([k]) => k.endsWith('_cents'))
		);
		expect(bands).toEqual(want);
	});

	it('total outstanding matches, and equals the sum of the bands', () => {
		const { n } = one<{ n: number }>(
			'SELECT SUM(amount_cents - amount_paid_cents) AS n FROM invoices WHERE amount_paid_cents < amount_cents'
		);
		expect(Number(n)).toBe(expected.totals.outstanding_cents);

		const bandSum = Object.entries(expected.invoice_bands)
			.filter(([k]) => k.endsWith('_cents'))
			.reduce((s, [, v]) => s + v, 0);
		expect(bandSum).toBe(expected.totals.outstanding_cents);
	});

	it('outstanding per client matches every client independently', () => {
		const rows = all<{ client_id: string; n: number }>(
			`SELECT client_id, SUM(amount_cents - amount_paid_cents) AS n
       FROM invoices WHERE amount_paid_cents < amount_cents GROUP BY client_id`
		);
		const got: Record<string, number> = {};
		for (const r of rows) got[r.client_id] = Number(r.n);
		expect(got).toEqual(expected.per_client_outstanding);
	});

	it('no invoice violates its own CHECK constraints', () => {
		const { c } = one<{ c: number }>(
			'SELECT COUNT(*) AS c FROM invoices WHERE amount_paid_cents > amount_cents OR due_date < issue_date'
		);
		expect(Number(c)).toBe(0);
	});

	it('invoice status counts match', () => {
		expect(grouped('SELECT status AS k, COUNT(*) AS n FROM invoices GROUP BY status')).toEqual(
			expected.invoice_status
		);
	});
});

describe('layer 1: projects, meetings, SOPs', () => {
	it('project phase and status distributions match', () => {
		expect(grouped('SELECT phase AS k, COUNT(*) AS n FROM projects GROUP BY phase')).toEqual(
			expected.project_phase
		);
		expect(grouped('SELECT status AS k, COUNT(*) AS n FROM projects GROUP BY status')).toEqual(
			expected.project_status
		);
	});

	it('meetings dated today match', () => {
		const { c } = one<{ c: number }>(
			`SELECT COUNT(*) AS c FROM meetings WHERE meeting_date = '${TODAY}'`
		);
		expect(Number(c)).toBe(expected.totals.meetings_today);
	});

	it('proposal statuses match, and accepted rows carry a linked item', () => {
		const g = grouped(
			'SELECT status AS k, COUNT(*) AS n FROM meeting_action_proposals GROUP BY status'
		);
		expect(g.pending).toBe(expected.totals.proposals_pending);
		expect(g.accepted).toBe(expected.totals.proposals_accepted);
		expect(g.rejected).toBe(expected.totals.proposals_rejected);

		const { c } = one<{ c: number }>(
			"SELECT COUNT(*) AS c FROM meeting_action_proposals WHERE status = 'accepted' AND action_item_id IS NULL"
		);
		expect(Number(c)).toBe(0);
	});

	it('every SOP has the version count it was generated with', () => {
		const rows = all<{ sop_id: string; n: number }>(
			'SELECT sop_id, COUNT(*) AS n FROM sop_versions GROUP BY sop_id'
		);
		const got: Record<string, number> = {};
		for (const r of rows) got[r.sop_id] = Number(r.n);
		expect(got).toEqual(expected.sop_version_counts);
	});

	it('every SOP points at its highest version', () => {
		const bad = all(
			`SELECT s.id FROM sops s
       JOIN sop_versions cur ON cur.id = s.current_version_id
       WHERE cur.version_number <> (
         SELECT MAX(version_number) FROM sop_versions v WHERE v.sop_id = s.id
       )`
		);
		expect(bad).toEqual([]);
	});
});

describe('layer 1: referential integrity', () => {
	it('the database reports no foreign key violations', () => {
		expect(all('PRAGMA foreign_key_check')).toEqual([]);
	});

	it('integrity_check passes', () => {
		const { integrity_check } = one<{ integrity_check: string }>('PRAGMA integrity_check');
		expect(integrity_check).toBe('ok');
	});

	it('every seeded row carries the v- prefix, so it is removable', () => {
		for (const table of ['clients', 'projects', 'meetings', 'action_items', 'invoices']) {
			const { c } = one<{ c: number }>(
				`SELECT COUNT(*) AS c FROM "${table}" WHERE id NOT LIKE 'v-%'`
			);
			expect(Number(c), `${table} has rows without the v- prefix`).toBe(0);
		}
	});

	it('no test contacts or contracts are left behind', () => {
		// Same guard as tickets, same reasoning: the seed creates none, so any row
		// is a leak from a test or a probe. The layer 3 cleanup can only satisfy
		// this if DELETE /api/contacts/:id really works, so the two check each
		// other rather than each trusting the other.
		const contacts = one<{ c: number }>('SELECT COUNT(*) AS c FROM contacts');
		const contracts = one<{ c: number }>('SELECT COUNT(*) AS c FROM contracts');
		expect(Number(contacts.c), 'Contacts exist that the seed did not create.').toBe(0);
		expect(Number(contracts.c), 'Contracts exist that the seed did not create.').toBe(0);
	});

	it('no test tickets are left behind', () => {
		// Tickets have no seeded rows at all, so any row here is a leak from a
		// test or a probe. The suite has caught stray action items three times;
		// this is the same guard on the newest table.
		const { c } = one<{ c: number }>('SELECT COUNT(*) AS c FROM tickets');
		expect(
			Number(c),
			'Tickets exist that the seed did not create. A test or a probe left them behind.'
		).toBe(0);
	});

	it('no seeded action item carries an Asana gid', () => {
		const { c } = one<{ c: number }>(
			'SELECT COUNT(*) AS c FROM action_items WHERE asana_task_gid IS NOT NULL'
		);
		expect(Number(c)).toBe(0);
	});
});
