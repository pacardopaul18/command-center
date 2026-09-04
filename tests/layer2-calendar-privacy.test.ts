import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calendarOwnership, label, shortLabel } from '../src/lib/calendar-label';

const ROOT = process.cwd();

function code(...parts: string[]): string {
	return readFileSync(join(ROOT, ...parts), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const connections = code('src', 'lib', 'server', 'api', 'connections.ts');

/**
 * A partner's calendar tells this app when they are busy and nothing else.
 *
 * Paul subscribes to his partners' calendars so scheduling can avoid their
 * meetings. Avoiding a meeting needs its start and its end. It does not need
 * the title, the description, the location, the attendees or the link, and this
 * app has no business holding any of it: those meetings belong to other people
 * who never agreed to have them stored here.
 *
 * The boundary is enforced at the write, so nothing about somebody else's
 * meeting ever reaches the database, rather than at the read, where it would
 * survive exactly as long as every future query remembered to exclude it.
 */

describe('layer 2: a calendar Paul does not own stores free and busy only', () => {
	it('decides ownership from the access role Google gives, not from the name', () => {
		/*
		 * `accessRole` is recorded when the calendar list is read. Inferring it
		 * from the summary would be guessing, and a calendar named after a person
		 * is not evidence about who owns it: Paul's own calendars are named after
		 * him too.
		 */
		expect(connections).toMatch(/const ownedByPaul = \(target\.access_role \?\? 'owner'\) === 'owner'/);
		expect(connections).toMatch(/access_role\s*\n?\s*FROM calendars WHERE sync_enabled = 1/);
	});

	it('writes null for every descriptive field on a calendar Paul does not own', () => {
		/*
		 * `conference_url` joined this list when it was added, and that is the
		 * test working: a new field read from Google has to be put behind the
		 * boundary at the moment it is introduced, not remembered later. A join
		 * link is a door into a room, and the furthest thing from free/busy
		 * there is.
		 */
		for (const field of [
			'summary',
			'description',
			'location',
			'organizer',
			'attendee_count',
			'html_link',
			'conference_url'
		]) {
			expect(
				connections.includes(`ownedByPaul ? e.${field} : null`),
				`${field} is stored unconditionally. A partner's meeting must reach this ` +
					'database as a time and nothing else.'
			).toBe(true);
		}
	});

	it('writes no attendee rows for a calendar Paul does not own', () => {
		expect(connections).toMatch(/for \(const a of ownedByPaul \? e\.attendees : \[\]\)/);
	});

	it('clears anything a previous sync stored before the rule existed', () => {
		/*
		 * A calendar synced before this rule, or one whose access role changed
		 * after a share was narrowed, would otherwise keep detail the rule says
		 * must not be here. Enforcing it only on new writes would make the
		 * property true of the code and false of the database.
		 */
		expect(connections).toMatch(/UPDATE calendar_events\s*\n?\s*SET summary = NULL, description = NULL, location = NULL,/);
		expect(connections).toMatch(/DELETE FROM calendar_event_attendees\s*\n?\s*WHERE event_id IN \(SELECT id FROM calendar_events WHERE calendar_id = \?\)/);
	});

	it('tells the screen which rows are free/busy only, derived not stored', () => {
		// A copy on every event row would be a second answer that goes stale the
		// moment a share is narrowed.
		const derivations = connections.match(
			/CASE WHEN COALESCE\(cal\.access_role, 'owner'\) = 'owner' THEN 0 ELSE 1 END AS free_busy_only/g
		);
		expect(derivations?.length, 'both event queries must expose it').toBeGreaterThanOrEqual(2);
	});
});

describe('layer 2: a busy block reads as busy, not as a failure', () => {
	it('names the calendar rather than showing an empty event', () => {
		/*
		 * "(no title)" against a partner's meeting describes a deliberate privacy
		 * boundary as a data failure. Somebody would go looking for the bug, find
		 * nothing, and either give up or "fix" it by storing the titles.
		 */
		expect(label({ free_busy_only: 1, calendar_name: 'Dustin Finkel', summary: null })).toBe(
			'Busy · Dustin Finkel'
		);
		expect(label({ free_busy_only: 1, calendar_name: null, summary: null })).toBe('Busy');
	});

	it('never leaks a title even if one somehow reached the row', () => {
		// Belt as well as braces. The write path is the guard; this makes the
		// screen incapable of showing a title it should not have been given.
		expect(
			label({ free_busy_only: 1, calendar_name: 'A partner', summary: 'Confidential review' })
		).toBe('Busy · A partner');
	});

	it('still says "(no title)" for an owned event that genuinely has none', () => {
		// Google lets an event be saved without a title. On Paul's own calendar
		// that is a real absence and saying so is accurate.
		expect(label({ free_busy_only: 0, calendar_name: 'Paul', summary: null })).toBe('(no title)');
		expect(label({ free_busy_only: 0, summary: '   ' })).toBe('(no title)');
	});

	it('shows an owned event by its title', () => {
		expect(label({ free_busy_only: 0, summary: 'Board meeting' })).toBe('Board meeting');
	});

	it('is the only thing the calendar views call', () => {
		// One function, because the interesting case is the one that is easy to
		// get right in some views and forget in others.
		/*
		 * Every screen that renders an event, not only the calendar ones.
		 *
		 * The meetings page and the meeting detail rendered the raw summary, so a
		 * partner's block appeared there as "Untitled call" and "(no title)"
		 * while the calendar showed it correctly as busy. One rule, applied in
		 * two of four places, is a rule that looks broken wherever it was missed:
		 * every event in the current window is on a non-owned calendar, so every
		 * one of them read as a call whose name had failed to load.
		 */
		for (const file of [
			['src', 'routes', 'calendar', '+page.svelte'],
			['src', 'lib', 'components', 'CalendarWeek.svelte'],
			['src', 'routes', 'meetings', '+page.svelte'],
			['src', 'routes', 'meetings', '[id]', '+page.svelte']
		]) {
			const view = readFileSync(join(ROOT, ...file), 'utf8');
			for (const fallback of ["summary ?? '(no title)'", "summary ?? 'Untitled call'", "summary ?? 'Untitled'"]) {
				expect(
					view.includes(fallback),
					`${file.join('/')} still renders a raw summary fallback instead of label().`
				).toBe(false);
			}
			// `label` from the shared module, however the import is spelled: the
			// calendar page now also takes `calendarOwnership` from it, and an
			// exact-string match would have failed on a second correct import.
			expect(
				view.includes("label } from '$lib/calendar-label'") ||
					view.includes(", label } from '$lib/calendar-label'"),
				`${file.join('/')} does not take label from the shared module.`
			).toBe(true);
		}
	});
});

describe('layer 2: the scopes did not widen to make this possible', () => {
	it('still requests only the two read scopes', () => {
		const google = code('src', 'lib', 'server', 'google.ts');
		expect(google).toMatch(/calendar\.readonly/);
		expect(google).not.toMatch(/calendar\.events\b/);
		expect(google).not.toMatch(/'https:\/\/www\.googleapis\.com\/auth\/calendar'/);
	});
});


describe('layer 2: the screen does not call another person calendar yours', () => {
	/*
	 * W5a. The calendar page printed "yours" against every row in the list, with
	 * no ownership check at all. Six of the seven calendars are read-only shares
	 * from partners, so the one word on that screen naming the privacy boundary
	 * was wrong about six of the seven rows it appeared on.
	 *
	 * `CalendarList.svelte` had split correctly on access_role the whole time.
	 * One rule, applied in one place of two. D216, and here the half that was
	 * missed looked confident rather than broken, which is worse.
	 */
	it('says yours only for a calendar Paul owns', () => {
		expect(calendarOwnership({ access_role: 'owner', is_primary: 1 })).toBe('yours, primary');
		expect(calendarOwnership({ access_role: 'owner', is_primary: 0 })).toBe('yours');
	});

	it('never says yours for a calendar somebody shared', () => {
		for (const role of ['reader', 'freeBusyReader', 'writer']) {
			const said = calendarOwnership({ access_role: role, is_primary: 0 });
			expect(said, `${role} was described as yours`).not.toContain('yours');
			expect(said).toBe('shared with you, busy times only');
		}
	});

	it('says what is stored, not only who owns it', () => {
		/*
		 * The person reading this line is the one who has to tell Dustin what
		 * this app holds about his diary. "Shared with you" alone does not
		 * answer that; "busy times only" does. D205.
		 */
		expect(calendarOwnership({ access_role: 'reader' })).toContain('busy times only');
	});

	it('treats a missing access role as owned, the same as everywhere else', () => {
		// The same default the sync and the event queries use, so a calendar read
		// before access roles were recorded does not silently become somebody
		// else's on the screen while staying Paul's in the database.
		expect(calendarOwnership({ is_primary: 1 })).toBe('yours, primary');
		expect(calendarOwnership({ access_role: null })).toBe('yours');
	});

	it('is what the calendar page calls, rather than a second copy of the rule', () => {
		const page = readFileSync(join(ROOT, 'src', 'routes', 'calendar', '+page.svelte'), 'utf8');
		expect(page).toMatch(/calendarOwnership\(cal\)/);
		expect(page, 'the old unconditional label is still there').not.toMatch(
			/is_primary \? 'yours, primary' : 'yours'/
		);
	});
});


describe('layer 2: a dense view gets a dense label', () => {
	/*
	 * D234 applied to the thing that produced it. A week-grid day column has
	 * about 105 pixels and "Busy · meredith@macgrayconsulting.com" wants 226, so
	 * every block truncated to "Busy · mer..." and carried nothing. Widening does
	 * not fix it: seven columns and a full address do not fit at any screen size.
	 *
	 * The domain is dropped rather than the label truncated. Every calendar here
	 * is at one firm, so the domain is the half that is identical on all of them,
	 * and dropping the shared half is lossless in the way cutting the
	 * distinguishing half is not.
	 */
	it('drops the domain and keeps the person', () => {
		expect(shortLabel({ free_busy_only: 1, calendar_name: 'meredith@macgrayconsulting.com', summary: null })).toBe(
			'Busy · meredith'
		);
	});

	it('leaves a name that is not an address alone', () => {
		expect(shortLabel({ free_busy_only: 1, calendar_name: 'Holidays in Philippines', summary: null })).toBe(
			'Busy · Holidays in Philippines'
		);
		expect(shortLabel({ free_busy_only: 0, summary: 'Board meeting' })).toBe('Board meeting');
	});

	it('never turns a busy block into a titled one', () => {
		// The privacy rule does not move for a layout change.
		expect(
			shortLabel({ free_busy_only: 1, calendar_name: 'meredith@x.com', summary: 'Confidential' })
		).toBe('Busy · meredith');
	});

	it('is what the grid renders, with the full name still on hover', () => {
		const grid = readFileSync(join(ROOT, 'src', 'lib', 'components', 'CalendarGrid.svelte'), 'utf8');
		expect(grid).toMatch(/class="block-title">\{shortLabel\(/);
		// The full name is not lost, it moves to the title attribute.
		expect(grid).toMatch(/title=\{label\(/);
	});
});
