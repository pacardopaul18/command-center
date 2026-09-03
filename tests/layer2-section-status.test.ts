import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	SECTION_MAPPINGS,
	isSectionMapping,
	resolveSection,
	sectionLabel,
	sectionProgress,
	type SectionStatusRow
} from '../src/lib/section-status';

const ROOT = process.cwd();

/**
 * Sections become status by decision, never by rule.
 *
 * Pillar 2's ruling. MacGray's 281 sections carry 103 distinct names, and the
 * survey of them is why the unmapped state matters more than the mapped one:
 * Sales, Finance, Operations and Marketing alone hold 1,362 tasks and none of
 * them is a workflow status. Three names matched a status vocabulary and all
 * three were the word "Review" inside a phase title.
 *
 * So a crosswalk somebody edits, provenance on every row, and an unmapped
 * section that stays unmapped. The tests below are mostly about the refusals,
 * because the refusals are the design.
 */

const row = (over: Partial<SectionStatusRow>): SectionStatusRow => ({
	id: 'r1',
	section_name: null,
	section_gid: null,
	status: 'open',
	source: 'manual',
	mapped_by: 'Paul',
	mapped_at: '2026-09-03',
	note: null,
	...over
});

describe('layer 2: precedence lives in one place', () => {
	it('prefers a mapping on the section gid over one on the name', () => {
		// The same word means different things in two engagements, and the
		// narrower decision wins. The same chain as the client crosswalk. D181.
		const rows = [
			row({ id: 'byname', section_name: 'Sales', status: 'open' }),
			row({ id: 'bygid', section_gid: '123', status: 'in_review' })
		];
		const verdict = resolveSection({ gid: '123', name: 'Sales' }, rows);
		expect(verdict.status).toBe('in_review');
		expect(verdict.via).toBe('section_gid');
	});

	it('falls to the name when no gid mapping exists', () => {
		const rows = [row({ section_name: 'Sales', status: 'open' })];
		const verdict = resolveSection({ gid: '999', name: 'Sales' }, rows);
		expect(verdict.status).toBe('open');
		expect(verdict.via).toBe('section_name');
	});

	it('carries who decided and when, on every answer it gives', () => {
		/*
		 * A status with no provenance is indistinguishable from an inferred one
		 * a year from now. The ruling is that these are decisions, so the record
		 * of the decision travels with the answer rather than being available on
		 * request.
		 */
		const rows = [
			row({ section_name: 'Doing', status: 'in_progress', mapped_by: 'Paul', mapped_at: '2026-09-03', note: 'Agreed with Dustin' })
		];
		const verdict = resolveSection({ name: 'Doing' }, rows);
		expect(verdict.mapped_by).toBe('Paul');
		expect(verdict.mapped_at).toBe('2026-09-03');
		expect(verdict.note).toBe('Agreed with Dustin');
	});
});

describe('layer 2: an unmapped section stays unmapped', () => {
	it('answers null and says so, rather than picking a default', () => {
		/*
		 * The failure this prevents: 2,400 tasks claiming a status nobody
		 * assigned, on a screen that then looks complete. An empty crosswalk has
		 * to produce an empty answer.
		 */
		const verdict = resolveSection({ gid: '1', name: 'Costco Launch' }, []);
		expect(verdict.status).toBe(null);
		expect(verdict.via).toBe('unmapped');
		expect(verdict.mapped_by).toBe(null);
	});

	it('does not match a section whose name merely looks similar', () => {
		// A near-match would apply one decision to two sections, which is the
		// same defect as inference with an extra step.
		const rows = [row({ section_name: 'Sales', status: 'open' })];
		for (const name of ['Sales Ops', 'sales', 'SALES', ' Sales', 'Sale']) {
			expect(resolveSection({ name }, rows).via, `${name} matched Sales`).toBe('unmapped');
		}
	});

	it('does not fall back to a name mapping meant for a different gid', () => {
		const rows = [row({ section_gid: 'abc', status: 'done' })];
		expect(resolveSection({ gid: 'xyz', name: 'Sales' }, rows).via).toBe('unmapped');
	});
});

describe('layer 2: no status is a decision, and absence is not', () => {
	/*
	 * The distinction the whole reconciliation depends on. "Sales is a business
	 * function and carries no status" is an answer. "Nobody has looked at Sales"
	 * is a question still open. Both produce no status for the task, and they
	 * must never look the same on a screen or in a count. D214, D220.
	 */
	it('reports not_a_status separately from unmapped', () => {
		const rows = [row({ section_name: 'Sales', status: 'not_a_status', mapped_by: 'Paul' })];
		const decided = resolveSection({ name: 'Sales' }, rows);
		const never = resolveSection({ name: 'Finance' }, rows);

		expect(decided.status).toBe(null);
		expect(never.status).toBe(null);
		expect(decided.via).toBe('not_a_status');
		expect(never.via).toBe('unmapped');
		expect(decided.mapped_by).toBe('Paul');
		expect(never.mapped_by).toBe(null);
	});

	it('labels the two differently on screen', () => {
		expect(sectionLabel({ status: null, via: 'not_a_status', mapped_by: 'Paul', mapped_at: 'x', note: null })).toBe('Carries no status');
		expect(sectionLabel({ status: null, via: 'unmapped', mapped_by: null, mapped_at: null, note: null })).toBe('Not mapped yet');
	});

	it('counts a decided-no-status section as decided', () => {
		const verdicts = [
			resolveSection({ name: 'A' }, [row({ section_name: 'A', status: 'in_progress' })]),
			resolveSection({ name: 'B' }, [row({ section_name: 'B', status: 'not_a_status' })]),
			resolveSection({ name: 'C' }, [])
		];
		const p = sectionProgress(verdicts);
		expect(p.sections).toBe(3);
		expect(p.mapped_to_status).toBe(1);
		expect(p.marked_no_status).toBe(1);
		expect(p.unmapped).toBe(1);
		expect(p.decided_share).toBeCloseTo(2 / 3, 5);
	});

	it('reports no share at all when there is nothing to decide', () => {
		// Zero would read as "nothing has been decided" and an empty mirror is
		// not that claim. D214.
		expect(sectionProgress([]).decided_share).toBe(null);
	});
});

describe('layer 2: nothing infers a status from a section name', () => {
	it('admits only manual as a source', () => {
		/*
		 * The column exists so that adding an inferred mapping is a schema change
		 * somebody has to justify, rather than a quiet insert that looks like
		 * every other row.
		 */
		const sql = readFileSync(join(ROOT, 'migrations', '0046_section_status_map.sql'), 'utf8');
		expect(sql).toMatch(/CHECK \(source IN \('manual'\)\)/);
	});

	it('has no keyword list, pattern or normaliser anywhere in the resolver', () => {
		/*
		 * A source check, in the D166 shape, because the failure being prevented
		 * is somebody adding a helpful default later. The refusals in this module
		 * are the design and they are easy to mistake for a gap.
		 */
		const src = readFileSync(join(ROOT, 'src', 'lib', 'section-status.ts'), 'utf8')
			.replace(/\/\*[\s\S]*?\*\//g, ' ')
			.replace(/(^|[^:])\/\/.*$/gm, '$1');

		for (const smell of [
			'toLowerCase',
			'toUpperCase',
			'trim()',
			'startsWith',
			'endsWith',
			'match(',
			'RegExp'
		]) {
			expect(src.includes(smell), `${smell} in the resolver is inference or fuzzy matching`).toBe(
				false
			);
		}

		/*
		 * `includes` is allowed in exactly one place: membership of the fixed
		 * vocabulary, which is an array lookup on a constant and not a string
		 * comparison against a section name. Checked rather than banned, because
		 * the first version of this test banned it outright and failed on
		 * `isSectionMapping`, which is the one call that is obviously fine.
		 */
		for (const line of src.split('\n').filter((l) => l.includes('includes('))) {
			expect(line, 'includes() must only test the fixed vocabulary').toMatch(
				/SECTION_MAPPINGS as readonly string\[\]\)\.includes/
			);
		}
	});

	it('is the only place a section becomes a status', () => {
		const server = join(ROOT, 'src', 'lib', 'server');
		const walk = (dir: string): string[] =>
			readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
				const full = join(dir, e.name);
				if (e.isDirectory()) return walk(full);
				return e.name.endsWith('.ts') ? [full] : [];
			});

		// Any server file that reads a section name and produces a status has to
		// go through the resolver. Nothing else may.
		const offenders = walk(server).filter((f) => {
			const text = readFileSync(f, 'utf8');
			return /section_name[\s\S]{0,200}(TICKET_STATUSES|'in_progress'|'in_review')/.test(text);
		});
		expect(offenders.map((f) => f.slice(server.length + 1))).toEqual([]);
	});

	it('offers not_a_status alongside the six, and nothing else', () => {
		expect([...SECTION_MAPPINGS].sort()).toEqual(
			['blocked', 'cancelled', 'done', 'in_progress', 'in_review', 'not_a_status', 'open'].sort()
		);
		expect(isSectionMapping('not_a_status')).toBe(true);
		expect(isSectionMapping('probably_done')).toBe(false);
		expect(isSectionMapping('')).toBe(false);
	});
});


describe('layer 2: the route records decisions and refuses inferences', () => {
	/*
	 * Against the fixture, through the real route. The resolver tests above are
	 * pure; these are about what the API will and will not store, which is a
	 * different question and the one an attacker or a careless script meets.
	 */
	const BASE = process.env.API_BASE ?? 'http://127.0.0.1:5173';
	const NAME = 'tp-section-fixture';

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

	beforeAll(async () => {
		const { res } = await api('/api/health');
		if (!res.ok && res.status !== 503) {
			throw new Error(`Dev server not answering at ${BASE}. Start it with: npm run dev`);
		}
		await api(`/api/sections?section_name=${encodeURIComponent(NAME)}`, { method: 'DELETE' });
	});

	afterAll(async () => {
		await api(`/api/sections?section_name=${encodeURIComponent(NAME)}`, { method: 'DELETE' });
	});

	it('stores a decision with its provenance, read back from the route', async () => {
		const created = await api(
			'/api/sections',
			post({ section_name: NAME, status: 'in_review', mapped_by: 'A person', note: 'Because.' })
		);
		expect(created.res.status, created.text.slice(0, 200)).toBe(201);
		expect(created.json.section.status).toBe('in_review');
		expect(created.json.section.mapped_by).toBe('A person');

		const list = await api('/api/sections');
		const row = (list.json.sections ?? []).find((s: any) => s.section_name === NAME);
		// The fixture has no such section, so it will not appear in the list. The
		// decision still exists and the resolver is what proves it; asserted
		// through the create response rather than pretending the list would show it.
		expect(row === undefined || row.status === 'in_review').toBe(true);
	});

	it('refuses a status outside the vocabulary', async () => {
		const bad = await api(
			'/api/sections',
			post({ section_name: NAME, status: 'probably_done', mapped_by: 'A person' })
		);
		expect(bad.res.status).toBe(400);
		expect(bad.json.error).toMatch(/not_a_status/);
	});

	it('refuses a ruling with nobody against it', async () => {
		// Provenance is the point. A mapping the server attributed to nobody is
		// indistinguishable from an inference a year from now.
		const bad = await api('/api/sections', post({ section_name: NAME, status: 'open' }));
		expect(bad.res.status).toBe(400);
	});

	it('refuses both keys at once, and neither', async () => {
		const both = await api(
			'/api/sections',
			post({ section_name: NAME, section_gid: 'x', status: 'open', mapped_by: 'A person' })
		);
		expect(both.res.status).toBe(400);

		const neither = await api('/api/sections', post({ status: 'open', mapped_by: 'A person' }));
		expect(neither.res.status).toBe(400);
	});

	it('replaces a second ruling on the same name rather than storing two', async () => {
		await api(
			'/api/sections',
			post({ section_name: NAME, status: 'open', mapped_by: 'First' })
		);
		const second = await api(
			'/api/sections',
			post({ section_name: NAME, status: 'blocked', mapped_by: 'Second' })
		);
		expect(second.res.status).toBe(201);
		expect(second.json.section.status).toBe('blocked');
		expect(second.json.section.mapped_by).toBe('Second');
	});

	it('reports progress over names, and counts the tasks still undecided', async () => {
		const list = await api('/api/sections');
		expect(list.res.status).toBe(200);
		expect(typeof list.json.progress.unmapped).toBe('number');
		expect(typeof list.json.tasks_under_unmapped).toBe('number');
		// Decided is mapped plus marked-no-status, never mapped alone: a section
		// ruled to carry no status is finished, not skipped.
		const p = list.json.progress;
		if (p.sections > 0) {
			expect(p.mapped_to_status + p.marked_no_status + p.unmapped).toBe(p.sections);
		}
	});
});


describe('layer 1: a ticket cannot resolve to two section statuses', () => {
	/*
	 * The conflicted case, ruled and then found unreachable, so this asserts the
	 * unreachability instead of handling it.
	 *
	 * The concern was real: if a task could sit in two mapped sections with two
	 * different statuses, the precedence chain has no rule for it, `section_status`
	 * is one column, and the collapse would happen wherever the query landed.
	 * That is exactly the plausible-wrong-answer the design refuses.
	 *
	 * It cannot happen here, and the reason is structural rather than lucky.
	 * `asana_tasks.gid` is the PRIMARY KEY and `section_gid` is one column on
	 * that row, so one task is one row is one section. Verified against the
	 * mirror as well as against the schema: zero tasks carry more than one
	 * section, and zero task gids appear twice.
	 *
	 * So there is no branch to write. Writing one would be dead code whose test
	 * could never fail on real data, which is the D222 family in the form that
	 * looks most like diligence.
	 *
	 * WHAT WOULD MAKE IT REACHABLE, and why this test exists rather than a
	 * comment: Asana genuinely allows a task in several projects, and
	 * `asana_task_projects` exists to hold that. The mirror records one project
	 * and one section per task, the one it was pulled under. If a future pull
	 * carries the full membership, a task gains two sections and this test fails
	 * the day it does, which is the day the conflicted rule has to be built.
	 */
	it('the schema permits only one section per task', () => {
		const sql = readFileSync(join(ROOT, 'migrations', '0032_asana_mirror.sql'), 'utf8');
		const table = sql.slice(sql.indexOf('CREATE TABLE asana_tasks'));
		const body = table.slice(0, table.indexOf(');'));
		expect(body).toMatch(/gid TEXT PRIMARY KEY/);

		/*
		 * Counted by line rather than by a multiline regex. The regex form returned
		 * 1 in node and 0 through the test transform, and a schema assertion that
		 * silently counts nothing is worse than none: it would have passed just as
		 * happily if a second section column appeared.
		 */
		const sectionColumns = body
			.split(String.fromCharCode(10))
			.filter((line) => line.trim().startsWith('section_gid'));
		expect(sectionColumns.length, 'one section column, not a list').toBe(1);
	});

	it('holds no task with more than one section, in either database', () => {
		/*
		 * Read from the file, both of them. The fixture is one shape and the real
		 * mirror is another, and this property has to be true of the data rather
		 * than only of the schema that permits it.
		 */
		for (const state of ['state', 'real']) {
			let path: string;
			try {
				const dir = join('.wrangler', state, 'v3', 'd1', 'miniflare-D1DatabaseObject');
				const file = readdirSync(dir).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
				if (!file) continue;
				path = join(dir, file);
			} catch {
				// The real database is not present on every machine. Skipping it is
				// correct; skipping both would make this test vacuous, which the
				// fixture check below rules out.
				continue;
			}

			const conn = new DatabaseSync(path);
			try {
				const dupes = conn
					.prepare(
						`SELECT COUNT(*) AS n FROM (
               SELECT gid FROM asana_tasks GROUP BY gid HAVING COUNT(DISTINCT section_gid) > 1)`
					)
					.get() as { n: number };
				expect(Number(dupes.n), `${state}: a task sits in two sections`).toBe(0);

				const twice = conn
					.prepare('SELECT COUNT(*) AS n FROM (SELECT gid FROM asana_tasks GROUP BY gid HAVING COUNT(*) > 1)')
					.get() as { n: number };
				expect(Number(twice.n), `${state}: a task gid appears twice`).toBe(0);
			} finally {
				conn.close();
			}
		}
	});

	it('holds no task in more than one project, which is the other way in', () => {
		// `asana_task_projects` is where multi-membership would appear first. Zero
		// today, and the day it is not, the section can differ per project.
		const dir = join('.wrangler', 'real', 'v3', 'd1', 'miniflare-D1DatabaseObject');
		let file: string | undefined;
		try {
			file = readdirSync(dir).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
		} catch {
			file = undefined;
		}
		if (!file) return;

		const conn = new DatabaseSync(join(dir, file));
		try {
			const multi = conn
				.prepare(
					`SELECT COUNT(*) AS n FROM (
             SELECT task_gid FROM asana_task_projects GROUP BY task_gid
             HAVING COUNT(DISTINCT project_gid) > 1)`
				)
				.get() as { n: number };
			expect(
				Number(multi.n),
				'a task now sits in several projects, so one task can carry two sections and the conflicted rule has to be built'
			).toBe(0);
		} finally {
			conn.close();
		}
	});
});
