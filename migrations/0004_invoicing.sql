-- Migration 0004: billing periods, time entries and invoices.
-- Data model is docs/Command_Center_Architecture.md section E.
--
-- Two deliberate deviations from the doc's field names, both recorded in
-- docs/DECISIONS.md:
--
-- 1. Money is stored as INTEGER cents in `amount_cents` and `amount_paid_cents`,
--    not as `amount` in a float. Binary floats cannot represent most decimal
--    money values exactly, so summing invoice totals in REAL drifts. Cents are
--    exact and the name says which unit it is, so nobody has to guess.
--
-- 2. `aging_bucket` is derived at read time, not stored. A stored bucket is
--    wrong the day after it is written, because the bucket depends on today.
--
-- Hours stay REAL. Billing is done in quarter-hour increments, which are exactly
-- representable in binary, and hours are summed for display rather than money.

CREATE TABLE billing_periods (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'reconciled', 'invoiced', 'paid')),
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (period_end >= period_start)
);

CREATE INDEX idx_billing_periods_client ON billing_periods (client_id);
CREATE INDEX idx_billing_periods_status ON billing_periods (status);

CREATE TABLE time_entries (
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  project_id        TEXT REFERENCES projects(id) ON DELETE SET NULL,
  billing_period_id TEXT REFERENCES billing_periods(id) ON DELETE SET NULL,
  entry_date        TEXT NOT NULL,
  hours             REAL NOT NULL CHECK (hours > 0),
  description       TEXT,
  billable          INTEGER NOT NULL DEFAULT 1 CHECK (billable IN (0, 1)),
  source            TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('clockify', 'manual')),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_time_entries_period ON time_entries (billing_period_id);
CREATE INDEX idx_time_entries_client_date ON time_entries (client_id, entry_date);
CREATE INDEX idx_time_entries_project ON time_entries (project_id);

CREATE TABLE invoices (
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  billing_period_id TEXT REFERENCES billing_periods(id) ON DELETE SET NULL,
  invoice_number    TEXT NOT NULL,
  issue_date        TEXT NOT NULL,
  due_date          TEXT NOT NULL,
  amount_cents      INTEGER NOT NULL CHECK (amount_cents >= 0),
  amount_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid_cents >= 0),
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'sent', 'partial', 'paid')),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (amount_paid_cents <= amount_cents),
  CHECK (due_date >= issue_date)
);

CREATE UNIQUE INDEX idx_invoices_number ON invoices (invoice_number COLLATE NOCASE);
CREATE INDEX idx_invoices_client ON invoices (client_id);
CREATE INDEX idx_invoices_due ON invoices (due_date);
CREATE INDEX idx_invoices_status ON invoices (status);

-- "overdue" is not a stored status. An invoice is overdue when it is unpaid and
-- its due date has passed, which is a question about today, not about the row.
-- Storing it would make every unpaid invoice wrong the morning after its due
-- date until something happened to rewrite it. Same reasoning as aging_bucket.
