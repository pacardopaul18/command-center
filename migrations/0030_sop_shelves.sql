-- Migration 0030: shelves hold books, books hold chapters, chapters hold pages.
--
-- SOPs are flat, with a `category` string doing the work of a shelf. That is
-- fine for twenty procedures and wrong for a hundred and twenty: there is no
-- place to say that three pages are one procedure read in order, and no way to
-- own or review a set of them together.
--
-- Four tables, not the six the audit sketched, and the two that are missing are
-- missing on purpose.
--
-- THERE IS NO ACCESS TABLE. The prototype draws role-based access inherited
-- from the shelf. This is a single-user application behind Cloudflare Access,
-- so a roles table would enforce nothing and would exist only to make the
-- screen look like it enforced something. Ownership is recorded as a name on a
-- shelf and a book, and the screen says it is a record of who looks after this,
-- not a permission system. D27 at the size of a module: never render an
-- affordance that does not exist. When there are several users this becomes a
-- real table and the screen stops lying by omission rather than by commission.
--
-- THERE IS NO ACTIVITY TABLE. The prototype's book activity is edits, reviews
-- and rollbacks across a book, all of which are already rows in `sop_versions`
-- with an author and a change note. A second table would be a second home for
-- facts that already exist and would drift the first time a version was written
-- without remembering to log it. It is a join. D155.

-- --- shelves ----------------------------------------------------------------

CREATE TABLE sop_shelves (
  id TEXT PRIMARY KEY,

  name TEXT NOT NULL,
  description TEXT,

  -- Who looks after this shelf. A name, not a user id: the roster is a text
  -- column everywhere else in this app and pretending otherwise here would mean
  -- one shelf that cannot name a contractor who has no login.
  owner TEXT,

  position INTEGER NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_sop_shelves_name ON sop_shelves (name COLLATE NOCASE);

-- --- books ------------------------------------------------------------------

CREATE TABLE sop_books (
  id TEXT PRIMARY KEY,
  shelf_id TEXT NOT NULL REFERENCES sop_shelves(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  description TEXT,

  -- Inherited from the shelf when null, which is why it is nullable rather than
  -- copied down at creation: a copy would not follow the shelf when it changed.
  owner TEXT,

  /**
   * How often the book is meant to be reread, in days.
   *
   * On the book rather than on each page, because a review is a sitting: you
   * read the procedure through, not one step of it. Individual pages keep their
   * own `review_due` for the ones that genuinely differ.
   */
  review_cycle_days INTEGER CHECK (review_cycle_days IS NULL OR review_cycle_days > 0),

  -- When the book was last read through, which with the cycle gives the next
  -- date. Storing the next date instead would need rewriting every row whenever
  -- the cycle changed.
  last_reviewed_at TEXT,

  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),

  position INTEGER NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_sop_books_shelf ON sop_books (shelf_id, position);

-- --- chapters ---------------------------------------------------------------

CREATE TABLE sop_chapters (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES sop_books(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_sop_chapters_book ON sop_chapters (book_id, position);

-- --- where a page lives -----------------------------------------------------
--
-- A side table rather than a `chapter_id` column on `sops`, because `sops` is
-- an existing table and takes no ALTER before Thursday. The consequence is
-- worth naming rather than glossing: a placement can go missing in a way a NOT
-- NULL column cannot, so a page with no placement is a real state the reads
-- have to handle. They do, by listing it as unfiled rather than by hiding it,
-- which is the right behaviour anyway for a page whose chapter was deleted.
--
-- One placement per page. A procedure that appears in two books is two
-- procedures that will drift; the unique constraint says so rather than a
-- comment asking people to be careful.

CREATE TABLE sop_placements (
  id TEXT PRIMARY KEY,

  sop_id TEXT NOT NULL REFERENCES sops(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES sop_chapters(id) ON DELETE CASCADE,

  position INTEGER NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL,

  UNIQUE (sop_id)
);

CREATE INDEX idx_sop_placements_chapter ON sop_placements (chapter_id, position);
