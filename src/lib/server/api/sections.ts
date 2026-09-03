import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { ApiError, optionalText, readJsonObject, requiredText } from './validate';
import { nowUtc, todayInWorkingZone } from '../dates';
import {
	isSectionMapping,
	resolveSection,
	sectionProgress,
	type SectionMapping,
	type SectionStatusRow
} from '$lib/section-status';

/**
 * The section reconciliation.
 *
 * Asana's real vocabulary for where a task is, at MacGray, is the section it
 * sits in. There are 103 distinct names across 281 sections and 66 projects,
 * and the app has six statuses. This is where a person says which is which.
 *
 * WHAT THE SURVEY FOUND, because it is what the screen has to be built for.
 * These are mostly not workflow status:
 *
 *   Sales, Finance, Operations, Marketing   business function, 1,362 tasks
 *   Phase 2 - Weeks 1-3 - Instacart ...     engagement phase, 39 names
 *   Costco Launch, 2500 Can Trial           ad-hoc grouping
 *   Untitled section                        Asana's default, 203 tasks
 *
 * So the common answer is "this carries no status", and that answer is a
 * mapping rather than an absence. A screen that offered only the six statuses
 * would have no way to record it, and the reconciliation could never finish.
 */

export const sections = new Hono<ApiEnv>();

async function crosswalkRows(db: ApiEnv['Bindings']['DB']): Promise<SectionStatusRow[]> {
	const { results } = await db
		.prepare(
			`SELECT id, section_name, section_gid, status, source, mapped_by, mapped_at, note
       FROM section_status_map`
		)
		.all<SectionStatusRow>();
	return results ?? [];
}

/**
 * Every section name in the mirror, with what it holds and what it means.
 *
 * Grouped by name rather than listed by section, because the name is the unit a
 * person decides about: "Sales" appears in 19 projects and one ruling should
 * cover all 19. The per-section overrides are listed separately, since they are
 * the exception and burying them in the list would hide the thing that wins.
 */
sections.get('/', async (c) => {
	const rows = await crosswalkRows(c.env.DB);

	const { results } = await c.env.DB.prepare(
		`SELECT s.name AS section_name,
            COUNT(DISTINCT s.gid) AS sections,
            COUNT(DISTINCT s.project_gid) AS projects,
            COUNT(t.gid) AS tasks,
            SUM(CASE WHEN t.completed = 0 THEN 1 ELSE 0 END) AS open_tasks
     FROM asana_sections s
     LEFT JOIN asana_tasks t ON t.section_gid = s.gid
     GROUP BY s.name
     ORDER BY tasks DESC, s.name COLLATE NOCASE`
	).all<{
		section_name: string;
		sections: number;
		projects: number;
		tasks: number;
		open_tasks: number | null;
	}>();

	const named = (results ?? []).map((row) => {
		const verdict = resolveSection({ name: row.section_name }, rows);
		return {
			...row,
			open_tasks: Number(row.open_tasks ?? 0),
			status: verdict.status,
			via: verdict.via,
			mapped_by: verdict.mapped_by,
			mapped_at: verdict.mapped_at,
			note: verdict.note
		};
	});

	// Per-section overrides, named so they are visible as the exception they are.
	const { results: overrides } = await c.env.DB.prepare(
		`SELECT m.section_gid, m.status, m.mapped_by, m.mapped_at, m.note,
            s.name AS section_name, p.name AS project_name
     FROM section_status_map m
     LEFT JOIN asana_sections s ON s.gid = m.section_gid
     LEFT JOIN asana_projects p ON p.gid = s.project_gid
     WHERE m.section_gid IS NOT NULL
     ORDER BY s.name COLLATE NOCASE`
	).all();

	return c.json({
		sections: named,
		overrides: overrides ?? [],
		/*
		 * Progress over names, not over section rows, because names are what
		 * somebody decides. Reported so the screen can say how much is left
		 * without the reader counting rows.
		 */
		progress: sectionProgress(named.map((n) => resolveSection({ name: n.section_name }, rows))),
		/*
		 * How many tasks are affected by what is still undecided. The count that
		 * matters: 103 names is a chore, and the tasks behind them are the reason
		 * to do it.
		 */
		tasks_under_unmapped: named
			.filter((n) => n.via === 'unmapped')
			.reduce((total, n) => total + Number(n.tasks ?? 0), 0)
	});
});

/**
 * Records one decision.
 *
 * `mapped_by` is required and is not defaulted to Paul. The point of provenance
 * is that a year from now somebody can tell a decision from an inference, and a
 * field the server fills in says nothing.
 */
sections.post('/', async (c) => {
	const body = await readJsonObject(c.req.raw);

	const status = body.status;
	if (!isSectionMapping(status)) {
		throw new ApiError(
			400,
			'A section maps to one of the six statuses, or to not_a_status when it carries none.'
		);
	}

	const name = optionalText(body.section_name, 'Section name', 300);
	const gid = optionalText(body.section_gid, 'Section', 64);
	if (!name === !gid) {
		throw new ApiError(
			400,
			'Map either a section name or one section, not both and not neither.'
		);
	}

	const mappedBy = requiredText(body.mapped_by, 'Who decided', 120);
	const note = optionalText(body.note, 'Note', 1000);
	const now = nowUtc();

	/*
	 * One decision per key. A second ruling on the same name replaces the first
	 * rather than sitting beside it, because two answers to one question is a
	 * resolver that has to pick, and picking is the inference this table exists
	 * to avoid.
	 */
	await c.env.DB.prepare(
		`INSERT INTO section_status_map
       (id, section_name, section_gid, status, source, mapped_by, mapped_at, note,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?)
     ON CONFLICT(section_name) WHERE section_name IS NOT NULL DO UPDATE SET
       status = excluded.status, mapped_by = excluded.mapped_by,
       mapped_at = excluded.mapped_at, note = excluded.note,
       updated_at = excluded.updated_at
     ON CONFLICT(section_gid) WHERE section_gid IS NOT NULL DO UPDATE SET
       status = excluded.status, mapped_by = excluded.mapped_by,
       mapped_at = excluded.mapped_at, note = excluded.note,
       updated_at = excluded.updated_at`
	)
		.bind(
			crypto.randomUUID(),
			name,
			gid,
			status as SectionMapping,
			mappedBy,
			todayInWorkingZone(),
			note,
			now,
			now
		)
		.run();

	const rows = await crosswalkRows(c.env.DB);
	return c.json(
		{
			section: resolveSection(gid ? { gid } : { name }, rows),
			progress_note:
				'The projection applies this on its next run. Nothing is rewritten until then.'
		},
		201
	);
});

/**
 * Removes a decision, returning the section to unmapped.
 *
 * Deliberately available, unlike the SOP verification log. A mapping is a
 * working judgement about somebody else's vocabulary, not a record that
 * something happened, and being wrong about it should be correctable rather
 * than only overwritable.
 */
sections.delete('/', async (c) => {
	const name = c.req.query('section_name') ?? null;
	const gid = c.req.query('section_gid') ?? null;
	if (!name === !gid) {
		throw new ApiError(400, 'Name one section name or one section.');
	}

	const result = await c.env.DB.prepare(
		name
			? 'DELETE FROM section_status_map WHERE section_name = ?'
			: 'DELETE FROM section_status_map WHERE section_gid = ?'
	)
		.bind(name ?? gid)
		.run();

	const removed = Number(result.meta?.changes ?? 0);
	if (removed === 0) throw new ApiError(404, 'That section has no mapping to remove.');
	return c.json({ removed });
});
