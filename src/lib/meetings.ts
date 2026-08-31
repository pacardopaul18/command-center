/**
 * The four states a meeting record can be in, named once.
 *
 * Not a column, and it must not become one. A meeting is waiting for a
 * transcript, or waiting for Paul to read the summary, or done with, and all
 * three are a reading of `transcript_text` and `summary_reviewed_at`. Storing
 * the answer would put the truth in a third place that the other two can
 * contradict, which is the argument D144 makes about aging on an invoice.
 *
 * Here rather than in `+page.ts` because both the route and the page need it.
 * A page component that imports a runtime value from its own `+page.ts` sets up
 * a cycle through SvelteKit's generated module and fails at load with an
 * internal error and no stack, which cost an hour once.
 */
export const MEETING_VIEWS = ['all', 'needs_transcript', 'to_review', 'reviewed'] as const;

export type MeetingView = (typeof MEETING_VIEWS)[number];

export const MEETING_VIEW_LABELS: Record<MeetingView, string> = {
	all: 'All',
	needs_transcript: 'Needs transcript',
	to_review: 'To review',
	reviewed: 'Reviewed'
};

export interface MeetingCounts {
	all: number;
	needs_transcript: number;
	to_review: number;
	reviewed: number;
	this_week: number;
	today: number;
	items_from_meetings: number;
}

/**
 * One event on Coming up.
 *
 * `meeting_id` is the whole reason the two lists sit side by side: it says
 * which of these calls already has a record and which is still only an entry in
 * somebody's diary.
 */
export interface UpcomingEvent {
	id: string;
	summary: string | null;
	starts_at: string;
	ends_at: string | null;
	all_day: number;
	html_link: string | null;
	location: string | null;
	attendee_count: number | null;
	meeting_id: string | null;
	meeting_title: string | null;
	account_email: string | null;
	account_id: string;
}
