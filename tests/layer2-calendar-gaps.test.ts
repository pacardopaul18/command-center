import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	gapsAreMeaningful,
	readBusy,
	straddlesClockChange,
	zoneOffsetMinutes
} from '../src/lib/calendar-gaps';

const ROOT = process.cwd();

/**
 * Gaps from the mirror, and the three ways this feature could be quietly wrong.
 *
 * W3. It sits directly on the privacy rule, so the boundary is asserted rather
 * than assumed; it computes in a zone nobody in this project shares, so the
 * offset is derived rather than written; and its output is an invitation to
 * book something, so an empty window must say no-data and never all-free.
 */

describe('layer 2: the zone is computed, never written down', () => {
	/*
	 * The live hazard. Paul works US hours from GMT+8 against calendars in
	 * Mountain, so the one zone nobody can infer from where they are sitting is
	 * the one the answer depends on. A hardcoded offset is right for half the
	 * year and confidently wrong for the other half, and wrong here means a
	 * suggested time that somebody else has already filled.
	 */
	it('follows Mountain across the clock change', () => {
		// Mountain Daylight in September, Mountain Standard in January.
		expect(zoneOffsetMinutes('America/Denver', new Date('2026-09-03T18:00:00Z'))).toBe(-360);
		expect(zoneOffsetMinutes('America/Denver', new Date('2026-01-15T18:00:00Z'))).toBe(-420);
	});

	it('is right about the zone Paul is sitting in too', () => {
		// GMT+8, no daylight saving. Asserted so a future change to this helper
		// cannot pass by being right about one zone only.
		expect(zoneOffsetMinutes('Asia/Manila', new Date('2026-09-03T18:00:00Z'))).toBe(480);
		expect(zoneOffsetMinutes('Asia/Manila', new Date('2026-01-15T18:00:00Z'))).toBe(480);
		expect(zoneOffsetMinutes('UTC', new Date('2026-09-03T18:00:00Z'))).toBe(0);
	});

	it('notices a window that straddles the change rather than picking one side', () => {
		/*
		 * `findSlots` takes a single offset for the whole window, so a fortnight
		 * across the end of daylight saving applies the wrong hour to part of it.
		 * Detected and reported, because the alternative is a screen that is
		 * quietly an hour out for six of its fourteen days.
		 */
		expect(
			straddlesClockChange(
				'America/Denver',
				new Date('2026-10-25T18:00:00Z'),
				new Date('2026-11-08T18:00:00Z')
			)
		).toBe(true);
		expect(
			straddlesClockChange(
				'America/Denver',
				new Date('2026-09-03T18:00:00Z'),
				new Date('2026-09-17T18:00:00Z')
			)
		).toBe(false);
	});
});

describe('layer 2: what counts as busy, and what is set aside', () => {
	it('counts a timed event and reports the count', () => {
		const reading = readBusy([
			{ starts_at: '2026-09-04T15:00:00Z', ends_at: '2026-09-04T16:00:00Z', all_day: 0 },
			{ starts_at: '2026-09-04T17:00:00Z', ends_at: '2026-09-04T17:30:00Z', all_day: 0 }
		]);
		expect(reading.busy).toHaveLength(2);
		expect(reading.counted).toBe(2);
	});

	it('sets all-day entries aside, and names the days so the reader can check', () => {
		/*
		 * An all-day row is a marker far more often than a wall: a holiday, a
		 * launch date, a label on the week. Twenty-four hours of busy erases the
		 * day, and a gap finder returning nothing is indistinguishable from one
		 * that is broken. Some are real leave, though, so they are reported and
		 * not hidden. The reader decides; the tool does not guess and does not
		 * conceal the guess it declined to make. D220.
		 */
		const reading = readBusy([
			{ starts_at: '2026-09-04T00:00:00Z', ends_at: '2026-09-05T00:00:00Z', all_day: 1 },
			{ starts_at: '2026-09-07T00:00:00Z', ends_at: '2026-09-08T00:00:00Z', all_day: 1 },
			{ starts_at: '2026-09-04T15:00:00Z', ends_at: '2026-09-04T16:00:00Z', all_day: 0 }
		]);
		expect(reading.busy).toHaveLength(1);
		expect(reading.all_day_excluded).toBe(2);
		expect(reading.all_day_days).toEqual(['2026-09-04', '2026-09-07']);
	});

	it('sets aside a row it cannot reason about rather than inventing a duration', () => {
		// A start with no end is not a zero-length event and not an all-day one.
		const reading = readBusy([
			{ starts_at: '2026-09-04T15:00:00Z', ends_at: null, all_day: 0 },
			{ starts_at: '2026-09-04T15:00:00Z', ends_at: '2026-09-04T14:00:00Z', all_day: 0 },
			{ starts_at: 'not a date', ends_at: '2026-09-04T16:00:00Z', all_day: 0 }
		]);
		expect(reading.busy).toHaveLength(0);
		expect(reading.unbounded_excluded).toBe(3);
	});
});

describe('layer 2: an unloaded window is no-data, never all-free', () => {
	/*
	 * D214, and it applies harder here than anywhere else in the app, because
	 * the output of this screen is an invitation to book something. A calendar
	 * that returned no events because the sync is stale looks exactly like a
	 * genuinely clear fortnight, and answering "you are free all week" from the
	 * first is the most expensive way to be confidently wrong.
	 */
	it('refuses to answer from an empty window', () => {
		expect(gapsAreMeaningful(readBusy([]), 0)).toBe(false);
	});

	it('answers when the window holds events, even if none are busy', () => {
		// Five all-day rows and nothing timed is a real, loaded, wide-open week.
		const reading = readBusy([
			{ starts_at: '2026-09-04T00:00:00Z', ends_at: '2026-09-05T00:00:00Z', all_day: 1 }
		]);
		expect(gapsAreMeaningful(reading, 1)).toBe(true);
	});
});

describe('layer 2: the privacy rule does not move for this feature', () => {
	const route = readFileSync(join(ROOT, 'src', 'lib', 'server', 'api', 'connections.ts'), 'utf8');
	const gaps = route.slice(route.indexOf("connections.get('/google/calendar/gaps'"));

	it('reads nothing from an event but its interval', () => {
		/*
		 * A gap is start and end times. If this feature ever needs to know what a
		 * meeting is in order to place something around it, the answer is no and
		 * it does without. Six of the seven calendars store free and busy only,
		 * so most of these columns hold null anyway; selecting them would still
		 * be the wrong instruction to leave behind.
		 */
		for (const field of ['summary', 'description', 'location', 'organizer', 'html_link', 'conference_url', 'attendee']) {
			expect(gaps.includes(`e.${field}`), `the gap query reads e.${field}`).toBe(false);
		}
		expect(gaps).toMatch(/e\.starts_at, e\.ends_at, e\.all_day/);
	});

	it('states the zone in its answer, from the shared constant', () => {
		/*
		 * Returned, so the screen can say which clock the times are on rather
		 * than leaving the reader to assume theirs. Taken from the working-zone
		 * constant rather than written here, so this route cannot drift from the
		 * rest of the app about what Mountain means.
		 */
		expect(gaps).toMatch(/zone: WORKING_TIME_ZONE/);
		expect(gaps).toMatch(/zone_offset_minutes: offset/);
		expect(gaps, 'the offset must be computed, not a literal').not.toMatch(/zoneOffsetMinutes: -?\d+/);
	});

	it('carries freshness, because a gap is only as current as the mirror', () => {
		expect(gaps).toMatch(/freshness/);
		expect(gaps).toMatch(/age_minutes/);
	});
});
