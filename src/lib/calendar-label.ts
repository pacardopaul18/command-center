/**
 * What a calendar block is called on screen.
 *
 * One function, shared by every calendar view, because the interesting case is
 * the one that is easy to get wrong in only some of them.
 *
 * A block on a calendar Paul does not own carries no title, by rule: his
 * partners' meetings are their business and this app stores only when they are
 * busy. The screen must say that. Rendering "(no title)" would describe a
 * deliberate privacy boundary as a data failure, and somebody would eventually
 * go looking for the bug, find nothing, and either give up or "fix" it by
 * storing the titles.
 */

export interface LabelledEvent {
	summary?: string | null;
	/** 1 when the row is free/busy only, derived from the calendar's access role. */
	free_busy_only?: number | null;
	calendar_name?: string | null;
}

export function label(event: LabelledEvent): string {
	if (event.free_busy_only) {
		// Named after the calendar, so "whose busy is this" is answerable without
		// holding anything about what they are doing.
		return event.calendar_name ? `Busy · ${event.calendar_name}` : 'Busy';
	}

	// An owned event with no title is a real absence: Google let somebody save
	// it that way, and saying so is accurate.
	return event.summary?.trim() || '(no title)';
}

/**
 * What a calendar is, in one phrase, from the access role Google reports.
 *
 * W5a. The calendar page printed "yours" against every calendar in the list
 * with no ownership check at all. Six of the seven are read-only shares from
 * partners, so the one word on that screen naming the privacy boundary was
 * wrong about six of the seven rows it appeared on.
 *
 * `CalendarList.svelte` had it right all along, splitting on
 * `access_role === 'owner'`. The rule was applied in one place of two, which is
 * the D216 shape: a rule half applied looks broken wherever it was missed, and
 * here it looked like the opposite of broken, which is worse.
 *
 * The share also says what is stored, not only who owns it. A reader looking at
 * this line is the person who has to be able to tell Dustin what this app holds
 * about his diary, and "shared with you" alone does not answer that. D205.
 */
export function calendarOwnership(calendar: {
	access_role?: string | null;
	is_primary?: number | null;
}): string {
	// Absent means owner, the same default the sync and the event queries use, so
	// a calendar read before access roles were recorded does not silently become
	// somebody else's.
	const owned = (calendar.access_role ?? 'owner') === 'owner';
	if (owned) return calendar.is_primary ? 'yours, primary' : 'yours';
	return 'shared with you, busy times only';
}
