-- Migration 0034: the Dropbox mirror.
--
-- DROPBOX IS THE SOURCE OF TRUTH AND THIS IS A COPY, on the same terms as the
-- Asana mirror. Metadata only: paths, names, sizes and modification times. No
-- bytes, ever. The app holds a map of where the client work is, not the client
-- work.
--
-- The path is the key. Dropbox's own file id is stable across renames and moves
-- and is the better key, but it only exists over the API; the local mirror is
-- built from a synced folder where the path is all there is. The column is
-- here, nullable, so the OAuth connector can fill it in later without a
-- migration and without a re-key.
--
-- L2, AND IT IS A HARD RULE NOT A PREFERENCE: activity is file level. A folder's
-- last activity is the newest modification time among the files beneath it,
-- computed here and never read off the folder itself. A folder's own mtime on a
-- synced Dropbox changes when the sync client touches it, so a folder date says
-- when Dropbox last thought about the folder rather than when anybody last did
-- work in it. Reading one made dormant clients look active. A test asserts that
-- no code reads a directory mtime.

CREATE TABLE dropbox_folders (
  path TEXT PRIMARY KEY,

  /** Dropbox's own id, when the connector supplies one. Null for a local scan. */
  dropbox_id TEXT,

  name TEXT NOT NULL,
  parent_path TEXT,

  -- Depth below the scan root, so the client-level folders can be found without
  -- counting separators in every query.
  depth INTEGER NOT NULL,

  /*
   * Rolled up from the files beneath, not read from the folder.
   *
   * Recursive: a client folder's totals include everything under it, because
   * "when did anything happen for this client" is the question being asked, and
   * an answer that stopped at the first level would say nothing happened when
   * all the work sits one folder deeper.
   */
  file_count INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  last_activity TEXT,

  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  client_match TEXT CHECK (client_match IS NULL OR client_match IN ('crosswalk', 'exact_name', 'manual')),

  synced_at TEXT NOT NULL
);

CREATE INDEX idx_dropbox_folders_parent ON dropbox_folders (parent_path);
CREATE INDEX idx_dropbox_folders_depth ON dropbox_folders (depth);
CREATE INDEX idx_dropbox_folders_client ON dropbox_folders (client_id);

CREATE TABLE dropbox_files (
  path TEXT PRIMARY KEY,
  dropbox_id TEXT,

  folder_path TEXT NOT NULL,
  name TEXT NOT NULL,

  -- Lower case, no dot, null when there is none. Stored rather than derived at
  -- read time because "how many spreadsheets does this client have" is a
  -- grouping query, and grouping on a substring expression cannot use an index.
  extension TEXT,

  size_bytes INTEGER NOT NULL DEFAULT 0,

  /** The file's own modification time. The only activity signal that counts. */
  modified_at TEXT,

  synced_at TEXT NOT NULL
);

CREATE INDEX idx_dropbox_files_folder ON dropbox_files (folder_path);
CREATE INDEX idx_dropbox_files_modified ON dropbox_files (modified_at);
CREATE INDEX idx_dropbox_files_extension ON dropbox_files (extension);

-- One row per scan, for the same reason the crosswalk records its loads: a scan
-- that found 300 files where the last found 11,000 is a half-synced folder or a
-- permission problem, and that is only noticed if the number is written down.
CREATE TABLE dropbox_scans (
  id TEXT PRIMARY KEY,
  root TEXT NOT NULL,

  -- 'local' for the synced folder, 'api' for the OAuth connector. Kept so the
  -- two can never be confused when the connector lands and both have run.
  source TEXT NOT NULL CHECK (source IN ('local', 'api')),

  folders INTEGER NOT NULL DEFAULT 0,
  files INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,

  -- Entries the scan could not read. Counted rather than dropped: a scan that
  -- silently skipped a locked folder would report a smaller Dropbox as if that
  -- were the truth.
  skipped INTEGER NOT NULL DEFAULT 0,

  started_at TEXT NOT NULL,
  finished_at TEXT,
  note TEXT
);
