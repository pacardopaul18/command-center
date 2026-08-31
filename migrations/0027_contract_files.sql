-- Migration 0027: the signed contract, as a file.
--
-- `contracts` from 0010 records what was agreed: a title, dates, a value, a
-- fulfillment status. It has never held the document. The redesigned client
-- page puts an upload box beside it with one line of copy that settles the
-- design question: "Upload signed files as they are, several at once. Nothing
-- is authored in here."
--
-- That is the right boundary and it is worth saying why. Authoring a contract
-- in this app would mean a template engine, a version history and, eventually,
-- somebody relying on a document this app generated in a dispute. Filing the
-- signed PDF where the client's other facts live costs nothing and is what the
-- question "what did we actually agree" needs.
--
-- Files hang off the client, not off a `contracts` row. A signed PDF usually
-- arrives before anybody records terms, and requiring a contract row first
-- would mean either refusing the upload or inventing a row to hang it on.
-- `contract_id` is here and nullable so a file can be attached to specific
-- terms later, which is a small update rather than a migration.
--
-- Same shape as `expense_receipts` from 0020, deliberately. Two tables that
-- hold a file in R2 and a row in D1 should look the same, and a reader who has
-- met one has met both. Bytes in R2 keyed by `r2_key`, never in D1: a row that
-- inlined a PDF would be read by every listing that touched the table.
--
-- A new table, no ALTER, which the freeze requires and this wanted anyway.

CREATE TABLE contract_files (
  id TEXT PRIMARY KEY,

  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- The terms this document is the evidence for, when they have been recorded.
  -- Cleared rather than cascaded if those terms are deleted: the signed file is
  -- the more durable fact of the two.
  contract_id TEXT REFERENCES contracts(id) ON DELETE SET NULL,

  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),

  -- Where the bytes are. Never a URL and never the bytes themselves.
  r2_key TEXT NOT NULL,

  uploaded_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_contract_files_client ON contract_files (client_id, uploaded_at DESC);
CREATE INDEX idx_contract_files_contract ON contract_files (contract_id);

-- One row per object, so a failed insert cannot leave two rows pointing at one
-- file and a delete of either one cannot orphan the other.
CREATE UNIQUE INDEX idx_contract_files_key ON contract_files (r2_key);
