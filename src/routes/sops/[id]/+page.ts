import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { Sop, SopVerification, SopVerificationTally, SopVersion } from '$lib/types';

/** History carries no bodies; exactly one body comes back, chosen by ?version. */
type VersionMeta = Omit<SopVersion, 'body'>;

/**
 * Where this page sits in the library, or null.
 *
 * Null is a real answer, not a missing one: every page was unfiled until the
 * shelves arrived, and one whose chapter was deleted goes back to being
 * unfiled rather than disappearing.
 */
export interface Placement {
	chapter_id: string;
	chapter_title: string;
	book_id: string;
	book_title: string;
	shelf_id: string;
	shelf_name: string;
}

/** A chapter to file into, flat, with its book and shelf named. */
export interface ChapterOption {
	id: string;
	title: string;
	book_id: string;
	book_title: string;
	shelf_id: string;
	shelf_name: string;
}

export const load: PageLoad = async ({ fetch, params, url }) => {
	const requested = url.searchParams.get('version');
	const query = requested ? `?version=${encodeURIComponent(requested)}` : '';

	const [res, chaptersRes] = await Promise.all([
		fetch(`/api/sops/${params.id}${query}`),
		fetch('/api/sops/chapters')
	]);

	if (res.status === 404) error(404, 'SOP not found.');
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the SOP.');
	}

	const data = (await res.json()) as {
		sop: Sop;
		versions: VersionMeta[];
		viewing: SopVersion;
		placement: Placement | null;
		verifications: SopVerification[];
		verification: SopVerificationTally;
	};

	// The picker is supporting detail: a failure reading it must not stop the
	// page rendering, so it degrades to a picker with nothing in it.
	const chapters = chaptersRes.ok
		? ((await chaptersRes.json()) as { chapters: ChapterOption[] }).chapters
		: [];

	return { ...data, chapters, isCurrent: data.viewing.id === data.sop.current_version_id };
};
