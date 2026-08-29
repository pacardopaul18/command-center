import type { PageLoad } from './$types';
import type { ActionItem, AgingBucket } from '$lib/types';

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

export const load: PageLoad = async ({ fetch }) => {
	const res = await fetch('/api/today');
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the cockpit.');
	}
	return (await res.json()) as {
		today: string;
		stale_days: number;
		soon_days: number;
		overdue: ActionItem[];
		due_today: ActionItem[];
		slipping: SlippingItem[];
		meetings: TodayMeeting[];
		invoice_alerts: InvoiceAlert[];
		totals: { open: number; done_today: number };
	};
};
