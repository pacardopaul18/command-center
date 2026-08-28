// Display helpers. These take the server's "today" (already resolved to
// Mountain Time) so the client clock never disagrees with the saved views.

const dayFormatter = new Intl.DateTimeFormat('en-US', {
	timeZone: 'UTC',
	weekday: 'short',
	month: 'short',
	day: 'numeric'
});

/** Whole days from today to the given date. Negative means the date has passed. */
export function daysFromToday(deadline: string, today: string): number {
	const a = Date.parse(`${deadline}T00:00:00Z`);
	const b = Date.parse(`${today}T00:00:00Z`);
	return Math.round((a - b) / 86_400_000);
}

export function formatDay(date: string): string {
	return dayFormatter.format(new Date(`${date}T00:00:00Z`));
}

export type DeadlineTone = 'overdue' | 'today' | 'soon' | 'later' | 'none';

export interface DeadlineLabel {
	tone: DeadlineTone;
	/** Short text carrying the state in words, never colour alone. */
	text: string;
	/** The plain date, always shown alongside. */
	date: string;
}

export function deadlineLabel(
	deadline: string | null,
	today: string,
	status: string
): DeadlineLabel {
	if (!deadline) return { tone: 'none', text: 'No deadline', date: '' };

	const date = formatDay(deadline);
	if (status === 'done') return { tone: 'later', text: 'Due', date };

	const days = daysFromToday(deadline, today);
	if (days < 0) {
		const n = Math.abs(days);
		return { tone: 'overdue', text: `Overdue by ${n} day${n === 1 ? '' : 's'}`, date };
	}
	if (days === 0) return { tone: 'today', text: 'Due today', date };
	if (days === 1) return { tone: 'soon', text: 'Due tomorrow', date };
	if (days <= 7) return { tone: 'soon', text: `Due in ${days} days`, date };
	return { tone: 'later', text: 'Due', date };
}
