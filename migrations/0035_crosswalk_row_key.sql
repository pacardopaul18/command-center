-- Migration 0035: the crosswalk is keyed on the row, not on the client.
--
-- 0033 made canonical_name the primary key, on the reasoning that the file is
-- organised around it and a synthetic id would need its own mapping back. The
-- file disagreed. It has 55 rows and 45 distinct canonical names: one client
-- carries nine program workstreams, each a separate line with its own Asana
-- gid, and another appears twice with the second marked `duplicate`.
--
-- So the load wrote 55 rows into 45 slots and the last one won. Ten Asana gids
-- went in and did not come out: the table held 33 of the file's 43, and ten
-- real projects were filed as unassigned. The load reported "rows_written: 55",
-- which was true about what it did and false about what the table held, and
-- that is the kind of number that gets believed.
--
-- The correct grain was always the row. A client legitimately has several Asana
-- projects. canonical_name is the client a row belongs to, not the identity of
-- the row.
--
-- Dropped and recreated rather than altered. This table was created earlier
-- today, has never been on production, and holds nothing that is not re-read
-- from the file on the next load. A compatibility path for one afternoon's data
-- would be more code than the whole loader.

DROP TABLE client_crosswalk;

CREATE TABLE client_crosswalk (
  id TEXT PRIMARY KEY,

  /*
   * The client this row belongs to, by name. Repeats across rows on purpose:
   * a program's workstreams are separate lines under one client.
   */
  canonical_name TEXT NOT NULL,

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

  /*
   * Unique where present. A gid identifies one Asana project, and a project
   * belongs to one client: two rows claiming the same gid is a contradiction in
   * the file, and it should fail the load rather than resolve itself by
   * whichever row happened to be written last. SQLite treats nulls as distinct
   * in a unique index, so the twelve rows with no gid are unaffected.
   */
  asana_gid TEXT,

  asana_total_tasks INTEGER,
  asana_open_tasks INTEGER,
  asana_owner TEXT,

  notes TEXT,

  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  matched_by TEXT CHECK (matched_by IS NULL OR matched_by IN ('asana_gid', 'dropbox_name', 'normalised_name', 'manual')),

  loaded_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_client_crosswalk_gid ON client_crosswalk (asana_gid);
CREATE INDEX idx_client_crosswalk_name ON client_crosswalk (canonical_name);
CREATE INDEX idx_client_crosswalk_dropbox ON client_crosswalk (dropbox_name);
CREATE INDEX idx_client_crosswalk_client ON client_crosswalk (client_id);

-- The load record gains the number that would have caught this.
--
-- `rows_written` counts what the loader did. `rows_in_table` counts what
-- survived. When those two disagree the file has collided with itself, and
-- reporting only the first is how ten gids went missing without a single
-- failing number on the screen. D138 in a new place: a count has to say what it
-- is a count of.
ALTER TABLE client_crosswalk_loads ADD COLUMN rows_in_table INTEGER;
ALTER TABLE client_crosswalk_loads ADD COLUMN distinct_clients INTEGER;
