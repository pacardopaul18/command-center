-- P3-E2: payments as events, and the ledger posting keyed to them.
--
-- WHY THIS CHANGES 0019, WRITTEN DOWN BECAUSE 0019 GOT IT WRONG.
--
-- 0019 put a unique partial index on ledger_transactions(source_invoice_id) to
-- stop a retried post from double counting. That guard was keyed on the invoice,
-- and the event it was guarding is a payment. One invoice can receive several
-- payments, so the index did not make a retry safe: it made the second partial
-- payment impossible to post at all. 110 of 900 seeded invoices are part paid,
-- so that is the ordinary case rather than an edge.
--
-- The lesson, recorded in the ledger as a finding: an idempotency guard must be
-- keyed on the event it guards, and the event has to exist as a record before
-- the guard can be designed. When 0019 was written there was no payment record
-- at all, only a running total on the invoice, and a guard was invented for an
-- event the schema could not name.
--
-- The ALTER here is permitted: the freeze protects the tables the rehearsal
-- exercises, and ledger_transactions was created this session, holds no
-- production rows, and no rehearsal step touches it.

-- One row per payment received. This is the record that did not exist.
--
-- amount_paid_cents on the invoice was a cumulative figure with no history, so
-- there was no date a payment arrived, no way to tell one payment from two, and
-- nothing to key a posting to. Cash basis needs all three.
CREATE TABLE invoice_payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,

  -- The date money arrived, which is the date the ledger entry carries. Not the
  -- invoice date and not today: under cash basis this is the whole point.
  paid_on TEXT NOT NULL,

  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT,
  reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_invoice_payments_invoice ON invoice_payments(invoice_id);
CREATE INDEX idx_invoice_payments_date ON invoice_payments(paid_on);

-- The ledger row points at the payment that produced it.
ALTER TABLE ledger_transactions ADD COLUMN source_payment_id TEXT REFERENCES invoice_payments(id) ON DELETE SET NULL;

-- The guard, re-keyed onto the event it guards. A retried post of the same
-- payment is refused; a second payment on the same invoice is not.
DROP INDEX idx_ledger_txn_invoice;

CREATE UNIQUE INDEX idx_ledger_txn_payment
  ON ledger_transactions(source_payment_id)
  WHERE source_payment_id IS NOT NULL;

-- source_invoice_id stays, without the uniqueness, because "which invoice did
-- this revenue come from" is still worth answering directly.
CREATE INDEX idx_ledger_txn_invoice_ref ON ledger_transactions(source_invoice_id);

-- The paid figure is derived from the payments, on every write.
--
-- It used to be set directly by a PATCH that trusted its caller, which is how a
-- paid total and the payments behind it come to disagree with nothing saying
-- so. Recomputed in the database rather than in the route, so an import or a
-- correction made by hand cannot leave the two out of step. Status follows the
-- same numbers, which is what the old route did and is worth keeping.
CREATE TRIGGER invoice_paid_after_payment_insert
AFTER INSERT ON invoice_payments
BEGIN
  UPDATE invoices SET
    amount_paid_cents = (
      SELECT COALESCE(SUM(amount_cents), 0) FROM invoice_payments WHERE invoice_id = NEW.invoice_id
    ),
    status = CASE
      WHEN (SELECT COALESCE(SUM(amount_cents), 0) FROM invoice_payments WHERE invoice_id = NEW.invoice_id)
           >= amount_cents THEN 'paid'
      WHEN (SELECT COALESCE(SUM(amount_cents), 0) FROM invoice_payments WHERE invoice_id = NEW.invoice_id)
           > 0 THEN 'partial'
      ELSE status
    END,
    updated_at = NEW.created_at
  WHERE id = NEW.invoice_id;
END;

CREATE TRIGGER invoice_paid_after_payment_update
AFTER UPDATE ON invoice_payments
BEGIN
  UPDATE invoices SET
    amount_paid_cents = (
      SELECT COALESCE(SUM(amount_cents), 0) FROM invoice_payments WHERE invoice_id = NEW.invoice_id
    ),
    status = CASE
      WHEN (SELECT COALESCE(SUM(amount_cents), 0) FROM invoice_payments WHERE invoice_id = NEW.invoice_id)
           >= amount_cents THEN 'paid'
      WHEN (SELECT COALESCE(SUM(amount_cents), 0) FROM invoice_payments WHERE invoice_id = NEW.invoice_id)
           > 0 THEN 'partial'
      ELSE 'sent'
    END,
    updated_at = NEW.updated_at
  WHERE id = NEW.invoice_id;
END;

-- A deleted payment must take its money back off the invoice, or a correction
-- leaves revenue behind that no payment supports.
CREATE TRIGGER invoice_paid_after_payment_delete
AFTER DELETE ON invoice_payments
BEGIN
  UPDATE invoices SET
    amount_paid_cents = (
      SELECT COALESCE(SUM(amount_cents), 0) FROM invoice_payments WHERE invoice_id = OLD.invoice_id
    ),
    status = CASE
      WHEN (SELECT COALESCE(SUM(amount_cents), 0) FROM invoice_payments WHERE invoice_id = OLD.invoice_id)
           >= (SELECT amount_cents FROM invoices WHERE id = OLD.invoice_id) THEN 'paid'
      WHEN (SELECT COALESCE(SUM(amount_cents), 0) FROM invoice_payments WHERE invoice_id = OLD.invoice_id)
           > 0 THEN 'partial'
      ELSE 'sent'
    END
  WHERE id = OLD.invoice_id;
END;

-- Payments may not exceed the invoice. The old route checked this and the check
-- has to survive the move, or the first overpayment is discovered in a report.
CREATE TRIGGER invoice_payments_not_over_invoice
BEFORE INSERT ON invoice_payments
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Payments would exceed the invoice amount.')
  WHERE (
    SELECT COALESCE(SUM(amount_cents), 0) FROM invoice_payments WHERE invoice_id = NEW.invoice_id
  ) + NEW.amount_cents > (SELECT amount_cents FROM invoices WHERE id = NEW.invoice_id);
END;

-- The category invoice payments post to.
--
-- Seeded with a fixed id so the posting code has something to name without a
-- setting, and so a fresh database and this one behave the same. It is an
-- ordinary category otherwise: it can be renamed, and it shows in the ledger
-- beside the hand-entered ones.
INSERT INTO ledger_categories (id, name, kind, parent_id, created_at, updated_at)
VALUES (
  'ledger-cat-client-payments',
  'Client payments',
  'income',
  NULL,
  '2026-08-31T00:00:00Z',
  '2026-08-31T00:00:00Z'
);

-- P3-E3: receipts against a ledger line.
--
-- Metadata in D1, bytes in R2, the same split meeting transcripts and mail
-- attachments already use. The row is the record; the object is what it points
-- at. ON DELETE CASCADE because a receipt for a transaction that no longer
-- exists is an orphan nothing can reach, and the bytes are cleaned up by the
-- route that deletes the row.
CREATE TABLE expense_receipts (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),

  -- Where the bytes are. Never a URL and never the bytes themselves: D1 is not
  -- a file store and a row that inlined a PDF would be read by every listing
  -- that touched the table.
  r2_key TEXT NOT NULL,

  uploaded_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_expense_receipts_transaction ON expense_receipts(transaction_id);
CREATE UNIQUE INDEX idx_expense_receipts_key ON expense_receipts(r2_key);
