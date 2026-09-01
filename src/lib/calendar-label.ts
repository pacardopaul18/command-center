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
