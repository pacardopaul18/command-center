import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:5173';

/**
 * One definition of an open ticket, and screens that agree about it.
 *
 * The finding: the Projects list showed a column headed "Open" counting action
 * items, immediately beside a column headed "Tickets" counting open tickets. A
 * project reading 0 and 2 was read as "no open tickets, two tickets" when it
 * meant "no open action items, two open tickets", and the project's own page
 * said 2 open and 13 closed.
 *
 * Both numbers were right. That is worth saying plainly, because the obvious
 * diagnosis was two queries disagreeing and it was wrong: nothing was
 * miscounted, the pair of headings was unreadable. The fix is the labels and a
 * third number, and these tests exist so the numbers cannot start disagreeing
 * later on top of it.
 */

const SERVER = join(process.cwd(), 'src', 'lib', 'server');

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) return walk(full);
		return entry.name.endsWith('.ts') ? [full] : [];
	});
}

describe('layer 2: an open ticket is defined once', () => {
	it('spells the status literal in exactly one file', () => {
		/*
		 * The literal was written out in ten places across five files. All ten
		 * agreed, which is luck rather than a property: the tenth was written by
		 * copying the ninth, and the first one somebody edits without finding the
		 * others is the day two screens disagree about the same rows.
		 */
		const offenders = walk(SERVER)
			.filter((file) => !file.endsWith('ticket-state.ts'))
			.filter((file) => /status (NOT )?IN \('done'\s*,\s*'cancelled'\)/i.test(readFileSync(file, 'utf8')))
			.map((file) => file.slice(SERVER.length + 1));

		expect(
			offenders,
			'These files spell out what an open ticket is instead of importing it from ' +
				'ticket-state.ts. Ten copies of a predicate agree until one of them is edited.'
		).toEqual([]);
	});
});

describe('layer 2: the list and the detail agree about every project', () => {
	it('reports open, total and overdue tickets that match the tickets themselves', async () => {
		const projects = (await (await fetch(`${BASE}/api/projects?archived=all`)).json()) as {
			projects: {
				id: string;
				name: string;
				open_tickets: number;
				all_tickets: number;
				overdue_tickets: number;
			}[];
		};

		// A sample rather than all of them: the property is that the list's
		// arithmetic matches the rows, and checking every project on a fixture
		// with hundreds would make the suite slow for no extra coverage.
		const sample = projects.projects.filter((p) => p.all_tickets > 0).slice(0, 12);
		expect(sample.length, 'no project has any tickets, so this proves nothing').toBeGreaterThan(0);

		for (const project of sample) {
			const listed = (await (
				await fetch(`${BASE}/api/tickets?project_id=${project.id}&status=all&page_size=500`)
			).json()) as { tickets: { status: string; due_date: string | null }[] };

			const open = listed.tickets.filter((t) => !['done', 'cancelled'].includes(t.status));

			expect(
				project.all_tickets,
				`${project.name}: the list says ${project.all_tickets} tickets, the tickets say ${listed.tickets.length}`
			).toBe(listed.tickets.length);

			expect(
				project.open_tickets,
				`${project.name}: the list says ${project.open_tickets} open, the tickets say ${open.length}`
			).toBe(open.length);

			expect(
				project.open_tickets,
				`${project.name}: more open than exist`
			).toBeLessThanOrEqual(project.all_tickets);

			expect(
				project.overdue_tickets,
				`${project.name}: overdue cannot exceed open`
			).toBeLessThanOrEqual(project.open_tickets);
		}
	});
});

describe('layer 2: the projects screen says which number is which', () => {
	const page = readFileSync(join(process.cwd(), 'src', 'routes', 'projects', '+page.svelte'), 'utf8');

	it('no longer heads a column with a bare "Open"', () => {
		// The heading has to say open what. This is the whole defect.
		expect(page).not.toMatch(/<th[^>]*>\s*Open\s*<\/th>/);
		expect(page).toMatch(/Action items/);
		expect(page).toMatch(/Tickets open/);
	});

	it('shows the total beside the open count', () => {
		// "2" invites the reader to supply the missing half. "2 of 15" does not.
		expect(page).toMatch(/all_tickets/);
	});
});

describe('layer 2: overdue tickets reach a reader', () => {
	/*
	 * The severe one. 247 open tickets were past due, correct in the Projects
	 * API, and reaching no reader on any screen: Today counted action items, of
	 * which the real database holds zero because no proposal has been accepted;
	 * Projects fetched the number and used it only to colour a different one;
	 * and there was no ticket list at all, only `/tickets/[id]`.
	 *
	 * So the app spent the life of the mirror telling Paul that nothing needed
	 * his attention. A count with nowhere to go is not a capability.
	 */
	const BASE = process.env.API_BASE ?? 'http://127.0.0.1:5173';

	async function api(path: string) {
		const res = await fetch(`${BASE}${path}`);
		const text = await res.text();
		let json: any = null;
		try {
			json = text ? JSON.parse(text) : null;
		} catch {
			json = null;
		}
		return { res, json, text };
	}

	it('the tickets route offers an overdue view and sizes every view', async () => {
		const { res, json } = await api('/api/tickets?view=overdue');
		expect(res.status).toBe(200);
		expect(json.views, 'the page cannot label a tab it has no size for').toBeTruthy();
		for (const key of ['overdue', 'due_today', 'open', 'all']) {
			expect(typeof json.views[key], `views.${key} is missing`).toBe('number');
		}
		// Every row it returns is genuinely overdue, against the working-zone day
		// the route itself reports.
		for (const t of json.tickets ?? []) {
			expect(t.due_date, 'an overdue ticket with no due date').toBeTruthy();
			expect(t.due_date < json.today, `${t.due_date} is not before ${json.today}`).toBe(true);
			expect(['done', 'cancelled']).not.toContain(t.status);
		}
	});

	it('the overdue view agrees with the count on the same response', async () => {
		// One expression. The Projects API and this one both read overdueTicket,
		// so a screen cannot show a list of a different size from its own tab.
		const { json } = await api('/api/tickets?view=overdue');
		expect(json.tickets.length).toBe(json.views.overdue);
	});

	it('Today counts tickets and action items as two things', async () => {
		/*
		 * They were one caption over two populations, and the population the
		 * caption implied was empty by construction. D238.
		 */
		const { json } = await api('/api/today');
		for (const key of [
			'tickets_overdue',
			'tickets_due_today',
			'overdue_action_items',
			'due_today_action_items'
		]) {
			expect(typeof json.counts[key], `counts.${key} is missing`).toBe('number');
		}
		expect(json.counts.overdue, 'the bare key is back, and it spans both populations').toBe(
			undefined
		);
	});

	it('Today and the tickets route report the same overdue number', async () => {
		const today = await api('/api/today');
		const tickets = await api('/api/tickets?view=overdue');
		expect(today.json.counts.tickets_overdue).toBe(tickets.json.views.overdue);
	});
});
