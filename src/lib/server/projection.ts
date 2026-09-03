import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { nowUtc, todayInWorkingZone } from './dates';
import { resolveSection, type SectionStatusRow } from '$lib/section-status';

/**
 * Putting the mirror onto the app's own screens.
 *
 * The mirror is a faithful copy of Asana in its own tables, and it was built
 * that way so a re-pull after a schema change costs nothing. The consequence
 * nobody scoped: `projects`, `tickets` and every screen that reads them stayed
 * empty while the mirror held 66 projects and 2,585 tasks.
 *
 * This is the missing half. A derivation, not a copy by hand.
 *
 * IDEMPOTENT, AND THAT IS THE WHOLE DESIGN. Every projected row is found again
 * by its Asana gid through `asana_project_links` and `asana_task_links`, so a
 * second run updates what the first wrote instead of doubling it. Pull again,
 * project again, and the app converges to the same state. Nothing here reads
 * what the app currently shows to decide what to write, because that would make
 * the result depend on how many times it had run.
 *
 * NOTHING HERE TOUCHES ASANA OR DROPBOX. It reads mirror tables and writes app
 * tables. The mirror is the source of truth for what Asana said; the app rows
 * are a rendering of it.
 *
 * WHAT IS NOT PROJECTED, and why it is a decision rather than an omission:
 *
 *   Stories.  10,062 of them, and they are comments and system events, not
 *             commitments. Projecting them into `action_items` would bury the
 *             one screen that is supposed to say what Paul owes people under ten
 *             thousand rows nobody owes anybody. They are shown as an activity
 *             trail on the ticket, read straight from the mirror.
 *
 *   Files.    Rendered from `dropbox_files` by query rather than copied into
 *             `project_files`. 11,150 metadata rows copied into a second table
 *             is a second copy that has to be kept converging, for no gain: the
 *             app authors nothing about them. The screens show them; the mirror
 *             remains the only place they live.
 */

const newId = () => crypto.randomUUID();

export interface ProjectionReport {
	run_id: string;
	projects_written: number;
	tickets_written: number;
	subtask_parents_written: number;
	skipped: number;
	skipped_because: string[];
	dropped_fields: { field: string; why: string; rows: number }[];
	totals: {
		tags: number;
		followers: number;
		custom_values: number;
		projects: number;
		projects_from_asana: number;
		projects_archived: number;
		tickets: number;
		tickets_from_asana: number;
		subtasks: number;
		action_items: number;
	};
}

interface MirrorProject {
	gid: string;
	name: string;
	notes: string | null;
	archived: number;
	client_id: string | null;
	created_at: string | null;
	modified_at: string | null;
}

interface MirrorTask {
	gid: string;
	project_gid: string | null;
	parent_gid: string | null;
	section_name: string | null;
	section_gid: string | null;
	name: string;
	notes: string | null;
	assignee_gid: string | null;
	assignee_name: string | null;
	completed: number;
	completed_at: string | null;
	start_on: string | null;
	due_on: string | null;
	created_at: string | null;
	modified_at: string | null;
}

/**
 * An Asana project's phase and status, derived from the only thing Asana says.
 *
 * Asana has no concept of a PMI phase and no project-level health. The app's
 * columns are NOT NULL, so something goes in them, and the choice is between a
 * silent default that asserts every project is `initiating` and a derivation
 * from `archived`, which is a real fact Asana carries.
 *
 * The derivation is stated here and reported in `dropped_fields`, so a screen
 * showing "executing" against 42 projects is traceable to one rule rather than
 * looking like somebody assessed them. Thursday's reconciliation replaces it
 * and the projection re-runs.
 */
interface ProjectSignals {
	archived: number;
	tickets: number;
	open: number;
	overdue: number;
}

function projectPhase(signal: ProjectSignals): { phase: string; status: string } {
	const { archived, tickets, open, overdue } = signal;

	/*
	 * Phase, from what is actually true about the work.
	 *
	 * Deliberately not a completion ratio. The PMI phases are not a progress bar,
	 * and reading "monitoring" off 50% done would be inventing a meaning the
	 * word does not have. Only three things here are known rather than guessed:
	 * an archived project is closed, a project nobody has broken into tickets has
	 * not started, and a project whose tickets are all finished is closing.
	 * Everything else is under way.
	 */
	const phase = archived
		? 'closing'
		: tickets === 0
			? 'initiating'
			: open === 0
				? 'closing'
				: 'executing';

	/*
	 * Status is health, and health is a fact about lateness.
	 *
	 * Anything overdue is at risk, which is the whole of the claim: it does not
	 * say how badly, because nothing here knows that. `blocked` is left for a
	 * person to set, since being blocked is something somebody knows and no
	 * count can show.
	 */
	const status = archived || (tickets > 0 && open === 0) ? 'done' : overdue > 0 ? 'at_risk' : 'on_track';

	return { phase, status };
}

/**
 * A task's status in the app's vocabulary.
 *
 * Deliberately coarse. Asana's real status vocabulary is the section a task sits
 * in, 103 distinct names across 66 projects, and mapping those onto six values
 * now would be guessing the answer to the question Thursday's reconciliation
 * exists to ask. The verbatim section stays on the mirror row and is shown on
 * the ticket, so the guess is visible next to the fact.
 *
 * `completed_at` is required by the table's own CHECK whenever the status is
 * done, and Asana does not always supply one on an old completed task, so it
 * falls back to the last modification rather than leaving the row unwritable.
 */
function projectStatus(task: MirrorTask): { status: string; completedAt: string | null } {
	if (!task.completed) return { status: 'open', completedAt: null };
	return {
		status: 'done',
		completedAt: task.completed_at ?? task.modified_at ?? task.created_at ?? nowUtc()
	};
}

/** Runs statements in chunks, for the same reason the mirror does. */
async function runAll(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
	const CHUNK = 50;
	for (let i = 0; i < statements.length; i += CHUNK) {
		const chunk = statements.slice(i, i + CHUNK);
		try {
			await db.batch(chunk);
		} catch {
			await new Promise((r) => setTimeout(r, 1_000));
			await db.batch(chunk);
		}
	}
}

/**
 * Projects the whole mirror onto the app's model.
 *
 * Safe to run twice. Safe to run after a re-pull. Reports what it wrote, what it
 * could not, and which Asana fields have nowhere to go.
 */
export async function projectMirror(
	db: D1Database,
	workspaceGid: string
): Promise<ProjectionReport> {
	const runId = newId();
	const at = nowUtc();
	await db
		.prepare('INSERT INTO projection_runs (id, started_at) VALUES (?, ?)')
		.bind(runId, at)
		.run();

	/*
	 * The section crosswalk, loaded once.
	 *
	 * 103 names and 281 sections, so the whole table fits in memory many times
	 * over and every task resolves against the same snapshot. Loading it per
	 * task would also mean a mapping edited mid-run applied to some tasks and
	 * not others, which is a projection that depends on when a row was read.
	 */
	const { results: sectionRows } = await db
		.prepare(
			`SELECT id, section_name, section_gid, status, source, mapped_by, mapped_at, note
       FROM section_status_map`
		)
		.all<SectionStatusRow>();
	const crosswalk = sectionRows ?? [];
	/* How many sections anybody has ruled on, for the projection's own report. */
	const sectionsDecided = crosswalk.length;

	/** One task's section verdict, resolved once and reused for both columns. */
	const verdicts = new Map<string, ReturnType<typeof resolveSection>>();
	const sectionVerdict = (task: MirrorTask) => {
		const key = `${task.section_gid ?? ''}|${task.section_name ?? ''}`;
		let v = verdicts.get(key);
		if (!v) {
			v = resolveSection({ gid: task.section_gid, name: task.section_name }, crosswalk);
			verdicts.set(key, v);
		}
		return v;
	};

	const skippedBecause: string[] = [];
	let skipped = 0;
	const skip = (why: string) => {
		skipped += 1;
		if (!skippedBecause.includes(why)) skippedBecause.push(why);
	};

	// --- the tasks, loaded first ------------------------------------------------
	//
	// Before the projects, because a project's phase and status are derived from
	// its tasks and the app's own tickets do not exist yet. The mirror is the
	// source for both, which is also why the two cannot disagree: they are read
	// from the same rows in the same pass.

	const { results: mirrorTasks } = await db
		.prepare(
			`SELECT t.gid, t.project_gid, t.parent_gid, t.section_name, t.section_gid, t.name, t.notes,
              t.assignee_gid, u.name AS assignee_name,
              t.completed, t.completed_at, t.start_on, t.due_on, t.created_at, t.modified_at
       FROM asana_tasks t
       LEFT JOIN asana_users u ON u.gid = t.assignee_gid
       WHERE t.workspace_gid = ?
       ORDER BY t.gid`
		)
		.bind(workspaceGid)
		.all<MirrorTask>();

	const tasks = mirrorTasks ?? [];
	const taskByGid = new Map(tasks.map((t) => [t.gid, t]));

	/** The project a task belongs to, following parents until one is found. */
	function projectGidOf(task: MirrorTask): string | null {
		let current: MirrorTask | undefined = task;
		for (let depth = 0; current && depth < 8; depth++) {
			if (current.project_gid) return current.project_gid;
			current = current.parent_gid ? taskByGid.get(current.parent_gid) : undefined;
		}
		return null;
	}

	const today = todayInWorkingZone();
	const signals = new Map<string, { tickets: number; open: number; overdue: number }>();
	for (const task of tasks) {
		const gid = projectGidOf(task);
		if (!gid) continue;
		const row = signals.get(gid) ?? { tickets: 0, open: 0, overdue: 0 };
		row.tickets += 1;
		if (!task.completed) {
			row.open += 1;
			if (task.due_on && task.due_on < today) row.overdue += 1;
		}
		signals.set(gid, row);
	}

	// --- projects --------------------------------------------------------------

	const { results: mirrorProjects } = await db
		.prepare(
			`SELECT gid, name, notes, archived, client_id, created_at, modified_at
       FROM asana_projects WHERE workspace_gid = ? ORDER BY gid`
		)
		.bind(workspaceGid)
		.all<MirrorProject>();

	// The identity map, read once. A project already projected keeps its app id,
	// which is what makes every link to it survive a re-projection.
	const { results: projectLinks } = await db
		.prepare('SELECT asana_gid, project_id FROM asana_project_links')
		.all<{ asana_gid: string; project_id: string }>();
	const projectIdFor = new Map((projectLinks ?? []).map((r) => [r.asana_gid, r.project_id]));

	let projectsWritten = 0;

	for (const project of mirrorProjects ?? []) {
		const signal = signals.get(project.gid) ?? { tickets: 0, open: 0, overdue: 0 };
		const { phase, status } = projectPhase({ archived: project.archived, ...signal });
		const existing = projectIdFor.get(project.gid);
		const id = existing ?? newId();

		await db
			.prepare(
				`INSERT INTO projects
         (id, client_id, name, phase, status, description, created_at, updated_at, asana_url)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
           client_id = ?2, name = ?3, description = ?6, updated_at = ?8, asana_url = ?9,
           /*
            * A person's decision is not re-derived away.
            *
            * Phase and status are derived from the tickets, and somebody who
            * has set either by hand has said something the counts do not know.
            * Overwriting it on the next projection would revert their decision
            * with nothing to say why, which is the worst kind of silent write.
            */
           phase = CASE WHEN projects.phase_is_manual = 1 THEN projects.phase ELSE ?4 END,
           status = CASE WHEN projects.status_is_manual = 1 THEN projects.status ELSE ?5 END`
			)
			.bind(
				id,
				project.client_id,
				project.name,
				phase,
				status,
				project.notes,
				project.created_at ?? at,
				at,
				`https://app.asana.com/0/${project.gid}`
			)
			.run();

		if (!existing) {
			await db
				.prepare(
					'INSERT OR REPLACE INTO asana_project_links (asana_gid, project_id, linked_at) VALUES (?, ?, ?)'
				)
				.bind(project.gid, id, at)
				.run();
			projectIdFor.set(project.gid, id);
		}

		projectsWritten += 1;
	}

	// --- tasks -----------------------------------------------------------------
	//
	// A ticket needs a project, by the table's own rule, and a subtask arrives
	// from Asana with none: it belongs to its parent. So a task's project is its
	// own, or its parent's, and a task that ends up with neither is skipped and
	// counted rather than attached to something arbitrary.

	const { results: taskLinks } = await db
		.prepare('SELECT asana_gid, ticket_id FROM asana_task_links')
		.all<{ asana_gid: string; ticket_id: string }>();
	const ticketIdFor = new Map((taskLinks ?? []).map((r) => [r.asana_gid, r.ticket_id]));

	// Ids are assigned for every task before any row is written, so a subtask
	// whose parent comes later in gid order still has a parent id to point at.
	for (const task of tasks) {
		if (!ticketIdFor.has(task.gid)) ticketIdFor.set(task.gid, newId());
	}

	let ticketsWritten = 0;
	const pending: D1PreparedStatement[] = [];

	for (const task of tasks) {
		const projectGid = projectGidOf(task);
		const projectId = projectGid ? projectIdFor.get(projectGid) : undefined;

		if (!projectId) {
			skip('a task belonged to no project the mirror holds, so it has no ticket');
			continue;
		}

		const id = ticketIdFor.get(task.gid)!;
		const { status, completedAt } = projectStatus(task);

		pending.push(
			db
				.prepare(
					`INSERT INTO tickets
           (id, project_id, title, description, start_date, due_date, status,
            assignee, completed_at, created_at, updated_at,
            asana_section, asana_assignee_gid, asana_modified_at, asana_url,
            section_status, section_status_via)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
           ON CONFLICT(id) DO UPDATE SET
             project_id = ?2, title = ?3, description = ?4, start_date = ?5,
             due_date = ?6, status = ?7, assignee = ?8, completed_at = ?9,
             updated_at = ?11, asana_section = ?12, asana_assignee_gid = ?13,
             asana_modified_at = ?14, asana_url = ?15,
             section_status = ?16, section_status_via = ?17`
				)
				.bind(
					id,
					projectId,
					task.name,
					task.notes,
					task.start_on,
					task.due_on,
					status,
					task.assignee_name,
					completedAt,
					task.created_at ?? at,
					at,
					task.section_name,
					task.assignee_gid,
					task.modified_at,
					`https://app.asana.com/0/0/${task.gid}`,
					/*
					 * What the crosswalk says, or nothing at all.
					 *
					 * Null when nobody has mapped this section, and null when
					 * somebody decided it carries no status. `section_status_via`
					 * is what tells those two apart, and the screen must too: an
					 * unmapped section is a question still open and a section
					 * marked not_a_status is an answer. D220.
					 *
					 * Never written into `status`, which stays the app's own and
					 * keeps meaning completed or not. Putting it there would make
					 * `open` the default bucket the ruling forbids.
					 */
					sectionVerdict(task).status,
					sectionVerdict(task).via
				)
		);

		pending.push(
			db
				.prepare(
					'INSERT OR REPLACE INTO asana_task_links (asana_gid, ticket_id, linked_at) VALUES (?, ?, ?)'
				)
				.bind(task.gid, id, at)
		);

		ticketsWritten += 1;
	}

	await runAll(db, pending);

	// --- subtask parents -------------------------------------------------------
	//
	// After the tickets exist, because both ends have to be there before the row
	// referencing them can be written.

	const parents: D1PreparedStatement[] = [];
	let parentsWritten = 0;

	for (const task of tasks) {
		if (!task.parent_gid) continue;
		const child = ticketIdFor.get(task.gid);
		const parent = ticketIdFor.get(task.parent_gid);
		if (!child || !parent) {
			skip('a subtask pointed at a parent the mirror does not hold');
			continue;
		}
		parents.push(
			db
				.prepare(
					`INSERT INTO ticket_parents (child_ticket_id, parent_ticket_id, source, created_at)
           VALUES (?1, ?2, 'asana', ?3)
           ON CONFLICT(child_ticket_id) DO UPDATE SET parent_ticket_id = ?2, created_at = ?3
           WHERE ticket_parents.source = 'asana'`
				)
				.bind(child, parent, at)
		);
		parentsWritten += 1;
	}

	await runAll(db, parents);

	// --- the sets: tags, followers, custom values --------------------------------
	//
	// Everything the first projection reported as dropped, now carried. These are
	// the app's own rows and the projection owns them, so each is cleared and
	// rewritten for the tickets it manages: a tag removed in Asana has to
	// disappear here too, and an upsert alone would leave it behind for ever.
	//
	// Only the rows this pass owns. A tag somebody adds in the app is marked
	// manual and is not the projection's to delete.

	await db.prepare("DELETE FROM ticket_tags WHERE source = 'asana'").run();
	await db.prepare("DELETE FROM ticket_followers WHERE source = 'asana'").run();
	await db
		.prepare(
			`DELETE FROM ticket_custom_values
       WHERE ticket_id IN (SELECT ticket_id FROM asana_task_links)`
		)
		.run();

	const sets: D1PreparedStatement[] = [];
	let tagRows = 0;
	let followerRows = 0;
	let customRows = 0;

	const { results: mirrorTags } = await db
		.prepare(
			`SELECT tt.task_gid, g.name FROM asana_task_tags tt
       JOIN asana_tags g ON g.gid = tt.tag_gid`
		)
		.all<{ task_gid: string; name: string }>();

	for (const row of mirrorTags ?? []) {
		const ticket = ticketIdFor.get(row.task_gid);
		if (!ticket) continue;
		sets.push(
			db
				.prepare(
					"INSERT OR IGNORE INTO ticket_tags (ticket_id, tag, source) VALUES (?, ?, 'asana')"
				)
				.bind(ticket, row.name)
		);
		tagRows += 1;
	}

	const { results: mirrorFollowers } = await db
		.prepare(
			`SELECT f.task_gid, f.user_gid, COALESCE(u.name, f.user_gid) AS name
       FROM asana_task_followers f
       LEFT JOIN asana_users u ON u.gid = f.user_gid`
		)
		.all<{ task_gid: string; user_gid: string; name: string }>();

	for (const row of mirrorFollowers ?? []) {
		const ticket = ticketIdFor.get(row.task_gid);
		if (!ticket) continue;
		sets.push(
			db
				.prepare(
					`INSERT OR IGNORE INTO ticket_followers (ticket_id, person_gid, name, source)
           VALUES (?, ?, ?, 'asana')`
				)
				.bind(ticket, row.user_gid, row.name)
		);
		followerRows += 1;
	}

	const { results: mirrorCustom } = await db
		.prepare(
			`SELECT v.task_gid, v.field_gid, v.display_value, f.name AS field_name, f.type AS field_type
       FROM asana_task_custom_values v
       JOIN asana_custom_fields f ON f.gid = v.field_gid`
		)
		.all<{
			task_gid: string;
			field_gid: string;
			display_value: string;
			field_name: string;
			field_type: string | null;
		}>();

	for (const row of mirrorCustom ?? []) {
		const ticket = ticketIdFor.get(row.task_gid);
		if (!ticket) continue;
		sets.push(
			db
				.prepare(
					`INSERT INTO ticket_custom_values
           (ticket_id, field_gid, field_name, field_type, display_value)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(ticket_id, field_gid) DO UPDATE SET
             field_name = ?3, field_type = ?4, display_value = ?5`
				)
				.bind(ticket, row.field_gid, row.field_name, row.field_type, row.display_value)
		);
		customRows += 1;
	}

	await runAll(db, sets);

	// --- what could not come across ---------------------------------------------

	const count = async (sql: string, ...binds: unknown[]) => {
		const row = await db
			.prepare(sql)
			.bind(...(binds as never[]))
			.first<{ n: number }>();
		return row?.n ?? 0;
	};

	const dropped: ProjectionReport['dropped_fields'] = [
		{
			field: 'project phase and status',
			why: 'Asana has no PMI phase and no project health. Both are derived from `archived` alone: archived becomes closing/done, live becomes executing/on_track. Not an assessment.',
			rows: mirrorProjects?.length ?? 0
		},
		{
			field: 'ticket status detail',
			why: "The app's own status is still only completed or not. The section is the firm's real vocabulary, 103 names, and it becomes a status only where somebody has said so in the crosswalk: section_status carries that answer and is null everywhere nobody has decided. Nothing infers it, and an unmapped section does not fall into a bucket.",
			rows: tasks.length
		},
		{
			field: 'section_status',
			why: 'Set from the section crosswalk, which is edited by hand and carries who decided and when. Null where the section is unmapped, and also null where somebody decided the section carries no status; section_status_via separates the two.',
			rows: sectionsDecided
		},
		{
			field: 'assignee_id',
			why: 'Still no app user row, and deliberately: six Asana assignees are not six members of this app. The gid is now carried on the ticket as asana_assignee_gid, so grouping and filtering work on identity rather than on a display name.',
			rows: await count(
				'SELECT COUNT(*) AS n FROM asana_tasks WHERE workspace_gid = ? AND assignee_gid IS NOT NULL',
				workspaceGid
			)
		},
		{
			field: 'stories',
			why: 'Deliberately not projected into action items. They are comments and system events, not commitments; ten thousand of them would bury the screen that says what Paul owes people. Shown as an activity trail on the ticket instead.',
			rows: await count('SELECT COUNT(*) AS n FROM asana_stories')
		},
		{
			field: 'estimate_hours',
			why: 'Asana carries no estimate in this workspace, and a made-up number would flow straight into billing.',
			rows: 0
		}
	];

	const totals = {
		tags: tagRows,
		followers: followerRows,
		custom_values: customRows,
		projects: await count('SELECT COUNT(*) AS n FROM projects'),
		projects_from_asana: await count('SELECT COUNT(*) AS n FROM asana_project_links'),
		projects_archived: await count(
			`SELECT COUNT(*) AS n FROM asana_project_links l
       JOIN asana_projects p ON p.gid = l.asana_gid WHERE p.archived = 1`
		),
		tickets: await count('SELECT COUNT(*) AS n FROM tickets'),
		tickets_from_asana: await count('SELECT COUNT(*) AS n FROM asana_task_links'),
		subtasks: await count("SELECT COUNT(*) AS n FROM ticket_parents WHERE source = 'asana'"),
		action_items: await count('SELECT COUNT(*) AS n FROM action_items')
	};

	await db
		.prepare(
			`UPDATE projection_runs SET
         finished_at = ?, projects_written = ?, tickets_written = ?,
         subtask_parents_written = ?, skipped = ?, skipped_because = ?,
         dropped_fields = ?, totals = ?
       WHERE id = ?`
		)
		.bind(
			nowUtc(),
			projectsWritten,
			ticketsWritten,
			parentsWritten,
			skipped,
			skippedBecause.length ? JSON.stringify(skippedBecause) : null,
			JSON.stringify(dropped),
			JSON.stringify(totals),
			runId
		)
		.run();

	return {
		run_id: runId,
		projects_written: projectsWritten,
		tickets_written: ticketsWritten,
		subtask_parents_written: parentsWritten,
		skipped,
		skipped_because: skippedBecause,
		dropped_fields: dropped,
		totals
	};
}
