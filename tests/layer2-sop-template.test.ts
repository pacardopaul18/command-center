import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	SOP_SECTIONS,
	SOP_TEMPLATE_HTML,
	isUnstartedTemplate,
	unfilledPlaceholders
} from '../src/lib/sop-template';
import { richTextToPlain, sanitizeRichText } from '../src/lib/rich-text';

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:5173';
const ROOT = process.cwd();

/**
 * The house SOP shape, and the log that says it was followed.
 *
 * P7. The template exists because a procedure written from a blank box gets the
 * parts its author was thinking about and misses the ones that only matter when
 * something has gone wrong: the deputy, the timing, the check on each step, the
 * failure table.
 *
 * The verification log exists because a SOP that says what to check had nowhere
 * to record that anybody did. Compliance was a claim and the fault rate was
 * anecdotal, and "it gets it wrong sometimes" is not a number anybody can act
 * on.
 */

const P = 'tp-sop7-';

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

/** The same trigger dance as the other SOP fixture, and the same duty to restore. */
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
		conn
			.prepare(
				`DELETE FROM sop_verifications WHERE sop_id IN (SELECT id FROM sops WHERE title LIKE '${P}%')`
			)
			.run();
		try {
			conn.prepare('DROP TRIGGER IF EXISTS sop_versions_undeletable').run();
			conn.prepare(`UPDATE sops SET current_version_id = NULL WHERE title LIKE '${P}%'`).run();
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

describe('layer 2: the template carries every part of the house shape', () => {
	const plain = richTextToPlain(SOP_TEMPLATE_HTML) ?? '';

	it('names all nine sections', () => {
		for (const section of SOP_SECTIONS) {
			expect(plain, `the template has no ${section} section`).toContain(section);
		}
	});

	it('gives every role a deputy', () => {
		// The reason for the whole column: steps 2 through 8 of SOP-001 have one
		// person against them, and a procedure that names one person stops when
		// that person is away.
		expect(plain).toContain('Deputy');
		expect(plain.toLowerCase()).toContain('named deputy');
	});

	it('puts a timing and a check on every step', () => {
		/*
		 * Counted, not merely present. A template with three step headings and
		 * one "When:" would pass a contains check and would teach the wrong shape
		 * to every SOP written from it.
		 */
		const steps = (plain.match(/^Step \d+/gm) ?? []).length;
		const whens = (plain.match(/^When:/gm) ?? []).length;
		const checks = (plain.match(/Check:/g) ?? []).length;
		expect(steps).toBeGreaterThanOrEqual(3);
		expect(whens, 'every step needs a deadline').toBe(steps);
		expect(checks, 'every step needs something observable to check').toBe(steps);
	});

	it('writes a step that produces work as propose, review, push', () => {
		// SOP-001's steps 6 and 7. Written this way from the outset so the app
		// taking the work over is a change of tooling, not a change of policy.
		expect(plain).toContain('Propose.');
		expect(plain).toContain('Review.');
		expect(plain).toContain('Push.');
	});

	it('sends the verification log to the app rather than into the document', () => {
		/*
		 * A log kept inside a SOP body would be edited into the procedure itself,
		 * and a SOP version is immutable: every verification would produce a new
		 * version of the procedure, which is exactly backwards.
		 */
		expect(plain).toMatch(/recorded against this SOP in the app/i);
	});

	it('survives the sanitiser unchanged, so it is stored as written', () => {
		// The template is HTML that goes through the same write path as anything
		// a person types. If sanitising rewrote it, the SOP a person started
		// would differ from the template on the very first save.
		expect(sanitizeRichText(SOP_TEMPLATE_HTML)).toBe(SOP_TEMPLATE_HTML);
	});

	it('counts what is left to fill in', () => {
		expect(unfilledPlaceholders(SOP_TEMPLATE_HTML)).toBeGreaterThan(10);
		expect(isUnstartedTemplate(SOP_TEMPLATE_HTML)).toBe(true);
		expect(unfilledPlaceholders('<p>A finished procedure.</p>')).toBe(0);
		expect(isUnstartedTemplate('<p>A finished procedure.</p>')).toBe(false);
	});

	it('is what the new SOP form starts from', () => {
		// A template nothing uses is a document. The form has to reach for it.
		const page = readFileSync(join(ROOT, 'src', 'routes', 'sops', '+page.svelte'), 'utf8');
		expect(page).toMatch(/SOP_TEMPLATE_HTML/);
		expect(page).toMatch(/body_html: SOP_TEMPLATE_HTML/);
	});
});

describe('layer 2: the verification log records who checked and what they found', () => {
	let sopId = '';

	it('starts with no fault rate rather than a rate of zero', async () => {
		const created = await api(
			'/api/sops',
			post({ title: `${P}procedure`, body_html: '<p>Do the thing.</p>' })
		);
		expect(created.res.status, created.text.slice(0, 200)).toBe(201);
		sopId = (created.json.sop ?? created.json).id;

		const detail = await api(`/api/sops/${sopId}`);
		expect(detail.json.verification.total).toBe(0);
		/*
		 * Null, not zero. A rate of 0% reads as "this never fails" and "nobody
		 * has checked" is the opposite claim, which is the D220 rule: a screen
		 * that cannot tell absence from success will be believed about the wrong
		 * one.
		 */
		expect(detail.json.verification.fault_rate).toBe(null);
	});

	it('records a pass and a fault, and computes the rate off them', async () => {
		await api(
			`/api/sops/${sopId}/verifications`,
			post({ subject: '09-02 Workflow Automation', step_number: 3, verified_by: 'Paul', outcome: 'pass' })
		);
		await api(
			`/api/sops/${sopId}/verifications`,
			post({
				subject: '09-01 Onboarding',
				step_number: 3,
				verified_by: 'Paul',
				outcome: 'fault',
				note: 'Filed to the wrong client, moved it.'
			})
		);

		const detail = await api(`/api/sops/${sopId}`);
		expect(detail.json.verification.total).toBe(2);
		expect(detail.json.verification.faults).toBe(1);
		expect(detail.json.verification.passes).toBe(1);
		expect(detail.json.verification.fault_rate).toBe(0.5);
		expect(detail.json.verifications).toHaveLength(2);

		const fault = detail.json.verifications.find((v: any) => v.outcome === 'fault');
		expect(fault.note).toContain('wrong client');
		expect(fault.step_number).toBe(3);
	});

	it('refuses a fault with no note', async () => {
		// A fault with no description is a number with nothing behind it, and the
		// next person cannot act on it.
		const bad = await api(
			`/api/sops/${sopId}/verifications`,
			post({ subject: 'Something', verified_by: 'Paul', outcome: 'fault' })
		);
		expect(bad.res.status).toBe(400);
		expect(bad.json.error).toMatch(/note/i);
	});

	it('refuses it at the database too, not only at the route', () => {
		/*
		 * Two guards, and they are not the same guard. The route check exists so
		 * the reader gets a sentence instead of a constraint failure; the CHECK
		 * in migration 0045 is what makes the rule true of the data. Removing the
		 * route check makes the API answer 500 rather than 400, which is how this
		 * pair was told apart: the request still fails, but for a different
		 * reason and with a worse message. D223.
		 */
		const conn = new DatabaseSync(localD1Path());
		try {
			expect(() =>
				conn
					.prepare(
						`INSERT INTO sop_verifications
             (id, sop_id, step_number, subject, verified_by, verified_at, outcome, note, created_at)
           VALUES ('${P}direct', ?, NULL, 'Direct', 'Nobody', '2026-09-03', 'fault', NULL, '2026-09-03T00:00:00Z')`
					)
					.run(sopId)
			).toThrow();
		} finally {
			conn.close();
		}
	});

	it('takes a whole-procedure check, which is not a missing step', async () => {
		const whole = await api(
			`/api/sops/${sopId}/verifications`,
			post({ subject: 'Full run through', verified_by: 'A deputy', outcome: 'pass' })
		);
		expect(whole.res.status).toBe(201);
		expect(whole.json.verification.step_number).toBe(null);
	});

	it('records who, not always Paul', async () => {
		// The point of a deputy is that somebody else runs the procedure, and a
		// log that always says Paul cannot show that it happened.
		const detail = await api(`/api/sops/${sopId}`);
		const names = new Set(detail.json.verifications.map((v: any) => v.verified_by));
		expect(names.has('A deputy')).toBe(true);
	});

	it('is append only: there is no route that edits or deletes an entry', () => {
		/*
		 * A compliance log that can be tidied up afterwards is not evidence of
		 * anything. A mistaken entry is corrected by logging the right one, which
		 * leaves both visible.
		 */
		const routes = readFileSync(join(ROOT, 'src', 'lib', 'server', 'api', 'sops.ts'), 'utf8');
		expect(routes).not.toMatch(/verifications\/:\w+/);
		expect(routes).not.toMatch(/UPDATE sop_verifications/);
		expect(routes).not.toMatch(/DELETE FROM sop_verifications/);
	});
});

/**
 * SOP-001's own content.
 *
 * The authored source lives under docs/data, which is not in version control:
 * it names real clients, real staff and a confidentiality exception, and
 * putting that in a remote repository is a one-way step nobody asked for. The
 * same rule already covers the client crosswalk.
 *
 * So these skip when the file is absent, and SAY SO. A bare checkout runs green
 * with a visible line saying the install is unverified, which is a different
 * thing from a silent pass: the failure mode this project keeps finding is a
 * check that proves nothing while looking like it proved something, and a skip
 * that announces itself is not that.
 *
 * On a machine that has the file, they run and they bite. `npm run verify:sop`
 * is the companion: it checks the installed record against this same source and
 * fails loudly when the two disagree.
 */
const SOURCE_PATH = join(ROOT, 'docs', 'data', 'SOP-001-meeting-capture.md');

let source = '';
try {
	source = readFileSync(SOURCE_PATH, 'utf8');
} catch {
	source = '';
}

const havePresent = source.length > 0;

if (!havePresent) {
	console.warn(
		'\n  SOP source not present, install unverified.\n' +
			'  docs/data/SOP-001-meeting-capture.md is deliberately not committed: it names real\n' +
			'  clients and staff. The SOP-001 content checks are skipped, not passed. Run\n' +
			'  npm run verify:sop on a machine that holds it.\n'
	);
}

describe.skipIf(!havePresent)('layer 2: SOP-001 is authored, installable and not approved', () => {
	it('carries the four additions the review asked for', () => {
		// Per-step timing, same day for Generate and next business morning for
		// the rest.
		expect(source).toMatch(/\*\*When:\*\* same day/);
		expect((source.match(/\*\*When:\*\*/g) ?? []).length).toBeGreaterThanOrEqual(8);
		expect(source).toMatch(/next business morning/);

		// The verification log, as a table in the app rather than prose here.
		expect(source).toMatch(/## 7\. Verification log/);
		expect(source).toMatch(/recorded in the Command Center against this SOP, not written into this document/);

		// A deputy column covering steps 2 through 8, not only Generate.
		expect(source).toMatch(/\| Role \| Who \| Deputy \|/);
		expect(source).toMatch(/Steps 2 through 8/);

		// Steps 6 and 7 as propose, review, push.
		expect(source).toMatch(/### Step 6: Propose the to-dos/);
		expect(source).toMatch(/### Step 7: Push the reviewed to-dos/);
		expect(source).toMatch(/\*\*Propose\.\*\*/);
		expect(source).toMatch(/\*\*Review\.\*\*/);
		expect(source).toMatch(/\*\*Push\.\*\*/);
	});

	it('keeps the Chasin Dreams exception intact', () => {
		// Dustin flagged it specifically, and it is called out as non-optional.
		expect(source).toMatch(/CD meetings/);
		expect(source).toMatch(/not optional and not subject to convenience/);
	});

	it('says it is a draft and nothing marks it approved', () => {
		/*
		 * Approval is Dustin's act. Neither this repo nor the installer can
		 * perform it, and a document that arrives already looking approved is
		 * the way an unapproved procedure gets followed.
		 */
		expect(source).toMatch(/\*\*Status:\*\* DRAFT/);
		expect(source).toMatch(/Nothing here is in force until he approves it/);

		const installer = readFileSync(join(ROOT, 'scripts', 'install-sop-001.mjs'), 'utf8');
		expect(installer).toMatch(/DRAFT/);
		expect(installer).not.toMatch(/approved: true|status: 'approved'/);
	});

	it('decides whether to write a new version from the source, not from the stored HTML', () => {
		/*
		 * The first version compared the HTML it generated against the HTML that
		 * came back, and those are never equal: the route parses and rebuilds
		 * every value, so the stored form is canonical and the generated form is
		 * not. Re-running the installer therefore added an identical version
		 * every time, which on an append-only table cannot be undone. The
		 * fingerprint is of the source that was sent, so an unchanged file
		 * genuinely produces no version.
		 */
		const installer = readFileSync(join(ROOT, 'scripts', 'install-sop-001.mjs'), 'utf8');
		expect(installer).toMatch(/createHash\('sha256'\)/);
		expect(installer).toMatch(/source \$\{fingerprint\}/);
		expect(installer, 'comparing stored HTML to generated HTML is the bug').not.toMatch(
			/body_html === html/
		);
	});

	it('leaves the Filer deputy named as an open question', () => {
		// It is the question that matters most, and inventing an answer would
		// have been the easiest thing in the document to get wrong.
		expect(source).toMatch(/TO BE NAMED/);
		expect(source).toMatch(/Who is the Filer's deputy\?/);
	});
});
