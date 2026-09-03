import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ApiEnv } from './env';
import { nowUtc, todayInWorkingZone } from '../dates';
import {
	ApiError,
	oneOf,
	optionalDate,
	optionalText,
	readJsonObject,
	requiredText
} from './validate';
import { SOP_STATUSES } from '$lib/types';
import type { SopStatus } from '$lib/types';
import { readRichField } from '../rich-field';

/**
 * SOP library with version history.
 *
 * Three rulings govern this module and are enforced by triggers in migration
 * 0002, not merely by the code here. See D32, D33 and D34.
 *
 *   D32 versions are immutable and undeletable
 *   D33 SOPs archive, never delete. There is deliberately no DELETE route
 *   D34 current_version_id moves forward only. Restore writes a new version
 *
 * The code still validates all three, so a caller gets a clear 400 rather than a
 * raw SQLITE_CONSTRAINT. The triggers are the backstop, not the error message.
 */

const LIST_SELECT = `
  SELECT s.*,
    v.version_number AS current_version_number,
    v.created_at     AS current_version_created_at,
    v.change_note    AS current_change_note,
    (SELECT COUNT(*) FROM sop_versions WHERE sop_id = s.id) AS version_count
  FROM sops s
  LEFT JOIN sop_versions v ON v.id = s.current_version_id
`;

export const sops = new Hono<ApiEnv>();

/** Defaults to active only, so archiving genuinely drops a SOP from the list. */
sops.get('/', async (c) => {
	const rawStatus = c.req.query('status') ?? 'active';
	const status = rawStatus === 'all' ? null : oneOf<SopStatus>(rawStatus, SOP_STATUSES, 'status', 'active');

	const where: string[] = [];
	const binds: unknown[] = [];

	if (status) {
		where.push('s.status = ?');
		binds.push(status);
	}

	const category = c.req.query('category')?.trim();
	if (category) {
		where.push('s.category = ?');
		binds.push(category);
	}

	// Search covers the title, the category and the current version's body, so
	// looking for a step inside an SOP finds the SOP.
	const q = c.req.query('q')?.trim();
	if (q) {
		where.push('(s.title LIKE ? OR s.category LIKE ? OR v.body LIKE ?)');
		const like = `%${q}%`;
		binds.push(like, like, like);
	}

	const { results } = await c.env.DB.prepare(
		`${LIST_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY s.status ASC, s.category COLLATE NOCASE, s.title COLLATE NOCASE`
	)
		.bind(...binds)
		.all();

	const categories = await c.env.DB.prepare(
		`SELECT category, COUNT(*) AS count
     FROM sops
     WHERE category IS NOT NULL AND status = 'active'
     GROUP BY category
     ORDER BY category COLLATE NOCASE`
	).all();

	const counts = await c.env.DB.prepare(
		`SELECT
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived
     FROM sops`
	).first<Record<string, number | null>>();

	return c.json({
		sops: results ?? [],
		categories: categories.results ?? [],
		counts: { active: counts?.active ?? 0, archived: counts?.archived ?? 0 }
	});
});

/* -------------------------------------------------------------------------
 * Shelves, books and chapters
 * ---------------------------------------------------------------------- */

/**
 * When a book is next due to be reread.
 *
 * Computed from the cycle and the last reading rather than stored, so changing
 * a cycle from quarterly to monthly moves every book at once instead of needing
 * every row rewritten. A book with no cycle has no next date, which is a real
 * answer and not a missing one.
 */
const BOOK_NEXT_REVIEW = `
  CASE
    WHEN b.review_cycle_days IS NULL THEN NULL
    ELSE DATE(COALESCE(b.last_reviewed_at, b.created_at), '+' || b.review_cycle_days || ' days')
  END
`;

/**
 * The whole shelf list, with what is on each one counted.
 *
 * Counted through the placements, so a page whose chapter was deleted does not
 * inflate a shelf it no longer belongs to. Books and pages are separate
 * subqueries rather than one join, because a join to chapters multiplies the
 * book row per chapter and the book count then reads plausibly and is wrong.
 */
sops.get('/shelves', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT sh.*,
        (SELECT COUNT(*) FROM sop_books b WHERE b.shelf_id = sh.id) AS book_count,
        (SELECT COUNT(*) FROM sop_placements p
         JOIN sop_chapters ch ON ch.id = p.chapter_id
         JOIN sop_books b ON b.id = ch.book_id
         WHERE b.shelf_id = sh.id) AS page_count
     FROM sop_shelves sh
     ORDER BY sh.position, sh.name COLLATE NOCASE`
	).all();

	/**
	 * Pages with nowhere to live, counted once for the whole library.
	 *
	 * Every existing SOP is one of these until somebody files it, and a library
	 * that simply did not show them would have lost a hundred and twenty
	 * procedures on the day the shelves arrived.
	 */
	const unfiled = await c.env.DB.prepare(
		`SELECT COUNT(*) AS n FROM sops s
     WHERE s.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM sop_placements p WHERE p.sop_id = s.id)`
	).first<{ n: number }>();

	const counts = await c.env.DB.prepare(
		`SELECT
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS pages,
       SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived
     FROM sops`
	).first<Record<string, number | null>>();

	const overdue = await c.env.DB.prepare(
		`SELECT COUNT(*) AS n FROM sops
     WHERE status = 'active' AND review_due IS NOT NULL AND review_due < ?`
	)
		.bind(todayInWorkingZone())
		.first<{ n: number }>();

	return c.json({
		shelves: results ?? [],
		unfiled: Number(unfiled?.n ?? 0),
		counts: {
			pages: counts?.pages ?? 0,
			archived: counts?.archived ?? 0,
			review_overdue: Number(overdue?.n ?? 0)
		}
	});
});

sops.post('/shelves', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const now = nowUtc();
	const id = crypto.randomUUID();

	const last = await c.env.DB.prepare('SELECT MAX(position) AS n FROM sop_shelves').first<{
		n: number | null;
	}>();

	try {
		await c.env.DB.prepare(
			`INSERT INTO sop_shelves (id, name, description, owner, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
			.bind(
				id,
				requiredText(body.name, 'Name', 120),
				optionalText(body.description, 'Description', 500),
				optionalText(body.owner, 'Owner', 120),
				Number(last?.n ?? 0) + 1,
				now,
				now
			)
			.run();
	} catch (err) {
		// Two shelves called Finance is a filing error, not a situation to
		// support: a reader would have no way to know which one to open.
		if (String(err).includes('UNIQUE')) {
			throw new ApiError(409, 'There is already a shelf with that name.');
		}
		throw err;
	}

	const created = await c.env.DB.prepare('SELECT * FROM sop_shelves WHERE id = ?')
		.bind(id)
		.first();
	return c.json({ shelf: created }, 201);
});

/** One shelf, its books, and when each is next due to be read. */
sops.get('/shelves/:id', async (c) => {
	const id = c.req.param('id');

	const shelf = await c.env.DB.prepare('SELECT * FROM sop_shelves WHERE id = ?')
		.bind(id)
		.first();
	if (!shelf) throw new ApiError(404, 'Shelf not found.');

	const { results } = await c.env.DB.prepare(
		`SELECT b.*,
        COALESCE(b.owner, sh.owner) AS owner_shown,
        ${BOOK_NEXT_REVIEW} AS next_review,
        (SELECT COUNT(*) FROM sop_chapters ch WHERE ch.book_id = b.id) AS chapter_count,
        (SELECT COUNT(*) FROM sop_placements p
         JOIN sop_chapters ch ON ch.id = p.chapter_id
         WHERE ch.book_id = b.id) AS page_count,
        (SELECT MAX(v.created_at) FROM sop_versions v
         JOIN sop_placements p ON p.sop_id = v.sop_id
         JOIN sop_chapters ch ON ch.id = p.chapter_id
         WHERE ch.book_id = b.id) AS last_edited_at
     FROM sop_books b
     JOIN sop_shelves sh ON sh.id = b.shelf_id
     WHERE b.shelf_id = ?
     ORDER BY b.position, b.title COLLATE NOCASE`
	)
		.bind(id)
		.all();

	return c.json({ shelf, books: results ?? [] });
});

sops.post('/shelves/:id/books', async (c) => {
	const db = c.env.DB;
	const shelfId = c.req.param('id');
	const shelf = await db.prepare('SELECT id FROM sop_shelves WHERE id = ?').bind(shelfId).first();
	if (!shelf) throw new ApiError(404, 'Shelf not found.');

	const body = await readJsonObject(c.req.raw);
	const now = nowUtc();
	const id = crypto.randomUUID();

	const last = await db
		.prepare('SELECT MAX(position) AS n FROM sop_books WHERE shelf_id = ?')
		.bind(shelfId)
		.first<{ n: number | null }>();

	const cycle = body.review_cycle_days;
	const cycleDays =
		cycle === undefined || cycle === null || cycle === '' ? null : Number(cycle);
	if (cycleDays !== null && (!Number.isInteger(cycleDays) || cycleDays <= 0)) {
		throw new ApiError(400, 'A review cycle is a whole number of days.');
	}

	await db
		.prepare(
			`INSERT INTO sop_books
       (id, shelf_id, title, description, owner, review_cycle_days, last_reviewed_at,
        status, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`
		)
		.bind(
			id,
			shelfId,
			requiredText(body.title, 'Title', 200),
			optionalText(body.description, 'Description', 500),
			optionalText(body.owner, 'Owner', 120),
			cycleDays,
			oneOf<'draft' | 'published' | 'archived'>(
				body.status,
				['draft', 'published', 'archived'],
				'status',
				'draft'
			),
			Number(last?.n ?? 0) + 1,
			now,
			now
		)
		.run();

	const created = await db.prepare('SELECT * FROM sop_books WHERE id = ?').bind(id).first();
	return c.json({ book: created }, 201);
});

/**
 * One book: its chapters, the pages in each, and what has happened to them.
 *
 * The activity is a join over `sop_versions` rather than a table of its own.
 * Every edit already writes a version with an author and a change note, so a
 * second home for the same facts would drift the first time a version was
 * written without remembering to log it. D155 in a second module.
 */
sops.get('/books/:id', async (c) => {
	const db = c.env.DB;
	const id = c.req.param('id');

	const book = await db
		.prepare(
			`SELECT b.*, sh.id AS shelf_id, sh.name AS shelf_name,
          COALESCE(b.owner, sh.owner) AS owner_shown,
          ${BOOK_NEXT_REVIEW} AS next_review
       FROM sop_books b JOIN sop_shelves sh ON sh.id = b.shelf_id
       WHERE b.id = ?`
		)
		.bind(id)
		.first();
	if (!book) throw new ApiError(404, 'Book not found.');

	const chapters = await db
		.prepare('SELECT * FROM sop_chapters WHERE book_id = ? ORDER BY position, title')
		.bind(id)
		.all();

	const pages = await db
		.prepare(
			`SELECT s.id, s.title, s.status, s.review_due, p.chapter_id, p.position,
          v.version_number, v.created_at AS last_edited_at
       FROM sop_placements p
       JOIN sops s ON s.id = p.sop_id
       JOIN sop_chapters ch ON ch.id = p.chapter_id
       LEFT JOIN sop_versions v ON v.id = s.current_version_id
       WHERE ch.book_id = ?
       ORDER BY p.position, s.title COLLATE NOCASE`
		)
		.bind(id)
		.all();

	const activity = await db
		.prepare(
			`SELECT v.id, v.version_number, v.change_note, v.created_at,
          s.id AS sop_id, s.title AS sop_title, u.display_name AS author
       FROM sop_versions v
       JOIN sop_placements p ON p.sop_id = v.sop_id
       JOIN sop_chapters ch ON ch.id = p.chapter_id
       JOIN sops s ON s.id = v.sop_id
       LEFT JOIN users u ON u.id = v.author_id
       WHERE ch.book_id = ?
       ORDER BY v.created_at DESC
       LIMIT 30`
		)
		.bind(id)
		.all();

	return c.json({
		book,
		chapters: chapters.results ?? [],
		pages: pages.results ?? [],
		activity: activity.results ?? []
	});
});

sops.post('/books/:id/chapters', async (c) => {
	const db = c.env.DB;
	const bookId = c.req.param('id');
	const book = await db.prepare('SELECT id FROM sop_books WHERE id = ?').bind(bookId).first();
	if (!book) throw new ApiError(404, 'Book not found.');

	const body = await readJsonObject(c.req.raw);
	const now = nowUtc();
	const id = crypto.randomUUID();

	const last = await db
		.prepare('SELECT MAX(position) AS n FROM sop_chapters WHERE book_id = ?')
		.bind(bookId)
		.first<{ n: number | null }>();

	await db
		.prepare(
			`INSERT INTO sop_chapters (id, book_id, title, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
		)
		.bind(id, bookId, requiredText(body.title, 'Title', 200), Number(last?.n ?? 0) + 1, now, now)
		.run();

	const created = await db.prepare('SELECT * FROM sop_chapters WHERE id = ?').bind(id).first();
	return c.json({ chapter: created }, 201);
});

/**
 * Marks a book as read through, which is what a review is.
 *
 * Sets the date it happened; the next date follows from the cycle. Setting the
 * next date directly would have to be redone every time the cycle changed.
 */
sops.post('/books/:id/reviewed', async (c) => {
	const result = await c.env.DB.prepare(
		'UPDATE sop_books SET last_reviewed_at = ?, updated_at = ? WHERE id = ?'
	)
		.bind(nowUtc(), nowUtc(), c.req.param('id'))
		.run();
	if (!result.meta.changes) throw new ApiError(404, 'Book not found.');
	return c.json({ ok: true });
});

/* -------------------------------------------------------------------------
 * Where a page lives
 * ---------------------------------------------------------------------- */

/**
 * Files a page into a chapter, or moves it.
 *
 * One placement per page, enforced by the unique index and expressed here as an
 * upsert: filing a page that is already filed moves it rather than failing. A
 * procedure that appeared in two books would be two procedures that drift.
 */
sops.put('/:id/placement', async (c) => {
	const db = c.env.DB;
	const sopId = c.req.param('id');

	const sop = await db.prepare('SELECT id FROM sops WHERE id = ?').bind(sopId).first();
	if (!sop) throw new ApiError(404, 'SOP not found.');

	const body = await readJsonObject(c.req.raw);
	const chapterId = requiredText(body.chapter_id, 'chapter_id', 64);

	const chapter = await db
		.prepare('SELECT id FROM sop_chapters WHERE id = ?')
		.bind(chapterId)
		.first();
	if (!chapter) throw new ApiError(404, 'No chapter with that id.');

	const last = await db
		.prepare('SELECT MAX(position) AS n FROM sop_placements WHERE chapter_id = ?')
		.bind(chapterId)
		.first<{ n: number | null }>();

	await db
		.prepare(
			`INSERT INTO sop_placements (id, sop_id, chapter_id, position, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (sop_id) DO UPDATE SET chapter_id = ?3, position = ?4`
		)
		.bind(crypto.randomUUID(), sopId, chapterId, Number(last?.n ?? 0) + 1, nowUtc())
		.run();

	return c.json({ ok: true });
});

sops.delete('/:id/placement', async (c) => {
	const result = await c.env.DB.prepare('DELETE FROM sop_placements WHERE sop_id = ?')
		.bind(c.req.param('id'))
		.run();
	if (!result.meta.changes) throw new ApiError(404, 'That page is not filed anywhere.');
	return c.json({ ok: true });
});

/**
 * Every chapter in the library, for the picker that files a page.
 *
 * Flat, with the shelf and book names alongside, because a three-level cascade
 * of selects to choose one chapter is three decisions where the reader has one.
 */
sops.get('/chapters', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT ch.id, ch.title, b.id AS book_id, b.title AS book_title,
        sh.id AS shelf_id, sh.name AS shelf_name
     FROM sop_chapters ch
     JOIN sop_books b ON b.id = ch.book_id
     JOIN sop_shelves sh ON sh.id = b.shelf_id
     ORDER BY sh.position, b.position, ch.position`
	).all();
	return c.json({ chapters: results ?? [] });
});

/** Pages with no chapter, which is every page until somebody files it. */
sops.get('/unfiled', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT s.id, s.title, s.category, s.status, s.review_due
     FROM sops s
     WHERE s.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM sop_placements p WHERE p.sop_id = s.id)
     ORDER BY s.category COLLATE NOCASE, s.title COLLATE NOCASE
     LIMIT 200`
	).all();
	return c.json({ pages: results ?? [] });
});

/**
 * A SOP, its history, and exactly one body.
 *
 * The history panel needs version numbers, dates and change notes, not bodies.
 * Returning every body would ship the SOP's entire revision history to the
 * browser on every page load, which for a long procedure is most of the payload
 * and none of the value. `?version=N` selects which single body comes back;
 * without it, the current one does.
 */
sops.get('/:id', async (c) => {
	const id = c.req.param('id');

	const sop = await c.env.DB.prepare(`${LIST_SELECT} WHERE s.id = ?`)
		.bind(id)
		.first<{ current_version_id: string | null }>();
	if (!sop) throw new ApiError(404, 'SOP not found.');

	const { results } = await c.env.DB.prepare(
		`SELECT id, sop_id, version_number, change_note, author_id, created_at
     FROM sop_versions WHERE sop_id = ? ORDER BY version_number DESC`
	)
		.bind(id)
		.all();

	const requested = c.req.query('version');
	const viewing = requested
		? await c.env.DB.prepare(
				'SELECT * FROM sop_versions WHERE sop_id = ? AND version_number = ?'
			)
				.bind(id, Number(requested))
				.first()
		: await c.env.DB.prepare('SELECT * FROM sop_versions WHERE id = ?')
				.bind(sop.current_version_id)
				.first();

	if (!viewing) throw new ApiError(404, 'Version not found for this SOP.');

	/**
	 * Where this page lives, when it lives anywhere.
	 *
	 * Null is a real answer, not a missing one: every page was unfiled until the
	 * shelves arrived, and a page whose chapter was deleted goes back to being
	 * unfiled rather than disappearing.
	 */
	const placement = await c.env.DB.prepare(
		`SELECT p.chapter_id, ch.title AS chapter_title, b.id AS book_id, b.title AS book_title,
        sh.id AS shelf_id, sh.name AS shelf_name
     FROM sop_placements p
     JOIN sop_chapters ch ON ch.id = p.chapter_id
     JOIN sop_books b ON b.id = ch.book_id
     JOIN sop_shelves sh ON sh.id = b.shelf_id
     WHERE p.sop_id = ?`
	)
		.bind(id)
		.first();

	/**
	 * The verification log, and what it says about the fault rate.
	 *
	 * Both are read here rather than behind a second request, because a
	 * procedure's compliance record is part of reading the procedure: a SOP
	 * nobody has verified in a month is a different thing from one verified
	 * yesterday, and the page should not need to be asked twice to say so.
	 */
	const verifications = await c.env.DB.prepare(
		`SELECT id, sop_id, step_number, subject, verified_by, verified_at, outcome, note, created_at
     FROM sop_verifications WHERE sop_id = ?
     ORDER BY verified_at DESC, created_at DESC
     LIMIT 200`
	)
		.bind(id)
		.all();

	const tally = await c.env.DB.prepare(
		`SELECT COUNT(*) AS total,
            SUM(CASE WHEN outcome = 'fault' THEN 1 ELSE 0 END) AS faults,
            MAX(verified_at) AS last_verified_at
     FROM sop_verifications WHERE sop_id = ?`
	)
		.bind(id)
		.first<{ total: number; faults: number | null; last_verified_at: string | null }>();

	const total = Number(tally?.total ?? 0);
	const faults = Number(tally?.faults ?? 0);

	return c.json({
		sop,
		versions: results ?? [],
		viewing,
		placement,
		verifications: verifications.results ?? [],
		verification: {
			total,
			faults,
			passes: total - faults,
			/*
			 * Null rather than zero when nothing has been logged. A rate of 0%
			 * reads as "this never fails", and "nobody has checked" is the
			 * opposite claim. D220.
			 */
			fault_rate: total > 0 ? faults / total : null,
			last_verified_at: tally?.last_verified_at ?? null
		}
	});
});

/**
 * Records that somebody checked, and what they found.
 *
 * Append only. There is no route to edit or delete an entry, for the same
 * reason a SOP version cannot be rewritten: a compliance log that can be
 * tidied up afterwards is not evidence of anything. A mistaken entry is
 * corrected by logging the correct one, which leaves both visible.
 */
sops.post('/:id/verifications', async (c) => {
	const sopId = c.req.param('id');
	const body = await readJsonObject(c.req.raw);

	const sop = await c.env.DB.prepare('SELECT id FROM sops WHERE id = ?').bind(sopId).first();
	if (!sop) throw new ApiError(404, 'SOP not found.');

	const outcome = oneOf<'pass' | 'fault'>(body.outcome, ['pass', 'fault'], 'outcome', 'pass');
	const note = optionalText(body.note, 'Note', 2000);
	// The database enforces this too. Checked here so the reader gets a sentence
	// rather than a constraint failure.
	if (outcome === 'fault' && !note) {
		throw new ApiError(400, 'A fault needs a note saying what went wrong.');
	}

	let stepNumber: number | null = null;
	if (body.step_number !== null && body.step_number !== undefined && body.step_number !== '') {
		const n = Number(body.step_number);
		if (!Number.isInteger(n) || n < 1) {
			throw new ApiError(400, 'The step must be a whole number, or empty for the whole procedure.');
		}
		stepNumber = n;
	}

	const id = crypto.randomUUID();
	const now = nowUtc();

	await c.env.DB.prepare(
		`INSERT INTO sop_verifications
       (id, sop_id, step_number, subject, verified_by, verified_at, outcome, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	)
		.bind(
			id,
			sopId,
			stepNumber,
			requiredText(body.subject, 'What was verified', 300),
			requiredText(body.verified_by, 'Who verified it', 120),
			optionalDate(body.verified_at, 'Verified on') ?? todayInWorkingZone(),
			outcome,
			note,
			now
		)
		.run();

	const created = await c.env.DB.prepare('SELECT * FROM sop_verifications WHERE id = ?')
		.bind(id)
		.first();
	return c.json({ verification: created }, 201);
});

/**
 * Authoring a SOP writes the record and version 1 together. current_version_id
 * is null for the instant between the two statements, which is why the whole
 * thing goes through a batch: a SOP with no current version is a half-written
 * record, never a valid state at rest.
 */
sops.post('/', async (c) => {
	const body = await readJsonObject(c.req.raw);
	const now = nowUtc();
	const sopId = crypto.randomUUID();
	const versionId = crypto.randomUUID();

	const title = requiredText(body.title, 'Title', 300);
	const versionBody = readRichField(body, 'body', 'Body');
	if (!versionBody.plain) throw new ApiError(400, 'Body is required.');
	const category = optionalText(body.category, 'Category', 120);
	const reviewDue = optionalDate(body.review_due, 'Review due');
	const ownerId = optionalText(body.owner_id, 'owner_id', 64);
	const changeNote = optionalText(body.change_note, 'Change note', 500) ?? 'Initial version';

	await c.env.DB.batch([
		c.env.DB.prepare(
			`INSERT INTO sops (id, title, category, current_version_id, owner_id, review_due, status, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, 'active', ?, ?)`
		).bind(sopId, title, category, ownerId, reviewDue, now, now),
		c.env.DB.prepare(
			`INSERT INTO sop_versions
         (id, sop_id, version_number, body, body_html, change_note, author_id, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?)`
		).bind(versionId, sopId, versionBody.plain, versionBody.html, changeNote, ownerId, now),
		c.env.DB.prepare('UPDATE sops SET current_version_id = ? WHERE id = ?').bind(versionId, sopId)
	]);

	const created = await c.env.DB.prepare(`${LIST_SELECT} WHERE s.id = ?`).bind(sopId).first();
	return c.json({ sop: created }, 201);
});

/**
 * Metadata only. The body is never edited here, because editing a body means
 * writing a new version. That is the whole point of the module.
 */
const UPDATABLE = ['title', 'category', 'review_due', 'owner_id', 'status'] as const;

sops.patch('/:id', async (c) => {
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw);

	if ('body' in body) {
		throw new ApiError(400, 'Editing a SOP body creates a new version. Post to /versions instead.');
	}
	if ('current_version_id' in body) {
		throw new ApiError(400, 'The current version is set by adding or restoring a version.');
	}

	const existing = await c.env.DB.prepare('SELECT id FROM sops WHERE id = ?').bind(id).first();
	if (!existing) throw new ApiError(404, 'SOP not found.');

	const sets: string[] = [];
	const binds: unknown[] = [];

	for (const field of UPDATABLE) {
		if (!(field in body)) continue;
		const raw = body[field];
		let value: string | null;

		switch (field) {
			case 'title':
				value = requiredText(raw, 'Title', 300);
				break;
			case 'category':
				value = optionalText(raw, 'Category', 120);
				break;
			case 'review_due':
				value = optionalDate(raw, 'Review due');
				break;
			case 'status':
				value = oneOf<SopStatus>(raw, SOP_STATUSES, 'status', 'active');
				break;
			default:
				value = optionalText(raw, field, 64);
		}

		sets.push(`${field} = ?`);
		binds.push(value);
	}

	if (sets.length === 0) throw new ApiError(400, 'Nothing to update.');

	sets.push('updated_at = ?');
	binds.push(nowUtc());
	binds.push(id);

	await c.env.DB.prepare(`UPDATE sops SET ${sets.join(', ')} WHERE id = ?`)
		.bind(...binds)
		.run();

	const updated = await c.env.DB.prepare(`${LIST_SELECT} WHERE s.id = ?`).bind(id).first();
	return c.json({ sop: updated });
});

/** Editing a SOP means adding a version. Nothing rewrites what came before. */
sops.post('/:id/versions', async (c) => {
	const id = c.req.param('id');
	const body = await readJsonObject(c.req.raw);
	const version = readRichField(body, 'body', 'Body');
	if (!version.plain) throw new ApiError(400, 'Body is required.');
	return addVersion(
		c,
		id,
		version,
		optionalText(body.change_note, 'Change note', 500),
		optionalText(body.author_id, 'author_id', 64)
	);
});

/**
 * Restore carries an old body forward as a new version. It never repoints the
 * SOP at an earlier row, so history stays linear and nothing is lost. D34.
 */
sops.post('/:id/versions/:versionId/restore', async (c) => {
	const id = c.req.param('id');
	const versionId = c.req.param('versionId');

	const source = await c.env.DB.prepare(
		'SELECT body, body_html, version_number FROM sop_versions WHERE id = ? AND sop_id = ?'
	)
		.bind(versionId, id)
		.first<{ body: string; body_html: string | null; version_number: number }>();
	if (!source) throw new ApiError(404, 'Version not found for this SOP.');

	const body = await readJsonObject(c.req.raw).catch(() => ({}) as Record<string, unknown>);
	const note =
		optionalText(body.change_note, 'Change note', 500) ??
		`Restored the content of version ${source.version_number}`;

	return addVersion(
		c,
		id,
		{ plain: source.body, html: source.body_html },
		note,
		optionalText(body.author_id, 'author_id', 64)
	);
});

async function addVersion(
	c: Context<ApiEnv>,
	sopId: string,
	/*
	 * The body, as both columns. A version is immutable history, so it carries
	 * its own HTML rather than the SOP carrying one copy: restoring version 3
	 * has to bring back exactly what version 3 said, formatting included.
	 */
	body: { html: string | null; plain: string | null },
	changeNote: string | null,
	authorId: string | null
) {
	const sop = await c.env.DB.prepare('SELECT id, status FROM sops WHERE id = ?')
		.bind(sopId)
		.first<{ id: string; status: SopStatus }>();
	if (!sop) throw new ApiError(404, 'SOP not found.');
	if (sop.status === 'archived') {
		throw new ApiError(400, 'This SOP is archived. Restore it to active before editing.');
	}

	const latest = await c.env.DB.prepare(
		'SELECT MAX(version_number) AS n FROM sop_versions WHERE sop_id = ?'
	)
		.bind(sopId)
		.first<{ n: number | null }>();

	const nextNumber = (latest?.n ?? 0) + 1;
	const versionId = crypto.randomUUID();
	const now = nowUtc();

	await c.env.DB.batch([
		c.env.DB.prepare(
			`INSERT INTO sop_versions
         (id, sop_id, version_number, body, body_html, change_note, author_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		).bind(versionId, sopId, nextNumber, body.plain, body.html, changeNote, authorId, now),
		c.env.DB.prepare('UPDATE sops SET current_version_id = ?, updated_at = ? WHERE id = ?').bind(
			versionId,
			now,
			sopId
		)
	]);

	const updated = await c.env.DB.prepare(`${LIST_SELECT} WHERE s.id = ?`).bind(sopId).first();
	return c.json({ sop: updated, version_number: nextNumber }, 201);
}

// D33. There is deliberately no DELETE route. Archiving is the only way to
// retire a SOP, and it is reversible.
