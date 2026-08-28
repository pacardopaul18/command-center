import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { Sop, SopVersion } from '$lib/types';

/** History carries no bodies; exactly one body comes back, chosen by ?version. */
type VersionMeta = Omit<SopVersion, 'body'>;

export const load: PageLoad = async ({ fetch, params, url }) => {
	const requested = url.searchParams.get('version');
	const query = requested ? `?version=${encodeURIComponent(requested)}` : '';

	const res = await fetch(`/api/sops/${params.id}${query}`);
	if (res.status === 404) error(404, 'SOP not found.');
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the SOP.');
	}

	const data = (await res.json()) as {
		sop: Sop;
		versions: VersionMeta[];
		viewing: SopVersion;
	};

	return { ...data, isCurrent: data.viewing.id === data.sop.current_version_id };
};
