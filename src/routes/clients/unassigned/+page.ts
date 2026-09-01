import type { PageLoad } from './$types';

export interface UnassignedProject {
	gid: string;
	name: string;
	archived: number;
	modified_at: string | null;
	tasks: number;
	open_tasks: number;
}

export interface UnassignedFolder {
	path: string;
	name: string;
	file_count: number;
	total_bytes: number;
	last_activity: string | null;
}

export interface ClientChoice {
	id: string;
	name: string;
	projects: number;
	folders: number;
}

export const load: PageLoad = async ({ fetch }) => {
	const res = await fetch('/api/unassigned');
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the unassigned list.');
	}

	return (await res.json()) as {
		projects: UnassignedProject[];
		folders: UnassignedFolder[];
		clients: ClientChoice[];
		counts: { projects: number; folders: number };
	};
};
