import { describe, expect, it } from 'vitest';
import { packLanes } from '../src/lib/calendar-layout';

/**
 * Overlapping events sit side by side, never on top of each other.
 *
 * Tested as a pure function because live data will not exercise it: a real week
 * often has no overlaps at all, so the packing can be wrong for weeks and fail
 * only on the day two calls actually clash, which is the day it matters.
 *
 * A block drawn over another hides it, and a hidden meeting is worse than no
 * calendar: the reader believes the slot is free and books over it.
 */

const at = (top: number, end: number) => ({ top, end });

describe('layer 2: the week grid never hides a meeting behind another', () => {
	it('gives a lone event the full width', () => {
		const [only] = packLanes([at(540, 600)]);
		expect(only.lanes).toBe(1);
		expect(only.widthPct).toBe(100);
		expect(only.leftPct).toBe(0);
	});

	it('splits two overlapping events in half', () => {
		const packed = packLanes([at(540, 600), at(570, 630)]);
		expect(packed.map((p) => p.lane)).toEqual([0, 1]);
		expect(packed.every((p) => p.widthPct === 50)).toBe(true);
		expect(packed.map((p) => p.leftPct)).toEqual([0, 50]);
	});

	it('gives three simultaneous calls a third each', () => {
		const packed = packLanes([at(540, 600), at(540, 600), at(540, 600)]);
		expect(packed.every((p) => p.lanes === 3)).toBe(true);
		expect(new Set(packed.map((p) => p.lane)).size).toBe(3);
	});

	it('reuses a lane once its occupant has finished', () => {
		// Back to back is not an overlap. Two sequential calls both take the full
		// width, because splitting them would say they clash when they do not.
		const packed = packLanes([at(540, 600), at(600, 660)]);
		expect(packed.every((p) => p.lane === 0)).toBe(true);
		expect(packed.every((p) => p.widthPct === 100)).toBe(true);
	});

	it('widens only as far as the worst pile-up', () => {
		// Two at nine, one at noon. The noon call does not become a third of the
		// width because of something that happened three hours earlier.
		const packed = packLanes([at(540, 600), at(545, 605), at(720, 780)]);
		expect(packed.every((p) => p.lanes === 2)).toBe(true);
	});

	it('places a zero-length event rather than dropping it', () => {
		// Google allows an event with the same start and end. It is still on the
		// calendar and still has to be visible.
		const [only] = packLanes([at(540, 540)]);
		expect(only).toBeTruthy();
		expect(only.widthPct).toBe(100);
	});

	it('survives an event that ends before it starts', () => {
		const packed = packLanes([at(600, 540)]);
		expect(packed).toHaveLength(1);
	});

	it('is stable for two events starting at the same minute', () => {
		/*
		 * Two events at the same start must not swap places between renders. The
		 * sort breaks the tie on the end time, so the order is a property of the
		 * data rather than of the array it arrived in.
		 */
		const a = { top: 540, end: 600, id: 'a' };
		const b = { top: 540, end: 570, id: 'b' };
		const first = packLanes([a, b]).map((p) => (p.item as typeof a).id);
		const second = packLanes([b, a]).map((p) => (p.item as typeof a).id);
		expect(first).toEqual(second);
	});

	it('keeps every event it was given', () => {
		const input = [at(540, 600), at(545, 605), at(700, 760), at(540, 541)];
		expect(packLanes(input)).toHaveLength(input.length);
	});
});
