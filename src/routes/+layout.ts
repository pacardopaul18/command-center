import type { LayoutLoad } from './$types';
import { readSettings } from '$lib/settings';

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
	const [res, settingsRes] = await Promise.all([
		fetch('/api/health').catch(() => null),
		fetch('/api/settings').catch(() => null)
	]);
	const body = res ? await res.json().catch(() => null) : null;

	const today =
		body && typeof (body as { today?: unknown }).today === 'string'
			? (body as { today: string }).today
			: new Date().toISOString().slice(0, 10);

	// Surfaced so a screen can warn rather than just failing when the database is
	// behind the code. Absent on older responses, which reads as no drift.
	const schema = (body as { schema?: { drift: boolean; detail?: string } } | null)?.schema ?? null;

	/**
	 * Settings on the layout, because the shell reads them.
	 *
	 * Density, zebra rows, the workspace name and where the logo points all
	 * affect every page, and Quick add sits in the shell too. Loading them once
	 * here is one request per navigation rather than one per screen.
	 *
	 * A failure falls back to the defaults, which are exactly the behaviour the
	 * app had before settings existed. A settings store that is briefly
	 * unreachable must not change how anything looks.
	 */
	const settings = readSettings(
		settingsRes && settingsRes.ok
			? ((await settingsRes.json().catch(() => null)) as { settings?: unknown })?.settings
			: null
	);

	return { today, schemaDrift: schema?.drift ? schema : null, settings };
};
