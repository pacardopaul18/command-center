import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { REPORT_TYPES } from '$lib/types';
import type { ReportType } from '$lib/types';

/**
 * The print route runs the same query with the same params as the screen route.
 * It does not receive data from the screen, so opening a print URL directly, or
 * refreshing it, gives a correct report rather than an empty one.
 */
export const load: PageLoad = async ({ fetch, params, url }) => {
	const type = params.type as ReportType;
	if (!REPORT_TYPES.includes(type)) error(404, 'That report does not exist.');

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
