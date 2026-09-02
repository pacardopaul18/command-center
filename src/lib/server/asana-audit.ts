import type { D1Database } from '@cloudflare/workers-types';
import { request } from './asana';

/**
 * Comparing what the app shows against what Asana actually says.
 *
 * READ ONLY ON BOTH SIDES. This fetches from Asana and reads app tables. It
 * writes nothing anywhere, and it is deliberately incapable of correcting what
 * it finds: an audit that repaired as it went would leave nobody able to say
 * how wrong things had been, and the size of the gap is the finding.
 *
 * There are two hops between Asana and a number on the screen. Asana to the
 * mirror, and the mirror to the app's own tickets through the projection.
 * Either can be wrong, and they fail differently: a bad pull means the mirror
 * disagrees with Asana, a bad projection means the app disagrees with the
 * mirror while the mirror is right. So both are compared and reported
 * separately, because "the number is wrong" is not an actionable sentence.
 *
 * WHERE THEY DISAGREE, ASANA WINS. That is the ruling and it is also the only
 * coherent position: Asana is the source of truth and this app mirrors it.
 */

export interface FieldGap {
	field: string;
	asana: string | number | null;
	mirror: string | number | null;
	app: string | number | null;
}

export interface ProjectAudit {
	gid: string;
	archived: number;
	/** Size band, so a sample can be shown to span sizes without naming anything. */
	band: string;
	asana_tasks: number;
	mirror_tasks: number;
	app_tickets: number;
	asana_open: number;
	mirror_open: number;
	app_open: number;
	/** Task-level disagreements, capped so one bad project cannot flood the report. */
	task_gaps: { gid: string; gaps: FieldGap[] }[];
	tasks_compared: number;
	tasks_with_any_gap: number;
	agrees: boolean;
}

export interface AuditReport {
	sampled: number;
	projects: ProjectAudit[];
	totals: {
		asana_tasks: number;
		mirror_tasks: number;
		app_tickets: number;
		projects_agreeing: number;
		projects_disagreeing: number;
	};
	calls: number;
	note: string;
}

interface AsanaTask {
	gid: string;
	completed?: boolean;
	/*
	 * When Asana says the task was made.
	 *
	 * Carried so a task the mirror lacks can be told apart from a task the pull
	 * missed. "Missing from the mirror" looks identical either way, and a pull
	 * that ran on Tuesday cannot be blamed for a task created on Thursday. D203.
	 */
	created_at?: string | null;
	due_on?: string | null;
	assignee?: { gid: string; name?: string } | null;
	memberships?: { project?: { gid: string }; section?: { name?: string } }[];
}

const FIELDS =
	'completed,due_on,created_at,assignee.gid,assignee.name,memberships.project.gid,memberships.section.name';

/** Every task on one project, straight from Asana, following its paging. */
async function liveTasks(token: string, projectGid: string): Promise<AsanaTask[]> {
	const out: AsanaTask[] = [];
	let offset: string | null = null;
	let calls = 0;

	do {
		const body: { data?: AsanaTask[]; next_page?: { offset?: string } | null } = await request(
			token,
			`/tasks?project=${projectGid}&opt_fields=${FIELDS}&limit=100${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`
		);
		out.push(...(body.data ?? []));
		offset = body.next_page?.offset ?? null;
		calls += 1;
		// Paced, for the same 150-a-minute limit the mirror respects.
		if (offset) await new Promise((r) => setTimeout(r, 420));
	} while (offset && calls < 40);

	return out;
}

function band(n: number): string {
	if (n === 0) return 'empty';
	if (n < 10) return 'small';
	if (n < 40) return 'medium';
	return 'large';
}

/**
 * Audits a sample of projects across sizes.
 *
 * Spread across size bands rather than taken off the top, because the failure
 * modes differ: a paging fault only shows on a project big enough to page, and
 * an empty project is where a zero-versus-null confusion hides.
 */
export async function auditProjects(
	env: { DB: D1Database; ASANA_TOKEN?: string },
	workspaceGid: string,
	sampleSize = 10
): Promise<AuditReport> {
	const token = env.ASANA_TOKEN;
	if (!token) throw new Error('No Asana token is configured.');

	const { results: candidates } = await env.DB.prepare(
		`SELECT p.gid, p.archived,
            (SELECT COUNT(*) FROM asana_tasks t WHERE t.project_gid = p.gid) AS mirror_tasks
     FROM asana_projects p
     WHERE p.workspace_gid = ?
     ORDER BY mirror_tasks DESC`
	)
		.bind(workspaceGid)
		.all<{ gid: string; archived: number; mirror_tasks: number }>();

	const all = candidates ?? [];
	const byBand = new Map<string, typeof all>();
	for (const row of all) {
		const b = band(row.mirror_tasks);
		byBand.set(b, [...(byBand.get(b) ?? []), row]);
	}

	// Round-robin across the bands until the sample is filled, so no band is
	// missed and the largest projects do not crowd out the rest.
	const picked: typeof all = [];
	const bands = [...byBand.keys()];
	for (let i = 0; picked.length < sampleSize && i < 100; i++) {
		for (const b of bands) {
			const list = byBand.get(b)!;
			const next = list[Math.floor(i)];
			if (next && !picked.includes(next)) picked.push(next);
			if (picked.length >= sampleSize) break;
		}
	}

	const projects: ProjectAudit[] = [];
	let calls = 0;

	for (const project of picked) {
		const live = await liveTasks(token, project.gid);
		calls += Math.max(1, Math.ceil(live.length / 100));

		const { results: mirrorRows } = await env.DB.prepare(
			`SELECT t.gid, t.completed, t.due_on, t.assignee_gid, t.section_name
       FROM asana_tasks t WHERE t.project_gid = ?`
		)
			.bind(project.gid)
			.all<{
				gid: string;
				completed: number;
				due_on: string | null;
				assignee_gid: string | null;
				section_name: string | null;
			}>();

		const { results: appRows } = await env.DB.prepare(
			`SELECT l.asana_gid AS gid, tk.status, tk.due_date, tk.asana_assignee_gid, tk.asana_section
       FROM asana_task_links l
       JOIN tickets tk ON tk.id = l.ticket_id
       WHERE l.asana_gid IN (SELECT gid FROM asana_tasks WHERE project_gid = ?)`
		)
			.bind(project.gid)
			.all<{
				gid: string;
				status: string;
				due_date: string | null;
				asana_assignee_gid: string | null;
				asana_section: string | null;
			}>();

		const mirrorBy = new Map((mirrorRows ?? []).map((r) => [r.gid, r]));
		const appBy = new Map((appRows ?? []).map((r) => [r.gid, r]));

		const taskGaps: ProjectAudit['task_gaps'] = [];

		for (const task of live) {
			const m = mirrorBy.get(task.gid);
			const a = appBy.get(task.gid);
			const gaps: FieldGap[] = [];

			if (!m) {
				gaps.push({
					field: 'present in mirror',
					asana: task.created_at ?? 'yes',
					mirror: 'missing',
					app: a ? 'yes' : 'missing'
				});
			} else {
				const liveCompleted = task.completed ? 1 : 0;
				if (liveCompleted !== m.completed) {
					gaps.push({ field: 'completed', asana: liveCompleted, mirror: m.completed, app: a?.status ?? null });
				}
				if ((task.due_on ?? null) !== (m.due_on ?? null)) {
					gaps.push({ field: 'due_on', asana: task.due_on ?? null, mirror: m.due_on, app: a?.due_date ?? null });
				}
				if ((task.assignee?.gid ?? null) !== (m.assignee_gid ?? null)) {
					gaps.push({
						field: 'assignee',
						asana: task.assignee?.gid ?? null,
						mirror: m.assignee_gid,
						app: a?.asana_assignee_gid ?? null
					});
				}

				const liveSection =
					(task.memberships ?? []).find((x) => x.project?.gid === project.gid)?.section?.name ?? null;
				if (liveSection !== (m.section_name ?? null)) {
					gaps.push({ field: 'section', asana: liveSection, mirror: m.section_name, app: a?.asana_section ?? null });
				}

				if (!a) {
					gaps.push({ field: 'present in app', asana: 'yes', mirror: 'yes', app: 'missing' });
				} else {
					// The app's status is coarse by design; only the open/closed
					// split is comparable, and that is the split every count uses.
					const appDone = a.status === 'done' || a.status === 'cancelled';
					if (appDone !== Boolean(liveCompleted)) {
						gaps.push({ field: 'open/closed', asana: liveCompleted ? 'done' : 'open', mirror: m.completed, app: a.status });
					}
				}
			}

			if (gaps.length) taskGaps.push({ gid: task.gid, gaps });
		}

		// Tasks the mirror holds that Asana no longer returns: deleted or moved
		// since the pull, and a stale row is as wrong as a missing one.
		for (const [gid] of mirrorBy) {
			if (!live.some((t) => t.gid === gid)) {
				taskGaps.push({
					gid,
					gaps: [{ field: 'present in Asana', asana: 'missing', mirror: 'yes', app: appBy.has(gid) ? 'yes' : 'missing' }]
				});
			}
		}

		const asanaOpen = live.filter((t) => !t.completed).length;
		const mirrorOpen = (mirrorRows ?? []).filter((r) => !r.completed).length;
		const appOpen = (appRows ?? []).filter((r) => r.status !== 'done' && r.status !== 'cancelled').length;

		projects.push({
			gid: project.gid,
			archived: project.archived,
			band: band(project.mirror_tasks),
			asana_tasks: live.length,
			mirror_tasks: (mirrorRows ?? []).length,
			app_tickets: (appRows ?? []).length,
			asana_open: asanaOpen,
			mirror_open: mirrorOpen,
			app_open: appOpen,
			tasks_compared: live.length,
			tasks_with_any_gap: taskGaps.length,
			task_gaps: taskGaps.slice(0, 8),
			agrees:
				live.length === (mirrorRows ?? []).length &&
				live.length === (appRows ?? []).length &&
				asanaOpen === mirrorOpen &&
				asanaOpen === appOpen &&
				taskGaps.length === 0
		});
	}

	return {
		sampled: projects.length,
		projects,
		totals: {
			asana_tasks: projects.reduce((s, p) => s + p.asana_tasks, 0),
			mirror_tasks: projects.reduce((s, p) => s + p.mirror_tasks, 0),
			app_tickets: projects.reduce((s, p) => s + p.app_tickets, 0),
			projects_agreeing: projects.filter((p) => p.agrees).length,
			projects_disagreeing: projects.filter((p) => !p.agrees).length
		},
		calls,
		note: 'Read only on both sides. Nothing was corrected; where the app disagrees with Asana, Asana is right.'
	};
}
