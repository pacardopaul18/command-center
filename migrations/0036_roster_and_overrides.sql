-- Migration 0036: the client roster overlay, and the manual override layer.
--
-- Two tables that both answer questions about a client, and they are separate
-- on purpose because they come from different places and survive different
-- events.

-- --- the roster, a status overlay -------------------------------------------
--
-- A second file Paul maintains, on a different shape from the crosswalk: 36
-- rows of name, status, shared mount, last activity and the evidence behind the
-- call. It is not a matching authority. The crosswalk decides which client a
-- project belongs to; this says what state that client is in.
--
-- The status vocabulary is stored as the file writes it: active, dormant,
-- reclassify_active, reclassify_completed, reclassify_unknown. It is NOT folded
-- into `clients.status`, which allows only active and archived. Three of those
-- five values are Paul saying "this needs a second look", which is a different
-- statement from either of the two the app already has, and collapsing it would
-- destroy the only thing the row was written to say. The same reasoning as
-- storing Asana's sections verbatim: a translation written now is a guess that
-- afterwards looks like a fact.
--
-- `evidence` is free text and is kept whole. It is the sentence that justifies
-- the status, and a status without its reason is an opinion.

CREATE TABLE client_roster (
  -- The roster's own name for the client. Not necessarily the crosswalk's
  -- canonical name: six of the thirty-six do not appear there at all, and that
  -- is a fact about the two files worth being able to see.
  name TEXT PRIMARY KEY,

  status TEXT,
  shared_mount TEXT,

  /** The roster's own activity call. Not derived, not compared, recorded. */
  last_activity TEXT,

  evidence TEXT,
  notes TEXT,

  /*
   * The client this row resolved to, and how.
   *
   * Null means unmatched, which is a state to show rather than a failure. The
   * roster carries no Asana gid, so the first precedence rule cannot apply
   * here and matching starts at the name.
   */
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  matched_by TEXT CHECK (matched_by IS NULL OR matched_by IN ('exact_name', 'normalised_name', 'manual')),

  loaded_at TEXT NOT NULL
);

CREATE INDEX idx_client_roster_client ON client_roster (client_id);
CREATE INDEX idx_client_roster_status ON client_roster (status);

-- Same property as the crosswalk load: what was read, and what the table holds.
-- A load that reports only its own effort will report success on a truncated
-- file. D174.
CREATE TABLE client_roster_loads (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  rows_in_file INTEGER NOT NULL,
  rows_written INTEGER NOT NULL,
  rows_skipped INTEGER NOT NULL,
  rows_in_table INTEGER NOT NULL,
  matched INTEGER NOT NULL,
  unmatched INTEGER NOT NULL,
  loaded_at TEXT NOT NULL,
  note TEXT
);

-- --- the manual override layer ------------------------------------------------
--
-- Paul's answer to an unassigned row: which client this Asana project or this
-- Dropbox folder actually belongs to.
--
-- A SEPARATE TABLE, NOT A ROW WRITTEN INTO client_crosswalk. The instruction
-- was to record the override with provenance 'manual', and this is where that
-- can be true. `client_crosswalk` is a faithful copy of a file: every load
-- rewrites it from what the file says, and a manual row has no line in the file
-- to be rewritten from, so the next load would delete exactly the corrections
-- that were most expensive to make. An override has to outlive a re-load or it
-- is not an override.
--
-- PRECEDENCE, as ruled: a manual override outranks name matching and does not
-- outrank an asana_gid. The gid is the authoritative identity of a project; a
-- person choosing a client from a list is answering a harder question with less
-- information, and if the two disagree the gid is right and the override was
-- made against a stale screen. Full order:
--
--   1. asana_gid exact
--   2. manual override
--   3. dropbox_name exact
--   4. normalised name
--   5. unassigned
--
-- The subject is (kind, key): an Asana project by gid, a Dropbox folder by
-- path. One row per subject, so overriding twice replaces rather than
-- accumulates, and there is never a question of which override is current.

CREATE TABLE client_overrides (
  kind TEXT NOT NULL CHECK (kind IN ('asana_project', 'dropbox_folder')),

  /** The gid for a project, the path for a folder. */
  subject_key TEXT NOT NULL,

  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  /*
   * What the subject was called when the choice was made.
   *
   * Kept so a later reader can see what Paul was looking at. A project renamed
   * in Asana after the override still carries the override, correctly, but the
   * decision then reads as being about a name that no longer exists, and that
   * is worth being able to explain rather than worth hiding.
   */
  subject_name TEXT,

  reason TEXT,

  created_at TEXT NOT NULL,

  PRIMARY KEY (kind, subject_key)
);

CREATE INDEX idx_client_overrides_client ON client_overrides (client_id);
