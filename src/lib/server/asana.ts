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

	constructor(status: number, message: string, detail: string | null = null) {
		super(message);
		this.status = status;
		this.detail = detail;
	}
}

export interface AsanaSettings {
	workspace_gid: string | null;
	workspace_name: string | null;
	project_gid: string | null;
	project_name: string | null;
	/** A user gid, an email, or the literal "me". Empty means unassigned. */
	assignee: string | null;
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
	assignee: null
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
			return new AsanaError(400, detail ?? 'Asana rejected the task as malformed.', detail);
		case 401:
			return new AsanaError(
				502,
				'Asana rejected the token. Set a current personal access token with `wrangler secret put ASANA_TOKEN`.',
				detail
			);
		case 403:
			return new AsanaError(
				502,
				'The Asana token is valid but not allowed to do that. Check it can create tasks in the chosen workspace and project.',
				detail
			);
		case 404:
			return new AsanaError(
				502,
				'Asana could not find that workspace, project or assignee. It may have been deleted or renamed.',
				detail
			);
		case 429: {
			const retry = res.headers.get('retry-after');
			return new AsanaError(
				429,
				retry
					? `Asana is rate limiting. Try again in ${retry} seconds.`
					: 'Asana is rate limiting. Try again shortly.',
				detail
			);
		}
		default:
			return new AsanaError(502, `Asana returned an error (${res.status}).`, detail);
	}
}

async function request<T>(token: string, path: string, init?: RequestInit): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`${BASE}${path}`, {
			...init,
			headers: {
				authorization: `Bearer ${token}`,
				'content-type': 'application/json',
				accept: 'application/json',
				...(init?.headers ?? {})
			}
		});
	} catch {
		throw new AsanaError(502, 'Could not reach Asana. The push did not happen.');
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
