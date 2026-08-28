-- Migration 0002: SOPs and their version history.
-- Data model is docs/Command_Center_Architecture.md section E.
--
-- Three rulings from Paul are enforced here rather than left to convention.
-- See D32, D33 and D34 in docs/DECISIONS.md.
--   D32 versions are immutable and undeletable
--   D33 SOPs archive, never delete
--   D34 current_version_id moves forward only
--
-- The two tables reference each other: a SOP points at its current version, and
-- every version points back at its SOP. current_version_id is therefore nullable
-- and set immediately after version 1 is written, in the same batch. A SOP with
-- a null current_version_id is a half-written record and never a valid state at
-- rest.

CREATE TABLE sops (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  category           TEXT,
  current_version_id TEXT REFERENCES sop_versions(id) ON DELETE RESTRICT,
  owner_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
  review_due         TEXT,
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'archived')),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_sops_status ON sops (status);
CREATE INDEX idx_sops_category ON sops (category);
CREATE INDEX idx_sops_review_due ON sops (review_due);

CREATE TABLE sop_versions (
  id             TEXT PRIMARY KEY,
  sop_id         TEXT NOT NULL REFERENCES sops(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL,
  body           TEXT NOT NULL,
  change_note    TEXT,
  author_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (sop_id, version_number)
);

CREATE INDEX idx_sop_versions_sop ON sop_versions (sop_id, version_number DESC);

-- D32. A version is a historical fact. Editing one would rewrite the audit
-- trail, which is the entire reason the table exists. Enforced in the database
-- so no future code path can quietly break it.
CREATE TRIGGER sop_versions_immutable
BEFORE UPDATE ON sop_versions
BEGIN
  SELECT RAISE(ABORT, 'SOP versions are immutable. Add a new version instead.');
END;

CREATE TRIGGER sop_versions_undeletable
BEFORE DELETE ON sop_versions
BEGIN
  SELECT RAISE(ABORT, 'SOP versions cannot be deleted. Archive the SOP instead.');
END;

-- D34. History is linear. Restoring an older version means writing a new version
-- that carries the old body forward, never pointing the SOP back at an earlier
-- row. This trigger makes going backwards impossible rather than merely
-- discouraged.
CREATE TRIGGER sops_current_version_forward_only
BEFORE UPDATE OF current_version_id ON sops
WHEN OLD.current_version_id IS NOT NULL
 AND NEW.current_version_id IS NOT NULL
 AND (SELECT version_number FROM sop_versions WHERE id = NEW.current_version_id)
     <= (SELECT version_number FROM sop_versions WHERE id = OLD.current_version_id)
BEGIN
  SELECT RAISE(ABORT, 'current_version_id moves forward only. Restore by adding a new version.');
END;
