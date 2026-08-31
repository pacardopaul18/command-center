/**
 * Finding a time everybody is free.
 *
 * Pure, and separate from the Google call on purpose. The interesting part of
 * "find a time" is the interval arithmetic, and interval arithmetic is where
 * the off-by-one lives: a slot that touches the end of a meeting is free, a
 * slot that overlaps it by a minute is not, and a run of back-to-back meetings
 * must merge into one wall rather than leaving imaginary gaps between them.
 * None of that needs a network, so none of it is tested through one.
 */

export interface Interval {
	start: string;
	end: string;
}

export interface Slot {
	start: string;
	end: string;
}

export interface SlotOptions {
	/** How long the meeting is, in minutes. */
	minutes: number;
	/** The search window. */
	from: string;
	to: string;
	/**
	 * The earliest and latest hour a slot may start and end, in the zone the
	 * offset describes. A calendar with nothing on it at 3am is free and is not
	 * a suggestion, and offering one is how a tool stops being trusted.
	 */
	dayStartHour: number;
	dayEndHour: number;
	/**
	 * Minutes to add to UTC to get the working zone, so the working-hours window
	 * is applied on the clock the reader lives on rather than on UTC. Passed in
	 * rather than derived, because the server has no business guessing which
	 * clock a browser is on.
	 */
	zoneOffsetMinutes: number;
	/** How many to return. A list of two hundred slots is not an answer. */
	limit: number;
	/**
	 * Slots start on this boundary, in minutes. Fifteen means 9:00, 9:15, 9:30,
	 * never 9:07, because a suggestion nobody would type is a suggestion nobody
	 * accepts.
	 */
	granularity: number;
}

const MINUTE = 60_000;

/**
 * Overlapping and touching intervals collapsed into one.
 *
 * Touching counts. Two meetings that end and begin at 10:00 leave no gap, and
 * treating them as separate blocks would leave a zero-length hole that a naive
 * scan reports as free time.
 */
export function mergeBusy(intervals: Interval[]): Interval[] {
	const sorted = intervals
		.map((i) => ({ start: new Date(i.start).getTime(), end: new Date(i.end).getTime() }))
		.filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
		.sort((a, b) => a.start - b.start);

	const out: { start: number; end: number }[] = [];
	for (const block of sorted) {
		const last = out[out.length - 1];
		if (last && block.start <= last.end) last.end = Math.max(last.end, block.end);
		else out.push({ ...block });
	}

	return out.map((i) => ({
		start: new Date(i.start).toISOString(),
		end: new Date(i.end).toISOString()
	}));
}

/**
 * Minutes since local midnight, and the local midnight it counts from.
 *
 * Arithmetic rather than `Intl`, because the offset is already known and a
 * formatter here would be a second source of truth about the same clock.
 *
 * Returning the day boundary alongside the minutes is the whole point. Reading
 * the clock alone loses which day it is, so a slot running 23:30 to 00:00 has
 * an end of "0 minutes past midnight", which is inside every working-hours
 * window ever configured. That is how a matcher offers half past eleven at
 * night as a suggestion and passes its own end-of-day check doing it.
 */
function localClock(ms: number, offsetMinutes: number): { day: number; minutes: number } {
	const shifted = ms + offsetMinutes * MINUTE;
	const day = Math.floor(shifted / 86_400_000);
	return { day, minutes: (shifted - day * 86_400_000) / MINUTE };
}

/**
 * Every start time in the window at which the whole meeting fits.
 *
 * Scans on the granularity rather than on the edges of the busy blocks. Both
 * work; this one produces the times a person would actually propose, and the
 * cost of the extra iterations across a fortnight is nothing.
 */
export function findSlots(busy: Interval[], options: SlotOptions): Slot[] {
	const merged = mergeBusy(busy);
	const walls = merged.map((b) => ({
		start: new Date(b.start).getTime(),
		end: new Date(b.end).getTime()
	}));

	const windowStart = new Date(options.from).getTime();
	const windowEnd = new Date(options.to).getTime();
	const length = options.minutes * MINUTE;
	const step = Math.max(1, options.granularity) * MINUTE;

	// Start on a granularity boundary in the working zone, so the first
	// suggestion is 9:00 rather than whatever minute the window happened to
	// open on.
	const offset = options.zoneOffsetMinutes * MINUTE;
	let cursor = Math.ceil((windowStart + offset) / step) * step - offset;

	const out: Slot[] = [];
	while (cursor + length <= windowEnd && out.length < options.limit) {
		const end = cursor + length;

		/**
		 * Both ends measured from the same local midnight, in minutes.
		 *
		 * Minutes, not hours: a 30 minute slot ending at 17:30 must fail a 17:00
		 * close and one ending exactly at 17:00 must pass it, and an hour
		 * comparison gets both of those the wrong way round. Counting the end
		 * from the start's midnight rather than its own is what keeps a slot
		 * from wrapping into tomorrow and reporting itself as early morning.
		 */
		const startClock = localClock(cursor, options.zoneOffsetMinutes);
		const endMinutes = startClock.minutes + options.minutes;

		if (
			startClock.minutes >= options.dayStartHour * 60 &&
			endMinutes <= options.dayEndHour * 60
		) {
			const blocked = walls.some((w) => cursor < w.end && end > w.start);
			if (!blocked) {
				out.push({ start: new Date(cursor).toISOString(), end: new Date(end).toISOString() });
				// Move past this suggestion rather than offering the same hour
				// four times over on a fifteen minute step.
				cursor += length;
				continue;
			}
		}

		cursor += step;
	}

	return out;
}
