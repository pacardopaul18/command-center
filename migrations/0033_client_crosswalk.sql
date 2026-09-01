-- Migration 0033: the client crosswalk, as a loaded table.
--
-- THE CROSSWALK IS DATA, NOT CODE. That is the ruling and this table is what
-- makes it true: a re-pull re-reads the file, and Paul editing the file is the
-- override path. Hard-coding 55 name mappings into a matcher would have made
-- every correction a code change and a deploy, and would have hidden the
-- mapping from the person who owns it.
--
-- The columns are the file's columns. Deliberately: a loader that renamed or
-- reshaped them on the way in would mean the table and the spreadsheet stopped
-- being the same thing, and the first disagreement would be unresolvable
-- without reading the loader.
--
-- MATCHING PRECEDENCE, ruled and encoded in the loader that reads this:
--   1. asana_gid exact. Authoritative, never overridden by a name.
--   2. dropbox_name exact, for folders.
--   3. normalised-name match.
--   4. the unassigned bucket: visible on screen, resolvable by Paul, never
--      guessed. A row filed under the wrong client is worse than one filed
--      under none.
--
-- canonical_name is what the app displays. asana_name and dropbox_name are kept
-- as aliases rather than normalised away, so drift is visible rather than
-- silently corrected: 20 of the 55 rows are flagged as drifting, and that
-- number is only useful if both spellings survive the load.

CREATE TABLE client_crosswalk (
  -- The canonical name is the key. It is what the app displays and what the
  -- file is organised around; a synthetic id would need its own mapping back to
  -- the file, which is one more thing that can drift.
  canonical_name TEXT PRIMARY KEY,

  type TEXT,
  presence TEXT,

  dropbox_name TEXT,
  asana_name TEXT,

  -- Kept as the file spells it rather than as a boolean, because the loader
  -- must not decide what a blank means in somebody else's spreadsheet.
  name_drift TEXT,

  dropbox_status TEXT,
  shared_mount TEXT,
  dropbox_last_activity TEXT,

  asana_gid TEXT,
  asana_total_tasks INTEGER,
  asana_open_tasks INTEGER,
  asana_owner TEXT,

  notes TEXT,

  /*
   * The client row this resolved to, and how.
   *
   * Null client_id means unmatched, which is a state the screen shows rather
   * than a failure. `matched_by` records the precedence rule that fired, so a
   * name match can never be mistaken for a gid match when somebody asks why a
   * project is filed where it is.
   */
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  matched_by TEXT CHECK (matched_by IS NULL OR matched_by IN ('asana_gid', 'dropbox_name', 'normalised_name', 'manual')),

  loaded_at TEXT NOT NULL
);

CREATE INDEX idx_client_crosswalk_gid ON client_crosswalk (asana_gid);
CREATE INDEX idx_client_crosswalk_dropbox ON client_crosswalk (dropbox_name);
CREATE INDEX idx_client_crosswalk_client ON client_crosswalk (client_id);

-- One row per load, so a truncated or stale file announces itself.
--
-- The counts are recorded rather than logged, because a log line scrolls away
-- and the question "is the crosswalk in this database the whole file" is asked
-- weeks later. A load that read 12 rows when the last read 55 is visible here
-- without anybody having kept the terminal open.
CREATE TABLE client_crosswalk_loads (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  rows_in_file INTEGER NOT NULL,
  rows_written INTEGER NOT NULL,
  rows_skipped INTEGER NOT NULL,
  with_asana_gid INTEGER NOT NULL,
  with_dropbox_name INTEGER NOT NULL,
  with_both INTEGER NOT NULL,
  name_drift INTEGER NOT NULL,
  loaded_at TEXT NOT NULL,
  note TEXT
);
