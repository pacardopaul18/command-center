-- Migration 0028: what a template has actually been used for.
--
-- The redesigned library sorts by use and puts a Most used tile at the top of
-- the page. Neither is possible: nothing records that a template was ever used.
-- The draft route generates and returns text, and that is the end of it.
--
-- A table rather than a counter column on `templates`, for two reasons. It is
-- one to many by nature, so a column could only ever hold the count and would
-- lose everything that makes it worth having: when, and what for. And a count
-- kept in a column is a number maintained by hand, which is a number that
-- eventually disagrees with reality and cannot be recomputed to check.
--
-- Being a new table also satisfies the freeze, but that is not why it is one.
--
-- Nothing here stores the draft. A generated draft is client-facing writing
-- that has not been read yet, and keeping every one would make this table a
-- silent archive of unreviewed text written in Paul's voice. The row records
-- that a draft happened and what it was about, which is what a library needs to
-- know. D158.

CREATE TABLE template_uses (
  id TEXT PRIMARY KEY,

  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,

  -- What the template was pointed at, as one short line the reader typed or the
  -- caller supplied. Optional: using a template for nothing in particular is a
  -- real thing to do and should not require inventing a reason.
  context TEXT,

  -- How many characters came back. Not the draft itself, deliberately: a length
  -- says whether generation worked without keeping unreviewed writing.
  drafted_chars INTEGER,

  -- Which model wrote it, when one did. Copying a template without generating
  -- is also a use, and leaves this null.
  model TEXT,

  created_at TEXT NOT NULL
);

CREATE INDEX idx_template_uses_template ON template_uses (template_id, created_at DESC);

-- The Most used tile and the drafts-this-month figure both scan by date across
-- every template, which is the other direction this is read in.
CREATE INDEX idx_template_uses_when ON template_uses (created_at DESC);
