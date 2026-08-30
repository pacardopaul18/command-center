import type { PageLoad } from './$types';

/**
 * The index carries whatever window is in the URL onto its links.
 *
 * A reader who set a range, went back to the index and picked a different
 * report should not have to set it again.
 */
export const load: PageLoad = ({ url }) => ({
	from: url.searchParams.get('from') ?? '',
	to: url.searchParams.get('to') ?? ''
});
