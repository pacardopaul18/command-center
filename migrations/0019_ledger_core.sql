-- P3-E1: the ledger core.
--
-- Single entry by ruling. Double entry is out until an accountant asks for it,
-- because the thing being replaced is a spreadsheet, and a two-partner firm
-- reconciling one account does not need debits and credits to answer "what came
-- in and what went out".
--
-- NEW TABLES ONLY. Nothing here alters an existing table, which is the standing
-- rule until Thursday. The invoice-to-ledger posting path is defined in comment
-- here and wired in E2, so nothing about invoices changes yet.
--
-- REVENUE POSTS ON PAYMENT, cash basis, per the E2 pre-ruling. An issued
-- invoice is a receivable and not revenue; a partial payment posts the paid
-- portion. Billing periods post nothing of their own. That decision lives in
-- this comment rather than only in a ledger entry, because the posting code in
-- E2 will be read by whoever wires it and this is the first thing they need.

CREATE TABLE ledger_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,

  -- Income, expense, overhead. Overhead is separate from expense on purpose:
  -- rent and software are not the cost of a particular engagement, and a
  -- margin figure that treats them as one is wrong in the direction that
  -- flatters.
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'overhead')),

  -- One level of nesting is what a small firm's chart actually uses. A parent
  -- may not itself have a parent, enforced by trigger below, because a tree of
  -- unlimited depth turns every total into a recursive query for no gain here.
  parent_id TEXT REFERENCES ledger_categories(id) ON DELETE RESTRICT,

  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_ledger_categories_name ON ledger_categories(name);
CREATE INDEX idx_ledger_categories_parent ON ledger_categories(parent_id);

CREATE TABLE ledger_transactions (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES ledger_categories(id) ON DELETE RESTRICT,

  -- Both optional and independent. An overhead line belongs to neither; a
  -- retainer belongs to a client and no project; project work belongs to both.
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,

  txn_date TEXT NOT NULL,

  -- Minor units, named as every other money column in this schema already is.
  -- A second convention would mean every future query has to know which table
  -- it is reading before it knows what the number means.
  amount_cents INTEGER NOT NULL,

  -- Carried per row and never assumed. Nothing else in the schema has a
  -- currency column, which is exactly why one is needed the moment a second
  -- currency appears: totals must group by it, and a NULL here would be a
  -- silent invitation to add pesos to dollars.
  currency TEXT NOT NULL CHECK (length(currency) = 3),

  -- Where the row came from, so a hand-typed line and a posted invoice are
  -- distinguishable without inference.
  provenance TEXT NOT NULL CHECK (provenance IN ('manual', 'invoice', 'import')),
  source_invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,

  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_ledger_txn_date ON ledger_transactions(txn_date);
CREATE INDEX idx_ledger_txn_category ON ledger_transactions(category_id);
CREATE INDEX idx_ledger_txn_client ON ledger_transactions(client_id);
CREATE INDEX idx_ledger_txn_project ON ledger_transactions(project_id);

-- One posted row per invoice payment event, so a retried post cannot double
-- count. Partial index because most rows are manual and carry no invoice.
CREATE UNIQUE INDEX idx_ledger_txn_invoice
  ON ledger_transactions(source_invoice_id)
  WHERE source_invoice_id IS NOT NULL;

-- A project belongs to a client. A transaction naming both must name the same
-- client the project belongs to.
--
-- Enforced here rather than in the route because the route is not the only way
-- a row can arrive: an import, a posting job, or a later hand-fix all bypass
-- it, and a row whose client and project disagree cannot be explained by any
-- report that groups by either one. SQLite has no cross-table CHECK, so this is
-- a trigger, and it is written for both INSERT and UPDATE because a row can
-- become inconsistent by being edited as easily as by being created.
CREATE TRIGGER ledger_txn_client_project_agree_insert
BEFORE INSERT ON ledger_transactions
FOR EACH ROW WHEN NEW.project_id IS NOT NULL AND NEW.client_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'The project belongs to a different client than the one on this transaction.')
  WHERE (SELECT client_id FROM projects WHERE id = NEW.project_id) IS NOT NEW.client_id;
END;

CREATE TRIGGER ledger_txn_client_project_agree_update
BEFORE UPDATE ON ledger_transactions
FOR EACH ROW WHEN NEW.project_id IS NOT NULL AND NEW.client_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'The project belongs to a different client than the one on this transaction.')
  WHERE (SELECT client_id FROM projects WHERE id = NEW.project_id) IS NOT NEW.client_id;
END;

-- Categories nest one level. A parent with a parent would make every total a
-- recursive query, and nothing in a small firm's chart of accounts needs it.
CREATE TRIGGER ledger_category_one_level
BEFORE INSERT ON ledger_categories
FOR EACH ROW WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'A category may nest one level. Its parent already has a parent.')
  WHERE (SELECT parent_id FROM ledger_categories WHERE id = NEW.parent_id) IS NOT NULL;
END;

-- A child must share its parent's kind. Income nested under expense would make
-- the sign of a subtotal depend on which level you read it at.
CREATE TRIGGER ledger_category_kind_matches_parent
BEFORE INSERT ON ledger_categories
FOR EACH ROW WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'A child category must have the same kind as its parent.')
  WHERE (SELECT kind FROM ledger_categories WHERE id = NEW.parent_id) IS NOT NEW.kind;
END;
