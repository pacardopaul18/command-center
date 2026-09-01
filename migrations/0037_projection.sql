-- Migration 0037: what the projection needs, and no more.
--
-- The mirror was built as a side model on purpose, so a re-pull after Thursday's
-- schema work costs nothing. Nothing was ever built to put it on the screens,
-- which is why 66 projects and 2,171 tasks were in the database and /projects
-- showed zero.
--
-- This adds two things. The identity map that makes a projection idempotent
-- already exists: `asana_project_links` and `asana_task_links` from 0032 were
-- created for exactly this, and reusing them is why this migration is short.
-- Presence in one of those tables IS the "mirrored, not authored" marker, and
-- `linked_at` is when it was projected. A second provenance table would be a
-- second answer to the same question, and the two would disagree.

-- --- a subtask's parent --------------------------------------------------------
--
-- `ticket_links` exists and cannot say this: its kinds are blocks, relates and
-- duplicates, all symmetric-ish relations between peers. A parent is not one of
-- those, and widening that CHECK would be a rebuild of an existing table, which
-- is frozen until Thursday.
--
-- Its own table is also the better shape. A ticket has at most one parent, and
-- a primary key on the child says so, where a row in `ticket_links` would allow
-- two parents and leave the code to be careful about it.

CREATE TABLE ticket_parents (
  child_ticket_id TEXT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  parent_ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,

  /*
   * Where the relationship came from.
   *
   * 'asana' means a re-projection owns this row and may rewrite it. Anything a
   * person creates later is not the projection's to change, and the column is
   * how a write path tells the difference without guessing.
   */
  source TEXT NOT NULL DEFAULT 'asana' CHECK (source IN ('asana', 'manual')),

  created_at TEXT NOT NULL
);

CREATE INDEX idx_ticket_parents_parent ON ticket_parents (parent_ticket_id);

-- --- what a projection run did -------------------------------------------------
--
-- The same property the crosswalk load has: a run reports what it wrote and what
-- the tables hold, and it records the fields it could not carry.
--
-- The dropped list is the part that matters. A projection that silently discards
-- an Asana field leaves a screen looking complete while a column of real
-- information is nowhere, and nobody asks about what they were never told was
-- missing. D138 applied to a mapping rather than to a count.

CREATE TABLE projection_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,

  projects_written INTEGER NOT NULL DEFAULT 0,
  tickets_written INTEGER NOT NULL DEFAULT 0,
  subtask_parents_written INTEGER NOT NULL DEFAULT 0,

  /* Mirror rows that could not be projected, with the reason, as JSON. */
  skipped INTEGER NOT NULL DEFAULT 0,
  skipped_because TEXT,

  /* Asana fields with no home in the app model, as JSON. Reported, not dropped
     quietly: the value stays in the mirror and can be projected later. */
  dropped_fields TEXT,

  /* Counts read back from the app tables after the run, not from the loop. */
  totals TEXT,

  note TEXT
);
