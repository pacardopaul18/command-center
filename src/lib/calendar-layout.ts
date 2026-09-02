/**
 * Placing overlapping events side by side.
 *
 * Pure and separate from the component, because this is the part of a week view
 * that is worth proving and the part live data will not exercise: a real week
 * often has no overlaps at all, so the packing can be wrong for weeks and only
 * fail on the day two calls actually clash, which is the day it matters.
 *
 * A block drawn on top of another hides it, and a hidden meeting is worse than
 * no calendar: the reader believes the slot is free and books over it.
 */

export interface Span {
	/** Minutes past midnight, in the working zone. */
	top: number;
	end: number;
}

export interface Placed<T extends Span> {
	item: T;
	lane: number;
	lanes: number;
	widthPct: number;
	leftPct: number;
}

/**
 * Greedy lane packing, which is what every calendar does and what people expect.
 *
 * Each event takes the first lane whose previous occupant has finished. The
 * lane count is the width of the widest pile-up in the day, so three
 * simultaneous calls each get a third and none is hidden.
 *
 * Sorted by start, then by end, so the order is stable: two events starting at
 * the same minute must not swap places between renders.
 */
export function packLanes<T extends Span>(items: T[]): Placed<T>[] {
	const sorted = [...items].sort((a, b) => a.top - b.top || a.end - b.end);
	const laneEnds: number[] = [];

	const placed = sorted.map((item) => {
		// A zero-length or backwards event still has to be visible, so an end at
		// or before the start is treated as a short block rather than dropped.
		const end = item.end > item.top ? item.end : item.top + 30;

		let lane = laneEnds.findIndex((endsAt) => endsAt <= item.top);
		if (lane === -1) {
			lane = laneEnds.length;
			laneEnds.push(end);
		} else {
			laneEnds[lane] = end;
		}
		return { item, lane };
	});

	const lanes = Math.max(1, laneEnds.length);
	return placed.map((p) => ({
		...p,
		lanes,
		widthPct: 100 / lanes,
		leftPct: (100 / lanes) * p.lane
	}));
}
