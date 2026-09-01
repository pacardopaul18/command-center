import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { ActionItem, Client, Project, Ticket } from '$lib/types';

/** One step in the plan. Migration 0029. */
export interface Milestone {
	id: string;
	project_id: string;
	title: string;
	due_date: string | null;
	/** Null means outstanding. A date rather than a flag, so a slipped plan reads. */
	done_at: string | null;
	position: number;
}

/** A file attached to the project. Bytes in R2, row here. */
export interface ProjectFile {
	id: string;
	project_id: string;
	filename: string;
	mime_type: string | null;
	size_bytes: number;
	uploaded_at: string;
}

export const load: PageLoad = async ({ fetch, params }) => {
	const [res, clientsRes, ticketsRes, ownersRes, milestonesRes, filesRes] = await Promise.all([
		fetch(`/api/projects/${params.id}`),
		fetch('/api/clients'),
		fetch(`/api/tickets?project_id=${params.id}&status=all`),
		fetch('/api/people/owners'),
		fetch(`/api/projects/${params.id}/milestones`),
		fetch(`/api/projects/${params.id}/files`)
	]);

	if (res.status === 404) error(404, 'Project not found.');
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the project.');
	}

	const data = (await res.json()) as {
		project: Project;
		action_items: ActionItem[];
		/** The working day, from the server. The browser's clock is not the app's. */
		today: string;
	};
	const clients = clientsRes.ok
		? ((await clientsRes.json()) as { clients: Client[] }).clients
		: [];

	// Tickets and the owner roster are supporting detail. A failure in either
	// must not stop the project loading, so both degrade to empty.
	const tickets = ticketsRes.ok
		? ((await ticketsRes.json()) as { tickets: Ticket[] }).tickets
		: [];
	const owners = ownersRes.ok
		? ((await ownersRes.json()) as { owners: string[] }).owners
		: [];

	// Milestones and files are supporting detail on the same footing as tickets:
	// a failure in either must not stop the project loading.
	const milestones = milestonesRes.ok
		? ((await milestonesRes.json()) as { milestones: Milestone[] }).milestones
		: [];
	const files = filesRes.ok
		? ((await filesRes.json()) as { files: ProjectFile[] }).files
		: [];

	/*
	 * The client's Dropbox files, on the project page too.
	 *
	 * A project belongs to a client and the client's folder is where its work
	 * actually lives, so a project page that showed only files somebody uploaded
	 * here was showing the empty half. Supporting detail: a failure degrades to
	 * nothing rather than taking the project down.
	 */
	const clientId = data.project.client_id;
	const dropboxRes = clientId
		? await fetch(`/api/files?client_id=${clientId}&page_size=25`)
		: null;
	const dropbox =
		dropboxRes && dropboxRes.ok
			? ((await dropboxRes.json()) as {
					files: { path: string; name: string; size_bytes: number; modified_at: string | null }[];
					total: number;
				})
			: { files: [], total: 0 };

	return { ...data, clients, tickets, owners, milestones, files, dropbox };
};
