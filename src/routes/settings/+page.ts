import type { PageLoad } from './$types';
import type {
	AsanaStatus,
	AsanaSyncStatus,
	ConnectionStatus,
	EmailIngestStatus
} from '$lib/types';
import type { CalendarRow } from '$lib/components/CalendarList.svelte';

export const load: PageLoad = async ({ fetch }) => {
	const [res, syncRes, connRes, mailRes, calRes, spendRes] = await Promise.all([
		fetch('/api/asana'),
		fetch('/api/asana/sync'),
		fetch('/api/connections'),
		fetch('/api/email/ingest'),
		fetch('/api/connections/google/calendars'),
		fetch('/api/email/summarise')
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

	const calendars = calRes.ok
		? ((await calRes.json()) as { calendars: CalendarRow[] }).calendars
		: [];

	// The spend meter. Context, so a failure reading it must not stop Settings.
	const spend = spendRes.ok
		? ((await spendRes.json()) as {
				usage: { kind: string; model: string; calls: number; input_tokens: number; output_tokens: number }[];
				last_24h: { calls: number; input_tokens: number; output_tokens: number };
				threads: number;
				triaged: number;
				summarised: number;
				remaining?: number;
			})
		: null;

	return { asana: (await res.json()) as AsanaStatus, sync, connections, mail, calendars, spend };
};
