import type { Interval } from './free-slots';

/**
 * Turning mirrored calendar rows into the busy intervals a gap search needs.
 *
 * W3. "Find a time" already exists on the Calendar page and asks Google live,
 * which is right when the answer must be current. This is the other one: it
 * reads the events already in the database, so it needs no network, no
 * per-person email, and cannot fail per calendar.
 *
 * WHY IT WORKS AT ALL, and it is worth saying because it looks like it should
 * not. Six of the seven synced calendars are partners' and store free and busy
 * only, by the rule in D205: start, end, and nothing else. That is exactly and
 * only what a gap search needs. The privacy boundary and this feature want the
 * same shape of data, so nothing had to be relaxed to build it.
 *
 * The trade against the live search is freshness, and it is a real one. A gap
 * found in a mirror synced three hours ago is a gap as of three hours ago. The
 * caller is required to say how old the data is; see the route.
 */

export interface MirrorEvent {
	starts_at: string;
	ends_at: string | null;
	all_day: number | null;
	calendar_name?: string | null;
}

export interface BusyReading {
	/** What blocks the search. */
	busy: Interval[];
	/** Events counted as busy. */
	counted: number;
	/**
	 * All-day entries, counted and excluded.
	 *
	 * An all-day row is a marker far more often than it is a wall: a holiday, a
	 * launch date, a label on the week. Treating one as twenty-four hours of
	 * busy erases the whole day, and a gap finder that returns nothing is
	 * indistinguishable from one that is broken.
	 *
	 * But some of them are real, and somebody's leave is exactly the day not to
	 * book. So they are excluded and reported rather than excluded quietly, and
	 * the screen names the days they fall on. The reader decides; the tool does
	 * not guess and does not hide the guess it did not make. D220.
	 */
	all_day_excluded: number;
	all_day_days: string[];
	/** Rows with no end, which cannot bound anything and are not silently zero. */
	unbounded_excluded: number;
}

/**
 * Reads the mirror into busy intervals, and says what it left out.
 *
 * Pure, so the judgement about all-day rows is testable without a database and
 * without a clock.
 */
export function readBusy(events: MirrorEvent[]): BusyReading {
	const busy: Interval[] = [];
	const allDayDays = new Set<string>();
	let allDay = 0;
	let unbounded = 0;

	for (const event of events) {
		if (event.all_day) {
			allDay += 1;
			allDayDays.add(event.starts_at.slice(0, 10));
			continue;
		}
		if (!event.ends_at) {
			// A start with no end is not a zero-length event and is not an
			// all-day one. It is a row this app cannot reason about, so it is
			// counted and set aside rather than assigned a duration.
			unbounded += 1;
			continue;
		}
		const start = Date.parse(event.starts_at);
		const end = Date.parse(event.ends_at);
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
			unbounded += 1;
			continue;
		}
		busy.push({ start: event.starts_at, end: event.ends_at });
	}

	return {
		busy,
		counted: busy.length,
		all_day_excluded: allDay,
		all_day_days: [...allDayDays].sort(),
		unbounded_excluded: unbounded
	};
}

/**
 * Whether a gap answer is worth showing at all.
 *
 * A mirror with no events in the window is not a diary with nothing in it. It
 * is a mirror that has not been synced, or synced a window that does not
 * overlap the question, and answering "you are free all week" from it would be
 * confidently wrong in the most expensive direction. D214, and the fifth
 * checklist item's shape: absence and emptiness are different claims.
 */
export function gapsAreMeaningful(reading: BusyReading, eventsInWindow: number): boolean {
	return eventsInWindow > 0 || reading.all_day_excluded > 0;
}

/**
 * Minutes to add to UTC to reach the working zone, at a given instant.
 *
 * Computed, never written down. Mountain is minus six in summer and minus seven
 * in winter, and a constant is right for half the year and confidently wrong
 * for the other half. Paul works US hours from GMT+8, so the one zone nobody
 * can infer from context is the one that matters, and a gap finder computing in
 * the wrong zone returns plausible times that are eight hours out.
 */
export function zoneOffsetMinutes(zone: string, at: Date): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: zone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	}).formatToParts(at);

	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
	// Hour 24 is midnight in this formatter's output; normalise it.
	const hour = get('hour') % 24;
	const asZone = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
	// Seconds are dropped on both sides, so the difference is whole minutes.
	return Math.round((asZone - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * Whether the search window straddles a clock change.
 *
 * `findSlots` takes one offset for the whole window, so a fortnight spanning
 * the end of daylight saving would apply the wrong hour to part of it. Rather
 * than silently pick, the caller is told, and the screen says the working hours
 * shift by an hour partway through. Two dates, one comparison, no guessing.
 */
export function straddlesClockChange(zone: string, from: Date, to: Date): boolean {
	return zoneOffsetMinutes(zone, from) !== zoneOffsetMinutes(zone, to);
}
