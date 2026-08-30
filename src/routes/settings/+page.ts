import type { PageLoad } from './$types';
import type {
	AsanaStatus,
	AsanaSyncStatus,
	ConnectionStatus,
	EmailIngestStatus
} from '$lib/types';

export const load: PageLoad = async ({ fetch }) => {
	const [res, syncRes, connRes, mailRes] = await Promise.all([
		fetch('/api/asana'),
		fetch('/api/asana/sync'),
		fetch('/api/connections'),
		fetch('/api/email/ingest')
	]);

	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load settings.');
	}

	// Sync state is supporting detail. A failure reading it must not stop the
	// settings page loading, since this is where a broken Asana setup gets
	// fixed and a page that will not open is no help at all.
	const sync = syncRes.ok ? ((await syncRes.json()) as AsanaSyncStatus) : null;

	const connections = connRes.ok ? ((await connRes.json()) as ConnectionStatus) : null;

	// Mail state is context. A failure reading it must not stop Settings loading,
	// since Settings is where a broken connection gets fixed.
	const mail = mailRes.ok ? ((await mailRes.json()) as EmailIngestStatus) : null;

	return { asana: (await res.json()) as AsanaStatus, sync, connections, mail };
};
