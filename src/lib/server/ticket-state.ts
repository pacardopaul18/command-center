/**
 * What "open" means for a ticket, written once.
 *
 * The literal `status NOT IN ('done','cancelled')` was spelled out in ten
 * places across five files. All ten happened to agree, which is luck rather
 * than a property: the tenth is written by copying the ninth, and the first one
 * somebody edits without finding the others is the day two screens start
 * reporting different numbers about the same rows.
 *
 * That is not hypothetical here. The Projects list showed a column headed
 * "Open" against open action items, immediately beside a column headed
 * "Tickets" against open tickets, and a project reading `0` and `2` was read as
 * "no open tickets, two tickets" when it meant "no open action items, two open
 * tickets". Both numbers were right and the screen was wrong.
 *
 * So: one definition, imported by everything that counts tickets, and a test
 * that fails if the literal reappears anywhere else.
 */

/** Statuses that mean the work is over, whichever way it ended. */
export const FINISHED_TICKET_STATUSES = ['done', 'cancelled'] as const;

/** SQL for a ticket that is still live. `alias` is the tickets table alias. */
export function openTicket(alias = 't'): string {
	return `${alias}.status NOT IN ('done','cancelled')`;
}

/** SQL for a ticket that is finished, either way. */
export function finishedTicket(alias = 't'): string {
	return `${alias}.status IN ('done','cancelled')`;
}

/**
 * SQL for a ticket that is late: still open and past its due date.
 *
 * Derived at read time against a bound date rather than stored, for the same
 * reason invoice aging is. A stored flag is a number maintained by hand that is
 * wrong from the first midnight nobody ran a job.
 *
 * The parameter is the caller's placeholder, because the callers bind their
 * dates at different positions.
 */
export function overdueTicket(alias = 't', datePlaceholder = '?1'): string {
	return `(${openTicket(alias)} AND ${alias}.due_date IS NOT NULL AND ${alias}.due_date < ${datePlaceholder})`;
}
