import type { PageLoad } from './$types';
import type { ActionItem, AgingBucket } from '$lib/types';
import { accountQuery, resolveAccountScope } from '$lib/account-scope';

export type SlipReason = 'ambiguous' | 'blocked' | 'stalled' | 'due_soon';
export type SlippingItem = ActionItem & { reason: SlipReason };

/**
 * A meeting dated today. No time field: `meetings` stores a date, so the card
 * shows the client and the follow-up counts rather than the mocked clock times
 * in the design. D27.
 */
export interface TodayMeeting {
	id: string;
	title: string;
	meeting_date: string;
	client_name: string | null;
	project_name: string | null;
	summary_reviewed_at: string | null;
	has_summary: number;
	open_follow_ups: number;
	pending_proposals: number;
}

/** An invoice past its due date. Not-yet-due invoices are not alerts. */
export interface InvoiceAlert {
	id: string;
	invoice_number: string;
	client_name: string;
	outstanding_cents: number;
	days_overdue: number;
	aging_bucket: AgingBucket;
}

/** A project, with its progress counted rather than stored. */
export interface DashboardProject {
	id: string;
	name: string;
	phase: string;
	status: string;
	target_close: string | null;
	next_milestone: string | null;
	client_name: string | null;
	open_items: number;
	all_items: number;
	done_items: number;
	open_tickets: number;
	late: number;
}

export interface DashboardTicket {
	id: string;
	title: string;
	status: string;
	priority: string;
	due_date: string | null;
	assignee: string | null;
	project_name: string;
	breaching: number;
}

/** One thread on the mail card. The shape the threads route already returns. */
export interface DashboardThread {
	id: string;
	subject: string | null;
	gist: string | null;
	last_at: string;
	severity: string | null;
	severity_override: string | null;
	latest_from: string | null;
	account_id: string;
}

/**
 * The cockpit, plus the mail that needs an answer.
 *
 * Two requests, not one, and the split is deliberate. `/api/today` is not
 * account scoped and must not become so: it reads Paul's own tracker, which
 * belongs to nobody's mailbox. Mail is scoped to one account, resolved here
 * through the shared helper so this loader cannot drift from the mail page's
 * idea of which account is open.
 *
 * D127 is the reason the scope is resolved in the loader rather than left to
 * the route. A correctly scoped route reached by a page that never names the
 * account is still a broken surface, and the guarantee that says so asserts
 * against this page's HTML rather than against the route beneath it.
 *
 * `allowAll` stays false. The dashboard has one mail card and no picker, so a
 * remembered union would put two clients' correspondence in one list with
 * nothing saying which was which. Crossing accounts is a feature that has to be
 * asked for, D111, and this screen never asks.
 */
export const load: PageLoad = async ({ fetch, url }) => {
	const scope = await resolveAccountScope(fetch, url);

	const [todayRes, mailRes] = await Promise.all([
		fetch('/api/today'),
		scope.connected
			? fetch(`/api/email/threads${accountQuery(scope.account)}&needs_you=true&limit=4`)
			: Promise.resolve(null)
	]);

	if (!todayRes.ok) {
		const body = (await todayRes.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the cockpit.');
	}

	const cockpit = (await todayRes.json()) as {
		today: string;
		stale_days: number;
		soon_days: number;
		overdue: ActionItem[];
		due_today: ActionItem[];
		slipping: SlippingItem[];
		meetings: TodayMeeting[];
		invoice_alerts: InvoiceAlert[];
		projects: DashboardProject[];
		tickets: DashboardTicket[];
		week: ActionItem[];
		finished: { title: string; completed_at: string; project_name: string | null }[];
		card_limit: number;
		oldest_overdue: string | null;
		counts: {
			overdue: number;
			due_today: number;
			week: number;
			meetings: number;
			invoice_alerts: number;
			awaiting_decision: number;
			past_due_cents: number;
			stalled: number;
			done_due_today: number;
			projects_active: number;
			projects_at_risk: number;
			tickets_open: number;
			tickets_breaching: number;
		};
		/**
		 * Whether each store holds anything at all.
		 *
		 * A tile showing zero means one of two things: nothing matched, or
		 * nothing was ever loaded. The first is good news, the second is a gap,
		 * and the tile said the same thing for both.
		 */
		sources: {
			action_items: boolean;
			meetings: boolean;
			invoices: boolean;
			projects: boolean;
			tickets: boolean;
		};
		totals: { open: number; done_today: number };
	};

	/**
	 * The mail card, and its failure mode.
	 *
	 * A mailbox that will not answer is reported on the card rather than thrown,
	 * because everything else on this screen is Paul's own data and still
	 * renders. A dashboard that goes blank because one account needs
	 * reconnecting is a worse outcome than a card that says so.
	 */
	const mail = mailRes?.ok
		? ((await mailRes.json()) as {
				threads: DashboardThread[];
				needs_you: number;
				total: number;
				counts: Record<string, number>;
				accounts: { id: string; account_email: string | null }[];
			})
		: null;

	return {
		...cockpit,
		mail: {
			connected: scope.connected,
			account: scope.account,
			// Named on the card. A list of somebody's mail with nothing saying
			// whose is worse than no list.
			account_email: mail?.accounts?.[0]?.account_email ?? null,
			threads: mail?.threads ?? [],
			needs_you: mail?.needs_you ?? 0,
			total: mail?.total ?? 0,
			/**
			 * The whole inbox, summed from the severity counts the same response
			 * already carries. `total` is the count matching the filter, so a
			 * card that said "5 of 5" was comparing a number with itself.
			 */
			inbox_total: Object.values(mail?.counts ?? {}).reduce((sum, n) => sum + Number(n), 0),
			failed: scope.connected && !mail
		}
	};
};
