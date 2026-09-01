-- Migration 0032: the Asana mirror.
--
-- ASANA IS THE SOURCE OF TRUTH AND THIS IS A COPY. That is the ruling, and it
-- decides the shape of everything below.
--
-- These tables hold what Asana returned, as Asana returned it. They are not the
-- app's own model and must never be edited by hand: anything here can be thrown
-- away and re-pulled, which is what makes Thursday's schema work free. A row
-- corrected locally would be a correction that the next sync silently reverts,
-- and nobody would know which of the two was right.
--
-- The app's own entities stay where they are. `projects` and `tickets` are not
-- replaced by this and are not ALTERed by it, because they take no ALTER before
-- Thursday and because a mirror that overwrote the app's model would make the
-- app a worse Asana rather than a different tool. The link between the two is a
-- side table, so a re-pull rebuilds the mirror without touching anything Paul
-- has written.
--
-- EVERY TABLE IS KEYED ON THE ASANA GID, never on a local id and never on a
-- timestamp. A gid is stable across renames, moves and re-pulls; a timestamp
-- comparison re-syncs everything whenever a bulk edit touches modified_at, and
-- ties on writes landing in the same second.
--
-- SECTIONS ARE STORED VERBATIM AND NOT TRANSLATED. The section a task sits in
-- is MacGray's real status vocabulary, and reading it is the input to Thursday's
-- status-model reconciliation. Mapping it onto the app's states now would be
-- guessing the answer to the question the reconciliation exists to ask, and the
-- guess would then look like evidence.

-- --- the workspace and its teams ---------------------------------------------

CREATE TABLE asana_workspaces (
  gid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE TABLE asana_teams (
  gid TEXT PRIMARY KEY,
  workspace_gid TEXT NOT NULL,
  name TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE INDEX idx_asana_teams_workspace ON asana_teams (workspace_gid);

-- --- people -------------------------------------------------------------------
--
-- Assignees and followers are the same table. A person is a person whichever
-- way they are attached to a task.

CREATE TABLE asana_users (
  gid TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  synced_at TEXT NOT NULL
);

-- --- projects -----------------------------------------------------------------

CREATE TABLE asana_projects (
  gid TEXT PRIMARY KEY,
  workspace_gid TEXT NOT NULL,
  team_gid TEXT,

  name TEXT NOT NULL,
  notes TEXT,

  /*
   * Archived projects are pulled and kept.
   *
   * Missing them was one of two systemic misses recorded in the MacGray
   * handoff, and it is now a permanent refresh check. An archived project is
   * not an absent project: it holds finished work somebody will ask about.
   */
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),

  created_at TEXT,
  modified_at TEXT,

  /*
   * The client this project belongs to, resolved through the crosswalk.
   *
   * Nullable, and null means unmatched rather than unimportant. An unmatched
   * project appears in a visible unassigned bucket; it is never attached to a
   * client on a guess, because a project filed under the wrong client is worse
   * than one filed under none.
   */
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,

  /** How the client was decided, so a guess can never be mistaken for a match. */
  client_match TEXT CHECK (client_match IS NULL OR client_match IN ('crosswalk', 'exact_name', 'manual')),

  synced_at TEXT NOT NULL
);

CREATE INDEX idx_asana_projects_workspace ON asana_projects (workspace_gid, archived);
CREATE INDEX idx_asana_projects_client ON asana_projects (client_id);

-- --- sections -----------------------------------------------------------------

CREATE TABLE asana_sections (
  gid TEXT PRIMARY KEY,
  project_gid TEXT NOT NULL,
  name TEXT NOT NULL,

  -- Asana orders sections explicitly and the order carries meaning: a board
  -- reads left to right. Sorting by name would scramble a workflow.
  position INTEGER NOT NULL DEFAULT 0,

  synced_at TEXT NOT NULL
);

CREATE INDEX idx_asana_sections_project ON asana_sections (project_gid, position);

-- --- tasks and subtasks -------------------------------------------------------
--
-- One table. A subtask in Asana is a task with a parent, not a different kind of
-- thing, and splitting them would mean every query asking the same question
-- twice.

CREATE TABLE asana_tasks (
  gid TEXT PRIMARY KEY,

  workspace_gid TEXT NOT NULL,

  -- A task can sit in several projects in Asana. This is the project it was
  -- pulled under; the full membership is in asana_task_projects.
  project_gid TEXT,
  section_gid TEXT,

  /** The section name as Asana spells it. Thursday's reconciliation input. */
  section_name TEXT,

  parent_gid TEXT,

  name TEXT NOT NULL,
  notes TEXT,

  assignee_gid TEXT,

  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  completed_at TEXT,

  start_on TEXT,
  due_on TEXT,

  created_at TEXT,
  modified_at TEXT,

  synced_at TEXT NOT NULL
);

CREATE INDEX idx_asana_tasks_project ON asana_tasks (project_gid, completed);
CREATE INDEX idx_asana_tasks_parent ON asana_tasks (parent_gid);
CREATE INDEX idx_asana_tasks_assignee ON asana_tasks (assignee_gid);
CREATE INDEX idx_asana_tasks_section ON asana_tasks (section_gid);

-- A task's full project membership, because one task can be in several.
CREATE TABLE asana_task_projects (
  task_gid TEXT NOT NULL,
  project_gid TEXT NOT NULL,
  PRIMARY KEY (task_gid, project_gid)
);

CREATE TABLE asana_task_followers (
  task_gid TEXT NOT NULL,
  user_gid TEXT NOT NULL,
  PRIMARY KEY (task_gid, user_gid)
);

-- --- tags ---------------------------------------------------------------------

CREATE TABLE asana_tags (
  gid TEXT PRIMARY KEY,
  workspace_gid TEXT NOT NULL,
  name TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE TABLE asana_task_tags (
  task_gid TEXT NOT NULL,
  tag_gid TEXT NOT NULL,
  PRIMARY KEY (task_gid, tag_gid)
);

-- --- custom fields ------------------------------------------------------------
--
-- The value is kept as Asana's own `display_value`, a string, rather than typed
-- into columns per field kind. A custom field can be renamed, retyped or
-- deleted in Asana at any time, and a schema that encoded today's types would
-- need a migration every time somebody edited a dropdown. The typed value is
-- available on re-pull if a specific field ever earns real handling.

CREATE TABLE asana_custom_fields (
  gid TEXT PRIMARY KEY,
  workspace_gid TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE asana_task_custom_values (
  task_gid TEXT NOT NULL,
  field_gid TEXT NOT NULL,
  display_value TEXT,
  PRIMARY KEY (task_gid, field_gid)
);

-- --- attachments, metadata only -----------------------------------------------
--
-- No bytes. An attachment's contents live in Asana or in whatever it links to,
-- and pulling them would mean this app holding copies of client files it was
-- not asked to hold. The download URL Asana returns is short-lived by design
-- and is deliberately not stored: a stale URL that looks like a link is worse
-- than no link.

CREATE TABLE asana_attachments (
  gid TEXT PRIMARY KEY,
  task_gid TEXT NOT NULL,
  name TEXT,
  size_bytes INTEGER,
  mime_type TEXT,
  host TEXT,
  created_at TEXT,
  synced_at TEXT NOT NULL
);

CREATE INDEX idx_asana_attachments_task ON asana_attachments (task_gid);

-- --- stories, which are comments and system events ----------------------------
--
-- Both kinds in one table, because Asana returns them as one stream and the
-- reader sees one history. `type` separates a person's comment from Asana's own
-- note about a change, the same split ticket_events makes.

CREATE TABLE asana_stories (
  gid TEXT PRIMARY KEY,
  task_gid TEXT NOT NULL,
  created_by_gid TEXT,
  created_at TEXT,
  type TEXT,
  text TEXT,
  synced_at TEXT NOT NULL
);

CREATE INDEX idx_asana_stories_task ON asana_stories (task_gid, created_at);

-- --- the link from the mirror to the app's own model --------------------------
--
-- Side tables, so a re-pull rebuilds the mirror without touching a row Paul has
-- written, and so `projects` and `tickets` take no ALTER before Thursday.

CREATE TABLE asana_project_links (
  asana_gid TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL,
  UNIQUE (project_id)
);

CREATE TABLE asana_task_links (
  asana_gid TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL,
  UNIQUE (ticket_id)
);

-- --- sync state, so a run is resumable ----------------------------------------
--
-- One row per workspace. A pull that stops halfway, for a rate limit or a
-- deploy or a closed laptop, resumes from the phase and cursor it recorded
-- rather than starting again: starting again is how a large pull never
-- finishes.

CREATE TABLE asana_sync_state (
  workspace_gid TEXT PRIMARY KEY,

  phase TEXT NOT NULL DEFAULT 'idle'
    CHECK (phase IN ('idle', 'teams', 'projects', 'sections', 'tasks', 'details', 'done', 'failed')),

  /** Where the current phase got to. Opaque to everything but the phase itself. */
  cursor TEXT,

  started_at TEXT,
  finished_at TEXT,
  last_error TEXT,

  /** Counts from the last completed run, as JSON, for the report. */
  counts TEXT,

  updated_at TEXT NOT NULL
);
