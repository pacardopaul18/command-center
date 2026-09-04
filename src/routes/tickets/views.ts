/**
 * The views this page offers, shared by its loader and its markup.
 *
 * In their own module rather than in `+page.ts`, because a value exported from
 * a loader file is not importable from the component beside it, and duplicating
 * the list is how the tabs and the query drift apart.
 */
export const TICKET_VIEWS = ['overdue', 'due_today', 'open', 'all'] as const;
export type TicketView = (typeof TICKET_VIEWS)[number];
