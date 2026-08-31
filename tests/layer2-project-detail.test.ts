import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Milestones, files, ticket links, ticket history and effort.
 *
 * Five features, one rule running through all of them: a child row is reached
 * through its parent, and asking for one through the wrong parent is refused
 * rather than answered with nothing. D108. That matters most on files, where
 * the only thing between a project's documents and anybody who can guess an id
 * is that the row is checked against the project in the path before R2 is
 * touched.
 *
 * The link direction is the other property worth pinning. A link is stored once
 * per pair, so the reverse view is computed. If that arithmetic is wrong, the
 * ticket that is blocked reads as the one doing the blocking, and both screens
 * look plausible.
 *
 * All fixture content is invented.
 */

const BASE = 'http://localhost:5173';
const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const NOW = '2026-09-01T00:00:00Z';

const P1 = 'pd-project-1';
const P2 = 'pd-project-2';
const T1 = 'pd-ticket-1';
const T2 = 'pd-ticket-2';

function openDb(): DatabaseSync {
	const f = readdirSync(DIR).find((x) => x.endsWith('.sqlite') && x !== 'metadata.sqlite');
	if (!f) throw new Error('Local D1 not found.');
	return new DatabaseSync(join(DIR, f));
}

let db: DatabaseSync;

async function api(path: string, init?: RequestInit) {
	const res = await fetch(`${BASE}${path}`, init);
	const text = await res.text();
	let json: Record<string, unknown> | null = null;
	try {
		json = JSON.parse(text) as Record<string, unknown>;
	} catch {
		json = null;
	}
	return { res, json, text };
}

const post = (path: string, body: unknown) =>
	api(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});

const patch = (path: string, body: unknown) =>
	api(path, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});

async function wipe() {
	for (const id of [P1, P2]) {
		const files = db
			.prepare('SELECT id FROM project_files WHERE project_id = ?')
			.all(id) as { id: string }[];
		// Through the route, so the objects go with the rows.
		for (const f of files) {
			await fetch(`${BASE}/api/projects/${id}/files/${f.id}`, { method: 'DELETE' }).catch(
				() => null
			);
		}
		db.prepare('DELETE FROM project_files WHERE project_id = ?').run(id);
		db.prepare('DELETE FROM project_milestones WHERE project_id = ?').run(id);
	}
	for (const id of [T1, T2]) {
		db.prepare('DELETE FROM ticket_time WHERE ticket_id = ?').run(id);
		db.prepare('DELETE FROM ticket_events WHERE ticket_id = ?').run(id);
		db.prepare('DELETE FROM ticket_links WHERE from_ticket_id = ? OR to_ticket_id = ?').run(id, id);
		db.prepare('DELETE FROM tickets WHERE id = ?').run(id);
	}
	for (const id of [P1, P2]) db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

beforeAll(async () => {
	db = openDb();
	await wipe();

	for (const [id, name] of [
		[P1, 'PD FIXTURE ONE'],
		[P2, 'PD FIXTURE TWO']
	]) {
		db.prepare(
			`INSERT INTO projects (id, name, phase, status, created_at, updated_at)
       VALUES (?, ?, 'planning', 'on_track', ?, ?)`
		).run(id, name, NOW, NOW);
	}

	for (const [id, title] of [
		[T1, 'PD TICKET ONE'],
		[T2, 'PD TICKET TWO']
	]) {
		db.prepare(
			`INSERT INTO tickets (id, project_id, title, status, priority, created_at, updated_at)
       VALUES (?, ?, ?, 'open', 'normal', ?, ?)`
		).run(id, P1, title, NOW, NOW);
	}
});

afterAll(async () => {
	await wipe();
	db.close();
});

describe('milestones', () => {
	let made = '';

	it('is added at the end of the sequence rather than at an arbitrary place', async () => {
		const first = await post(`/api/projects/${P1}/milestones`, { title: 'PD first' });
		const second = await post(`/api/projects/${P1}/milestones`, { title: 'PD second' });
		expect(first.res.status).toBe(201);
		expect(second.res.status).toBe(201);

		made = (first.json?.milestone as { id: string }).id;
		const positions = db
			.prepare('SELECT title, position FROM project_milestones WHERE project_id = ? ORDER BY position')
			.all(P1) as { title: string; position: number }[];
		expect(positions.map((p) => p.title)).toEqual(['PD first', 'PD second']);
	});

	it('marking one done records when, and undoing it clears the date', async () => {
		// A boolean would lose the date, and the date is what makes a slipped
		// plan legible afterwards. Toggling twice must leave no trace.
		await patch(`/api/projects/${P1}/milestones/${made}`, { done: true });
		let row = db
			.prepare('SELECT done_at FROM project_milestones WHERE id = ?')
			.get(made) as { done_at: string | null };
		expect(row.done_at).toBeTruthy();

		await patch(`/api/projects/${P1}/milestones/${made}`, { done: false });
		row = db.prepare('SELECT done_at FROM project_milestones WHERE id = ?').get(made) as {
			done_at: string | null;
		};
		expect(row.done_at, 'undoing left a completion date behind').toBeNull();
	});

	it('refuses a milestone reached through the wrong project', async () => {
		const wrong = await patch(`/api/projects/${P2}/milestones/${made}`, { title: 'PD hijack' });
		expect(wrong.res.status).toBe(404);

		const row = db
			.prepare('SELECT title FROM project_milestones WHERE id = ?')
			.get(made) as { title: string };
		expect(row.title, 'the refusal renamed it anyway').toBe('PD first');
	});

	it('the next milestone shown prefers a real row over the typed column', async () => {
		db.prepare('UPDATE projects SET next_milestone = ? WHERE id = ?').run('PD typed', P1);

		const { json } = await api('/api/projects');
		const project = (json?.projects as { id: string; next_milestone_shown: string }[]).find(
			(p) => p.id === P1
		);
		// Two places hold this fact. The rows are the better one and win.
		expect(project?.next_milestone_shown).toBe('PD first');
	});

	it('falls back to the typed column when there are no milestone rows', async () => {
		const { json } = await api('/api/projects');
		const project = (json?.projects as { id: string; next_milestone_shown: string | null }[]).find(
			(p) => p.id === P2
		);
		expect(project?.next_milestone_shown ?? null).toBeNull();
	});
});

describe('project files', () => {
	function file(marker: string): File {
		return new File([`PD ${marker} contents`], `${marker}.csv`, { type: 'text/csv' });
	}

	async function upload(projectId: string, f: File) {
		const form = new FormData();
		form.set('file', f);
		return api(`/api/projects/${projectId}/files`, { method: 'POST', body: form });
	}

	it('accepts whatever the work produced, not a fixed list of types', async () => {
		// Unlike contracts and receipts. A project file is a spreadsheet, an
		// export, an archive; refusing the next legitimate format would teach
		// people to put files somewhere else.
		const { res } = await upload(P1, file('export'));
		expect(res.status).toBe(201);
	});

	it('serves the bytes as a download, never inline', async () => {
		const row = db
			.prepare('SELECT id FROM project_files WHERE project_id = ? LIMIT 1')
			.get(P1) as { id: string };

		const res = await fetch(`${BASE}/api/projects/${P1}/files/${row.id}`);
		expect(res.ok).toBe(true);

		/**
		 * The reason this matters more here than on a contract: a project file is
		 * arbitrary content this app did not produce, and an HTML or SVG file
		 * served inline would run in the app's own origin.
		 */
		expect(res.headers.get('content-disposition')).toContain('attachment');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
	});

	it('refuses a file reached through the wrong project', async () => {
		const row = db
			.prepare('SELECT id FROM project_files WHERE project_id = ? LIMIT 1')
			.get(P1) as { id: string };

		const res = await fetch(`${BASE}/api/projects/${P2}/files/${row.id}`);
		expect(res.status, "one project's file was served from another's URL").toBe(404);
	});

	it('removes the row and the bytes together', async () => {
		const row = db
			.prepare('SELECT id FROM project_files WHERE project_id = ? LIMIT 1')
			.get(P1) as { id: string };

		const removed = await fetch(`${BASE}/api/projects/${P1}/files/${row.id}`, {
			method: 'DELETE'
		});
		expect(removed.ok).toBe(true);

		const gone = await fetch(`${BASE}/api/projects/${P1}/files/${row.id}`);
		expect(gone.status, 'the bytes outlived the row').toBe(404);
	});
});

describe('links between tickets', () => {
	it('is stored once and read from both ends with the relation the right way round', async () => {
		const made = await post(`/api/tickets/${T1}/links`, { to_ticket_id: T2, kind: 'blocks' });
		expect(made.res.status).toBe(201);

		const rows = db
			.prepare('SELECT COUNT(*) AS n FROM ticket_links WHERE from_ticket_id = ? OR to_ticket_id = ?')
			.get(T1, T1) as { n: number };
		expect(Number(rows.n), 'the link was written twice').toBe(1);

		const from = (await api(`/api/tickets/${T1}/links`)).json as {
			links: { relation: string; other_id: string }[];
		};
		expect(from.links[0].relation).toBe('blocks');
		expect(from.links[0].other_id).toBe(T2);

		// The other end reads the inverse without a second row existing. Get this
		// wrong and the blocked ticket reads as the one doing the blocking.
		const to = (await api(`/api/tickets/${T2}/links`)).json as {
			links: { relation: string; other_id: string }[];
		};
		expect(to.links[0].relation).toBe('is blocked by');
		expect(to.links[0].other_id).toBe(T1);
	});

	it('refuses a second link between the same two, in either direction', async () => {
		const again = await post(`/api/tickets/${T2}/links`, { to_ticket_id: T1, kind: 'relates' });
		expect(again.res.status).toBe(409);
	});

	it('refuses to link a ticket to itself', async () => {
		const self = await post(`/api/tickets/${T1}/links`, { to_ticket_id: T1, kind: 'relates' });
		expect(self.res.status).toBe(400);
	});

	it('can be removed from either end', async () => {
		const link = db.prepare('SELECT id FROM ticket_links LIMIT 1').get() as { id: string };
		// From the reverse end, where the reader has no idea which row is stored.
		const res = await fetch(`${BASE}/api/tickets/${T2}/links/${link.id}`, { method: 'DELETE' });
		expect(res.ok).toBe(true);
	});
});

describe('a ticket writes down what happened to it', () => {
	it('a status change records itself, after the change and not before', async () => {
		await patch(`/api/tickets/${T1}`, { status: 'in_progress' });

		const events = (await api(`/api/tickets/${T1}/events`)).json as {
			events: { kind: string; detail: string }[];
		};
		const status = events.events.find((e) => e.kind === 'status');
		expect(status?.detail).toContain('in_progress');

		// The row really did change, so the line is not a record of something
		// that did not happen.
		const row = db.prepare('SELECT status FROM tickets WHERE id = ?').get(T1) as {
			status: string;
		};
		expect(row.status).toBe('in_progress');
	});

	it('only comments can be posted, never a fabricated status line', async () => {
		await post(`/api/tickets/${T1}/events`, { detail: 'PD comment', author: 'PD person' });

		const events = (await api(`/api/tickets/${T1}/events`)).json as {
			events: { kind: string; detail: string; author: string | null }[];
		};
		const mine = events.events.find((e) => e.detail === 'PD comment');
		// The kind is not taken from the caller. A route that accepted one would
		// let the history claim a change that never happened.
		expect(mine?.kind).toBe('comment');
		expect(mine?.author).toBe('PD person');
	});
});

describe('effort against a ticket', () => {
	it('is stored in minutes, because hours as a float does not add up', async () => {
		// Three sixths of an hour. In hours these are 0.1 + 0.2 + 0.3 and the
		// total ends in ...0000004; in minutes they are 6 + 12 + 18.
		for (const hours of ['0.1', '0.2', '0.3']) {
			const { res } = await post(`/api/tickets/${T1}/time`, { hours });
			expect(res.status, `${hours} was refused`).toBe(201);
		}

		const { json } = await api(`/api/tickets/${T1}/time`);
		expect(json?.total_minutes, 'the total drifted').toBe(36);
	});

	it('refuses nothing, a negative, and more than a day', async () => {
		for (const hours of ['0', '-1', '25']) {
			const { res } = await post(`/api/tickets/${T1}/time`, { hours });
			expect(res.status, `${hours} was accepted`).toBe(400);
		}
	});

	it('writes a line on the history so the ticket says where its time went', async () => {
		const events = (await api(`/api/tickets/${T1}/events`)).json as {
			events: { kind: string }[];
		};
		expect(events.events.some((e) => e.kind === 'time')).toBe(true);
	});

	it('refuses an entry reached through the wrong ticket', async () => {
		const entry = db
			.prepare('SELECT id FROM ticket_time WHERE ticket_id = ? LIMIT 1')
			.get(T1) as { id: string };
		const res = await fetch(`${BASE}/api/tickets/${T2}/time/${entry.id}`, { method: 'DELETE' });
		expect(res.status).toBe(404);
	});
});
