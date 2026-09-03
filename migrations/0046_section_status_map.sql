-- Section to coarse status, by crosswalk. Pillar 2.
--
-- MacGray's Asana sections are the firm's real vocabulary for where a task is,
-- and there are 103 distinct names across 66 projects. The projection has
-- always refused to turn them into status, and recorded why: mapping them by
-- rule would guess the answer the reconciliation exists to ask.
--
-- This is that answer's home. A row here is somebody's decision, never an
-- inference, and it carries who made it and when. Same shape as the client
-- crosswalk: a table a person edits, with precedence in one place.
--
-- WHAT THE SURVEY FOUND, and it is why the unmapped state matters more here
-- than it would have in the design somebody imagined. These sections are mostly
-- not workflow status at all:
--
--   Sales, Finance, Operations, Marketing   business function, 1,362 tasks
--   Phase 2 - Weeks 1-3 - Instacart ...     engagement phase, 39 names
--   Costco Launch, 2500 Can Trial           ad-hoc grouping
--   Untitled section                        203 tasks, Asana's default
--
-- Three names matched a status vocabulary and all three were false positives:
-- the word "Review" inside a phase title. So this table starts empty and stays
-- mostly empty, and that is the correct state rather than a gap to be filled.
--
-- NOT_A_STATUS IS A MAPPING, NOT AN ABSENCE. "Sales is a business function and
-- carries no status" is a decision somebody made. "Nobody has looked at Sales"
-- is not. Collapsing the two would lose the only record that the question was
-- asked, and would make the reconciliation impossible to finish, because there
-- would be no way to say a section is done being considered. D214, D220.

CREATE TABLE section_status_map (
  id            TEXT PRIMARY KEY,

  -- Keyed on the verbatim name, or on one section, never both.
  --
  -- The name is the useful unit: "Sales" appears in 19 projects and one
  -- decision should cover all 19. The gid exists for the case where the same
  -- word means different things in two engagements, and it wins, exactly as a
  -- manual client override wins over a name match. D181.
  section_name  TEXT,
  section_gid   TEXT,

  -- A ticket status, or 'not_a_status'. Never null: a row with no answer is an
  -- unmapped section, and an unmapped section has no row.
  status        TEXT NOT NULL,

  -- Provenance, required. Who decided, when, and how.
  --
  -- `source` admits one value today and is a column rather than a constant so
  -- that adding an inferred mapping later is a schema change somebody has to
  -- justify, not a quiet insert.
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual')),
  mapped_by     TEXT NOT NULL,
  mapped_at     TEXT NOT NULL,
  note          TEXT,

  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,

  CHECK (
    (section_name IS NOT NULL AND section_gid IS NULL) OR
    (section_name IS NULL AND section_gid IS NOT NULL)
  ),
  CHECK (status IN ('open', 'in_progress', 'blocked', 'in_review', 'done', 'cancelled', 'not_a_status'))
);

-- One decision per name and one per section. A second row for the same key is
-- two answers to one question, and the resolver would have to pick.
CREATE UNIQUE INDEX section_status_by_name ON section_status_map (section_name)
  WHERE section_name IS NOT NULL;
CREATE UNIQUE INDEX section_status_by_gid ON section_status_map (section_gid)
  WHERE section_gid IS NOT NULL;
