import type { PageLoad } from './$types';
import type { ActionItem } from '$lib/types';

export type SlipReason = 'ambiguous' | 'blocked' | 'stalled' | 'due_soon';
export type SlippingItem = ActionItem & { reason: SlipReason };

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
		totals: { open: number; done_today: number };
	};
};
