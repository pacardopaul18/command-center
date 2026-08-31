import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fillTemplate, missingInputs, templateInputs } from '../src/lib/template-inputs';

/**
 * The fields a template asks for, and the record of it being used.
 *
 * The parser is pure and tested without a network, because its failures are the
 * quiet kind: a footnote read as a question, a placeholder silently replaced by
 * nothing, the same question asked three times. All of those look like a working
 * feature on screen.
 *
 * The recording half is what makes the Most used tile mean anything. It is also
 * where a mistake would be worst: storing the generated draft would turn this
 * table into an archive of unreviewed client-facing writing, so the test asserts
 * that it does not.
 */

const BASE = 'http://localhost:5173';
const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const TEMPLATE = 'tpl-fixture-1';
const NOW = '2026-09-01T00:00:00Z';

describe('reading the fields out of a template', () => {
	it('finds each placeholder once, in the order it first appears', () => {
		const body = 'Hi [name], invoice [number] is late. Chase [name] again about [number].';
		expect(templateInputs(body).map((i) => i.key)).toEqual(['name', 'number']);
	});

	it('turns a key into something a form can label', () => {
		const body = '[client_name] [client-name] [clientName] [days past due]';
		expect(templateInputs(body).map((i) => i.label)).toEqual([
			'Client name',
			'Client name',
			'Client name',
			'Days past due'
		]);
	});

	it('does not mistake a footnote or a bracketed date for a question', () => {
		// The rule that keeps ordinary prose out: a placeholder starts with a
		// letter. Without it every citation in a document becomes a form field.
		const body = 'See [1] and [2026-08-31] and [42].';
		expect(templateInputs(body)).toEqual([]);
	});

	it('does not treat a bracketed sentence as a placeholder', () => {
		const body = '[this is an aside that runs on well past the length of any real field name]';
		expect(templateInputs(body)).toEqual([]);
	});

	it('leaves an unanswered placeholder visible rather than blanking it', () => {
		/**
		 * The defect this exists for. A half-filled template that still shows
		 * [number] is obviously unfinished; one with a gap where the number
		 * should be looks finished and goes out that way.
		 */
		const body = 'Hi [name], invoice [number] is late.';
		expect(fillTemplate(body, { name: 'Dana' })).toBe('Hi Dana, invoice [number] is late.');
		expect(fillTemplate(body, { name: 'Dana', number: '' })).toBe(
			'Hi Dana, invoice [number] is late.'
		);
	});

	it('replaces every occurrence, not just the first', () => {
		expect(fillTemplate('[name] and [name]', { name: 'Dana' })).toBe('Dana and Dana');
	});

	it('names what is still empty', () => {
		const body = 'Hi [name], invoice [number] is [days] days late.';
		expect(missingInputs(body, { name: 'Dana' }).map((i) => i.key)).toEqual(['number', 'days']);
		expect(missingInputs(body, { name: 'D', number: 'X', days: '3' })).toEqual([]);
	});

	it('an answer containing brackets is not re-read as a placeholder', () => {
		// String.replace with a function argument, not a $-pattern: a value
		// containing $& or $1 would otherwise be expanded rather than inserted.
		const out = fillTemplate('Hi [name].', { name: '[Dana] $& $1' });
		expect(out).toBe('Hi [Dana] $& $1.');
	});
});

function openDb(): DatabaseSync {
	const f = readdirSync(DIR).find((x) => x.endsWith('.sqlite') && x !== 'metadata.sqlite');
	if (!f) throw new Error('Local D1 not found.');
	return new DatabaseSync(join(DIR, f));
}

let db: DatabaseSync;

function wipe() {
	db.prepare('DELETE FROM template_uses WHERE template_id = ?').run(TEMPLATE);
	db.prepare('DELETE FROM templates WHERE id = ?').run(TEMPLATE);
}

beforeAll(() => {
	db = openDb();
	wipe();
	db.prepare(
		`INSERT INTO templates (id, name, scenario, body, type, status, created_at, updated_at)
     VALUES (?, 'FIXTURE TEMPLATE', 'FIXTURE scenario', 'Hi [name].', 'email', 'active', ?, ?)`
	).run(TEMPLATE, NOW, NOW);
});

afterAll(() => {
	wipe();
	db.close();
});

async function api(path: string, init?: RequestInit) {
	const res = await fetch(`${BASE}${path}`, init);
	const text = await res.text();
	let json: Record<string, unknown> | null = null;
	try {
		json = JSON.parse(text) as Record<string, unknown>;
	} catch {
		json = null;
	}
	return { res, json };
}

describe('recording that a template was used', () => {
	it('a copy counts as a use, because copying is what the library is for', async () => {
		const { res } = await api(`/api/templates/${TEMPLATE}/used`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ context: 'FIXTURE copied it' })
		});
		expect(res.status).toBe(201);

		const row = db
			.prepare('SELECT context, model, drafted_chars FROM template_uses WHERE template_id = ?')
			.get(TEMPLATE) as { context: string; model: string | null; drafted_chars: number | null };

		expect(row.context).toBe('FIXTURE copied it');
		// No model and no draft, because neither happened. A row that claimed a
		// model had written something would make the drafts figure a lie.
		expect(row.model).toBeNull();
		expect(row.drafted_chars).toBeNull();
	});

	it('stores no draft text, only that a draft happened', () => {
		// The column list is the guarantee. A generated draft is client-facing
		// writing nobody has read; keeping every one would make this table a
		// silent archive of it. D158.
		const columns = db
			.prepare('PRAGMA table_info(template_uses)')
			.all() as { name: string }[];
		const names = columns.map((c) => c.name);
		expect(names).toContain('drafted_chars');
		for (const forbidden of ['draft', 'body', 'text', 'content', 'output']) {
			expect(names, `template_uses has a ${forbidden} column`).not.toContain(forbidden);
		}
	});

	it('the count on the list is computed, so it cannot drift', async () => {
		const before = (await api(`/api/templates?status=all`)).json as {
			templates: { id: string; use_count: number }[];
		};
		const was = before.templates.find((t) => t.id === TEMPLATE)?.use_count ?? 0;

		await api(`/api/templates/${TEMPLATE}/used`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({})
		});

		const after = (await api(`/api/templates?status=all`)).json as {
			templates: { id: string; use_count: number; last_used_at: string | null }[];
		};
		const row = after.templates.find((t) => t.id === TEMPLATE);
		expect(row?.use_count).toBe(was + 1);
		expect(row?.last_used_at, 'the last used date was not reported').toBeTruthy();
	});

	it('refuses to record a use against a template that does not exist', async () => {
		const { res } = await api('/api/templates/does-not-exist/used', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({})
		});
		expect(res.status).toBe(404);
	});

	it('a context longer than a line is cut rather than kept whole', async () => {
		await api(`/api/templates/${TEMPLATE}/used`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ context: 'FIXTURE ' + 'x'.repeat(400) })
		});
		const rows = db
			.prepare('SELECT context FROM template_uses WHERE template_id = ? AND context IS NOT NULL')
			.all(TEMPLATE) as { context: string }[];
		for (const row of rows) {
			expect(row.context.length, 'a whole situation was stored as context').toBeLessThanOrEqual(
				200
			);
		}
	});
});
