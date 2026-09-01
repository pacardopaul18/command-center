import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The unassigned bucket, and the override that empties it.
 *
 * Two properties matter here and both are the kind that erode quietly.
 *
 * The first is the golden rule: resolving an unassigned row changes which
 * client the app files it under and touches neither Asana nor Dropbox. Both are
 * the source of truth and both are read only in this phase.
 *
 * The second is precedence. A manual override outranks name matching and does
 * not outrank an asana_gid, and that order lives in code where a later edit
 * could reorder it without anything visibly breaking.
 */

const ROOT = process.cwd();

/**
 * The code with the prose taken out.
 *
 * These tests search for words the files also explain at length. Searching raw
 * text finds the explanation and fails on it, which would leave two ways out:
 * stop explaining, or weaken the test.
 */
function code(...parts: string[]): string {
	return readFileSync(join(ROOT, ...parts), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const route = code('src', 'lib', 'server', 'api', 'unassigned.ts');
const crosswalk = code('src', 'lib', 'server', 'crosswalk.ts');
const dropbox = code('src', 'lib', 'server', 'dropbox.ts');
const screen = code('src', 'routes', 'clients', 'unassigned', '+page.svelte');

describe('layer 2: filing an unassigned row changes nothing outside the app', () => {
	it('makes no request to either source system', () => {
		// The route reads mirrored tables and writes app tables. Any outbound
		// call at all from here would be a write to a system the app only reads.
		for (const call of ['fetch(', 'request(', 'asana.com', 'dropboxapi', 'ASANA_TOKEN']) {
			expect(
				route.includes(call),
				`The unassigned route names ${call}. Filing a row is the app deciding where to ` +
					'put something it has already been shown. Asana and Dropbox are the source of ' +
					'truth and are read only in this phase.'
			).toBe(false);
		}
	});

	it('writes the override to its own table, never into the crosswalk copy', () => {
		expect(route).toMatch(/INSERT INTO client_overrides/);
		// client_crosswalk is a faithful copy of a file and every load rewrites
		// it from what the file says. A manual row has no line in the file, so
		// the next load would delete exactly the corrections that cost the most.
		expect(route).not.toMatch(/INSERT INTO client_crosswalk|UPDATE client_crosswalk/);
	});

	it('refuses a client that does not exist rather than defaulting to one', () => {
		// D108. A named thing that is not there is an error, never a silent
		// substitution.
		expect(route).toMatch(/SELECT id, name FROM clients WHERE id = \?/);
		expect(route).toMatch(/That client does not exist/);
	});

	it('refuses a subject the mirror does not hold', () => {
		expect(route).toMatch(/No mirrored Asana project has that gid/);
		expect(route).toMatch(/No mirrored Dropbox folder has that path/);
	});

	it('can be undone, so a judgement can be revised', () => {
		expect(route).toMatch(/DELETE FROM client_overrides/);
	});

	it('says on the screen that nothing is changed in either source', () => {
		// The person filing needs to know the blast radius before they click,
		// not after.
		expect(screen).toMatch(/changes nothing in\s+Asana or Dropbox/);
	});
});

describe('layer 2: the override ranks below a gid and above a name', () => {
	/**
	 * The ruled order:
	 *
	 *   1. asana_gid exact
	 *   2. manual override
	 *   3. dropbox_name exact
	 *   4. normalised name
	 *   5. unassigned
	 *
	 * Asserted by reading the guards, because the order is expressed as a chain
	 * of conditions and reordering it is a two-line edit that breaks nothing
	 * visible.
	 */

	it('never consults the override when a gid matched', () => {
		expect(crosswalk).toMatch(/const manualHit = gidHit \? undefined : overrides\.get\(project\.gid\)/);
	});

	it('never consults a name when the override answered', () => {
		expect(crosswalk).toMatch(
			/const dropboxHit = gidHit \|\| manualHit \? undefined : byDropbox\.get\(project\.name\)/
		);
		expect(crosswalk).toMatch(/gidHit \|\| manualHit \|\| dropboxHit/);
	});

	it('puts the branches in the ruled order', () => {
		const order = ['gidHit', 'manualHit', 'dropboxHit', 'normalisedHit'].map((name) =>
			crosswalk.indexOf(`} else if (${name})`) >= 0
				? crosswalk.indexOf(`} else if (${name})`)
				: crosswalk.indexOf(`if (${name})`)
		);
		expect(order.every((i) => i > 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
	});

	it('applies the override on the Dropbox side too, above both name rules', () => {
		expect(dropbox).toMatch(/const manual = overrides\.get\(folder\.path\)/);
		expect(dropbox).toMatch(/const exact = manual \? undefined : byDropbox\.get\(folder\.name\)/);
		expect(dropbox).toMatch(/manual \|\| exact \? undefined/);
	});

	it('no longer skips a manual row instead of ranking it', () => {
		// The first version skipped rows already marked manual, which left the
		// precedence half in the matcher and half in whichever rows happened to
		// be left alone. A gid could then never overtake a stale override.
		expect(crosswalk).not.toMatch(/client_match === 'manual'\) continue/);
		expect(dropbox).not.toMatch(/client_match === 'manual'\) continue/);
	});
});

describe('layer 2: the roster is an overlay, not a matcher', () => {
	const roster = code('src', 'lib', 'server', 'roster.ts');
	const schema = readFileSync(
		join(ROOT, 'migrations', '0036_roster_and_overrides.sql'),
		'utf8'
	);

	it('never files a project or a folder against a client', () => {
		for (const table of ['asana_projects', 'dropbox_folders', 'client_crosswalk']) {
			expect(
				new RegExp(`(INSERT INTO|UPDATE|DELETE FROM)\\s+${table}`, 'i').test(roster),
				`The roster loader writes ${table}. It says what state a client is in, not ` +
					'which client a project belongs to. The crosswalk is the matching authority.'
			).toBe(false);
		}
	});

	it('keeps the roster status out of clients.status', () => {
		// clients.status allows active and archived. Three of the roster's five
		// values are Paul saying "this needs a second look", which neither can
		// express, and folding it would destroy the only thing the row says.
		expect(roster).not.toMatch(/UPDATE clients/);
		const body = schema.split('CREATE TABLE client_roster (')[1].split(');')[0];
		expect(body).toMatch(/status TEXT/);
		expect(body).not.toMatch(/CHECK \(status IN/);
	});

	it('reports what the table holds, not only what it wrote', () => {
		// D174, the property that would have caught the crosswalk losing ten
		// Asana gids while reporting that it wrote all fifty-five rows.
		expect(roster).toMatch(/rows_in_table/);
		expect(roster).toMatch(/SELECT COUNT\(\*\) AS rows/);
		const loads = schema.split('CREATE TABLE client_roster_loads (')[1].split(');')[0];
		expect(loads).toMatch(/rows_in_file INTEGER NOT NULL/);
		expect(loads).toMatch(/rows_written INTEGER NOT NULL/);
		expect(loads).toMatch(/rows_in_table INTEGER NOT NULL/);
	});
});
