import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export interface Shelf {
	id: string;
	name: string;
	description: string | null;
	owner: string | null;
	book_count: number;
	page_count: number;
}

/**
 * One book on a shelf.
 *
 * `owner_shown` is the book's own owner falling back to the shelf's, computed
 * by the read rather than copied down at creation: a copy would not follow the
 * shelf when it changed. `next_review` is the cycle applied to the last
 * reading, for the same reason.
 */
export interface Book {
	id: string;
	shelf_id: string;
	title: string;
	description: string | null;
	owner_shown: string | null;
	review_cycle_days: number | null;
	last_reviewed_at: string | null;
	next_review: string | null;
	status: 'draft' | 'published' | 'archived';
	chapter_count: number;
	page_count: number;
	last_edited_at: string | null;
}

export const load: PageLoad = async ({ fetch, params }) => {
	const res = await fetch(`/api/sops/shelves/${params.id}`);
	if (res.status === 404) error(404, 'Shelf not found.');
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the shelf.');
	}
	return (await res.json()) as { shelf: Shelf; books: Book[] };
};
