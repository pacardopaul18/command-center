import type { PageLoad } from './$types';
import type { AsanaStatus } from '$lib/types';

export const load: PageLoad = async ({ fetch }) => {
	const res = await fetch('/api/asana');
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load settings.');
	}
	return { asana: (await res.json()) as AsanaStatus };
};
