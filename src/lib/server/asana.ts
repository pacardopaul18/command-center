/**
 * The one place the app talks to Asana.
 *
 * D4: one-way push only. The command center is Paul's own follow-through
 * record; Asana stays the firm's shared system of record. Nothing here reads
 * task state back, nothing polls, and nothing writes to Asana except an
 * explicit per-item push that Paul clicks.
 *
 * Contract checked against developers.asana.com rather than recalled:
 *
 * - `POST https://app.asana.com/api/1.0/tasks`
 * - `Authorization: Bearer <personal access token>`
 * - The request body nests everything under a `data` key, and so does the
 *   response. The new task's id is `data.gid`.
 * - `workspace` is required unless `projects` or `parent` is supplied. That is
 *   why this module makes Paul choose a workspace before a push can happen: a
 *   token alone is not enough information to create a task.
 * - `due_on` is YYYY-MM-DD, which is exactly how deadlines are already stored.
 * - Errors come back as `{ errors: [{ message, help }] }`.
 *
 * One thing is deliberately NOT asserted. The docs page for the Task object was
 * truncated at the point where `permalink_url` would appear, twice, so whether
 * Asana returns a ready-made task URL is unconfirmed. The push asks for it via
 * `opt_fields` and uses it when it comes back; when it does not, the link is
 * constructed. Both paths are reported so the first live push settles it.
 */

import type { KVNamespace } from '@cloudflare/workers-types';

const BASE = 'https://app.asana.com/api/1.0';

export class AsanaError extends Error {
	status: number;
	/** Asana's own text, when it had something specific to say. */
	detail: string | null;
	/**
	 * The status Asana actually returned, before it was remapped for the UI.
	 *
	 * `status` is what the API should answer with, so most Asana faults become
	 * 502: they are not the caller's mistake. That is right for a screen and
	 * useless for the sync, which has to tell "this one task is gone" (404, and
	 * D69 applies) apart from "the token is dead" (401, and nothing should be
	 * marked at all). Losing that distinction would let one expired token mark
	 * every linked item ambiguous.
	 */
	httpStatus: number | null;

	constructor(
		status: number,
		message: string,
		detail: string | null = null,
		httpStatus: number | null = null
	) {
		super(message);
		this.status = status;
		this.detail = detail;
		this.httpStatus = httpStatus;
	}
}

export interface AsanaSettings {
	workspace_gid: string | null;
	workspace_name: string | null;
	project_gid: string | null;
	project_name: string | null;
	/** A user gid, an email, or the literal "me". Empty means unassigned. */
	assignee: string | null;

	/*
	 * Whether this app may create tasks in Asana at all.
	 *
	 * Off unless somebody turns it on, and that is the point. The one-way push
	 * is a v1 feature and it stays in the code, but during the mirror phase the
	 * ruling is that Asana is the source of truth and the app only reads it.
	 *
	 * Before this existed, the only thing preventing a push was that no
	 * workspace had been chosen. That is not a decision, it is an accident of
	 * configuration, and picking a workspace to make the mirror settings
	 * coherent would have quietly armed it. Exactly the shape of D180: a
	 * capability held back by something being unconfigured rather than by
	 * anybody having decided.
	 */
	push_enabled: boolean;
}

/**
 * The assignee a push uses when Settings names none.
 *
 * Asana resolves the literal "me" to the owner of the token, which is Paul.
 *
 * This is a default rather than a blank because of D-asana-1: the first
 * production push created a task with no assignee and no project, and Asana's
 * My Tasks only lists tasks assigned to you. The task existed, was reachable by
 * search and by its permalink, and was invisible in every view a person
 * actually opens. An unassigned task is a task nobody will do, so the safe
 * default is the one that puts it in front of somebody.
 *
 * There is deliberately no way to request an unassigned task. That is not an
 * oversight; it is the defect this constant exists to prevent.
 */
export const DEFAULT_ASSIGNEE = 'me';

/** What a push will actually send, after the default is applied. */
export function effectiveAssignee(settings: AsanaSettings): string {
	const chosen = settings.assignee?.trim();
	return chosen ? chosen : DEFAULT_ASSIGNEE;
}

export const EMPTY_SETTINGS: AsanaSettings = {
	workspace_gid: null,
	workspace_name: null,
	project_gid: null,
	project_name: null,
	assignee: null,

	// Off by default, and off for anything already stored: the spread in
	// readSettings puts this value under whatever was saved before the field
	// existed, so an old settings blob reads as push disabled rather than as
	// push enabled by omission.
	push_enabled: false
};

/** KV key holding the Asana settings. Settings live in KV per the architecture. */
export const SETTINGS_KEY = 'asana:settings';

export async function readSettings(kv: KVNamespace): Promise<AsanaSettings> {
	const raw = await kv.get(SETTINGS_KEY);
	if (!raw) return { ...EMPTY_SETTINGS };
	try {
		return { ...EMPTY_SETTINGS, ...(JSON.parse(raw) as Partial<AsanaSettings>) };
	} catch {
		// Unreadable settings are treated as unset rather than as a fault. The
		// worst case is Paul picking the workspace again.
		return { ...EMPTY_SETTINGS };
	}
}

export async function writeSettings(kv: KVNamespace, settings: AsanaSettings): Promise<void> {
	await kv.put(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Turns an Asana response into something the UI can show.
 *
 * The requirement is that a failure surfaces legibly. A raw "403" tells Paul
 * nothing he can act on, so every code that has a distinct cause gets a
 * distinct sentence naming what to do about it. Asana's own message is carried
 * through as `detail` when it exists, because on a 400 it names the bad field
 * and no wording here could be more specific than that.
 */
async function toError(res: Response): Promise<AsanaError> {
	let detail: string | null = null;
	try {
		const body = (await res.json()) as { errors?: { message?: string }[] };
		const first = body?.errors?.[0]?.message;
		if (typeof first === 'string' && first.trim()) detail = first.trim();
	} catch {
		detail = (await res.text().catch(() => '')).slice(0, 300) || null;
	}

	switch (res.status) {
		case 400:
			return new AsanaError(400, detail ?? 'Asana rejected the task as malformed.', detail, 400);
		case 401:
			return new AsanaError(
				502,
				'Asana rejected the token. Set a current personal access token with `wrangler secret put ASANA_TOKEN`.',
				detail,
				401
			);
		case 403:
			return new AsanaError(
				502,
				'The Asana token is valid but not allowed to do that. Check it can create tasks in the chosen workspace and project.',
				detail,
				403
			);
		case 404:
			return new AsanaError(
				502,
				'Asana could not find that workspace, project or assignee. It may have been deleted or renamed.',
				detail,
				404
			);
		case 429: {
			const retry = res.headers.get('retry-after');
			return new AsanaError(
				429,
				retry
					? `Asana is rate limiting. Try again in ${retry} seconds.`
					: 'Asana is rate limiting. Try again shortly.',
				detail,
				429
			);
		}
		default:
			return new AsanaError(502, `Asana returned an error (${res.status}).`, detail, res.status);
	}
}

/** How long any one Asana request may take before it is treated as stuck. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * One Asana request. Exported so the mirror can page without a second client
 * that would need its own error mapping and drift from this one.
 */
export async function request<T>(token: string, path: string, init?: RequestInit): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`${BASE}${path}`, {
			...init,
			// A request with no deadline is not a slow request, it is a stuck
			// one. A mirror pull that hangs on a single connection stops making
			// progress while still looking alive, and the only symptom is a
			// count that stops going up. Thirty seconds is far longer than any
			// page of a hundred rows takes.
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			headers: {
				authorization: `Bearer ${token}`,
				'content-type': 'application/json',
				accept: 'application/json',
				...(init?.headers ?? {})
			}
		});
	} catch (err) {
		const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
		throw new AsanaError(
			timedOut ? 504 : 502,
			timedOut
				? `Asana did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.`
				: 'Could not reach Asana. The request did not happen.'
		);
	}

	if (!res.ok) throw await toError(res);

	try {
		return (await res.json()) as T;
	} catch {
		throw new AsanaError(502, 'Asana returned a response that was not valid JSON.');
	}
}

export interface AsanaRef {
	gid: string;
	name: string;
}

/** The workspaces the token can see. Paul picks one; there is no sane default. */
export async function listWorkspaces(token: string): Promise<AsanaRef[]> {
	const body = await request<{ data?: AsanaRef[] }>(token, '/workspaces?limit=100');
	return (body.data ?? []).map((w) => ({ gid: String(w.gid), name: String(w.name) }));
}

/** Projects in a workspace. Optional: a task can be created with no project. */
export async function listProjects(token: string, workspaceGid: string): Promise<AsanaRef[]> {
	const body = await request<{ data?: AsanaRef[] }>(
		token,
		`/projects?workspace=${encodeURIComponent(workspaceGid)}&archived=false&limit=100`
	);
	return (body.data ?? []).map((p) => ({ gid: String(p.gid), name: String(p.name) }));
}

export interface CreatedTask {
	gid: string;
	/** Asana's own link when it returned one, otherwise a constructed fallback. */
	url: string;
	/** True when the URL came from Asana rather than from string building. */
	url_from_asana: boolean;
}

export interface TaskInput {
	name: string;
	notes: string;
	/** YYYY-MM-DD, or null for no due date. */
	dueOn: string | null;
	workspaceGid: string;
	projectGid: string | null;
	assignee: string | null;
}

/**
 * Creates one task in Asana and returns its gid.
 *
 * Nothing is written to D1 here. The caller stores the gid only after this
 * resolves, so a failed push leaves the action item exactly as it was. Same
 * rule the digests already follow with their sent marker: the record of having
 * done a thing is written after the thing succeeded, never before.
 */
export async function createTask(token: string, input: TaskInput): Promise<CreatedTask> {
	const data: Record<string, unknown> = {
		name: input.name,
		notes: input.notes,
		workspace: input.workspaceGid
	};

	// Only send what has a value. Asana treats an explicit null on some of these
	// as an instruction rather than as an omission.
	if (input.dueOn) data.due_on = input.dueOn;
	if (input.projectGid) data.projects = [input.projectGid];
	if (input.assignee) data.assignee = input.assignee;

	const body = await request<{ data?: { gid?: string; permalink_url?: string } }>(
		token,
		'/tasks?opt_fields=gid,permalink_url,name',
		{ method: 'POST', body: JSON.stringify({ data }) }
	);

	const gid = body.data?.gid;
	if (!gid) {
		throw new AsanaError(502, 'Asana accepted the task but did not return its id.');
	}

	const permalink = body.data?.permalink_url;
	return {
		gid: String(gid),
		url: permalink ?? taskUrl(String(gid)),
		url_from_asana: Boolean(permalink)
	};
}

/**
 * A link to a task from its gid alone.
 *
 * Used wherever a stored action item is displayed, since D4 stores the gid and
 * not a URL. Asana resolves this form to the task regardless of which project
 * it sits in, which is why the leading segments are zeros rather than a real
 * project id.
 */
export function taskUrl(gid: string): string {
	return `https://app.asana.com/0/0/${gid}`;
}

/**
 * The fields the sync reads back. Requested explicitly, because Asana returns
 * only gid and name unless asked, and a silently missing field would look like
 * a cleared value.
 */
const SYNC_FIELDS = 'gid,name,completed,completed_at,due_on,modified_at,assignee.name,permalink_url';

export interface AsanaTask {
	gid: string;
	name: string;
	completed: boolean;
	completed_at: string | null;
	due_on: string | null;
	modified_at: string | null;
	assignee_name: string | null;
	permalink_url: string | null;
}

function toTask(raw: Record<string, unknown>): AsanaTask {
	const assignee = raw.assignee as { name?: string } | null | undefined;
	return {
		gid: String(raw.gid),
		name: typeof raw.name === 'string' ? raw.name : '',
		completed: raw.completed === true,
		completed_at: typeof raw.completed_at === 'string' ? raw.completed_at : null,
		due_on: typeof raw.due_on === 'string' ? raw.due_on : null,
		modified_at: typeof raw.modified_at === 'string' ? raw.modified_at : null,
		assignee_name: typeof assignee?.name === 'string' ? assignee.name : null,
		permalink_url: typeof raw.permalink_url === 'string' ? raw.permalink_url : null
	};
}

/**
 * Tasks changed since a moment, which is the whole polling mechanism.
 *
 * Asana will not list tasks by workspace alone. It insists on a project, a
 * section, a tag, or a workspace paired with an assignee. So the query shape
 * follows the settings: a configured project scopes it directly, and without
 * one it falls back to the workspace plus the assignee pushes already use. That
 * is not a lesser path, it is the same set of tasks a push can create.
 *
 * `modified_since` is a filter on what is returned, never a guarantee of what
 * exists. A task deleted in Asana does not appear in this list at all, which is
 * indistinguishable from a task that simply did not change. Absence here means
 * nothing, and that is precisely why `fetchTask` exists.
 */
export async function listChangedTasks(
	token: string,
	settings: AsanaSettings,
	modifiedSince: string
): Promise<AsanaTask[]> {
	const since = encodeURIComponent(modifiedSince);
	const path = settings.project_gid
		? `/tasks?project=${encodeURIComponent(settings.project_gid)}&modified_since=${since}` +
			`&opt_fields=${SYNC_FIELDS}&limit=100`
		: `/tasks?workspace=${encodeURIComponent(settings.workspace_gid ?? '')}` +
			`&assignee=${encodeURIComponent(effectiveAssignee(settings))}` +
			`&modified_since=${since}&opt_fields=${SYNC_FIELDS}&limit=100`;

	const body = await request<{ data?: Record<string, unknown>[] }>(token, path);
	return (body.data ?? []).map(toTask);
}

/**
 * One task by gid, or null when Asana says it is not there.
 *
 * Null is reserved for exactly one case: Asana answered, and answered 404. Any
 * other failure throws, because it means the sync learned nothing about this
 * task. Treating an expired token or a rate limit as "the task is gone" would
 * mark every linked item ambiguous over a problem that has nothing to do with
 * the tasks at all.
 */
export async function fetchTask(token: string, gid: string): Promise<AsanaTask | null> {
	try {
		const body = await request<{ data?: Record<string, unknown> }>(
			token,
			`/tasks/${encodeURIComponent(gid)}?opt_fields=${SYNC_FIELDS}`
		);
		return body.data ? toTask(body.data) : null;
	} catch (err) {
		if (err instanceof AsanaError && err.httpStatus === 404) return null;
		throw err;
	}
}
