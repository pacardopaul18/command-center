import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv, normaliseName } from '../src/lib/csv';

/**
 * The guarantees the real-data mirror rests on, asserted rather than trusted.
 *
 * The ruling is that Asana and Dropbox are the source of truth and this app
 * mirrors them read only in this phase. Every one of these tests exists because
 * a property of that sentence is the kind of thing that erodes quietly during
 * an unrelated change, and would then be discovered by somebody noticing their
 * real Asana had been edited.
 *
 * They are deliberately blunt. A subtle test here would be worse: the point is
 * that whoever adds a write sees a failure naming the decision they are
 * overturning.
 */

const SERVER = join(process.cwd(), 'src', 'lib', 'server');

function read(...parts: string[]): string {
	return readFileSync(join(SERVER, ...parts), 'utf8');
}

describe('layer 2: the mirror never writes to Asana', () => {
	const mirror = read('asana-mirror.ts');

	it('issues no request with a method other than the default GET', () => {
		// The mirror calls `request(token, path)` and never passes an init. Any
		// method at all in this file is a write, because reading needs none.
		for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) {
			expect(
				mirror.includes(`'${verb}'`) || mirror.includes(`"${verb}"`),
				`asana-mirror.ts names the ${verb} method. The mirror is read only in this ` +
					'phase: Asana is the source of truth and nothing here may change it.'
			).toBe(false);
		}
	});

	it('does not reach for the task-creating client', () => {
		expect(
			/\bcreateTask\b/.test(mirror),
			'asana-mirror.ts imports createTask. Pushing is the separate one-way sync; ' +
				'the mirror pulls and only pulls.'
		).toBe(false);
	});
});

describe('layer 2: mirrored rows are never edited by hand', () => {
	/**
	 * Only two files may write the asana_* tables: the mirror that pulls them,
	 * and the crosswalk that files a project against a client.
	 *
	 * The filing is the one allowed exception and it is narrow: it sets
	 * client_id and client_match, which are the app's answer about a mirrored
	 * row rather than a change to what Asana said. Anything else editing these
	 * tables would be a hand correction that the next pull silently reverts,
	 * and nobody would know which of the two was right.
	 */
	const ALLOWED = new Set(['asana-mirror.ts', join('api', 'crosswalk.ts'), 'crosswalk.ts']);

	function walk(dir: string): string[] {
		return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) return walk(full);
			return entry.name.endsWith('.ts') ? [full] : [];
		});
	}

	it('writes the asana_ tables from the mirror and the filing, and nowhere else', () => {
		const offenders: string[] = [];

		for (const file of walk(SERVER)) {
			const relative = file.slice(SERVER.length + 1);
			if (ALLOWED.has(relative)) continue;

			const text = readFileSync(file, 'utf8');
			if (/\b(INSERT INTO|UPDATE|DELETE FROM)\s+asana_/i.test(text)) {
				offenders.push(relative);
			}
		}

		expect(
			offenders,
			'These files write to the Asana mirror tables. Mirrored data is re-pulled, ' +
				'never hand corrected: a local edit is a correction the next sync reverts.'
		).toEqual([]);
	});

	it('changes only the filing columns when it does write them', () => {
		const crosswalk = read('crosswalk.ts');
		const updates = crosswalk.match(/UPDATE asana_\w+ SET ([^']+)/g) ?? [];
		expect(updates.length).toBeGreaterThan(0);
		for (const statement of updates) {
			expect(
				/SET client_id = \?, client_match = \?/.test(statement),
				`${statement} changes more than the filing. The crosswalk decides which ` +
					'client a project belongs to and nothing else about it.'
			).toBe(true);
		}
	});
});

describe('layer 2: the suite never runs against the real database', () => {
	it('is not pointed at the real-data environment', () => {
		expect(
			process.env.CC_DATA,
			'The suite is running with CC_DATA=real. The tests write fixtures and delete ' +
				'them again; the real mirror is not a place to do that.'
		).not.toBe('real');
	});

	it('keeps the two state directories apart in the build config', () => {
		const config = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');
		expect(config).toMatch(/REAL_STATE_DIR = '\.wrangler\/real\/v3'/);
		// The `v3` is load bearing. Wrangler's CLI appends it and miniflare does
		// not, so a path without it means migrations land in one database and
		// the dev server reads another.
		expect(config).toMatch(/v3/);
	});
});

describe('layer 2: mirrored rows carry their provenance', () => {
	const schema = readFileSync(
		join(process.cwd(), 'migrations', '0032_asana_mirror.sql'),
		'utf8'
	);

	it('gives every mirrored entity a gid primary key', () => {
		const entities = [
			'asana_workspaces',
			'asana_teams',
			'asana_users',
			'asana_projects',
			'asana_sections',
			'asana_tasks',
			'asana_tags',
			'asana_custom_fields',
			'asana_attachments',
			'asana_stories'
		];
		for (const table of entities) {
			const body = schema.split(`CREATE TABLE ${table} (`)[1]?.split(');')[0] ?? '';
			expect(body, `${table} is missing from the migration`).not.toBe('');
			expect(
				/gid TEXT PRIMARY KEY/.test(body),
				`${table} is not keyed on its Asana gid. A gid survives renames and moves; ` +
					'a local id would need its own mapping back, which is one more thing to drift.'
			).toBe(true);
		}
	});

	it('stamps every mirrored entity with when it was synced', () => {
		for (const table of [
			'asana_workspaces',
			'asana_teams',
			'asana_users',
			'asana_projects',
			'asana_sections',
			'asana_tasks',
			'asana_tags',
			'asana_custom_fields',
			'asana_attachments',
			'asana_stories'
		]) {
			const body = schema.split(`CREATE TABLE ${table} (`)[1]?.split(');')[0] ?? '';
			expect(
				/synced_at TEXT NOT NULL/.test(body),
				`${table} has no synced_at. Provenance is not optional: a mirrored row has ` +
					'to be able to say when it was last true.'
			).toBe(true);
		}
	});

	it('stores no attachment bytes and no download URL', () => {
		const body = schema.split('CREATE TABLE asana_attachments (')[1].split(');')[0];
		expect(body).not.toMatch(/\burl\b/i);
		expect(body).not.toMatch(/\bcontent\b|\bblob\b|\bbytes\b(?!_)/i);
	});

	it('keeps the section name Asana spells, for Thursday to read', () => {
		const body = schema.split('CREATE TABLE asana_tasks (')[1].split(');')[0];
		expect(
			/section_name TEXT/.test(body),
			'asana_tasks has no section_name. The verbatim section is the input to the ' +
				'status-model reconciliation; translating it now would be guessing the answer.'
		).toBe(true);
	});
});

describe('layer 2: the mirror is resumable by gid, never by timestamp', () => {
	const mirror = readFileSync(join(SERVER, 'asana-mirror.ts'), 'utf8');

	it('cursors on a gid', () => {
		expect(mirror).toMatch(/gid > \?2/);
	});

	it('never asks Asana for what changed since a time', () => {
		expect(
			/modified_since|modified_at\.after|since=/.test(mirror),
			'The mirror is paging by a timestamp. A timestamp cursor re-syncs everything ' +
				'the first time somebody bulk edits, and ties on writes in the same second.'
		).toBe(false);
	});

	it('sweeps again when the set grew under the walk', () => {
		// Subtasks are tasks and are written as they are found, so one discovered
		// under task 900 can carry a gid below the cursor and be walked past. A
		// phase that reported done over a set it never finished would look
		// exactly like success.
		expect(mirror).toMatch(/sweep_started_with/);
		expect(mirror).toMatch(/grewBy > 0 && sweepsSoFar < 3/);
	});

	it('does not claim a project whose pages it did not finish', () => {
		expect(
			/if \(!next\) cursor = project\.gid;/.test(mirror),
			'The tasks phase advances its cursor unconditionally. A project marked ' +
				'finished part way through loses the rest of its tasks silently, which ' +
				'looks like success.'
		).toBe(true);
	});
});

describe('layer 2: reading the crosswalk file', () => {
	it('reads quoted fields containing commas and newlines', () => {
		const table = parseCsv(
			'canonical_name,notes\n"Smith, Jones & Co","line one\nline two"\nPlain,ok\n'
		);
		expect(table.header).toEqual(['canonical_name', 'notes']);
		expect(table.rows).toHaveLength(2);
		expect(table.rows[0].canonical_name).toBe('Smith, Jones & Co');
		expect(table.rows[0].notes).toBe('line one\nline two');
		expect(table.rows[1].canonical_name).toBe('Plain');
	});

	it('reads a doubled quote as one quote', () => {
		const table = parseCsv('canonical_name\n"The ""Big"" One"\n');
		expect(table.rows[0].canonical_name).toBe('The "Big" One');
	});

	it('strips the byte order mark Excel writes', () => {
		const table = parseCsv('﻿canonical_name,type\nAcme,client\n');
		expect(table.header[0]).toBe('canonical_name');
		expect(table.rows[0].canonical_name).toBe('Acme');
	});

	it('does not turn a trailing newline into a row', () => {
		expect(parseCsv('a,b\n1,2\n').rows).toHaveLength(1);
		expect(parseCsv('a,b\r\n1,2\r\n').rows).toHaveLength(1);
	});

	it('leaves a blank blank rather than guessing a zero', () => {
		const table = parseCsv('canonical_name,asana_total_tasks\nAcme,\n');
		expect(table.rows[0].asana_total_tasks).toBe('');
	});
});

describe('layer 2: name normalisation is conservative', () => {
	it('ignores case, punctuation and the legal suffix', () => {
		expect(normaliseName('MacGray, LLC')).toBe(normaliseName('macgray llc'));
		expect(normaliseName('Acme Inc.')).toBe(normaliseName('ACME'));
		expect(normaliseName('Smith  &  Jones')).toBe(normaliseName('Smith and Jones'.replace(' and ', ' & ')));
	});

	it('does not collapse two different clients onto one key', () => {
		// The third precedence rule sits below two exact ones, so an over-eager
		// normaliser is the failure mode that matters: it files real work under
		// the wrong client, invisibly.
		const distinct = [
			'Northside Dental',
			'Northside Medical',
			'Acme Holdings',
			'Acme Logistics',
			'Gray Brothers',
			'Gray Sisters'
		];
		const keys = distinct.map(normaliseName);
		expect(new Set(keys).size).toBe(distinct.length);
	});

	it('produces an empty key rather than a wrong one for a name with no letters', () => {
		expect(normaliseName('---')).toBe('');
	});
});
