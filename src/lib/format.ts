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

/**
 * The same date without its weekday, for columns where the weekday is noise.
 *
 * A dated table row is read against the rows above and below it, not against
 * the week, and "Sat, Aug 29" in a column of forty invoices costs four
 * characters a row to say something nobody is asking. Same UTC formatting as
 * formatDay, for the same reason: a bare date must not shift a day.
 */
const shortDayFormatter = new Intl.DateTimeFormat('en-US', {
	timeZone: 'UTC',
	month: 'short',
	day: 'numeric'
});

export function formatDayShort(date: string): string {
	return shortDayFormatter.format(new Date(`${date}T00:00:00Z`));
}

/**
 * A date with its year, for anything that reaches back past this one.
 *
 * "Client since Aug 25" is only useful if the reader already knows which year,
 * and the whole point of that line is that they do not.
 */
const yearDayFormatter = new Intl.DateTimeFormat('en-US', {
	timeZone: 'UTC',
	year: 'numeric',
	month: 'short',
	day: 'numeric'
});

export function formatDayYear(date: string): string {
	return yearDayFormatter.format(new Date(`${date}T00:00:00Z`));
}

/**
 * A stored UTC timestamp shown in Mountain Time.
 *
 * Deliberately different from `formatDay`. A deadline is a bare date with no
 * zone: 'Sep 3' means Sep 3 wherever you are, so it formats in UTC to stop the
 * browser shifting it a day. A completion is a real instant, and the only
 * honest way to show it is in the timezone the person was working in. Intl
 * carries the DST rules, so this needs no arithmetic of its own.
 */
const momentFormatter = new Intl.DateTimeFormat('en-US', {
	timeZone: 'America/Denver',
	month: 'short',
	day: 'numeric',
	hour: 'numeric',
	minute: '2-digit'
});

export function formatMoment(iso: string): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return iso;
	return momentFormatter.format(at);
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
