import type { PageLoad } from './$types';
import type { Sop } from '$lib/types';

/** A shelf, with what stands on it counted through the placements. */
export interface Shelf {
	id: string;
	name: string;
	description: string | null;
	owner: string | null;
	book_count: number;
	page_count: number;
}

export const load: PageLoad = async ({ fetch, url }) => {
	const q = url.searchParams.get('q') ?? '';
	const category = url.searchParams.get('category') ?? '';
	const status = url.searchParams.get('status') ?? 'active';

	const query = new URLSearchParams({ status });
	if (q) query.set('q', q);
	if (category) query.set('category', category);

	const [res, shelvesRes] = await Promise.all([
		fetch(`/api/sops?${query}`),
		fetch('/api/sops/shelves')
	]);

	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load SOPs.');
	}

	const data = (await res.json()) as {
		sops: Sop[];
		categories: { category: string; count: number }[];
		counts: { active: number; archived: number };
	};

	/**
	 * The shelves are the library's front door and the flat list is still behind
	 * it, because a hundred and eleven pages were filed under a category and
	 * nothing else until this migration. A failure reading the shelves must not
	 * take the list with it.
	 */
	const library = shelvesRes.ok
		? ((await shelvesRes.json()) as {
				shelves: Shelf[];
				unfiled: number;
				counts: { pages: number; archived: number; review_overdue: number };
			})
		: {
				shelves: [] as Shelf[],
				unfiled: 0,
				counts: { pages: 0, archived: 0, review_overdue: 0 }
			};

	/**
	 * `library` is kept as its own object rather than spread.
	 *
	 * Both responses carry a `counts`, and spreading the second over the first
	 * silently replaced the list's active and archived numbers with the
	 * library's page counts. The tabs then read a figure that was never about
	 * them, which type checking caught and a reader would not have.
	 */
	return { ...data, library, q, category, status };
};
