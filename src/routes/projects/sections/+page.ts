import type { PageLoad } from './$types';

export interface SectionRow {
	section_name: string;
	sections: number;
	projects: number;
	tasks: number;
	open_tasks: number;
	status: string | null;
	via: 'section_gid' | 'section_name' | 'not_a_status' | 'unmapped';
	mapped_by: string | null;
	mapped_at: string | null;
	note: string | null;
}

export interface SectionOverride {
	section_gid: string;
	section_name: string | null;
	project_name: string | null;
	status: string;
	mapped_by: string;
	mapped_at: string;
	note: string | null;
}

export const load: PageLoad = async ({ fetch }) => {
	const res = await fetch('/api/sections');
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the sections.');
	}

	return (await res.json()) as {
		sections: SectionRow[];
		overrides: SectionOverride[];
		progress: {
			sections: number;
			mapped_to_status: number;
			marked_no_status: number;
			unmapped: number;
			decided_share: number | null;
		};
		tasks_under_unmapped: number;
	};
};
