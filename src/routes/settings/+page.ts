import type { PageLoad } from './$types';
import type { AsanaStatus, AsanaSyncStatus } from '$lib/types';

export const load: PageLoad = async ({ fetch }) => {
	const [res, syncRes] = await Promise.all([fetch('/api/asana'), fetch('/api/asana/sync')]);

	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load settings.');
	}

	// Sync state is supporting detail. A failure reading it must not stop the
	// settings page loading, since this is where a broken Asana setup gets
	// fixed and a page that will not open is no help at all.
	const sync = syncRes.ok ? ((await syncRes.json()) as AsanaSyncStatus) : null;

	return { asana: (await res.json()) as AsanaStatus, sync };
};
