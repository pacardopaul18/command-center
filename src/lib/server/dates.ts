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

/**
 * The UTC instant at which a given Mountain Time calendar day begins.
 *
 * Needed because D1 stores timestamps in UTC while the app reasons in Mountain
 * Time. Comparing a UTC `completed_at` against `${day}T00:00:00Z` would be wrong
 * by the six or seven hour offset, so "done today" would count work finished
 * late the previous evening.
 *
 * Mountain Time is UTC-7 in winter and UTC-6 in summer, so midnight is one of
 * two instants. Rather than read the offset at some sample time and hope, which
 * is off by an hour on the two DST changeover days each year, both candidates
 * are checked and the one that actually formats back to 00:00 on that date in
 * the zone wins.
 */
export function workingDayStartUtc(day: string): string {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: WORKING_TIME_ZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		hour12: false
	});

	for (const offsetHours of [7, 6]) {
		const candidate = new Date(`${day}T00:00:00Z`);
		candidate.setUTCHours(offsetHours);
		const formatted = parts.formatToParts(candidate);
		const get = (type: string) => formatted.find((part) => part.type === type)?.value;
		const date = `${get('year')}-${get('month')}-${get('day')}`;
		// Intl renders midnight as hour 24 in some engines, so accept both.
		const hour = get('hour');
		if (date === day && (hour === '00' || hour === '24')) {
			return candidate.toISOString().replace(/\.\d{3}Z$/, 'Z');
		}
	}

	// Unreachable for Mountain Time. Falling back to the winter offset rather
	// than throwing, because a cockpit counter is not worth a 500.
	const fallback = new Date(`${day}T00:00:00Z`);
	fallback.setUTCHours(7);
	return fallback.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** An ISO 8601 UTC timestamp this many days before now. */
export function daysAgoUtc(days: number, now: Date = new Date()): string {
	const d = new Date(now.getTime());
	d.setUTCDate(d.getUTCDate() - days);
	return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
