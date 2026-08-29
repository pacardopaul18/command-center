import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { REPORT_TYPES } from '$lib/types';
import type { ReportType } from '$lib/types';

export const load: PageLoad = async ({ fetch, params, url }) => {
	const type = params.type as ReportType;
	if (!REPORT_TYPES.includes(type)) error(404, 'That report does not exist.');

	// The window is carried in the URL so a report is a linkable, re-runnable
	// thing rather than a screen state. The print route reads the same params.
	const query = new URLSearchParams();
	for (const key of ['from', 'to']) {
		const value = url.searchParams.get(key);
		if (value) query.set(key, value);
	}

	const res = await fetch(`/api/reports/${type}?${query}`);
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not run that report.');
	}

	return (await res.json()) as {
		type: ReportType;
		today: string;
		from: string;
		to: string;
		generated_at: string;
		data: Record<string, unknown>;
	};
};
