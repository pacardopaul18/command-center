import type { LayoutLoad } from './$types';

/**
 * The working date, resolved once in Mountain Time by the server and shared with
 * every screen. Nothing in the UI computes "today" from the browser clock, so a
 * laptop in the wrong time zone can never disagree with the saved views.
 *
 * Health returns 503 when the schema has drifted (D50), and the date in that
 * response is still correct. So this reads the body on any status and only falls
 * back to the browser clock if there is no usable date at all. Checking `ok`
 * here would have quietly swapped every screen onto the browser clock during a
 * drift, which is a second failure hiding behind the first.
 */
export const load: LayoutLoad = async ({ fetch }) => {
	const res = await fetch('/api/health').catch(() => null);
	const body = res ? await res.json().catch(() => null) : null;

	const today =
		body && typeof (body as { today?: unknown }).today === 'string'
			? (body as { today: string }).today
			: new Date().toISOString().slice(0, 10);

	// Surfaced so a screen can warn rather than just failing when the database is
	// behind the code. Absent on older responses, which reads as no drift.
	const schema = (body as { schema?: { drift: boolean; detail?: string } } | null)?.schema ?? null;

	return { today, schemaDrift: schema?.drift ? schema : null };
};
