import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { Book } from '../../shelves/[id]/+page';

export interface Chapter {
	id: string;
	book_id: string;
	title: string;
	position: number;
}

export interface BookPage {
	id: string;
	title: string;
	status: string;
	review_due: string | null;
	chapter_id: string;
	position: number;
	version_number: number | null;
	last_edited_at: string | null;
}

/**
 * One line of a book's history.
 *
 * Joined out of `sop_versions` rather than read from a table of its own. Every
 * edit already writes a version with an author and a change note, so a second
 * home for the same facts would drift the first time a version was written
 * without remembering to log it. D155.
 */
export interface BookActivity {
	id: string;
	version_number: number;
	change_note: string | null;
	created_at: string;
	sop_id: string;
	sop_title: string;
	author: string | null;
}

export const load: PageLoad = async ({ fetch, params }) => {
	const res = await fetch(`/api/sops/books/${params.id}`);
	if (res.status === 404) error(404, 'Book not found.');
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the book.');
	}
	return (await res.json()) as {
		book: Book & { shelf_id: string; shelf_name: string };
		chapters: Chapter[];
		pages: BookPage[];
		activity: BookActivity[];
	};
};
