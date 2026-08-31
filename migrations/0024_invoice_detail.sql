-- Migration 0024: what an invoice is made of, and how a client is billed.
--
-- The invoicing screen was rebuilt around the client rather than the invoice
-- (see the redesign handoff in docs/design/invoicing-redesign). That redesign
-- asks four things of the schema that were genuinely absent, and no amount of
-- page work conjures them:
--
--   1. Line items. An invoice carried one number, so the screen could show a
--      total and nothing about what it was for. Quantity, rate and description
--      per line is the whole of the design's expanded row.
--   2. A trail. Created, sent, reminded, paid was in the mock and in nobody's
--      database. Every state change an invoice went through was unrecorded, so
--      the only history was the current status.
--   3. Estimates, credit notes and voids. All three are documents that look
--      like an invoice and must not count as one.
--   4. A billing profile per client: where the invoice goes, on what schedule,
--      and whether the next one is raised automatically.
--
-- D38 does not apply. Every change here is an ADD COLUMN or a new table, so no
-- table is rebuilt, no DROP fires a referential action, and the payment
-- triggers on `invoices` from 0020 keep working untouched. Stated at the site
-- where the next reader will wonder whether the ceremony was skipped.
--
-- Money stays INTEGER cents throughout, per 0004. Quantities are REAL for the
-- same reason hours are: they are counted and multiplied for display, and
-- quarter-hour increments are exact in binary.

-- --- Line items -------------------------------------------------------------

CREATE TABLE invoice_line_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,

  -- Display order, set by the form. Not a sort on created_at: reordering a line
  -- is a thing people do, and created_at cannot express it.
  position INTEGER NOT NULL,

  -- What was billed. Free text from a short catalogue offered in the form
  -- rather than a foreign key: a products table is a second entity, and this
  -- one user's catalogue is eight strings that change when the work changes.
  service TEXT NOT NULL,
  description TEXT,

  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_rate_cents INTEGER NOT NULL CHECK (unit_rate_cents >= 0),

  -- quantity * unit_rate_cents, rounded once, at write.
  --
  -- Deliberate duplication. The alternative is rounding on every read, and two
  -- readers that round differently produce two totals for one invoice. Rounding
  -- at the moment of writing makes the line's contribution a fact rather than a
  -- recomputation, and the invoice total is the sum of these rows rather than
  -- the sum of a product nobody has agreed how to round.
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_invoice_line_items_invoice ON invoice_line_items (invoice_id, position);

-- --- The trail --------------------------------------------------------------

-- One row per thing that happened to an invoice.
--
-- Append only by convention: nothing updates or deletes these rows, because a
-- history that can be edited is not a history. The kinds are closed so the
-- screen can group them, and 'note' is the escape hatch for anything a person
-- wants recorded that the system did not do itself.
CREATE TABLE invoice_events (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,

  -- When it happened, which is not always when it was recorded: a reminder
  -- written from Gmail yesterday is logged today and dated yesterday.
  occurred_at TEXT NOT NULL,

  kind TEXT NOT NULL CHECK (kind IN (
    'created', 'edited', 'issued', 'reminded', 'payment',
    'voided', 'converted', 'duplicated', 'note'
  )),

  -- One plain sentence, already formatted for reading. The screen prints it as
  -- it stands, so a trail written today still reads correctly after the code
  -- that wrote it has changed.
  detail TEXT NOT NULL,

  created_at TEXT NOT NULL
);

CREATE INDEX idx_invoice_events_invoice ON invoice_events (invoice_id, occurred_at);

-- --- Invoices: the document, beyond its total -------------------------------

-- What kind of document this is. An invoice is a receivable; the other two are
-- not, and every balance, band and total in the new endpoints filters on this.
--
-- An estimate is a quote that has not been agreed. A credit note is money owed
-- back. Both look like invoices, print like invoices, and would silently
-- inflate what the firm is owed if they were counted as invoices, which is the
-- whole reason the column exists rather than a naming convention on
-- invoice_number.
--
-- No CHECK: SQLite cannot add one to an existing table without a rebuild, and a
-- rebuild here means dropping a table that three triggers and a ledger foreign
-- key depend on. Validated in the API instead, against a constant the page
-- shares. Recorded so nobody reads the missing CHECK as an oversight.
ALTER TABLE invoices ADD COLUMN kind TEXT NOT NULL DEFAULT 'invoice';

-- What the work was, in two levels, because the design's table shows both and
-- because "Consulting, contract renewal" is how the work gets described.
ALTER TABLE invoices ADD COLUMN category TEXT;
ALTER TABLE invoices ADD COLUMN subcategory TEXT;

-- The message printed on the invoice itself. Not a note about the invoice:
-- that is what an invoice_events row of kind 'note' is for.
ALTER TABLE invoices ADD COLUMN message TEXT;

-- Discount and tax, kept as both the instruction and the result.
--
-- discount_kind and discount_value are what was asked for: ten percent off, or
-- 250 off. discount_cents and tax_cents are what that came to on this invoice.
-- Storing only the instruction means recomputing money on every read; storing
-- only the result means the screen cannot show what was asked for and an edit
-- has to guess. Both, written together, is the honest shape.
ALTER TABLE invoices ADD COLUMN discount_kind TEXT;
ALTER TABLE invoices ADD COLUMN discount_value REAL NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN tax_percent REAL NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0;

-- The sum of the line items before discount and tax.
--
-- Nullable on purpose. The 900 invoices already in the database predate line
-- items and have no subtotal, and inventing one by copying amount_cents would
-- assert a breakdown that does not exist. NULL means this invoice was written
-- before invoices had parts, and the screen says so rather than showing a
-- fabricated single line.
ALTER TABLE invoices ADD COLUMN subtotal_cents INTEGER;

-- Void, as a date rather than a status.
--
-- Void cannot join the status CHECK without rebuilding the table, and it does
-- not belong there anyway: status tracks how much has been paid, and a voided
-- invoice is not a payment state. A voided document keeps its number, keeps its
-- trail, and stops counting toward anything.
ALTER TABLE invoices ADD COLUMN voided_at TEXT;

-- Set when this invoice is one of a repeating series. The frequency lives on
-- the invoice as well as on the client because a client may have one recurring
-- retainer and any number of one-off invoices beside it.
ALTER TABLE invoices ADD COLUMN recurring_frequency TEXT;

-- Where this document came from: the estimate it was converted from, the
-- invoice it was duplicated from, or the recurring invoice that raised it.
ALTER TABLE invoices ADD COLUMN source_invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL;

CREATE INDEX idx_invoices_kind ON invoices (kind);
CREATE INDEX idx_invoices_client_issue ON invoices (client_id, issue_date);

-- --- Clients: the billing profile -------------------------------------------

-- Where the invoice is addressed. Contact name, email and phone deliberately do
-- NOT move here: `contacts` already holds them, one row per person with a
-- single primary per client, and copying them onto clients would create two
-- places for one fact and a day where they disagree.
ALTER TABLE clients ADD COLUMN billing_address TEXT;

-- How often this client is billed, as a label: Monthly, Fortnightly, Ad hoc. It
-- describes the arrangement. Whether anything is raised automatically is the
-- separate question below, because a monthly client can be billed by hand for
-- years.
ALTER TABLE clients ADD COLUMN billing_schedule TEXT;

-- Automation, and the honest limit of it.
--
-- auto_recurring raises the next invoice as a DRAFT on auto_frequency, from
-- auto_next_date onward. A draft, never a sent document: this app has no way to
-- send mail to a client, asserted by test rather than promised, in
-- tests/layer2-no-send-surface.test.ts. The furthest automation can go is
-- putting a document in front of Paul with the work already on it.
ALTER TABLE clients ADD COLUMN auto_recurring INTEGER NOT NULL DEFAULT 0
  CHECK (auto_recurring IN (0, 1));
ALTER TABLE clients ADD COLUMN auto_frequency TEXT;
ALTER TABLE clients ADD COLUMN auto_next_date TEXT;

-- digest_reminders puts this client's overdue invoices in the start of day
-- digest. That is what a reminder can be here: a prompt to Paul, not a message
-- to the client. The cadence names when the prompt starts, relative to the due
-- date.
ALTER TABLE clients ADD COLUMN digest_reminders INTEGER NOT NULL DEFAULT 0
  CHECK (digest_reminders IN (0, 1));
ALTER TABLE clients ADD COLUMN reminder_cadence TEXT;

-- Addresses carried into the Gmail compose link the screen builds. Prefill
-- only. Nothing here causes mail to leave this machine.
ALTER TABLE clients ADD COLUMN billing_cc TEXT;
