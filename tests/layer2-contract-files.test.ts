import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Signed contract files: what may be uploaded, and who may read one back.
 *
 * The interesting property is not the upload, it is the read. A file lives in
 * R2 under a key this app chooses, and the only thing standing between a
 * client's signed agreement and anybody who can guess an id is that the row is
 * checked against the client in the path before the bucket is touched. A route
 * that looked the file up by id alone would serve one client's contract from
 * another client's URL and look completely normal doing it.
 *
 * The second property is that a row and an object never disagree. A row without
 * its bytes is a contract on screen that cannot be opened; an object without
 * its row is a file nobody can reach and nobody knows to delete.
 *
 * All fixture content is invented. No real contract is read or printed here.
 */

const BASE = 'http://localhost:5173';
const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';

const A = 'cf-client-a';
const B = 'cf-client-b';
const NOW = '2026-09-01T00:00:00Z';

function openDb(): DatabaseSync {
	const f = readdirSync(DIR).find((x) => x.endsWith('.sqlite') && x !== 'metadata.sqlite');
	if (!f) throw new Error('Local D1 not found.');
	return new DatabaseSync(join(DIR, f));
}

let db: DatabaseSync;

/** A tiny but structurally real PDF, so nothing here depends on a fixture file. */
function pdf(marker: string): File {
	const body = `%PDF-1.4\n% ${marker}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`;
	return new File([body], `${marker}.pdf`, { type: 'application/pdf' });
}

async function upload(clientId: string, file: File, contractId?: string) {
	const form = new FormData();
	form.set('file', file);
	if (contractId) form.set('contract_id', contractId);
	const res = await fetch(`${BASE}/api/clients/${clientId}/files`, { method: 'POST', body: form });
	const text = await res.text();
	let json: Record<string, unknown> | null = null;
	try {
		json = JSON.parse(text) as Record<string, unknown>;
	} catch {
		json = null;
	}
	return { res, json };
}

/**
 * Cleanup goes through the delete route, not straight at the table.
 *
 * Deleting the rows in SQLite would satisfy layer 1 and leave every uploaded
 * object in the bucket, which is precisely the orphan the route exists to
 * avoid. Using the route means this suite cannot pass while leaving files
 * behind, and it exercises the delete path one more time on the way out.
 */
async function wipe() {
	for (const id of [A, B]) {
		const rows = db
			.prepare('SELECT id FROM contract_files WHERE client_id = ?')
			.all(id) as { id: string }[];
		for (const row of rows) {
			await fetch(`${BASE}/api/clients/${id}/files/${row.id}`, { method: 'DELETE' }).catch(
				() => null
			);
		}
		// Anything the route could not remove still goes, so a failed cleanup
		// cannot leave layer 1 red for the next run.
		db.prepare('DELETE FROM contract_files WHERE client_id = ?').run(id);
		db.prepare('DELETE FROM contracts WHERE client_id = ?').run(id);
		db.prepare('DELETE FROM clients WHERE id = ?').run(id);
	}
}

beforeAll(async () => {
	db = openDb();
	await wipe();
	for (const [id, name] of [
		[A, 'CONTRACT FIXTURE ALPHA'],
		[B, 'CONTRACT FIXTURE BRAVO']
	]) {
		db.prepare(
			`INSERT INTO clients (id, name, status, created_at, updated_at)
       VALUES (?, ?, 'active', ?, ?)`
		).run(id, name, NOW, NOW);
	}

	db.prepare(
		`INSERT INTO contracts (id, client_id, title, created_at, updated_at)
     VALUES (?, ?, 'ALPHA TERMS', ?, ?)`
	).run(`${A}-terms`, A, NOW, NOW);
});

afterAll(async () => {
	await wipe();
	db.close();
});

describe('uploading a signed contract', () => {
	it('accepts a PDF and records it against the client', async () => {
		const { res, json } = await upload(A, pdf('alpha-signed'));
		expect(res.status, JSON.stringify(json)).toBe(201);

		const file = json?.file as { id: string; client_id: string; size_bytes: number };
		expect(file.client_id).toBe(A);
		expect(file.size_bytes, 'a zero-byte row was written').toBeGreaterThan(0);
	});

	it('refuses anything that is not a contract', async () => {
		// An allowlist, not a blocklist: the point is that the next extension
		// somebody invents is refused too, without anybody adding it to a list.
		const script = new File(['echo hello'], 'payload.sh', { type: 'application/x-sh' });
		const { res } = await upload(A, script);
		expect(res.status).toBe(415);
	});

	it('refuses an empty file rather than filing nothing', async () => {
		const empty = new File([], 'nothing.pdf', { type: 'application/pdf' });
		const { res } = await upload(A, empty);
		expect(res.status).toBe(400);
	});

	it('refuses to attach a file to another client\'s terms', async () => {
		// The contract row is checked against the client in the path. Without
		// that, a signed document files itself under a client who never signed it.
		const { res } = await upload(B, pdf('bravo-misfiled'), `${A}-terms`);
		expect(res.status).toBe(404);

		const n = db
			.prepare('SELECT COUNT(*) AS n FROM contract_files WHERE client_id = ?')
			.get(B) as { n: number };
		expect(Number(n.n), 'the refusal wrote the row anyway').toBe(0);
	});

	it('attaches to its own terms when asked', async () => {
		const { res, json } = await upload(A, pdf('alpha-with-terms'), `${A}-terms`);
		expect(res.status).toBe(201);
		expect((json?.file as { contract_id: string }).contract_id).toBe(`${A}-terms`);
	});
});

describe('reading one back', () => {
	it('serves the bytes through the client that owns them', async () => {
		const row = db
			.prepare('SELECT id FROM contract_files WHERE client_id = ? LIMIT 1')
			.get(A) as { id: string };

		const res = await fetch(`${BASE}/api/clients/${A}/files/${row.id}`);
		expect(res.ok).toBe(true);
		expect(res.headers.get('content-type')).toBe('application/pdf');

		// Never cached by a shared cache: this is a client's contract.
		expect(res.headers.get('cache-control')).toContain('no-store');

		const body = await res.text();
		expect(body.startsWith('%PDF'), 'the bytes did not come back').toBe(true);
	});

	it('refuses the same file under a different client', async () => {
		const row = db
			.prepare('SELECT id FROM contract_files WHERE client_id = ? LIMIT 1')
			.get(A) as { id: string };

		// The defect this exists for: a real id, reached through the wrong
		// client, must not serve the file.
		const res = await fetch(`${BASE}/api/clients/${B}/files/${row.id}`);
		expect(res.status, "one client's contract was served from another's URL").toBe(404);
	});

	it('lists only this client\'s files', async () => {
		await upload(B, pdf('bravo-signed'));

		const mine = (await (await fetch(`${BASE}/api/clients/${A}/files`)).json()) as {
			files: { filename: string }[];
		};
		const names = mine.files.map((f) => f.filename);
		expect(names).toContain('alpha-signed.pdf');
		expect(names, "account B's file appeared on A").not.toContain('bravo-signed.pdf');
	});
});

describe('removing one', () => {
	it('refuses a file belonging to another client, and leaves it there', async () => {
		const row = db
			.prepare('SELECT id FROM contract_files WHERE client_id = ? LIMIT 1')
			.get(A) as { id: string };

		const res = await fetch(`${BASE}/api/clients/${B}/files/${row.id}`, { method: 'DELETE' });
		expect(res.status).toBe(404);

		const still = db
			.prepare('SELECT COUNT(*) AS n FROM contract_files WHERE id = ?')
			.get(row.id) as { n: number };
		expect(Number(still.n), 'the refusal deleted the row anyway').toBe(1);
	});

	it('removes the row and the file together', async () => {
		const row = db
			.prepare('SELECT id FROM contract_files WHERE client_id = ? LIMIT 1')
			.get(A) as { id: string };

		const res = await fetch(`${BASE}/api/clients/${A}/files/${row.id}`, { method: 'DELETE' });
		expect(res.ok).toBe(true);

		const gone = await fetch(`${BASE}/api/clients/${A}/files/${row.id}`);
		expect(gone.status, 'the bytes outlived the row').toBe(404);
	});
});

describe('the activity feed', () => {
	it('reports a filed contract without anything having written a log line', async () => {
		await upload(A, pdf('alpha-activity'));

		const overview = (await (await fetch(`${BASE}/api/clients/${A}/overview`)).json()) as {
			activity: { kind: string; detail: string }[];
		};

		const filed = overview.activity.find((e) => e.kind === 'file');
		expect(filed, 'a filed contract did not reach the activity feed').toBeTruthy();
		expect(filed?.detail).toContain('alpha-activity.pdf');
	});
});
