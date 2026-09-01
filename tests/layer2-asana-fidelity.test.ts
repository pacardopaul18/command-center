import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** Code with the prose removed, so a comment about a rule cannot satisfy it. */
function code(...parts: string[]): string {
	return readFileSync(join(ROOT, ...parts), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const projection = code('src', 'lib', 'server', 'projection.ts');
const schema = readFileSync(join(ROOT, 'migrations', '0038_asana_fidelity.sql'), 'utf8');

/**
 * A ticket synced from Asana arrives complete.
 *
 * The first projection carried a title, a description, two dates and
 * complete-or-not, because those were the only columns that existed, and
 * reported everything else as dropped. Reporting it was right and leaving it
 * dropped was temporary. These tests are the standard, so the next field Asana
 * gains is a failing test rather than a silent loss.
 */

describe('layer 2: every Asana field has a home', () => {
	it('gives the ticket the columns for what belongs to one ticket', () => {
		for (const column of [
			'asana_section',
			'asana_assignee_gid',
			'asana_modified_at',
			'asana_url'
		]) {
			expect(
				schema.includes(`ALTER TABLE tickets ADD COLUMN ${column}`),
				`tickets has no ${column}. A field Asana holds and the app drops is a field ` +
					'nobody knows is missing.'
			).toBe(true);
		}
	});

	it('gives the sets their own tables rather than a delimited string', () => {
		for (const table of ['ticket_tags', 'ticket_followers', 'ticket_custom_values']) {
			expect(schema).toMatch(new RegExp(`CREATE TABLE ${table} \\(`));
		}
	});

	it('keys custom values on the field gid, not on its name', () => {
		// A custom field can be renamed in Asana at any time. Keying on the name
		// would orphan every value the first time somebody edits a label.
		const body = schema.split('CREATE TABLE ticket_custom_values (')[1].split(');')[0];
		expect(body).toMatch(/field_gid TEXT NOT NULL/);
		expect(body).toMatch(/PRIMARY KEY \(ticket_id, field_gid\)/);
	});

	it('projects all three sets', () => {
		expect(projection).toMatch(/INSERT OR IGNORE INTO ticket_tags/);
		expect(projection).toMatch(/INSERT OR IGNORE INTO ticket_followers/);
		expect(projection).toMatch(/INSERT INTO ticket_custom_values/);
	});

	it('clears only the rows it owns before rewriting them', () => {
		/*
		 * A tag removed in Asana has to disappear here too, so the projection
		 * clears and rewrites. It must clear only its own rows: a tag somebody
		 * added in the app is marked manual and is not the projection's to delete.
		 */
		expect(projection).toMatch(/DELETE FROM ticket_tags WHERE source = 'asana'/);
		expect(projection).toMatch(/DELETE FROM ticket_followers WHERE source = 'asana'/);
		expect(projection).toMatch(/DELETE FROM ticket_custom_values\s*\n?\s*WHERE ticket_id IN \(SELECT ticket_id FROM asana_task_links\)/);
	});

	it('still refuses to invent app users for Asana people', () => {
		expect(projection).not.toMatch(/INSERT INTO users/i);
	});
});

describe('layer 2: a derived value that a person overrode stays overridden', () => {
	it('records whether phase and status were set by hand', () => {
		expect(schema).toMatch(/ALTER TABLE projects ADD COLUMN phase_is_manual/);
		expect(schema).toMatch(/ALTER TABLE projects ADD COLUMN status_is_manual/);
	});

	it('does not re-derive over a manual phase or status', () => {
		/*
		 * Overwriting a person's decision on the next projection would revert it
		 * with nothing to say why, which is the worst kind of silent write.
		 */
		expect(projection).toMatch(
			/phase = CASE WHEN projects\.phase_is_manual = 1 THEN projects\.phase ELSE \?4 END/
		);
		expect(projection).toMatch(
			/status = CASE WHEN projects\.status_is_manual = 1 THEN projects\.status ELSE \?5 END/
		);
	});
});

describe('layer 2: phase and status come from the work, not from one flag', () => {
	it('reads ticket counts, not just the archived bit', () => {
		expect(projection).toMatch(/interface ProjectSignals/);
		expect(projection).toMatch(/tickets: number;/);
		expect(projection).toMatch(/overdue: number;/);
	});

	it('derives the signals from the mirror rather than from projected tickets', () => {
		// The app's tickets do not exist yet when the projects are written, and
		// deriving from two different sources is how two screens start disagreeing.
		expect(projection).toMatch(/const signals = new Map</);
		expect(projection).toMatch(/if \(task\.due_on && task\.due_on < today\) row\.overdue \+= 1;/);
	});

	it('does not read a completion ratio as a PMI phase', () => {
		/*
		 * The phases are not a progress bar. "Monitoring" derived from 50% done
		 * would be inventing a meaning the word does not have, so only three
		 * things are claimed: archived is closed, no tickets is not started, and
		 * no open tickets is closing.
		 */
		expect(projection).not.toMatch(/'monitoring'/);
		expect(projection).not.toMatch(/'planning'/);
	});
});

describe('layer 2: the ticket detail hides nothing it was given', () => {
	const route = code('src', 'lib', 'server', 'api', 'tickets.ts');
	const page = readFileSync(
		join(ROOT, 'src', 'routes', 'tickets', '[id]', '+page.svelte'),
		'utf8'
	);

	it('returns the sets with the ticket', () => {
		expect(route).toMatch(/FROM ticket_tags WHERE ticket_id = \?/);
		expect(route).toMatch(/FROM ticket_followers WHERE ticket_id = \?/);
		expect(route).toMatch(/FROM ticket_custom_values WHERE ticket_id = \?/);
	});

	it('renders the description card even when there is nothing in it', () => {
		/*
		 * The card used to disappear when the description was empty, so a ticket
		 * with nothing written offered no way to write anything. An empty card
		 * that invites the first sentence is the point of an empty card.
		 */
		expect(page).not.toMatch(/\{#if ticket\.description\}\s*<Card title="Description">/);
		expect(page).toMatch(/No description yet\./);
		expect(page).toMatch(/saveDescription/);
	});

	it('lets somebody log time for a day that is not today', () => {
		// People log late. A form that can only say "now" makes them lie about
		// when or not log it at all. The API always accepted logged_on.
		expect(page).toMatch(/effortDraft\.logged_on/);
		expect(page).toMatch(/logged_on: effortDraft\.logged_on \|\| null/);
	});
});
