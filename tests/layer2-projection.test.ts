import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * The projection: the mirror rendered onto the app's own screens.
 *
 * The failure this exists to prevent is the one that produced it. The mirror
 * held 66 projects and 2,585 tasks and `/projects` showed nothing, because the
 * mirror was deliberately a side model and nothing was ever built to read it.
 * These tests are about the properties of the pass that closes that gap, and
 * every one of them is a property that would be invisible if it broke.
 */

const ROOT = process.cwd();

/** Code with the prose removed, so a comment explaining a rule cannot satisfy it. */
function code(...parts: string[]): string {
	return readFileSync(join(ROOT, ...parts), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const projection = code('src', 'lib', 'server', 'projection.ts');

describe('layer 2: a projection never writes to Asana or Dropbox', () => {
	it('makes no outbound request of any kind', () => {
		for (const call of ['fetch(', 'request(', 'asana.com', 'dropboxapi', 'ASANA_TOKEN']) {
			expect(
				projection.includes(call),
				`projection.ts names ${call}. It reads mirror tables and writes app tables. ` +
					'Asana and Dropbox are the source of truth and are read only in this phase.'
			).toBe(false);
		}
	});

	it('writes no mirror table', () => {
		// The mirror is what Asana said. The projection is a rendering of it, and
		// a rendering that edited its own source could not be re-derived.
		expect(projection).not.toMatch(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+asana_(?!project_links|task_links)/i);
		expect(projection).not.toMatch(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+dropbox_/i);
	});
});

describe('layer 2: the projection is idempotent by construction', () => {
	it('finds every row again by its Asana gid, not by name or position', () => {
		expect(projection).toMatch(/asana_project_links/);
		expect(projection).toMatch(/asana_task_links/);
		expect(projection).toMatch(/projectIdFor\.get\(/);
		expect(projection).toMatch(/ticketIdFor\.get\(/);
	});

	it('upserts rather than inserting', () => {
		// Two runs must converge. An INSERT with no conflict clause doubles the
		// app's model every time somebody re-pulls.
		const inserts = projection.match(/INSERT INTO (projects|tickets|ticket_parents)[\s\S]{0,600}?`/g) ?? [];
		expect(inserts.length).toBeGreaterThanOrEqual(3);
		for (const statement of inserts) {
			expect(
				/ON CONFLICT/.test(statement),
				`This INSERT has no ON CONFLICT clause, so a second run doubles it:\n${statement.slice(0, 160)}`
			).toBe(true);
		}
	});

	it('never decides what to write from what the app currently shows', () => {
		/*
		 * Reading the app's own rows to choose the next write makes the result
		 * depend on how many times the pass has run, which is the definition of
		 * not idempotent.
		 *
		 * Reading them afterwards to report is the opposite and is required:
		 * D174 says a run states what the tables hold, not only what its loop
		 * counted. So the check is on the deciding half of the file, everything
		 * before the reporting helper, rather than on the whole of it. A test
		 * that banned both would have forced the reporting to be dropped or the
		 * assertion weakened, and neither is the right answer.
		 */
		const deciding = projection.split('const count = async')[0];
		expect(deciding).not.toBe(projection);

		expect(deciding).not.toMatch(/SELECT[^`]*FROM projects/i);
		expect(deciding).not.toMatch(/SELECT[^`]*FROM tickets/i);
	});

	it('assigns every ticket id before writing any row', () => {
		// A subtask whose parent sorts later still needs a parent id to point at.
		// Without this the parent link is silently dropped for roughly half of
		// them, depending on gid order.
		expect(projection).toMatch(/for \(const task of tasks\) \{\s*if \(!ticketIdFor\.has\(task\.gid\)\)/);
	});
});

describe('layer 2: nothing is projected without a source, and nothing is invented', () => {
	it('skips a task with no project rather than attaching it somewhere', () => {
		expect(projection).toMatch(/a task belonged to no project the mirror holds/);
		// And the skip is counted, not swallowed. D138.
		expect(projection).toMatch(/const skip = \(why: string\)/);
	});

	it('does not project stories into action items', () => {
		/*
		 * Ruled, and worth a test rather than a comment. 10,062 stories are
		 * comments and system events, not commitments; projecting them would bury
		 * the one screen that says what Paul owes people under ten thousand rows
		 * nobody owes anybody.
		 */
		expect(
			/INSERT INTO action_items/i.test(projection),
			'The projection writes action items. Stories are an activity trail, not ' +
				'commitments. Action items stay empty until real extraction produces them.'
		).toBe(false);
	});

	it('creates no user rows for Asana assignees', () => {
		expect(projection).not.toMatch(/INSERT INTO users/i);
		expect(projection).toMatch(/assignee_name/);
	});

	it('reports every field it could not carry, with the reason and a count', () => {
		expect(projection).toMatch(/dropped_fields/);
		for (const field of ['tags', 'custom fields', 'followers', 'stories', 'assignee_id']) {
			expect(
				projection.includes(`'${field}'`),
				`${field} is not in the dropped list. A projection that discards a field ` +
					'quietly leaves a screen looking complete while real information is nowhere.'
			).toBe(true);
		}
	});

	it('states the phase derivation instead of defaulting silently', () => {
		// projects.phase is NOT NULL with a default, so something goes in it. The
		// choice is a silent 'initiating' on 66 projects or a stated rule.
		expect(projection).toMatch(/function projectPhase/);
		expect(projection).toMatch(/archived\s*$|archived\n|archived \?/m);
		expect(projection).toMatch(/project phase and status/);
	});
});

describe('layer 2: a parent link is its own table, not a ticket_link kind', () => {
	const schema = readFileSync(join(ROOT, 'migrations', '0037_projection.sql'), 'utf8');

	it('gives a ticket at most one parent, structurally', () => {
		const body = schema.split('CREATE TABLE ticket_parents (')[1].split(');')[0];
		expect(body).toMatch(/child_ticket_id TEXT PRIMARY KEY/);
	});

	it('records whether the projection owns the row', () => {
		const body = schema.split('CREATE TABLE ticket_parents (')[1].split(');')[0];
		expect(body).toMatch(/source TEXT NOT NULL DEFAULT 'asana'/);
		// A re-projection rewrites only what it created.
		expect(projection).toMatch(/WHERE ticket_parents\.source = 'asana'/);
	});
});

describe('layer 2: the projected rows in this database trace to a mirror row', () => {
	/**
	 * Read straight from the fixture database rather than through the API.
	 *
	 * The fixture has no mirror, so every count here is zero, and that is the
	 * assertion: the seed authors projects and tickets of its own and none of
	 * them may claim an Asana source. On the real-data environment the same test
	 * would compare the two sides properly. Either way the property is that a
	 * link never points at a row that is not there.
	 */
	function localD1Path(): string {
		const dir = join('.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
		const files = readdirSync(dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
		return join(dir, files[0]);
	}

	it('has no link pointing at a project or ticket that does not exist', () => {
		const db = new DatabaseSync(localD1Path(), { readOnly: true });
		const orphanProjects = db
			.prepare(
				`SELECT COUNT(*) AS n FROM asana_project_links l
         WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = l.project_id)`
			)
			.get() as { n: number };
		const orphanTickets = db
			.prepare(
				`SELECT COUNT(*) AS n FROM asana_task_links l
         WHERE NOT EXISTS (SELECT 1 FROM tickets t WHERE t.id = l.ticket_id)`
			)
			.get() as { n: number };

		expect(Number(orphanProjects.n)).toBe(0);
		expect(Number(orphanTickets.n)).toBe(0);
	});

	it('has no link whose Asana row is missing from the mirror', () => {
		const db = new DatabaseSync(localD1Path(), { readOnly: true });
		const ghostProjects = db
			.prepare(
				`SELECT COUNT(*) AS n FROM asana_project_links l
         WHERE NOT EXISTS (SELECT 1 FROM asana_projects p WHERE p.gid = l.asana_gid)`
			)
			.get() as { n: number };
		const ghostTickets = db
			.prepare(
				`SELECT COUNT(*) AS n FROM asana_task_links l
         WHERE NOT EXISTS (SELECT 1 FROM asana_tasks t WHERE t.gid = l.asana_gid)`
			)
			.get() as { n: number };

		expect(
			Number(ghostProjects.n),
			'A projected project claims an Asana source the mirror does not hold.'
		).toBe(0);
		expect(
			Number(ghostTickets.n),
			'A projected ticket claims an Asana source the mirror does not hold.'
		).toBe(0);
	});
});

describe('layer 2: the files view reads the mirror and cannot change it', () => {
	const route = code('src', 'lib', 'server', 'api', 'files.ts');

	it('has no write, upload, move or delete surface', () => {
		for (const word of ['upload', 'delete', 'move', 'INSERT INTO', 'UPDATE ', 'DELETE FROM']) {
			expect(
				new RegExp(word.trim(), 'i').test(route),
				`The files route names "${word.trim()}". Dropbox is the source of truth and the ` +
					'app mirrors it read only. The absence of the surface is the mechanism.'
			).toBe(false);
		}
	});

	it('serves no file contents', () => {
		for (const word of ['download', 'readFile', 'arrayBuffer', 'blob']) {
			expect(new RegExp(word, 'i').test(route)).toBe(false);
		}
	});

	it('copies no file row into the app model', () => {
		/*
		 * There is deliberately no projection pass for files. Copying 11,150
		 * metadata rows into `project_files` would be a second copy to keep
		 * converging, for no gain: the app authors nothing about them. A query
		 * renders them and the mirror stays the only place they live.
		 */
		expect(projection).not.toMatch(/dropbox_files/);
		expect(projection).not.toMatch(/INSERT INTO project_files/i);
	});

	it('counts the files under folders nobody has matched yet', () => {
		// Hiding them would report a smaller Dropbox than exists. 694 of the
		// 11,150 sit under the 14 unmatched client folders.
		expect(route).toMatch(/files_not_under_a_matched_client/);
	});
});
