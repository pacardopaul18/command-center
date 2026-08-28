import type { PageLoad } from './$types';
import type { Sop } from '$lib/types';

export const load: PageLoad = async ({ fetch, url }) => {
	const q = url.searchParams.get('q') ?? '';
	const category = url.searchParams.get('category') ?? '';
	const status = url.searchParams.get('status') ?? 'active';

	const query = new URLSearchParams({ status });
	if (q) query.set('q', q);
	if (category) query.set('category', category);

	const res = await fetch(`/api/sops?${query}`);
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load SOPs.');
	}

	const data = (await res.json()) as {
		sops: Sop[];
		categories: { category: string; count: number }[];
		counts: { active: number; archived: number };
	};

	return { ...data, q, category, status };
};
