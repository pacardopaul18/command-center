-- Client 360: the two things the client page needs that do not exist yet.
--
-- D38 does not apply. Both are new tables. Nothing is rebuilt, so no
-- referential action fires and nothing needs stashing and restoring. Stated
-- here for the same reason 0008 and 0009 state it: at the site where the next
-- reader will wonder whether the ceremony was skipped or was never needed.
--
-- Client 360 reads like a UI job and is not. Projects, invoices, meetings and
-- tickets already exist and only need filtering by client. Contacts and
-- contracts are genuinely absent, and no amount of page work conjures them.

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT,
  -- Lean is one contact per row, many rows per client. Deduplicating people
  -- across clients is a second entity and belongs in full.
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Cheap and worth having: an address with nothing before or after the @ is
  -- a typo every time. Deliberately not stricter than that, because email
  -- grammar is far wider than most patterns assume and rejecting a real
  -- address is worse than storing an odd one.
  CHECK (email IS NULL OR email LIKE '%_@_%')
);

CREATE INDEX idx_contacts_client ON contacts (client_id);

-- At most one primary contact per client. A partial unique index says exactly
-- that: rows with is_primary = 0 are not in the index at all, so a client may
-- have any number of ordinary contacts and only ever one primary.
CREATE UNIQUE INDEX idx_contacts_one_primary
  ON contacts (client_id)
  WHERE is_primary = 1;

CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  value_cents INTEGER CHECK (value_cents IS NULL OR value_cents >= 0),

  -- Hand-set for now, by ruling. The definition of "fulfilled against what"
  -- was open, and inventing one would have been worse than asking.
  fulfillment_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (fulfillment_status IN ('not_started', 'in_progress', 'fulfilled', 'cancelled')),

  -- What the status was derived from. 'manual' means a person set it, which is
  -- every row today. The column exists now so that computing fulfillment later
  -- from invoices, hours or deliverables is a code change and not a migration:
  -- the status column does not move, it just stops being written by hand.
  -- Recording the basis alongside the status is what makes the two modes
  -- distinguishable after the fact, rather than leaving a column whose meaning
  -- silently changed on some date nobody wrote down.
  fulfillment_basis TEXT NOT NULL DEFAULT 'manual'
    CHECK (fulfillment_basis IN ('manual', 'invoiced', 'hours', 'deliverables')),

  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX idx_contracts_client ON contracts (client_id);

-- Contracts are the record of what was agreed. ON DELETE RESTRICT above is the
-- same reasoning tickets use for projects: deleting a client with a contract
-- against it should require dealing with the contract, not silently take it.
