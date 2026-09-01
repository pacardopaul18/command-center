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

	/*
	 * How much mirrored work is still unfiled.
	 *
	 * Fetched here so the link to the reconciliation screen can carry a number.
	 * A bare link says a screen exists; a number says whether it is worth
	 * opening, and this one is only worth opening when it is not zero.
	 *
	 * Its failure is not this page's failure. The client list is useful with or
	 * without the mirror, and a mirror that has never been pulled would
	 * otherwise take the whole page down.
	 */
	const pending = await fetch('/api/unassigned')
		.then((r) => (r.ok ? r.json() : null))
		.then((body) => (body?.counts as { projects: number; folders: number } | undefined) ?? null)
		.catch(() => null);

	return { ...data, status, pending };
};
