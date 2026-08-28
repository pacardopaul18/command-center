import type { PageLoad } from './$types';
import type { Client } from '$lib/types';

export const load: PageLoad = async ({ fetch, url }) => {
	const status = url.searchParams.get('status') ?? 'active';
	const res = await fetch(`/api/clients?status=${encodeURIComponent(status)}`);
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load clients.');
	}
	const data = (await res.json()) as {
		clients: Client[];
		counts: { active: number; archived: number };
	};
	return { ...data, status };
};
