import type { PageLoad } from './$types';
import type { Template } from '$lib/types';

export const load: PageLoad = async ({ fetch, url }) => {
	const status = url.searchParams.get('status') ?? 'active';
	const q = url.searchParams.get('q') ?? '';

	const query = new URLSearchParams({ status });
	if (q) query.set('q', q);

	const res = await fetch(`/api/templates?${query}`);
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load templates.');
	}

	const data = (await res.json()) as {
		templates: Template[];
		counts: { active: number; archived: number; email: number; doc: number };
		/** Every use this month, across the whole library rather than the filter. */
		drafted_this_month: number;
		/** The template carrying the library, or null before anything is used. */
		most_used: { id: string; name: string; uses: number } | null;
	};

	return { ...data, status, q };
};
