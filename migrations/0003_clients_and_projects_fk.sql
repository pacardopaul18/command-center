-- Migration 0003: Clients, and the projects rebuild that T-clients-0 owed.
--
-- Stage 1 carried projects.client_id as an unconstrained column because Clients
-- did not exist and SQLite cannot add a foreign key to an existing table. That
-- debt comes due here: projects is rebuilt with the real constraint.
--
-- The rebuild is the standard SQLite table-swap, with one non-obvious hazard.
--
-- DROP TABLE performs an implicit delete of every row, which FIRES referential
-- actions on child tables. action_items.project_id is ON DELETE SET NULL, so
-- dropping projects silently nulls every action item's project link.
-- defer_foreign_keys does not help: it defers constraint CHECKING, not the
-- actions themselves. PRAGMA foreign_keys = OFF would stop them, but it is a
-- no-op inside a transaction and D1 runs migrations in one.
--
-- This was caught by verification, not by reading: the first version of this
-- migration lost both links. The fix is to stash the mapping before the drop and
-- restore it after the rename.

PRAGMA defer_foreign_keys = true;

CREATE TABLE clients (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  billing_terms TEXT,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'archived')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_clients_status ON clients (status);
CREATE UNIQUE INDEX idx_clients_name ON clients (name COLLATE NOCASE);

-- --- projects rebuilt with a real client_id foreign key ---
-- ON DELETE RESTRICT rather than SET NULL: a client with projects against it is
-- not something to delete by accident. Clients archive, matching SOPs.

CREATE TABLE projects_rebuilt (
  id             TEXT PRIMARY KEY,
  client_id      TEXT REFERENCES clients(id) ON DELETE RESTRICT,
  name           TEXT NOT NULL,
  phase          TEXT NOT NULL DEFAULT 'initiating'
                 CHECK (phase IN ('initiating','planning','executing','monitoring','closing')),
  status         TEXT NOT NULL DEFAULT 'on_track'
                 CHECK (status IN ('on_track','at_risk','blocked','done')),
  owner_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  start_date     TEXT,
  target_close   TEXT,
  next_milestone TEXT,
  description    TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Stash the action item links before the drop nulls them. Ordinary table, not
-- TEMP, because D1 migrations run remotely and a temp table would not be
-- reliably visible across the statements in the batch.
CREATE TABLE _0003_project_links AS
  SELECT id AS action_item_id, project_id
  FROM action_items
  WHERE project_id IS NOT NULL;

-- Columns listed explicitly on both sides. A bare SELECT * would silently
-- depend on column order matching, which is exactly the kind of thing that
-- breaks a data migration quietly.
INSERT INTO projects_rebuilt
  (id, client_id, name, phase, status, owner_id, start_date, target_close,
   next_milestone, description, created_at, updated_at)
SELECT
   id, client_id, name, phase, status, owner_id, start_date, target_close,
   next_milestone, description, created_at, updated_at
FROM projects;

DROP TABLE projects;

ALTER TABLE projects_rebuilt RENAME TO projects;

CREATE INDEX idx_projects_status ON projects (status);
CREATE INDEX idx_projects_phase ON projects (phase);
CREATE INDEX idx_projects_client ON projects (client_id);

-- Put the links back, then drop the scratch table.
UPDATE action_items
SET project_id = (
  SELECT project_id FROM _0003_project_links
  WHERE action_item_id = action_items.id
)
WHERE id IN (SELECT action_item_id FROM _0003_project_links);

DROP TABLE _0003_project_links;
