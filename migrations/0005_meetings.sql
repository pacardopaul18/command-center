-- Migration 0005: Meetings, and the action_items rebuild that T-meetings-0 owed.
--
-- Stage 1 carried action_items.meeting_id as an unconstrained column because
-- Meetings did not exist and SQLite cannot add a foreign key to an existing
-- table. That debt comes due here.
--
-- This follows the D38 standard exactly, because D38 exists because the first
-- version of migration 0003 silently destroyed every project link:
--
--   1. stash the child links before the drop
--   2. rebuild, drop, rename, recreate indexes
--   3. restore the links, drop the scratch table
--   4. verify by diffing rows before and after, not by reading the SQL
--
-- The hazard, restated so nobody has to rediscover it: DROP TABLE performs an
-- implicit delete of every row, which FIRES referential actions on child tables.
-- action_items.project_id is ON DELETE SET NULL. Here it is action_items itself
-- being rebuilt, so nothing downstream depends on it, but the same trap applies
-- in reverse: projects.id is referenced BY action_items, and rebuilding
-- action_items must not lose those references. defer_foreign_keys holds the
-- constraint checks until the end of the transaction so the intermediate state
-- is legal; it does not stop referential actions, which is why the stash exists.

PRAGMA defer_foreign_keys = true;

CREATE TABLE meetings (
  id            TEXT PRIMARY KEY,
  client_id     TEXT REFERENCES clients(id) ON DELETE RESTRICT,
  project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  meeting_date  TEXT NOT NULL,
  attendees     TEXT,
  recording_url TEXT,
  -- R2 object key for the uploaded transcript file. The transcript text also
  -- lives in D1 so it is searchable without a round trip to R2.
  transcript_ref  TEXT,
  transcript_text TEXT,
  summary       TEXT,
  -- Set when a human has reviewed the AI output. Nothing extracted by AI is
  -- treated as confirmed until this is set. See the extraction step.
  summary_reviewed_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_meetings_date ON meetings (meeting_date DESC);
CREATE INDEX idx_meetings_client ON meetings (client_id);
CREATE INDEX idx_meetings_project ON meetings (project_id);

-- --- action_items rebuilt with a real meeting_id foreign key ---

-- Step 1. Stash both link columns before anything is dropped.
CREATE TABLE _0005_action_links AS
  SELECT id AS action_item_id, project_id, meeting_id
  FROM action_items
  WHERE project_id IS NOT NULL OR meeting_id IS NOT NULL;

CREATE TABLE action_items_rebuilt (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  context        TEXT,
  owner          TEXT,
  owner_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  deadline       TEXT,
  status         TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','waiting','blocked','done','ambiguous')),
  source         TEXT NOT NULL DEFAULT 'manual'
                 CHECK (source IN ('meeting','email','manual')),
  meeting_id     TEXT REFERENCES meetings(id) ON DELETE SET NULL,
  project_id     TEXT REFERENCES projects(id) ON DELETE SET NULL,
  asana_task_gid TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  completed_at   TEXT
);

-- Step 2. Columns listed explicitly on both sides. A bare SELECT * would depend
-- on column order matching, which is how a data migration breaks quietly.
INSERT INTO action_items_rebuilt
  (id, title, context, owner, owner_id, deadline, status, source,
   meeting_id, project_id, asana_task_gid, created_at, updated_at, completed_at)
SELECT
   id, title, context, owner, owner_id, deadline, status, source,
   meeting_id, project_id, asana_task_gid, created_at, updated_at, completed_at
FROM action_items;

DROP TABLE action_items;

ALTER TABLE action_items_rebuilt RENAME TO action_items;

CREATE INDEX idx_action_items_status_deadline ON action_items (status, deadline);
CREATE INDEX idx_action_items_project ON action_items (project_id);
CREATE INDEX idx_action_items_meeting ON action_items (meeting_id);
CREATE INDEX idx_action_items_deadline ON action_items (deadline);

-- Step 3. Put the links back, then drop the scratch table.
UPDATE action_items
SET project_id = (
      SELECT project_id FROM _0005_action_links
      WHERE action_item_id = action_items.id
    ),
    meeting_id = (
      SELECT meeting_id FROM _0005_action_links
      WHERE action_item_id = action_items.id
    )
WHERE id IN (SELECT action_item_id FROM _0005_action_links);

DROP TABLE _0005_action_links;
