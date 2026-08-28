import type { LayoutLoad } from './$types';

/**
 * The working date, resolved once in Mountain Time by the server and shared with
 * every screen. Nothing in the UI computes "today" from the browser clock, so a
 * laptop in the wrong time zone can never disagree with the saved views.
 */
export const load: LayoutLoad = async ({ fetch }) => {
	const res = await fetch('/api/health');
	if (res.ok) {
		const body = (await res.json()) as { today: string };
		return { today: body.today };
	}
	return { today: new Date().toISOString().slice(0, 10) };
};
