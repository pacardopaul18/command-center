import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:5173';

/**
 * A field that is offered has to come back.
 *
 * The finding, P1: Quick Add's Meeting form had a box labelled "Agenda or
 * notes". It posted the text as `notes`, the route accepted the request,
 * returned 200 with a meeting, and threw the words away, because `meetings` had
 * no such column and the insert never named it. Nothing failed. The form
 * cleared, the meeting appeared, and the agenda was gone.
 *
 * A 200 is not evidence of storage. That is the whole lesson, and it is why
 * these tests post through the real route and then read the row back through
 * the real route rather than checking that the write was accepted.
 *
 * The test is written against the fields Quick Add actually offers, so adding a
 * box to that form without carrying it through the route and the read fails
 * here rather than in six months when somebody asks where their notes went.
 */

const ROOT = process.cwd();

function localD1Path(): string {
	const dir = join('.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
	const files = readdirSync(dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	return join(dir, files[0]);
}

/** Everything this file writes carries this prefix, so cleanup is exact. D157. */
const P = 'tp-roundtrip-';

async function api(path: string, init?: RequestInit) {
	const res = await fetch(`${BASE}${path}`, init);
	const text = await res.text();
	let json: any = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = null;
	}
	return { res, json, text };
}

const post = (payload: unknown): RequestInit => ({
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(payload)
});

/**
 * Cleans up by title, not by id.
 *
 * A run that failed half way through created rows and never learned their ids.
 * The titles are known before the request is sent, so they are what cleanup can
 * rely on.
 */
function sweep() {
	const conn = new DatabaseSync(localD1Path());
	try {
		// Tickets before projects: the ticket names its project, and a project
		// deleted first takes its tickets with it or refuses to go.
		for (const table of ['action_items', 'tickets', 'meetings']) {
			conn.prepare(`DELETE FROM ${table} WHERE title LIKE '${P}%' OR id LIKE '${P}%'`).run();
		}
		conn.prepare(`DELETE FROM projects WHERE name LIKE '${P}%' OR id LIKE '${P}%'`).run();
	} finally {
		conn.close();
	}
}

beforeAll(async () => {
	const { res } = await api('/api/health');
	if (!res.ok && res.status !== 503) {
		throw new Error(`Dev server not answering at ${BASE}. Start it with: npm run dev`);
	}
	sweep();
});

afterAll(() => sweep());

/**
 * One case per Quick Add kind: what the form sends, and what has to survive.
 *
 * `sent` is the request body Quick Add builds. `expect` is what reading the
 * record back has to show. They are written separately on purpose: a field the
 * route renames or normalises is still stored, and the point is that the value
 * is retrievable, not that it is echoed verbatim.
 */
const CASES = [
	{
		kind: 'Action item',
		path: '/api/action-items',
		read: (id: string) => `/api/action-items/${id}`,
		unwrap: (j: any) => j.item ?? j.action_item ?? j,
		sent: {
			title: `${P}action`,
			context: 'One line so the item still makes sense later.',
			owner: 'Paul Pacardo',
			deadline: '2026-10-01',
			status: 'open',
			source: 'manual'
		},
		want: {
			title: `${P}action`,
			context: 'One line so the item still makes sense later.',
			owner: 'Paul Pacardo',
			deadline: '2026-10-01',
			source: 'manual'
		}
	},
	{
		kind: 'Meeting',
		path: '/api/meetings',
		read: (id: string) => `/api/meetings/${id}`,
		unwrap: (j: any) => j.meeting ?? j,
		sent: {
			title: `${P}meeting`,
			notes: 'What it needs to cover.',
			meeting_date: '2026-10-02',
			attendees: 'Paul, Dustin',
			recording_url: 'https://example.com/rec'
		},
		want: {
			title: `${P}meeting`,
			// The field this whole test exists for.
			notes: 'What it needs to cover.',
			meeting_date: '2026-10-02',
			attendees: 'Paul, Dustin',
			recording_url: 'https://example.com/rec'
		}
	}
] as const;

describe('layer 2: every Quick Add field survives the round trip', () => {
	for (const c of CASES) {
		it(`${c.kind}: reads back everything the form sent`, async () => {
			const created = await api(c.path, post(c.sent));
			expect(created.res.status, created.text.slice(0, 200)).toBe(201);

			const id = (c.unwrap(created.json) ?? {}).id;
			expect(id, 'the create response must name the row it made').toBeTruthy();

			const back = await api(c.read(id));
			expect(back.res.status).toBe(200);
			const row = c.unwrap(back.json);

			for (const [field, value] of Object.entries(c.want)) {
				expect(
					row?.[field],
					`${c.kind}.${field} was accepted and did not come back. ` +
						'A field either persists or does not exist.'
				).toBe(value);
			}
		});
	}
});

describe('layer 2: a ticket keeps the fields Quick Add offers', () => {
	/*
	 * Tickets need a project, so this one makes its own rather than borrowing a
	 * seeded row whose counts layer 1 is watching.
	 */
	it('start date, estimate, status and reporter all come back', async () => {
		const project = await api(
			'/api/projects',
			post({
				name: `${P}project`,
				start_date: '2026-09-15',
				target_close: '2026-12-01',
				phase: 'initiating',
				status: 'on_track'
			})
		);
		expect(project.res.status, project.text.slice(0, 200)).toBe(201);
		const projectId = (project.json.project ?? project.json).id;

		// The project's own new fields, read back through its own route.
		const projectBack = await api(`/api/projects/${projectId}`);
		const projectRow = projectBack.json.project ?? projectBack.json;
		expect(projectRow.start_date, 'project start_date did not persist').toBe('2026-09-15');

		const ticket = await api(
			'/api/tickets',
			post({
				project_id: projectId,
				title: `${P}ticket`,
				description: 'Context.',
				priority: 'normal',
				assignee: 'Paul Pacardo',
				start_date: '2026-09-16',
				due_date: '2026-09-30',
				estimate_hours: 4,
				status: 'in_progress',
				reporter: 'Dustin Finkel'
			})
		);
		expect(ticket.res.status, ticket.text.slice(0, 200)).toBe(201);
		const ticketId = (ticket.json.ticket ?? ticket.json).id;

		const back = await api(`/api/tickets/${ticketId}`);
		const row = back.json.ticket ?? back.json;
		for (const [field, value] of Object.entries({
			start_date: '2026-09-16',
			due_date: '2026-09-30',
			estimate_hours: 4,
			status: 'in_progress',
			reporter: 'Dustin Finkel',
			assignee: 'Paul Pacardo'
		})) {
			expect(row?.[field], `ticket.${field} was accepted and did not come back`).toBe(value);
		}
	});
});

describe('layer 2: the form and the route name the same fields', () => {
	/*
	 * The static half. The round trips above prove the fields that are wired;
	 * this proves nothing new was added to the form without being wired, which
	 * is the failure that produced P1 in the first place.
	 */
	const quickAdd = readFileSync(join(ROOT, 'src', 'lib', 'components', 'QuickAdd.svelte'), 'utf8');

	it('sends every field key it renders', () => {
		/*
		 * Each field list entry is a box the reader can type in. If the matching
		 * value never appears in that kind's save body, the box is decorative: the
		 * reader fills it, the request goes without it, and the value is lost
		 * before it ever reaches the route.
		 */
		const keys = [...quickAdd.matchAll(/\bkey: '([a-z_]+)'/g)].map((m) => m[1]);
		const orphans = keys.filter(
			(k) => !new RegExp('v[.]' + k + '(?![a-z_])').test(quickAdd)
		);
		expect(orphans, 'these Quick Add fields are rendered but never sent').toEqual([]);
	});

	it('offers the meeting notes box and posts it where the route reads it', () => {
		/*
		 * P2 turned this box into the shared rich-text editor, so the key moved
		 * from `notes` to `notes_html`. The route reads either, but the form has
		 * to send the one that matches what its box produces: sending HTML under
		 * the plain key would store the markup as the searchable text.
		 */
		expect(quickAdd).toMatch(/notes_html: area/);
		expect(quickAdd).toMatch(/richArea: true/);
	});
});
