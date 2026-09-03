import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:5173';

/**
 * The rich-text fields, through the real routes.
 *
 * `layer2-rich-text.test.ts` proves the parser. This proves the wiring: that
 * every field the ruling named actually stores both columns, that the plain
 * projection is derived rather than echoed, and above all that the server is
 * the boundary.
 *
 * THE SERVER IS THE BOUNDARY. The editor sanitises before it posts, so the
 * hostile cases here are posted straight at the route with no browser involved,
 * which is how an attacker would send them. A guard that only runs in the page
 * is a guard that never runs.
 */

const P = 'tp-rich-';

function localD1Path(): string {
	const dir = join('.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
	const files = readdirSync(dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	return join(dir, files[0]);
}

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

const patch = (payload: unknown): RequestInit => ({
	method: 'PATCH',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(payload)
});

/**
 * The two triggers that make a SOP version history rather than a document.
 *
 * D32 and D33, enforced in the database precisely so no code path can quietly
 * break them. Cleanup has to take them down to remove its own rows and put them
 * straight back, and `triggersIntact` below asserts that it did: a fixture that
 * left the guarantee off would be worse than one that left rows behind, because
 * the rows are visible and the missing trigger is not.
 */
const SOP_TRIGGERS = [
	`CREATE TRIGGER sop_versions_immutable
   BEFORE UPDATE ON sop_versions
   BEGIN
     SELECT RAISE(ABORT, 'SOP versions are immutable. Add a new version instead.');
   END`,
	`CREATE TRIGGER sop_versions_undeletable
   BEFORE DELETE ON sop_versions
   BEGIN
     SELECT RAISE(ABORT, 'SOP versions cannot be deleted. Archive the SOP instead.');
   END`
];

function sweep() {
	const conn = new DatabaseSync(localD1Path());
	try {
		conn.prepare(`DELETE FROM tickets WHERE title LIKE '${P}%'`).run();
		conn.prepare(`DELETE FROM meetings WHERE title LIKE '${P}%'`).run();
		try {
			conn.prepare('DROP TRIGGER IF EXISTS sop_versions_undeletable').run();
			// The SOP points at its current version, so the pointer goes first or
			// the foreign key refuses the delete.
			conn
				.prepare(
					`UPDATE sops SET current_version_id = NULL WHERE title LIKE '${P}%'`
				)
				.run();
			conn
				.prepare(
					`DELETE FROM sop_versions WHERE sop_id IN (SELECT id FROM sops WHERE title LIKE '${P}%')`
				)
				.run();
		} finally {
			for (const sql of SOP_TRIGGERS) {
				const name = /CREATE TRIGGER (\w+)/.exec(sql)?.[1];
				conn.prepare(`DROP TRIGGER IF EXISTS ${name}`).run();
				conn.prepare(sql).run();
			}
		}
		conn.prepare(`DELETE FROM sops WHERE title LIKE '${P}%'`).run();
		conn.prepare(`DELETE FROM projects WHERE name LIKE '${P}%'`).run();
		conn
			.prepare(
				`DELETE FROM contacts WHERE client_id IN (SELECT id FROM clients WHERE name LIKE '${P}%')`
			)
			.run();
		conn.prepare(`DELETE FROM clients WHERE name LIKE '${P}%'`).run();
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

describe('layer 2: this fixture put the SOP guarantees back', () => {
	/*
	 * Cleanup drops the undeletable trigger to remove its own versions. If it
	 * ever failed to restore it, SOP history would silently stop being history
	 * on this machine and nothing else would notice. Asserted here rather than
	 * assumed, and it runs after the sweep in beforeAll.
	 */
	it('both triggers exist', () => {
		const conn = new DatabaseSync(localD1Path());
		try {
			const rows = conn
				.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'sop_versions%'")
				.all() as { name: string }[];
			const names = rows.map((r) => r.name).sort();
			expect(names).toEqual(['sop_versions_immutable', 'sop_versions_undeletable']);
		} finally {
			conn.close();
		}
	});

	it('a version still cannot be deleted or edited through the database', () => {
		/*
		 * Aimed at a real row. The first version of this used `WHERE 1 = 0`,
		 * which matches nothing, so a BEFORE DELETE trigger never fires and the
		 * test passed whether or not the trigger existed. Found by asking why it
		 * failed once the trigger was restored, which it should not have.
		 */
		const conn = new DatabaseSync(localD1Path());
		try {
			const row = conn.prepare('SELECT id FROM sop_versions LIMIT 1').get() as
				| { id: string }
				| undefined;
			expect(row, 'the seed should hold at least one SOP version').toBeTruthy();
			const id = row!.id;

			expect(() => conn.prepare('DELETE FROM sop_versions WHERE id = ?').run(id)).toThrow();
			expect(() =>
				conn.prepare("UPDATE sop_versions SET body = 'x' WHERE id = ?").run(id)
			).toThrow();

			// Aborted, so the row is untouched. Proving the trigger fired is not
			// the same as proving it protected anything.
			const still = conn.prepare('SELECT COUNT(*) AS n FROM sop_versions WHERE id = ?').get(id) as {
				n: number;
			};
			expect(Number(still.n)).toBe(1);
		} finally {
			conn.close();
		}
	});
});

/** A body using every construct Asana emits, so nothing is proved on a trivial case. */
const RICH =
	'<h1>Heading</h1><p>Text with <strong>bold</strong> and <em>italic</em>.</p>' +
	'<ul><li>First</li><li>Second</li></ul><p><a href="https://example.com/x">a link</a></p>';

/** What the plain projection has to be. Written out rather than derived. */
const PLAIN = 'Heading\n\nText with bold and italic.\n\n- First\n- Second\n\na link';

/** Posted straight at the route, with no editor in the way. */
const HOSTILE =
	'<p onclick="alert(1)">kept</p><script>alert(2)</script>' +
	'<a href="javascript:alert(3)">not a link</a><iframe src="https://evil.example"></iframe>';

describe('layer 2: every rich field stores both columns', () => {
	let clientId = '';
	let projectId = '';

	it('a project description round-trips and projects to plain text', async () => {
		const created = await api(
			'/api/projects',
			post({ name: `${P}project`, description_html: RICH })
		);
		expect(created.res.status, created.text.slice(0, 200)).toBe(201);
		projectId = (created.json.project ?? created.json).id;

		const back = await api(`/api/projects/${projectId}`);
		const row = back.json.project ?? back.json;
		expect(row.description_html).toContain('<strong>bold</strong>');
		expect(row.description).toBe(PLAIN);
		// The plain column is what search reads, and it must hold no markup.
		expect(row.description).not.toMatch(/[<>]/);
	});

	it('a ticket description round-trips on create and on patch', async () => {
		const created = await api(
			'/api/tickets',
			post({ project_id: projectId, title: `${P}ticket`, description_html: RICH })
		);
		expect(created.res.status, created.text.slice(0, 200)).toBe(201);
		const id = (created.json.ticket ?? created.json).id;

		const back = await api(`/api/tickets/${id}`);
		const row = back.json.ticket ?? back.json;
		expect(row.description_html).toContain('<li>First</li>');
		expect(row.description).toBe(PLAIN);

		// Patch is a separate code path from create, and the field that persists
		// on one and not the other is exactly the P1 failure in a new place.
		await api(`/api/tickets/${id}`, patch({ description_html: '<p>Edited.</p>' }));
		const after = await api(`/api/tickets/${id}`);
		const edited = after.json.ticket ?? after.json;
		expect(edited.description_html).toBe('<p>Edited.</p>');
		expect(edited.description).toBe('Edited.');
	});

	it('a meeting keeps its notes as both', async () => {
		const created = await api(
			'/api/meetings',
			post({ title: `${P}meeting`, meeting_date: '2026-10-05', notes_html: RICH })
		);
		expect(created.res.status, created.text.slice(0, 200)).toBe(201);
		const id = (created.json.meeting ?? created.json).id;

		const back = await api(`/api/meetings/${id}`);
		const row = back.json.meeting ?? back.json;
		expect(row.notes_html).toContain('<h1>Heading</h1>');
		expect(row.notes).toBe(PLAIN);
	});

	it('a client keeps its notes as both, through either route that makes one', async () => {
		/*
		 * Two routes insert into `clients`: the client route and the invoicing
		 * one that Quick Add posts to. A client made by one and a client made by
		 * the other have to look the same in the database, or the field works
		 * depending on which screen it was created from.
		 */
		const viaInvoicing = await api(
			'/api/invoicing/clients',
			post({ name: `${P}client-invoicing`, notes_html: RICH })
		);
		expect(viaInvoicing.res.status, viaInvoicing.text.slice(0, 200)).toBe(201);
		clientId = (viaInvoicing.json.client ?? viaInvoicing.json).id;

		const back = await api(`/api/invoicing/clients/${clientId}`);
		const row = back.json.client ?? back.json;
		expect(row.notes_html).toContain('<strong>bold</strong>');
		expect(row.notes).toBe(PLAIN);

		const viaClients = await api('/api/clients', post({ name: `${P}client-plain`, notes_html: RICH }));
		expect(viaClients.res.status, viaClients.text.slice(0, 200)).toBe(201);
		const other = viaClients.json.client ?? viaClients.json;
		expect(other.notes_html).toContain('<strong>bold</strong>');
		expect(other.notes).toBe(PLAIN);
	});

	it('a SOP version carries its own formatting, and a restore brings it back', async () => {
		const created = await api('/api/sops', post({ title: `${P}sop`, body_html: RICH }));
		expect(created.res.status, created.text.slice(0, 200)).toBe(201);
		const sopId = (created.json.sop ?? created.json).id;

		const v1 = await api(`/api/sops/${sopId}`);
		expect(v1.json.viewing?.body_html ?? v1.json.version?.body_html).toContain('<h1>Heading</h1>');

		// A second version, then a restore of the first. Restoring has to bring
		// back what version 1 said, formatting included: a version is history,
		// and history that loses its structure is a different document.
		await api(`/api/sops/${sopId}/versions`, post({ body_html: '<p>Version two.</p>' }));

		// The version list on the detail route carries metadata only, so the body
		// of an older version is read by asking for that version.
		const one = await api(`/api/sops/${sopId}?version=1`);
		const first = one.json.viewing ?? one.json.version;
		expect(first, 'version 1 should still exist').toBeTruthy();
		expect(first.body_html).toContain('<h1>Heading</h1>');

		const restored = await api(`/api/sops/${sopId}/versions/${first.id}/restore`, post({}));
		expect(restored.res.status, restored.text.slice(0, 200)).toBe(201);
		const now = await api(`/api/sops/${sopId}`);
		const viewing = now.json.viewing ?? now.json.version;
		expect(viewing.body_html).toContain('<h1>Heading</h1>');
		expect(viewing.body).toBe(PLAIN);
	});
});

describe('layer 2: the route sanitises, not the page', () => {
	/*
	 * Every one of these is posted with no browser involved. The editor's own
	 * sanitising is a courtesy to the writer; this is the boundary.
	 */
	it('strips a hostile description posted straight at the tickets route', async () => {
		const project = await api('/api/projects', post({ name: `${P}project-hostile` }));
		const projectId = (project.json.project ?? project.json).id;

		const created = await api(
			'/api/tickets',
			post({ project_id: projectId, title: `${P}ticket-hostile`, description_html: HOSTILE })
		);
		expect(created.res.status).toBe(201);
		const row = created.json.ticket ?? created.json;

		expect(row.description_html).not.toMatch(/<script/i);
		expect(row.description_html).not.toMatch(/<iframe/i);
		expect(row.description_html).not.toMatch(/onclick/i);
		expect(row.description_html).not.toMatch(/javascript:/i);
		// The words survive. Dropping content along with markup is how a
		// sanitiser silently eats somebody's paragraph.
		expect(row.description_html).toContain('kept');
	});

	it('stores nothing executable in the database itself', () => {
		// Read straight off the file rather than through the API, because the
		// question is what is at rest, not what a query happens to return.
		const conn = new DatabaseSync(localD1Path());
		try {
			const rows = conn
				.prepare(
					`SELECT description_html AS v FROM tickets WHERE title LIKE '${P}%'
           UNION ALL SELECT notes_html FROM meetings WHERE title LIKE '${P}%'
           UNION ALL SELECT description_html FROM projects WHERE name LIKE '${P}%'
           UNION ALL SELECT notes_html FROM clients WHERE name LIKE '${P}%'`
				)
				.all() as { v: string | null }[];
			expect(rows.length).toBeGreaterThan(0);
			for (const row of rows) {
				if (!row.v) continue;
				expect(row.v).not.toMatch(/<script|<iframe|javascript:|\son[a-z]+\s*=/i);
			}
		} finally {
			conn.close();
		}
	});

	it('takes plain text from a caller that sends no HTML', async () => {
		/*
		 * An import, a script or an older client sends the plain field. It has to
		 * keep working, and it has to leave the HTML column null rather than
		 * inventing markup, because a row with no HTML is exactly what a row that
		 * has never been through the editor is.
		 */
		const created = await api(
			'/api/meetings',
			post({ title: `${P}meeting-plain`, meeting_date: '2026-10-06', notes: 'Just words.' })
		);
		const row = created.json.meeting ?? created.json;
		expect(row.notes).toBe('Just words.');
		expect(row.notes_html).toBe(null);
	});
});
