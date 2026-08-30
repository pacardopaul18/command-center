-- Tickets, and the additive rate model.
--
-- Two workstreams in one migration window on purpose. Both are additive, the
-- rate columns are three lines, and batching saves a whole D39 snapshot and D50
-- ordering window later.
--
-- No table is rebuilt here, so D38 does not apply. Every change is either a new
-- table or an ALTER TABLE ADD COLUMN, and SQLite adds a nullable column in place
-- without touching the rows or firing a referential action. The one rule that
-- does apply is SQLite's: a column added with a REFERENCES clause must default
-- to NULL, which every column below does.

-- --- Tickets ----------------------------------------------------------------
--
-- The worked unit under a project. Action items stay the capture layer: a thing
-- Paul writes down in ten seconds during a call. A ticket is what that becomes
-- when somebody is going to work it, and the two are deliberately different
-- shapes rather than one table with optional fields.
--
-- project_id is NOT NULL because the ruling was tickets under projects. A ticket
-- with no project would be an action item with extra columns, which is the thing
-- the entity fork exists to avoid.
CREATE TABLE tickets (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title          TEXT NOT NULL,
  description    TEXT,

  -- Planned window. `due_date` rather than an `end_date`, because the end of a
  -- ticket is two different facts: when it was meant to be finished, which is
  -- this, and when it actually was, which is completed_at.
  start_date     TEXT,
  due_date       TEXT,

  -- Estimate is stored. Actual is not: it is summed from time_entries through
  -- ticket_id, so the two can never disagree with each other. A stored actual
  -- is a second copy of a number that already exists, and second copies drift.
  estimate_hours REAL CHECK (estimate_hours IS NULL OR estimate_hours > 0),

  status         TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','in_progress','blocked','in_review','done','cancelled')),
  priority       TEXT NOT NULL DEFAULT 'normal'
                 CHECK (priority IN ('low','normal','high','urgent')),

  -- Same shape as action_items: free text for who, with an optional link to a
  -- real user. The picker offers both, and history that names somebody who was
  -- never a user in this system stays readable.
  assignee       TEXT,
  assignee_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  reporter       TEXT,
  reporter_id    TEXT REFERENCES users(id) ON DELETE SET NULL,

  -- Set when the ticket reaches done or cancelled, cleared if it leaves them.
  completed_at   TEXT,

  -- The action item this ticket was converted from, if any. Stored on this side
  -- only: one column makes the link queryable in both directions, and a second
  -- column on action_items would be a copy that can fall out of step.
  converted_from_action_item_id TEXT REFERENCES action_items(id) ON DELETE SET NULL,

  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

  -- A ticket that is finished must say when, and one that is not must not.
  CHECK (
    (status IN ('done','cancelled') AND completed_at IS NOT NULL)
    OR (status NOT IN ('done','cancelled') AND completed_at IS NULL)
  ),
  CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date)
);

CREATE INDEX idx_tickets_project ON tickets (project_id);
CREATE INDEX idx_tickets_status ON tickets (status);
CREATE INDEX idx_tickets_due ON tickets (due_date);
CREATE INDEX idx_tickets_assignee ON tickets (assignee COLLATE NOCASE);

-- An action item converts to a ticket once. A second conversion would produce
-- two tickets for one commitment, which is the duplicate problem the Asana push
-- already learned to refuse.
CREATE UNIQUE INDEX idx_tickets_converted_from
  ON tickets (converted_from_action_item_id)
  WHERE converted_from_action_item_id IS NOT NULL;

-- --- Time entries: ticket link and rate -------------------------------------
--
-- ticket_id lands now even though nothing writes it yet. The ruling was
-- arithmetic rather than judgement: a nullable column today is free, and adding
-- it after there is data is a table rebuild under D38, which this project has
-- already paid for twice.
ALTER TABLE time_entries ADD COLUMN ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL;

-- The rate that applied to this entry, in cents per hour. Nullable forever:
-- entries recorded before rates existed have no rate and never will, and that
-- is correct rather than missing data.
ALTER TABLE time_entries ADD COLUMN rate_cents INTEGER
  CHECK (rate_cents IS NULL OR rate_cents >= 0);

CREATE INDEX idx_time_entries_ticket ON time_entries (ticket_id);

-- --- Clients: a default rate ------------------------------------------------
--
-- Offered when a time entry is created, never imposed. The computation is
-- hours times rate and it produces a suggestion; the amount on an invoice stays
-- whatever was entered, forever. That was the ruling and it is also the only
-- safe reading: invoices already issued were issued for a number, and a formula
-- applied retroactively would rewrite history.
ALTER TABLE clients ADD COLUMN default_rate_cents INTEGER
  CHECK (default_rate_cents IS NULL OR default_rate_cents >= 0);
