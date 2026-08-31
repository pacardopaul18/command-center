import { describe, expect, it } from 'vitest';
import { findSlots, mergeBusy, type Interval } from '../src/lib/free-slots';

/**
 * The interval arithmetic behind Find a time.
 *
 * Tested without a network, because none of this needs one and because the
 * failures here are the quiet kind: a suggestion that overlaps a meeting by one
 * minute, a gap invented between two back-to-back calls, a 4am slot offered
 * with a straight face. Every one of those looks like a working feature.
 */

const DAY = '2026-09-02';
const base = (h: number, m = 0) =>
	`${DAY}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;

/** UTC working hours, so the offset is out of the way except where it is the subject. */
const OPTIONS = {
	minutes: 30,
	from: base(0),
	to: `2026-09-03T00:00:00.000Z`,
	dayStartHour: 9,
	dayEndHour: 17,
	zoneOffsetMinutes: 0,
	limit: 50,
	granularity: 15
};

describe('busy blocks merge before anything is matched against them', () => {
	it('overlapping meetings become one wall', () => {
		const merged = mergeBusy([
			{ start: base(9), end: base(11) },
			{ start: base(10), end: base(12) }
		]);
		expect(merged).toEqual([{ start: base(9), end: base(12) }]);
	});

	it('back to back meetings leave no gap between them', () => {
		// The defect this pins: a zero-length hole at 10:00 that a naive scan
		// reports as free, and a 30 minute meeting booked into no time at all.
		const merged = mergeBusy([
			{ start: base(9), end: base(10) },
			{ start: base(10), end: base(11) }
		]);
		expect(merged).toEqual([{ start: base(9), end: base(11) }]);
	});

	it('a block with no duration is not a block', () => {
		expect(mergeBusy([{ start: base(9), end: base(9) }])).toEqual([]);
	});

	it('unsorted input merges the same as sorted input', () => {
		const blocks: Interval[] = [
			{ start: base(14), end: base(15) },
			{ start: base(9), end: base(10) },
			{ start: base(9, 30), end: base(11) }
		];
		expect(mergeBusy(blocks)).toEqual([
			{ start: base(9), end: base(11) },
			{ start: base(14), end: base(15) }
		]);
	});
});

describe('a suggested slot is one a person would accept', () => {
	it('never overlaps a busy block, not even by a minute', () => {
		const busy = [{ start: base(9, 15), end: base(10, 45) }];
		const slots = findSlots(busy, OPTIONS);
		for (const slot of slots) {
			const s = new Date(slot.start).getTime();
			const e = new Date(slot.end).getTime();
			const overlap = s < new Date(busy[0].end).getTime() && e > new Date(busy[0].start).getTime();
			expect(overlap, `${slot.start} runs into a meeting`).toBe(false);
		}
	});

	it('a slot may touch the end of a meeting, because that is free', () => {
		const slots = findSlots([{ start: base(9), end: base(10) }], OPTIONS);
		expect(slots[0].start, 'the first free half hour after a 10:00 finish was skipped').toBe(
			base(10)
		);
	});

	it('stays inside working hours at both ends', () => {
		const slots = findSlots([], OPTIONS);
		expect(slots[0].start).toBe(base(9));
		const last = slots[slots.length - 1];
		expect(
			new Date(last.end).getTime(),
			'a slot ran past the end of the working day'
		).toBeLessThanOrEqual(new Date(base(17)).getTime());
	});

	it('a half hour ending exactly at the close is offered', () => {
		// The hour-comparison bug in both directions: 16:30 to 17:00 is inside a
		// 17:00 close and must be offered.
		const slots = findSlots([], OPTIONS);
		expect(slots.some((s) => s.end === base(17))).toBe(true);
	});

	it('never starts on a minute nobody would propose', () => {
		const slots = findSlots([{ start: base(9), end: base(9, 7) }], OPTIONS);
		for (const slot of slots) {
			expect(new Date(slot.start).getUTCMinutes() % 15, `${slot.start} is a ragged start`).toBe(0);
		}
	});

	it('does not offer the same hour four times over', () => {
		const slots = findSlots([], OPTIONS);
		const starts = new Set(slots.map((s) => s.start));
		expect(starts.size).toBe(slots.length);
		// 9 to 17 in half hours is sixteen, and a 15 minute step must not turn
		// that into thirty-one overlapping suggestions.
		expect(slots.length).toBe(16);
	});

	it('applies working hours on the working clock, not on UTC', () => {
		// Mountain time in September is UTC-6. 9am there is 15:00Z, and a window
		// scanned in UTC would answer 9:00Z, which is 3am to the reader.
		const slots = findSlots([], { ...OPTIONS, zoneOffsetMinutes: -360 });
		expect(slots[0].start).toBe(base(15));
	});

	it('returns nothing rather than something wrong when the day is full', () => {
		const slots = findSlots([{ start: base(0), end: `2026-09-03T00:00:00.000Z` }], OPTIONS);
		expect(slots).toEqual([]);
	});

	it('honours the limit, because a list of two hundred slots is not an answer', () => {
		expect(findSlots([], { ...OPTIONS, limit: 4 })).toHaveLength(4);
	});

	it('a meeting longer than the working day has no slot', () => {
		expect(findSlots([], { ...OPTIONS, minutes: 600 })).toEqual([]);
	});
});
