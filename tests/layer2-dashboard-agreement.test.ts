import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:5173';
const ROOT = process.cwd();
const SERVER = join(ROOT, 'src', 'lib', 'server');

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const full = join(dir, e.name);
		if (e.isDirectory()) return walk(full);
		return e.name.endsWith('.ts') ? [full] : [];
	});
}

/**
 * Every dashboard number equals the number on the page it links to.
 *
 * The dashboard said 37 active projects; the Projects page, one click away,
 * said 42 live. Both were right. One counted projects whose status was not
 * done, the other counted projects Asana had not archived, and five projects
 * are live with every ticket finished. Two expressions for one concept,
 * agreeing until the day they do not.
 *
 * This is F15 in a second place, which is why the fix is the same fix: one
 * expression, imported by both, with a test that fails if a second appears.
 */

describe('layer 2: an active project is defined once', () => {
	it('spells the archived rule in one file', () => {
		const offenders = walk(SERVER)
			.filter((f) => !f.endsWith('project-state.ts'))
			.filter((f) => {
				const text = readFileSync(f, 'utf8');
				// The literal shapes the two screens used before they were merged.
				return (
					/status\s*!=\s*'done'\s*\)\s*AS projects_active/i.test(text) ||
					/SUM\(CASE WHEN ap\.archived = 1/i.test(text)
				);
			})
			.map((f) => f.slice(SERVER.length + 1));

		expect(
			offenders,
			'These files define an active project themselves instead of importing it. ' +
				'Two expressions for one concept agree until the day they do not.'
		).toEqual([]);
	});

	it('is imported by both the dashboard and the projects list', () => {
		for (const file of ['today.ts', 'projects.ts']) {
			const text = readFileSync(join(SERVER, 'api', file), 'utf8');
			expect(text, `${file} does not use the shared definition`).toMatch(
				/from '\.\.\/project-state'/
			);
		}
	});
});

describe('layer 2: the dashboard agrees with the pages it links to', () => {
	it('reports the same active and archived counts as the projects screen', async () => {
		const today = (await (await fetch(`${BASE}/api/today`)).json()) as {
			counts: { projects_active: number; projects_at_risk: number; tickets_open: number };
		};
		const projects = (await (await fetch(`${BASE}/api/projects?archived=all`)).json()) as {
			counts: { live: number; archived: number };
			projects: { status: string; open_tickets: number; archived: number }[];
		};

		expect(
			today.counts.projects_active,
			`dashboard says ${today.counts.projects_active} active, projects page says ${projects.counts.live} live`
		).toBe(projects.counts.live);

		const atRisk = projects.projects.filter(
			(p) => (p.status === 'at_risk' || p.status === 'blocked') && !p.archived
		).length;
		expect(today.counts.projects_at_risk).toBe(atRisk);

		const openTickets = projects.projects.reduce((sum, p) => sum + (p.open_tickets ?? 0), 0);
		expect(
			today.counts.tickets_open,
			`dashboard says ${today.counts.tickets_open} open tickets, the projects sum to ${openTickets}`
		).toBe(openTickets);
	});
});

describe('layer 2: a zero with nothing behind it says so', () => {
	it('reports which stores hold anything', async () => {
		const today = (await (await fetch(`${BASE}/api/today`)).json()) as {
			sources: Record<string, boolean>;
		};
		for (const key of ['action_items', 'meetings', 'invoices', 'projects', 'tickets']) {
			expect(typeof today.sources?.[key], `sources.${key} is missing`).toBe('boolean');
		}
	});

	it('draws a tile with no source differently from one reporting zero', () => {
		/*
		 * "0 overdue" is good news. "0 overdue because nothing was ever loaded" is
		 * a gap, and one tile said both. Not hidden, because hiding it answers
		 * "why is this missing" with silence.
		 */
		const page = readFileSync(join(ROOT, 'src', 'routes', '+page.svelte'), 'utf8');
		expect(page).toMatch(/const NOT_LOADED = 'no data yet'/);
		expect(page).toMatch(/class:unsourced=\{tile\.muted\}/);
		expect(page).toMatch(/\.tile\.unsourced/);
	});

	it('never raises an alarm on a tile it has no source for', () => {
		// An alarm on a number that does not exist is the loudest possible way to
		// report nothing.
		const page = readFileSync(join(ROOT, 'src', 'routes', '+page.svelte'), 'utf8');
		const alarms = page.match(/alarm: [^\n]+/g) ?? [];
		for (const line of alarms) {
			if (line.includes('false')) continue;
			expect(line, `alarm without a source check: ${line}`).toMatch(/data\.sources\./);
		}
	});
});
