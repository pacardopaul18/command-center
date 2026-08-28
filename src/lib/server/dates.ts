// Paul works US Mountain Time. Overdue and due-today are decided against the
// Mountain Time calendar date, not UTC, so an item due today does not flip to
// overdue at 6pm local when UTC rolls over.
//
// Cron Triggers are UTC only, so the digests later convert the other way.

export const WORKING_TIME_ZONE = 'America/Denver';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
	timeZone: WORKING_TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

/** Today's calendar date in Mountain Time, as YYYY-MM-DD. */
export function todayInWorkingZone(now: Date = new Date()): string {
	return dateFormatter.format(now);
}

/** Current instant as an ISO 8601 UTC string, matching what D1 stores. */
export function nowUtc(now: Date = new Date()): string {
	return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** True for a well formed YYYY-MM-DD date that is a real calendar day. */
export function isValidDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Default deadline for a new item: today plus two days, per the UX principles. */
export function defaultDeadline(now: Date = new Date()): string {
	const base = new Date(`${todayInWorkingZone(now)}T00:00:00Z`);
	base.setUTCDate(base.getUTCDate() + 2);
	return base.toISOString().slice(0, 10);
}
