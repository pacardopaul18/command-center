import type { PageLoad } from './$types';
import type {
	AsanaStatus,
	AsanaSyncStatus,
	ConnectionStatus,
	EmailIngestStatus
} from '$lib/types';
import type { CalendarRow } from '$lib/components/CalendarList.svelte';
import { accountQuery, resolveAccountScope, scopedError } from '$lib/account-scope';

export const load: PageLoad = async ({ fetch, url }) => {
	/**
	 * Three of these reads belong to one account, and none of them said which.
	 *
	 * Settings is the worst page in the app to leave unscoped, because it holds
	 * the calendar list and the mail ingest progress. Once a second account was
	 * connected those reads would be refused and rendered as nothing, so the
	 * page a reader opens to find out why the app stopped showing them would be
	 * one of the pages that had stopped showing them. D127.
	 */
	const scope = await resolveAccountScope(fetch, url);
	const acct = accountQuery(scope.account);

	const [res, syncRes, connRes, mailRes, calRes, spendRes] = await Promise.all([
		fetch('/api/asana'),
		fetch('/api/asana/sync'),
		fetch('/api/connections'),
		fetch(`/api/email/ingest${acct}`),
		fetch(`/api/connections/google/calendars${acct}`),
		fetch(`/api/email/summarise${acct}`)
	]);

	/**
	 * Read before anything consumes a body.
	 *
	 * `scopedError` only reads a response that failed, which is exactly the case
	 * where no success branch reads it, so the two never touch the same body.
	 * Ordered first anyway, because a body is read once and a rule that depends
	 * on statement order is a rule waiting to be broken by the next edit.
	 */
	const mailError = scope.connected ? await scopedError(mailRes, 'mail status') : null;
	const calendarError = scope.connected ? await scopedError(calRes, 'the calendars') : null;
	const spendError = scope.connected ? await scopedError(spendRes, 'the spend meter') : null;

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

	return {
		asana: (await res.json()) as AsanaStatus,
		sync,
		connections,
		mail,
		calendars,
		spend,
		account: scope.account,
		accountConnected: scope.connected,
		// Which mailbox the mail, calendar and spend figures describe. Settings
		// has no switcher, so without this the numbers are unattributed and a
		// two-account reader cannot tell whose they are.
		accountEmail:
			(connections as { accounts?: { id: string; account_email: string | null }[] } | null)
				?.accounts?.find((a) => a.id === scope.account)?.account_email ?? null,
		mailError,
		calendarError,
		spendError
	};
};
