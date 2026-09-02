import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { nowUtc } from './dates';
import { AsanaError, request } from './asana';

/**
 * The Asana mirror: a faithful copy of a workspace, pulled in phases.
 *
 * ASANA IS THE SOURCE OF TRUTH. Nothing here writes to Asana, and nothing in
 * the app edits what this writes. Every row can be thrown away and re-pulled,
 * which is the property that makes Thursday's schema work free and is why the
 * mirror is kept apart from the app's own projects and tickets.
 *
 * PHASES, NOT ONE PASS. A full pull is thousands of requests against a service
 * that allows 150 a minute, and a single invocation that tried it would be
 * killed halfway with nothing recorded. Each call advances the phases it can
 * afford, writes where it got to, and returns. Running it again continues.
 *
 * RESUMED BY GID, NEVER BY TIMESTAMP. A gid survives renames, moves and
 * re-pulls. A timestamp cursor re-syncs the world the first time somebody bulk
 * edits anything, and ties on writes landing in the same second.
 */

export type Phase = 'idle' | 'teams' | 'projects' | 'sections' | 'tasks' | 'details' | 'done' | 'failed';

export interface MirrorCounts {
	teams: number;
	projects: number;
	projects_archived: number;
	sections: number;
	tasks: number;
	subtasks: number;
	assignees: number;
	followers: number;
	tags: number;
	custom_values: number;
	attachments: number;
	stories: number;
}

export interface MirrorOutcome {
	phase: Phase;
	/** Requests spent this invocation, so a caller can pace the next one. */
	calls: number;
	counts: MirrorCounts;
	/**
	 * Why this invocation stopped. Always present, because a run that did
	 * nothing and a run that finished both return small numbers and only the
	 * reason separates them. D138.
	 */
	stopped: string;
	done: boolean;
}

/**
 * Asana allows 150 requests a minute on the free tier. 420ms between calls is
 * about 142, which leaves headroom for the clock being generous and for
 * anything else the app happens to be doing.
 *
 * Waiting is wall clock, not CPU, so it costs a Worker nothing that matters.
 */
const MIN_GAP_MS = 420;

/** A budget in requests, so one invocation cannot run for an unbounded time. */
const DEFAULT_CALL_BUDGET = 120;

/**
 * How far a refresh window reaches back beyond the last watermark.
 *
 * Asana's `modified_since` is exclusive and two writes can land in the same
 * second, so a watermark set exactly at a finish time can skip a task modified
 * during the run that produced it. Overlapping costs nothing, because every
 * write is an upsert keyed on the gid: re-reading an unchanged row wastes a few
 * bytes, and missing one puts a wrong number on a screen with no sign of it.
 *
 * Ten minutes rather than seconds, so a late cron firing or a drifting clock
 * does not open a hole either.
 */
const REFRESH_OVERLAP_MS = 10 * 60 * 1000;

class Pacer {
	private last = 0;
	spent = 0;
	constructor(private readonly budget: number) {}

	canAfford(): boolean {
		return this.spent < this.budget;
	}

	async wait(): Promise<void> {
		const since = Date.now() - this.last;
		if (this.last > 0 && since < MIN_GAP_MS) {
			await new Promise((r) => setTimeout(r, MIN_GAP_MS - since));
		}
		this.last = Date.now();
		this.spent += 1;
	}
}

interface Page<T> {
	data?: T[];
	next_page?: { offset?: string } | null;
}

/** One page back: the rows, and the offset to ask for the next one. */
interface Chunk<T> {
	rows: T[];
	next: string | null;
}

/**
 * One page of a paged Asana collection.
 *
 * Retries the two failures that are about timing rather than about the request:
 * a rate limit, where Asana says how long to wait, and a timeout, where the
 * connection went nowhere. Everything else throws on the first answer, because
 * retrying a 401 or a 404 only delays finding out.
 */
async function page<T>(
	token: string,
	pacer: Pacer,
	path: string,
	offset?: string | null
): Promise<Chunk<T>> {
	const joiner = path.includes('?') ? '&' : '?';
	const url = `${path}${joiner}limit=100${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`;

	for (let attempt = 0; ; attempt++) {
		await pacer.wait();
		try {
			const body = await request<Page<T>>(token, url);
			return { rows: body.data ?? [], next: body.next_page?.offset ?? null };
		} catch (err) {
			const status = err instanceof AsanaError ? (err.httpStatus ?? err.status) : 0;
			const worthRetrying = status === 429 || status === 504 || status === 500 || status === 502;
			if (!worthRetrying || attempt >= 2) throw err;

			// Doubling from five seconds. Asana returns a Retry-After on a 429,
			// but a fixed floor is safer than trusting a header on the one code
			// path where getting it wrong means being locked out further.
			await new Promise((r) => setTimeout(r, 5_000 * 2 ** attempt));
		}
	}
}

const EMPTY_COUNTS: MirrorCounts = {
	teams: 0,
	projects: 0,
	projects_archived: 0,
	sections: 0,
	tasks: 0,
	subtasks: 0,
	assignees: 0,
	followers: 0,
	tags: 0,
	custom_values: 0,
	attachments: 0,
	stories: 0
};

async function readState(db: D1Database, workspaceGid: string) {
	const row = await db
		.prepare('SELECT * FROM asana_sync_state WHERE workspace_gid = ?')
		.bind(workspaceGid)
		.first<{ phase: Phase; cursor: string | null; counts: string | null }>();

	if (row) return row;

	await db
		.prepare(
			`INSERT INTO asana_sync_state (workspace_gid, phase, cursor, started_at, updated_at)
       VALUES (?, 'teams', NULL, ?, ?)`
		)
		.bind(workspaceGid, nowUtc(), nowUtc())
		.run();

	return { phase: 'teams' as Phase, cursor: null, counts: null };
}

async function writeState(
	db: D1Database,
	workspaceGid: string,
	phase: Phase,
	cursor: string | null,
	counts: MirrorCounts | null = null,
	error: string | null = null
) {
	await db
		.prepare(
			`UPDATE asana_sync_state
       SET phase = ?1, cursor = ?2, last_error = ?3, updated_at = ?4,
           counts = COALESCE(?5, counts),
           finished_at = CASE WHEN ?1 = 'done' THEN ?4 ELSE finished_at END
       WHERE workspace_gid = ?6`
		)
		.bind(phase, cursor, error, nowUtc(), counts ? JSON.stringify(counts) : null, workspaceGid)
		.run();
}

/**
 * What the mirror actually holds, counted from the tables rather than from the
 * run.
 *
 * A run reports what it wrote this invocation, which after a resume is a
 * fraction of the whole. The report Paul reads is about the mirror, so it is
 * counted from the mirror. D138's sibling: a number has to say what it is of.
 */
export async function mirrorTotals(db: D1Database, workspaceGid: string): Promise<MirrorCounts> {
	const one = async (sql: string) => {
		const row = await db.prepare(sql).bind(workspaceGid).first<{ n: number }>();
		return row?.n ?? 0;
	};

	return {
		teams: await one('SELECT COUNT(*) AS n FROM asana_teams WHERE workspace_gid = ?'),
		projects: await one('SELECT COUNT(*) AS n FROM asana_projects WHERE workspace_gid = ?'),
		projects_archived: await one(
			'SELECT COUNT(*) AS n FROM asana_projects WHERE workspace_gid = ? AND archived = 1'
		),
		sections: await one(
			`SELECT COUNT(*) AS n FROM asana_sections s
       JOIN asana_projects p ON p.gid = s.project_gid WHERE p.workspace_gid = ?`
		),
		tasks: await one(
			'SELECT COUNT(*) AS n FROM asana_tasks WHERE workspace_gid = ? AND parent_gid IS NULL'
		),
		subtasks: await one(
			'SELECT COUNT(*) AS n FROM asana_tasks WHERE workspace_gid = ? AND parent_gid IS NOT NULL'
		),
		assignees: await one(
			'SELECT COUNT(DISTINCT assignee_gid) AS n FROM asana_tasks WHERE workspace_gid = ? AND assignee_gid IS NOT NULL'
		),
		followers: await one(
			`SELECT COUNT(*) AS n FROM asana_task_followers f
       JOIN asana_tasks t ON t.gid = f.task_gid WHERE t.workspace_gid = ?`
		),
		tags: await one('SELECT COUNT(*) AS n FROM asana_tags WHERE workspace_gid = ?'),
		custom_values: await one(
			`SELECT COUNT(*) AS n FROM asana_task_custom_values v
       JOIN asana_tasks t ON t.gid = v.task_gid WHERE t.workspace_gid = ?`
		),
		attachments: await one(
			`SELECT COUNT(*) AS n FROM asana_attachments a
       JOIN asana_tasks t ON t.gid = a.task_gid WHERE t.workspace_gid = ?`
		),
		stories: await one(
			`SELECT COUNT(*) AS n FROM asana_stories s
       JOIN asana_tasks t ON t.gid = s.task_gid WHERE t.workspace_gid = ?`
		)
	};
}

/** Upserts a person. Keyed on the gid, so a re-pull overwrites cleanly. */
function userStatement(db: D1Database, gid: string, name: string | null): D1PreparedStatement {
	return db
		.prepare(
			`INSERT INTO asana_users (gid, name, synced_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(gid) DO UPDATE SET name = ?2, synced_at = ?3`
		)
		.bind(gid, name, nowUtc());
}

interface RawTask {
	gid: string;
	name?: string;
	notes?: string;
	completed?: boolean;
	completed_at?: string | null;
	start_on?: string | null;
	due_on?: string | null;
	created_at?: string | null;
	modified_at?: string | null;
	num_subtasks?: number;
	parent?: { gid: string } | null;
	assignee?: { gid: string; name?: string } | null;
	followers?: { gid: string; name?: string }[];
	tags?: { gid: string; name?: string }[];
	memberships?: { project?: { gid: string }; section?: { gid: string; name?: string } }[];
	custom_fields?: { gid: string; name?: string; type?: string; display_value?: string | null }[];
}

/**
 * The fields asked for on a task list.
 *
 * One request returning everything a task row needs, rather than a request per
 * task per field. The alternative is three thousand tasks times four calls,
 * which at 150 a minute is most of an afternoon.
 */
const TASK_FIELDS = [
	'name',
	'notes',
	'completed',
	'completed_at',
	'start_on',
	'due_on',
	'created_at',
	'modified_at',
	'num_subtasks',
	'parent.gid',
	'assignee.gid',
	'assignee.name',
	'followers.gid',
	'followers.name',
	'tags.gid',
	'tags.name',
	'memberships.project.gid',
	'memberships.section.gid',
	'memberships.section.name',
	'custom_fields.gid',
	'custom_fields.name',
	'custom_fields.type',
	'custom_fields.display_value'
].join(',');

/**
 * The statements one task needs, collected rather than run.
 *
 * A task writes its own row plus a row per project membership, follower, tag
 * and custom value: ten to fifteen statements, and a page brings a hundred
 * tasks. Run one at a time that is fifteen hundred round trips to the database
 * per page, and the pull spends its life waiting on the storage layer rather
 * than on Asana's rate limit, which is the thing it was designed around.
 *
 * Handed back to the caller so a whole page goes in one batch.
 */
/**
 * The workspace-level rows already written during this run.
 *
 * People, tags and custom field definitions belong to the workspace, not to the
 * task, and every task that mentions one produced another upsert of the same
 * row. Fifty-nine tasks generated a hundred and twenty-seven identical people
 * upserts and one field definition rewritten once per task that carried it. All
 * of them were correct and all but the first were waste, and the waste was most
 * of the time the pull was spending.
 *
 * Per run rather than global: a long-lived cache would go stale against a
 * rename in Asana and there would be nothing to invalidate it.
 */
interface Seen {
	users: Set<string>;
	tags: Set<string>;
	fields: Set<string>;
}

function taskStatements(
	db: D1Database,
	workspaceGid: string,
	projectGid: string | null,
	task: RawTask,
	counts: MirrorCounts,
	seen: Seen
): D1PreparedStatement[] {
	const at = nowUtc();
	const out: D1PreparedStatement[] = [];

	const membership = (task.memberships ?? []).find(
		(m) => !projectGid || m.project?.gid === projectGid
	);
	const sectionGid = membership?.section?.gid ?? null;
	const sectionName = membership?.section?.name ?? null;

	out.push(
		db
			.prepare(
				`INSERT INTO asana_tasks
       (gid, workspace_gid, project_gid, section_gid, section_name, parent_gid, name, notes,
        assignee_gid, completed, completed_at, start_on, due_on, created_at, modified_at, synced_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
       ON CONFLICT(gid) DO UPDATE SET
         project_gid = ?3, section_gid = ?4, section_name = ?5, parent_gid = ?6, name = ?7,
         notes = ?8, assignee_gid = ?9, completed = ?10, completed_at = ?11, start_on = ?12,
         due_on = ?13, created_at = ?14, modified_at = ?15, synced_at = ?16`
			)
			.bind(
				task.gid,
				workspaceGid,
				projectGid,
				sectionGid,
				sectionName,
				task.parent?.gid ?? null,
				task.name ?? '(untitled)',
				task.notes ?? null,
				task.assignee?.gid ?? null,
				task.completed ? 1 : 0,
				task.completed_at ?? null,
				task.start_on ?? null,
				task.due_on ?? null,
				task.created_at ?? null,
				task.modified_at ?? null,
				at
			)
	);

	if (task.parent?.gid) counts.subtasks += 1;
	else counts.tasks += 1;

	if (task.assignee?.gid) {
		if (!seen.users.has(task.assignee.gid)) {
			seen.users.add(task.assignee.gid);
			out.push(userStatement(db, task.assignee.gid, task.assignee.name ?? null));
		}
		counts.assignees += 1;
	}

	for (const membershipRow of task.memberships ?? []) {
		if (!membershipRow.project?.gid) continue;
		out.push(
			db
				.prepare('INSERT OR IGNORE INTO asana_task_projects (task_gid, project_gid) VALUES (?, ?)')
				.bind(task.gid, membershipRow.project.gid)
		);
	}

	for (const follower of task.followers ?? []) {
		if (!seen.users.has(follower.gid)) {
			seen.users.add(follower.gid);
			out.push(userStatement(db, follower.gid, follower.name ?? null));
		}
		out.push(
			db
				.prepare('INSERT OR IGNORE INTO asana_task_followers (task_gid, user_gid) VALUES (?, ?)')
				.bind(task.gid, follower.gid)
		);
		counts.followers += 1;
	}

	for (const tag of task.tags ?? []) {
		if (!seen.tags.has(tag.gid)) {
			seen.tags.add(tag.gid);
			out.push(
				db
					.prepare(
						`INSERT INTO asana_tags (gid, workspace_gid, name, synced_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(gid) DO UPDATE SET name = ?3, synced_at = ?4`
					)
					.bind(tag.gid, workspaceGid, tag.name ?? '(unnamed)', at)
			);
		}
		out.push(
			db
				.prepare('INSERT OR IGNORE INTO asana_task_tags (task_gid, tag_gid) VALUES (?, ?)')
				.bind(task.gid, tag.gid)
		);
		counts.tags += 1;
	}

	for (const field of task.custom_fields ?? []) {
		if (!seen.fields.has(field.gid)) {
			seen.fields.add(field.gid);
			out.push(
				db
					.prepare(
						`INSERT INTO asana_custom_fields (gid, workspace_gid, name, type, synced_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(gid) DO UPDATE SET name = ?3, type = ?4, synced_at = ?5`
					)
					.bind(field.gid, workspaceGid, field.name ?? '(unnamed)', field.type ?? null, at)
			);
		}

		// Only values that exist. A null display_value is Asana saying the field
		// is unset on this task, and a row saying "unset" is noise in a table
		// that already answers by absence.
		if (field.display_value != null && field.display_value !== '') {
			out.push(
				db
					.prepare(
						`INSERT INTO asana_task_custom_values (task_gid, field_gid, display_value)
           VALUES (?1, ?2, ?3)
           ON CONFLICT(task_gid, field_gid) DO UPDATE SET display_value = ?3`
					)
					.bind(task.gid, field.gid, field.display_value)
			);
			counts.custom_values += 1;
		}
	}

	return out;
}

/**
 * Runs a page's worth of statements in as few round trips as possible.
 *
 * Chunked, because a batch is one transaction and one very large transaction is
 * both slower and all-or-nothing: a page of a hundred tasks that fails on the
 * last statement would roll back the ninety-nine that were fine, and the pull
 * would make no progress while looking like it tried.
 */
async function runAll(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
	const CHUNK = 50;
	for (let i = 0; i < statements.length; i += CHUNK) {
		const chunk = statements.slice(i, i + CHUNK);

		// One retry, because the local storage layer drops a connection under
		// sustained write load and surfaces it as `fetch failed <- ECONNRESET`.
		// That is a fault in the transport, not in the data: the same batch
		// succeeds a second later. Without this the pull stops on it, and the
		// only symptom is a count that stopped going up.
		try {
			await db.batch(chunk);
		} catch {
			await new Promise((r) => setTimeout(r, 1_000));
			await db.batch(chunk);
		}
	}
}

/**
 * Advances the mirror as far as one budget allows.
 *
 * Returns what it did and why it stopped. Call it again to continue; when
 * `done` is true there is nothing left in this pass.
 */
export async function mirrorStep(
	env: { DB: D1Database; ASANA_TOKEN?: string },
	workspaceGid: string,
	callBudget = DEFAULT_CALL_BUDGET
): Promise<MirrorOutcome> {
	const token = env.ASANA_TOKEN;
	if (!token) {
		return {
			phase: 'failed',
			calls: 0,
			counts: { ...EMPTY_COUNTS },
			stopped: 'No Asana token is configured.',
			done: false
		};
	}

	const db = env.DB;
	const pacer = new Pacer(callBudget);
	const counts = { ...EMPTY_COUNTS };
	const seen: Seen = { users: new Set(), tags: new Set(), fields: new Set() };
	const state = await readState(db, workspaceGid);
	let phase: Phase = state.phase === 'idle' || state.phase === 'failed' ? 'teams' : state.phase;
	let cursor = state.cursor;

	// Sweep bookkeeping for the details phase, carried on the state row so it
	// survives the invocation boundary the way everything else here does.
	const sweep = ((): { sweep_started_with: number; sweeps: number } => {
		try {
			const parsed = state.counts ? JSON.parse(state.counts) : null;
			return {
				sweep_started_with: Number(parsed?.sweep_started_with) || 0,
				sweeps: Number(parsed?.sweeps) || 0
			};
		} catch {
			return { sweep_started_with: 0, sweeps: 0 };
		}
	})();
	const sweepStartedWith = sweep.sweep_started_with;
	const sweepsSoFar = sweep.sweeps;

	try {
		// --- teams -----------------------------------------------------------
		if (phase === 'teams') {
			await pacer.wait();
			const ws = await request<{ data: { gid: string; name: string } }>(
				token,
				`/workspaces/${workspaceGid}`
			);
			await db
				.prepare(
					`INSERT INTO asana_workspaces (gid, name, synced_at) VALUES (?1, ?2, ?3)
           ON CONFLICT(gid) DO UPDATE SET name = ?2, synced_at = ?3`
				)
				.bind(ws.data.gid, ws.data.name, nowUtc())
				.run();

			let next: string | null = cursor;
			do {
				if (!pacer.canAfford()) {
					await writeState(db, workspaceGid, 'teams', next);
					return { phase, calls: pacer.spent, counts, stopped: 'Budget spent mid-teams.', done: false };
				}
				// Only an organization has teams. A plain workspace answers 400
				// here, and that is a fact about the workspace rather than a
				// failed pull, so it moves on instead of stopping everything.
				let res: Chunk<{ gid: string; name: string }>;
				try {
					res = await page<{ gid: string; name: string }>(
						token,
						pacer,
						`/organizations/${workspaceGid}/teams`,
						next
					);
				} catch {
					res = { rows: [], next: null };
				}
				for (const team of res.rows) {
					await db
						.prepare(
							`INSERT INTO asana_teams (gid, workspace_gid, name, synced_at) VALUES (?1, ?2, ?3, ?4)
               ON CONFLICT(gid) DO UPDATE SET name = ?3, synced_at = ?4`
						)
						.bind(team.gid, workspaceGid, team.name, nowUtc())
						.run();
					counts.teams += 1;
				}
				next = res.next;
			} while (next);

			phase = 'projects';
			cursor = null;
			await writeState(db, workspaceGid, phase, cursor);
		}

		// --- projects, both live and archived ---------------------------------
		//
		// Archived projects are pulled on purpose. Missing them was one of two
		// systemic misses recorded in the MacGray handoff and is a permanent
		// refresh check: an archived project holds finished work somebody asks
		// about, and its absence reads as the work never happening.
		if (phase === 'projects') {
			for (const archived of [false, true]) {
				let next: string | null = null;
				do {
					if (!pacer.canAfford()) {
						await writeState(db, workspaceGid, 'projects', null);
						return {
							phase,
							calls: pacer.spent,
							counts,
							stopped: 'Budget spent mid-projects.',
							done: false
						};
					}
					const res: Chunk<{
						gid: string;
						name: string;
						archived?: boolean;
						notes?: string;
						created_at?: string;
						modified_at?: string;
						team?: { gid: string } | null;
					}> = await page<{
						gid: string;
						name: string;
						archived?: boolean;
						notes?: string;
						created_at?: string;
						modified_at?: string;
						team?: { gid: string } | null;
					}>(
						token,
						pacer,
						`/projects?workspace=${workspaceGid}&archived=${archived}&opt_fields=name,archived,notes,created_at,modified_at,team.gid`,
						next
					);

					for (const project of res.rows) {
						await db
							.prepare(
								`INSERT INTO asana_projects
                 (gid, workspace_gid, team_gid, name, notes, archived, created_at, modified_at, synced_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
               ON CONFLICT(gid) DO UPDATE SET
                 team_gid = ?3, name = ?4, notes = ?5, archived = ?6,
                 created_at = ?7, modified_at = ?8, synced_at = ?9`
							)
							.bind(
								project.gid,
								workspaceGid,
								project.team?.gid ?? null,
								project.name,
								project.notes ?? null,
								project.archived ? 1 : 0,
								project.created_at ?? null,
								project.modified_at ?? null,
								nowUtc()
							)
							.run();
						counts.projects += 1;
						if (project.archived) counts.projects_archived += 1;
					}
					next = res.next;
				} while (next);
			}

			phase = 'sections';
			cursor = null;
			await writeState(db, workspaceGid, phase, cursor);
		}

		// --- sections, per project -------------------------------------------
		//
		// The cursor is the last project gid finished, so a resumed run picks up
		// at the next one rather than re-reading every project it already has.
		if (phase === 'sections') {
			const { results } = await db
				.prepare(
					`SELECT gid FROM asana_projects
           WHERE workspace_gid = ? AND (?2 IS NULL OR gid > ?2)
           ORDER BY gid`
				)
				.bind(workspaceGid, cursor)
				.all<{ gid: string }>();

			for (const project of results ?? []) {
				if (!pacer.canAfford()) {
					await writeState(db, workspaceGid, 'sections', cursor);
					return {
						phase,
						calls: pacer.spent,
						counts,
						stopped: 'Budget spent mid-sections.',
						done: false
					};
				}

				let next: string | null = null;
				let position = 0;
				do {
					const res: Chunk<{ gid: string; name: string }> = await page<{ gid: string; name: string }>(
						token,
						pacer,
						`/projects/${project.gid}/sections`,
						next
					);
					for (const section of res.rows) {
						await db
							.prepare(
								`INSERT INTO asana_sections (gid, project_gid, name, position, synced_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(gid) DO UPDATE SET name = ?3, position = ?4, synced_at = ?5`
							)
							.bind(section.gid, project.gid, section.name, position++, nowUtc())
							.run();
						counts.sections += 1;
					}
					next = res.next;
				} while (next);

				cursor = project.gid;
			}

			phase = 'tasks';
			cursor = null;
			await writeState(db, workspaceGid, phase, cursor);
		}

		// --- tasks, per project ----------------------------------------------
		if (phase === 'tasks') {
			const { results } = await db
				.prepare(
					`SELECT gid FROM asana_projects
           WHERE workspace_gid = ? AND (?2 IS NULL OR gid > ?2)
           ORDER BY gid`
				)
				.bind(workspaceGid, cursor)
				.all<{ gid: string }>();

			for (const project of results ?? []) {
				if (!pacer.canAfford()) {
					await writeState(db, workspaceGid, 'tasks', cursor);
					return {
						phase,
						calls: pacer.spent,
						counts,
						stopped: 'Budget spent mid-tasks.',
						done: false
					};
				}

				let next: string | null = null;
				do {
					const res: Chunk<RawTask> = await page<RawTask>(
						token,
						pacer,
						`/tasks?project=${project.gid}&opt_fields=${TASK_FIELDS}`,
						next
					);
					await runAll(
						db,
						res.rows.flatMap((task) =>
							taskStatements(db, workspaceGid, project.gid, task, counts, seen)
						)
					);
					next = res.next;
				} while (next && pacer.canAfford());

				// Only claim the project when its last page came back. Advancing
				// the cursor on a project that still had pages left would mark it
				// finished and lose the rest of its tasks silently, which is the
				// one failure a resumable pull must not have: it looks like
				// success and the missing rows are never asked about again.
				if (!next) cursor = project.gid;
				else {
					await writeState(db, workspaceGid, 'tasks', cursor);
					return {
						phase,
						calls: pacer.spent,
						counts,
						stopped: 'Budget spent part way through one project.',
						done: false
					};
				}
			}

			phase = 'details';
			cursor = null;
			await writeState(db, workspaceGid, phase, cursor);
		}

		// --- details: subtasks, stories, attachments --------------------------
		//
		// The expensive phase, and last on purpose. Structure first means Paul
		// has something to look at after one short run, and the per-task calls
		// continue behind it.
		if (phase === 'details') {
			/*
			 * A sweep walks a table that grows while it walks.
			 *
			 * Subtasks are tasks, written into `asana_tasks` as they are found,
			 * and a subtask discovered under task 900 can be given a gid below
			 * the cursor. The `gid > cursor` walk passes it by, and the phase
			 * would then report done over a set it never finished. So a sweep
			 * records how many tasks there were when it started, and the end of
			 * the walk compares.
			 */
			if (cursor === null) {
				const at = await db
					.prepare('SELECT COUNT(*) AS n FROM asana_tasks WHERE workspace_gid = ?')
					.bind(workspaceGid)
					.first<{ n: number }>();
				await db
					.prepare('UPDATE asana_sync_state SET counts = ? WHERE workspace_gid = ?')
					.bind(JSON.stringify({ sweep_started_with: at?.n ?? 0, sweeps: sweepsSoFar + 1 }), workspaceGid)
					.run();
			}

			const { results } = await db
				.prepare(
					`SELECT gid FROM asana_tasks
           WHERE workspace_gid = ? AND (?2 IS NULL OR gid > ?2)
           ORDER BY gid`
				)
				.bind(workspaceGid, cursor)
				.all<{ gid: string }>();

			for (const task of results ?? []) {
				// Three calls per task, so stop with room rather than halfway.
				if (pacer.spent + 3 > callBudget) {
					await writeState(db, workspaceGid, 'details', cursor);
					return {
						phase,
						calls: pacer.spent,
						counts,
						stopped: 'Budget spent mid-details.',
						done: false
					};
				}

				const subtasks = await page<RawTask>(
					token,
					pacer,
					`/tasks/${task.gid}/subtasks?opt_fields=${TASK_FIELDS}`
				);
				const pending: D1PreparedStatement[] = subtasks.rows.flatMap((sub) =>
					taskStatements(db, workspaceGid, null, sub, counts, seen)
				);

				const stories = await page<{
					gid: string;
					created_at?: string;
					created_by?: { gid: string; name?: string } | null;
					type?: string;
					resource_subtype?: string;
					text?: string;
				}>(
					token,
					pacer,
					`/tasks/${task.gid}/stories?opt_fields=created_at,created_by.gid,created_by.name,type,resource_subtype,text`
				);
				for (const story of stories.rows) {
					if (story.created_by?.gid && !seen.users.has(story.created_by.gid)) {
						seen.users.add(story.created_by.gid);
						pending.push(userStatement(db, story.created_by.gid, story.created_by.name ?? null));
					}
					pending.push(
						db
							.prepare(
								`INSERT INTO asana_stories
               (gid, task_gid, created_by_gid, created_at, type, text, synced_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
               ON CONFLICT(gid) DO UPDATE SET text = ?6, synced_at = ?7`
							)
							.bind(
								story.gid,
								task.gid,
								story.created_by?.gid ?? null,
								story.created_at ?? null,
								story.resource_subtype ?? story.type ?? null,
								story.text ?? null,
								nowUtc()
							)
					);
					counts.stories += 1;
				}

				const attachments = await page<{
					gid: string;
					name?: string;
					size?: number;
					resource_subtype?: string;
					created_at?: string;
				}>(
					token,
					pacer,
					`/attachments?parent=${task.gid}&opt_fields=name,size,resource_subtype,created_at`
				);
				for (const file of attachments.rows) {
					pending.push(
						db
							.prepare(
								`INSERT INTO asana_attachments
               (gid, task_gid, name, size_bytes, mime_type, host, created_at, synced_at)
               VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7)
               ON CONFLICT(gid) DO UPDATE SET name = ?3, size_bytes = ?4, host = ?5, synced_at = ?7`
							)
							.bind(
								file.gid,
								task.gid,
								file.name ?? null,
								file.size ?? null,
								file.resource_subtype ?? null,
								file.created_at ?? null,
								nowUtc()
							)
					);
					counts.attachments += 1;
				}

				await runAll(db, pending);

				cursor = task.gid;
			}

			/*
			 * Another sweep if the set grew under this one.
			 *
			 * The upserts are idempotent, so a repeat costs time and nothing
			 * else. Bounded at three, because a mirror that swept forever would
			 * be a pull that never finishes, and by the third sweep a workspace
			 * that is still growing is growing because somebody is working in
			 * it, not because the walk missed anything.
			 */
			const finalCount = await db
				.prepare('SELECT COUNT(*) AS n FROM asana_tasks WHERE workspace_gid = ?')
				.bind(workspaceGid)
				.first<{ n: number }>();

			const grewBy = (finalCount?.n ?? 0) - sweepStartedWith;

			if (grewBy > 0 && sweepsSoFar < 3) {
				cursor = null;
				await writeState(db, workspaceGid, 'details', null, counts);
				return {
					phase,
					calls: pacer.spent,
					counts,
					stopped: `Sweep finished; ${grewBy} tasks appeared during it, so another sweep starts.`,
					done: false
				};
			}

			phase = 'done';
			await writeState(db, workspaceGid, phase, null);
		}

		return {
			phase,
			calls: pacer.spent,
			counts,
			stopped: phase === 'done' ? 'Nothing left to pull.' : `Stopped in ${phase}.`,
			done: phase === 'done'
		};
	} catch (err) {
		// Unwrap the cause chain. `fetch failed` on its own is a sentence with no
		// information in it: it does not say which host, which layer, or whether
		// the pull can be retried. Node hangs the real reason on `cause`, and an
		// error that reaches a person without it wastes an hour. D138.
		const parts: string[] = [];
		let current: unknown = err;
		for (let depth = 0; current instanceof Error && depth < 4; depth++) {
			parts.push(`${current.name}: ${current.message}`);
			current = (current as Error & { cause?: unknown }).cause;
		}
		const message = parts.length ? parts.join(' <- ') : String(err);

		// The phase is kept, not set to 'failed'. A transient fault is not a
		// reason to start the pull again from the beginning: the cursor is still
		// good, and resuming from 'teams' would re-read every project and every
		// section to get back to where it already was. The error is recorded on
		// the row instead, which is where somebody looks for it.
		await writeState(db, workspaceGid, phase, cursor, counts, message);
		return {
			phase,
			calls: pacer.spent,
			counts,
			stopped: `Stopped in ${phase}: ${message}`,
			done: false
		};
	}
}

export interface RefreshOutcome {
	/** Tasks Asana reported as changed, and therefore rewritten. */
	tasks_changed: number;
	subtasks_changed: number;
	projects_seen: number;
	projects_added: number;
	calls: number;
	since: string | null;
	refreshed_at: string | null;
	/**
	 * Present whether or not anything changed. A quiet refresh and a refused one
	 * both return zeros, and only the reason separates them. D138.
	 */
	detail: string;
}

/**
 * Catches the mirror up, rather than walking it again.
 *
 * The full pull is a snapshot: correct when it ran and steadily less true
 * afterwards, which the accuracy audit measured at eleven tasks and one status
 * over two days. This is what keeps it current.
 *
 * IT ASKS ASANA WHAT CHANGED. That is a query filter and not a cursor, and the
 * difference is D169's whole point. Identity and upsert stay entirely on the
 * gid; `modified_since` only narrows what comes back, and nothing here uses a
 * timestamp to decide where a walk resumes. A bulk edit returning every task is
 * then the right answer rather than a fault, because every task did change.
 *
 * ARCHIVED PROJECTS ARE REFRESHED TOO. Twenty-four of the sixty-six here are
 * archived, so a live-only refresh would let a third of the workspace drift
 * while reporting itself current. D172 applies to staying current, not only to
 * the first pull.
 */
export async function refreshMirror(
	env: { DB: D1Database; ASANA_TOKEN?: string },
	workspaceGid: string,
	callBudget = 90
): Promise<RefreshOutcome> {
	const token = env.ASANA_TOKEN;
	const out: RefreshOutcome = {
		tasks_changed: 0,
		subtasks_changed: 0,
		projects_seen: 0,
		projects_added: 0,
		calls: 0,
		since: null,
		refreshed_at: null,
		detail: ''
	};

	if (!token) {
		out.detail = 'No Asana token is configured, so nothing was refreshed.';
		return out;
	}

	const state = await env.DB.prepare(
		`SELECT phase, finished_at, refresh_watermark
     FROM asana_sync_state WHERE workspace_gid = ?`
	)
		.bind(workspaceGid)
		.first<{ phase: string; finished_at: string | null; refresh_watermark: string | null }>();

	if (!state) {
		out.detail = 'This workspace has never been pulled, so there is nothing to refresh.';
		return out;
	}

	if (state.phase !== 'done') {
		// A refresh on top of a half-finished pull would interleave two walks over
		// the same rows and make both sets of counts unreadable. The pull finishes.
		out.detail = `The full pull is still in its ${state.phase} phase, so the refresh stood down.`;
		return out;
	}

	const base = state.refresh_watermark ?? state.finished_at;
	if (!base) {
		out.detail = 'No watermark and no finish time, so there is nothing to measure changes against.';
		return out;
	}

	const since = new Date(Date.parse(base) - REFRESH_OVERLAP_MS)
		.toISOString()
		.replace(/\.\d{3}Z$/, 'Z');
	out.since = since;

	// The moment the refresh began, not the moment it ended. Anything modified
	// while it runs must be caught next time rather than fall through the gap.
	const startedAt = nowUtc();
	const pacer = new Pacer(callBudget);
	const counts = { ...EMPTY_COUNTS };
	const seen: Seen = { users: new Set(), tags: new Set(), fields: new Set() };

	try {
		// Projects first, live and archived, so a project created since the last
		// refresh has somewhere to hang its tasks.
		for (const archived of [false, true]) {
			let next: string | null = null;
			do {
				if (!pacer.canAfford()) break;
				const res: Chunk<{
					gid: string;
					name: string;
					archived?: boolean;
					notes?: string;
					created_at?: string;
					modified_at?: string;
					team?: { gid: string } | null;
				}> = await page(
					token,
					pacer,
					`/projects?workspace=${workspaceGid}&archived=${archived}&opt_fields=name,archived,notes,created_at,modified_at,team.gid`,
					next
				);

				for (const project of res.rows) {
					const existed = await env.DB.prepare('SELECT gid FROM asana_projects WHERE gid = ?')
						.bind(project.gid)
						.first();
					if (!existed) out.projects_added += 1;

					await env.DB.prepare(
						`INSERT INTO asana_projects
             (gid, workspace_gid, team_gid, name, notes, archived, created_at, modified_at, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(gid) DO UPDATE SET
               team_gid = ?3, name = ?4, notes = ?5, archived = ?6,
               created_at = ?7, modified_at = ?8, synced_at = ?9`
					)
						.bind(
							project.gid,
							workspaceGid,
							project.team?.gid ?? null,
							project.name,
							project.notes ?? null,
							project.archived ? 1 : 0,
							project.created_at ?? null,
							project.modified_at ?? null,
							nowUtc()
						)
						.run();
					out.projects_seen += 1;
				}
				next = res.next;
			} while (next && pacer.canAfford());
		}

		// Then what changed on each, asked of Asana rather than re-read wholesale.
		const { results: projects } = await env.DB.prepare(
			'SELECT gid FROM asana_projects WHERE workspace_gid = ? ORDER BY gid'
		)
			.bind(workspaceGid)
			.all<{ gid: string }>();

		for (const project of projects ?? []) {
			if (!pacer.canAfford()) {
				out.calls = pacer.spent;
				out.detail =
					`Budget spent part way through. The watermark was not moved, so the next ` +
					`run covers the same window and nothing is skipped.`;
				return out;
			}

			let next: string | null = null;
			do {
				const res: Chunk<RawTask> = await page(
					token,
					pacer,
					`/tasks?project=${project.gid}&modified_since=${encodeURIComponent(since)}&opt_fields=${TASK_FIELDS}`,
					next
				);
				if (res.rows.length) {
					await runAll(
						env.DB,
						res.rows.flatMap((task) =>
							taskStatements(env.DB, workspaceGid, project.gid, task, counts, seen)
						)
					);
				}
				next = res.next;
			} while (next && pacer.canAfford());
		}

		out.tasks_changed = counts.tasks;
		out.subtasks_changed = counts.subtasks;
		out.calls = pacer.spent;
		out.refreshed_at = startedAt;

		// Only now. A watermark moved before the work finished would open a hole
		// exactly the size of whatever failed.
		await env.DB.prepare(
			`UPDATE asana_sync_state
       SET refreshed_at = ?, refresh_watermark = ?, updated_at = ?
       WHERE workspace_gid = ?`
		)
			.bind(startedAt, startedAt, nowUtc(), workspaceGid)
			.run();

		out.detail =
			out.tasks_changed + out.subtasks_changed === 0
				? `Nothing has changed in Asana since ${since}.`
				: `${out.tasks_changed} tasks and ${out.subtasks_changed} subtasks changed since ${since}.`;

		return out;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		out.calls = pacer.spent;
		out.detail = `Refresh stopped: ${message}. The watermark was not moved, so nothing was skipped.`;
		return out;
	}
}
