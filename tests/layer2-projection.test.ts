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
		/*
		 * `asana.com` was on this list and has been taken off, deliberately.
		 *
		 * The projection now builds a link to the Asana task so a ticket can
		 * offer "open this in Asana". That is a string in a column, not a
		 * request: a URL nobody fetches reaches nothing. Keeping the hostname
		 * banned would have meant dropping the link or weakening the claim,
		 * and the property was never "the word does not appear" but "nothing
		 * here calls out".
		 *
		 * What remains is what could actually make a call: the two request
		 * helpers, and the token without which none would be authorised.
		 */
		for (const call of ['fetch(', 'request(', 'dropboxapi', 'ASANA_TOKEN']) {
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
		const tables = [
			'projects',
			'tickets',
			'ticket_parents',
			'ticket_tags',
			'ticket_followers',
			'ticket_custom_values'
		];

		// Checked per table rather than by counting matches inside a fixed
		// window. The window was 600 characters, the projects statement grew
		// past it, and the test started checking two of three without saying
		// so. A test that quietly checks less than it claims is worse than one
		// that fails.
		for (const table of tables) {
			const at = projection.indexOf(`INTO ${table}`);
			expect(at, `nothing writes ${table}`).toBeGreaterThan(-1);

			const statement = projection.slice(at, at + 900);
			const upserts =
				/ON CONFLICT/.test(statement) ||
				/INSERT OR IGNORE/.test(projection.slice(Math.max(0, at - 24), at));

			expect(
				upserts,
				`The write to ${table} is a plain INSERT, so a second run doubles it.`
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

	it('reports every field it still cannot carry, with the reason and a count', () => {
		expect(projection).toMatch(/dropped_fields/);

		/*
		 * This list shrank, and that is the point of the change that shrank it.
		 *
		 * Tags, custom fields and followers were on it because the app had no
		 * columns for them. Migration 0038 gave them tables and the projection
		 * carries them, so asserting they are still reported as dropped would be
		 * asserting yesterday's truth. What is left is what is deliberately not
		 * carried, and each of those has a reason that is a decision rather than
		 * a gap.
		 */
		for (const field of ['stories', 'assignee_id', 'ticket status detail']) {
			expect(
				projection.includes(`'${field}'`),
				`${field} is not in the dropped list. A projection that discards a field ` +
					'quietly leaves a screen looking complete while real information is nowhere.'
			).toBe(true);
		}

		// And these must no longer claim to be dropped, because they are not.
		for (const carried of ['tags', 'custom fields', 'followers']) {
			expect(
				projection.includes(`field: '${carried}'`),
				`${carried} is still reported as dropped, but the projection now carries it. ` +
					'A report that overstates the loss is as wrong as one that hides it.'
			).toBe(false);
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
