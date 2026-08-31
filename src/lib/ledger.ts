/**
 * Month arithmetic for the ledger, shared by the loader and the page.
 *
 * In `$lib` rather than in `+page.ts` for the reason written down in
 * `$lib/meetings.ts`: a page component that imports a runtime value from its own
 * `+page.ts` cycles through SvelteKit's generated module and fails at load with
 * an internal error and no stack.
 *
 * All UTC. A month boundary computed on a browser's local clock puts the first
 * of the month in the previous one for anybody west of Greenwich, and the whole
 * page is then a month out with nothing on screen to show it.
 */

/** `YYYY-MM` for the month containing an instant. */
export function monthKey(d: Date): string {
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The first and last day of a `YYYY-MM`, as the window the routes take. */
export function monthWindow(month: string): { from: string; to: string } {
	const [year, mon] = month.split('-').map(Number);
	const first = new Date(Date.UTC(year, mon - 1, 1));
	// Day zero of the next month is the last day of this one, which is the
	// spelling that needs no leap-year special case.
	const last = new Date(Date.UTC(year, mon, 0));
	return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

export function previousMonth(month: string): string {
	const [year, mon] = month.split('-').map(Number);
	return monthKey(new Date(Date.UTC(year, mon - 2, 1)));
}

export function nextMonth(month: string): string {
	const [year, mon] = month.split('-').map(Number);
	return monthKey(new Date(Date.UTC(year, mon, 1)));
}

export function monthLabel(month: string): string {
	const [year, mon] = month.split('-').map(Number);
	return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString('en-US', {
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	});
}
