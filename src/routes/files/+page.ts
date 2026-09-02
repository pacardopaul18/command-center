import type { PageLoad } from './$types';

export interface MirroredFile {
	path: string;
	name: string;
	extension: string | null;
	size_bytes: number;
	modified_at: string | null;
	folder_path: string;
}

export interface FileKind {
	extension: string;
	files: number;
	total_bytes: number;
}

export const load: PageLoad = async ({ fetch, url }) => {
	const page = url.searchParams.get('page') ?? '1';
	const q = url.searchParams.get('q') ?? '';
	const extension = url.searchParams.get('extension') ?? '';
	const clientId = url.searchParams.get('client_id') ?? '';

	const query = new URLSearchParams({ page, page_size: '50' });
	if (q) query.set('q', q);
	if (extension) query.set('extension', extension);
	if (clientId) query.set('client_id', clientId);

	const [listRes, summaryRes, clientsRes] = await Promise.all([
		fetch(`/api/files?${query}`),
		fetch('/api/files/summary'),
		fetch('/api/clients?status=all')
	]);

	if (!listRes.ok) {
		const body = (await listRes.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the files.');
	}

	const list = (await listRes.json()) as {
		files: MirroredFile[];
		page: number;
		page_size: number;
		total: number;
	};

	// Supporting detail. A failure in either must not stop the list rendering.
	const summary = summaryRes.ok
		? ((await summaryRes.json()) as {
				totals: { files: number; total_bytes: number; newest: string | null };
				kinds: FileKind[];
				filing: { client_folders: number; filed: number; unassigned: number };
				files_not_under_a_matched_client: number;
				freshness: {
					synced: boolean;
					as_of?: string | null;
					age_minutes?: number | null;
					reason?: string;
				};
			})
		: null;

	const clients = clientsRes.ok
		? ((await clientsRes.json()) as { clients: { id: string; name: string }[] }).clients
		: [];

	return { ...list, summary, clients, q, extension, clientId };
};
