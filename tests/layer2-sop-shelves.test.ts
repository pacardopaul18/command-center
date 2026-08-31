import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Shelves, books, chapters, and where a page lives.
 *
 * Three properties are worth pinning, and none of them is the hierarchy itself.
 *
 * A page has exactly one home. A procedure appearing in two books is two
 * procedures that drift, so filing an already-filed page moves it rather than
 * adding a second placement.
 *
 * A page with no home is a real state, not a missing one. Every SOP was unfiled
 * until the shelves arrived, and one whose chapter is deleted goes back to
 * being unfiled rather than disappearing. A library that only showed filed
 * pages would have lost a hundred and eleven procedures on day one.
 *
 * The next review date is computed from the cycle, so changing a cycle moves
 * every book at once. Storing the date would need every row rewritten.
 *
 * All fixture content is invented.
 */

const BASE = 'http://localhost:5173';
const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const NOW = '2026-09-01T00:00:00Z';

const SHELF = 'sop-shelf-fix';

/**
 * A page this fixture borrows rather than creates.
 *
 * Creating one would mean creating a version for it, and D33's trigger makes a
 * version undeletable: the cleanup would fail, the row would outlive the run,
 * and layer 1 would go red on the next one. That is the trigger working, and
 * the right response is to stop creating pages in tests rather than to weaken
 * it.
 *
 * So the fixture borrows a seeded page that is currently unfiled and puts it
 * back that way. Placements are this migration's own table and are removable,
 * which is what makes borrowing reversible.
 */
let SOP = '';

function openDb(): DatabaseSync {
	const f = readdirSync(DIR).find((x) => x.endsWith('.sqlite') && x !== 'metadata.sqlite');
	if (!f) throw new Error('Local D1 not found.');
	return new DatabaseSync(join(DIR, f));
}

let db: DatabaseSync;
let bookId = '';
let chapterA = '';
let chapterB = '';

async function api(path: string, init?: RequestInit) {
	const res = await fetch(`${BASE}${path}`, init);
	const text = await res.text();
	let json: Record<string, unknown> | null = null;
	try {
		json = JSON.parse(text) as Record<string, unknown>;
	} catch {
		json = null;
	}
	return { res, json };
}

const send = (path: string, method: string, body: unknown) =>
	api(path, {
		method,
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});

function wipe() {
	// The borrowed page goes back to unfiled, which is how it was found. The
	// page itself is never touched.
	if (SOP) db.prepare('DELETE FROM sop_placements WHERE sop_id = ?').run(SOP);
	// Books and chapters cascade from the shelf.
	db.prepare('DELETE FROM sop_shelves WHERE id = ?').run(SHELF);
}

beforeAll(() => {
	db = openDb();

	/**
	 * An unfiled seeded page, and the fixture refuses to run without one.
	 *
	 * Falling back to creating a page would reintroduce the undeletable version
	 * this borrowing exists to avoid, so the absence is an error rather than a
	 * quiet second path.
	 */
	const borrowed = db
		.prepare(
			`SELECT s.id FROM sops s
       WHERE s.status = 'active' AND s.current_version_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM sop_placements p WHERE p.sop_id = s.id)
       LIMIT 1`
		)
		.get() as { id: string } | undefined;
	if (!borrowed) throw new Error('No unfiled seeded SOP to borrow. Reload the volume seed.');
	SOP = borrowed.id;

	wipe();

	db.prepare(
		`INSERT INTO sop_shelves (id, name, description, owner, position, created_at, updated_at)
     VALUES (?, 'SOP FIXTURE SHELF', NULL, 'FIXTURE OWNER', 99, ?, ?)`
	).run(SHELF, NOW, NOW);
});

afterAll(() => {
	wipe();
	db.close();
});

describe('the hierarchy', () => {
	it('a book is created on its shelf and inherits the owner until it has one', async () => {
		const made = await send(`/api/sops/shelves/${SHELF}/books`, 'POST', {
			title: 'SOP FIXTURE BOOK',
			review_cycle_days: 30
		});
		expect(made.res.status).toBe(201);
		bookId = (made.json?.book as { id: string }).id;

		const { json } = await api(`/api/sops/shelves/${SHELF}`);
		const book = (json?.books as { owner_shown: string }[])[0];
		// Computed by the read, not copied down: a copy would not follow the
		// shelf when the shelf's owner changed.
		expect(book.owner_shown).toBe('FIXTURE OWNER');
	});

	it('the next review is the cycle applied to the last reading', async () => {
		/**
		 * Backdated first, because a book created today and read through today
		 * has the same next review either way, and asserting it moved would be
		 * asserting something that cannot happen.
		 */
		db.prepare('UPDATE sop_books SET last_reviewed_at = ? WHERE id = ?').run(
			'2026-01-01T00:00:00Z',
			bookId
		);

		const before = await api(`/api/sops/shelves/${SHELF}`);
		const first = (before.json?.books as { id: string; next_review: string }[]).find(
			(b) => b.id === bookId
		)?.next_review;
		expect(first, 'a book with a cycle has no next review').toBe('2026-01-31');

		await send(`/api/sops/books/${bookId}/reviewed`, 'POST', {});

		const after = await api(`/api/sops/shelves/${SHELF}`);
		const second = (after.json?.books as { id: string; next_review: string }[]).find(
			(b) => b.id === bookId
		)?.next_review;
		expect(
			String(second) > String(first),
			'reading it through did not move the next review'
		).toBe(true);

		// Computed, not stored: changing the cycle moves it again with no rows
		// rewritten.
		db.prepare('UPDATE sop_books SET review_cycle_days = 90 WHERE id = ?').run(bookId);
		const widened = await api(`/api/sops/shelves/${SHELF}`);
		const third = (widened.json?.books as { id: string; next_review: string }[]).find(
			(b) => b.id === bookId
		)?.next_review;
		expect(String(third) > String(second), 'the cycle change did not move the date').toBe(true);
	});

	it('a book with no cycle has no next review, rather than an overdue one', async () => {
		// D27 in a small place: absence of a cycle must not read as a missed date.
		const made = await send(`/api/sops/shelves/${SHELF}/books`, 'POST', {
			title: 'SOP FIXTURE UNCYCLED'
		});
		expect(made.res.status).toBe(201);

		const { json } = await api(`/api/sops/shelves/${SHELF}`);
		const book = (json?.books as { title: string; next_review: string | null }[]).find(
			(b) => b.title === 'SOP FIXTURE UNCYCLED'
		);
		expect(book?.next_review ?? null).toBeNull();
	});

	it('a review cycle must be a whole number of days', async () => {
		const bad = await send(`/api/sops/shelves/${SHELF}/books`, 'POST', {
			title: 'SOP FIXTURE BAD',
			review_cycle_days: '2.5'
		});
		expect(bad.res.status).toBe(400);
	});

	it('two shelves cannot share a name, because a reader could not tell them apart', async () => {
		const clash = await send('/api/sops/shelves', 'POST', { name: 'SOP FIXTURE SHELF' });
		expect(clash.res.status).toBe(409);
	});

	it('chapters are appended in order', async () => {
		const a = await send(`/api/sops/books/${bookId}/chapters`, 'POST', { title: 'FIXTURE ONE' });
		const b = await send(`/api/sops/books/${bookId}/chapters`, 'POST', { title: 'FIXTURE TWO' });
		chapterA = (a.json?.chapter as { id: string }).id;
		chapterB = (b.json?.chapter as { id: string }).id;

		const { json } = await api(`/api/sops/books/${bookId}`);
		expect((json?.chapters as { title: string }[]).map((c) => c.title)).toEqual([
			'FIXTURE ONE',
			'FIXTURE TWO'
		]);
	});
});

describe('where a page lives', () => {
	it('starts nowhere, and says so rather than hiding', async () => {
		const { res, json } = await api(`/api/sops/${SOP}`);
		// The read has to have worked, or the null below is an error body.
		expect(res.ok, 'the page could not be read at all').toBe(true);
		expect(json?.placement ?? null).toBeNull();

		const unfiled = await api('/api/sops/unfiled');
		const ids = (unfiled.json?.pages as { id: string }[]).map((p) => p.id);
		expect(ids, 'an unfiled page was not listed anywhere').toContain(SOP);
	});

	it('filing it twice moves it rather than giving it two homes', async () => {
		await send(`/api/sops/${SOP}/placement`, 'PUT', { chapter_id: chapterA });
		await send(`/api/sops/${SOP}/placement`, 'PUT', { chapter_id: chapterB });

		const rows = db
			.prepare('SELECT chapter_id FROM sop_placements WHERE sop_id = ?')
			.all(SOP) as { chapter_id: string }[];
		expect(rows.length, 'the page is filed in two places').toBe(1);
		expect(rows[0].chapter_id).toBe(chapterB);
	});

	it('a filed page leaves the unfiled list and names where it is', async () => {
		const unfiled = await api('/api/sops/unfiled');
		const ids = (unfiled.json?.pages as { id: string }[]).map((p) => p.id);
		expect(ids).not.toContain(SOP);

		const { json } = await api(`/api/sops/${SOP}`);
		const placement = json?.placement as { chapter_title: string; shelf_name: string };
		expect(placement.chapter_title).toBe('FIXTURE TWO');
		expect(placement.shelf_name).toBe('SOP FIXTURE SHELF');
	});

	it('deleting a chapter unfiles its pages rather than deleting them', async () => {
		// The consequence of a side table, named rather than glossed: a placement
		// can go missing in a way a NOT NULL column cannot. The page survives.
		db.prepare('DELETE FROM sop_chapters WHERE id = ?').run(chapterB);

		const still = db.prepare('SELECT COUNT(*) AS n FROM sops WHERE id = ?').get(SOP) as {
			n: number;
		};
		expect(Number(still.n), 'deleting a chapter deleted the procedure').toBe(1);

		const unfiled = await api('/api/sops/unfiled');
		const ids = (unfiled.json?.pages as { id: string }[]).map((p) => p.id);
		expect(ids, 'the page vanished instead of going back to unfiled').toContain(SOP);
	});

	it('refuses a chapter that does not exist rather than filing into nothing', async () => {
		const { res } = await send(`/api/sops/${SOP}/placement`, 'PUT', {
			chapter_id: 'no-such-chapter'
		});
		expect(res.status).toBe(404);
	});
});

describe('what the module deliberately does not have', () => {
	it('no access or roles table, because there is nothing to enforce', () => {
		/**
		 * The prototype draws role-based access inherited from the shelf. This is
		 * a single-user app behind Cloudflare Access, so a roles table would
		 * enforce nothing and exist only to make the screen look like it did.
		 * D162. Asserted by name so adding one is a deliberate act with this
		 * comment in view.
		 */
		const migration = readFileSync('migrations/0030_sop_shelves.sql', 'utf8');
		for (const forbidden of ['sop_access', 'sop_roles', 'sop_permissions']) {
			expect(migration, `0030 creates ${forbidden}`).not.toContain(`CREATE TABLE ${forbidden}`);
		}
	});

	it('no activity table, because every edit is already a version', async () => {
		const migration = readFileSync('migrations/0030_sop_shelves.sql', 'utf8');
		expect(migration).not.toContain('CREATE TABLE sop_activity');

		// And the feature works anyway, joined out of the versions that exist.
		const { json } = await api(`/api/sops/books/${bookId}`);
		expect(Array.isArray(json?.activity), 'the book has no activity list').toBe(true);
	});
});
