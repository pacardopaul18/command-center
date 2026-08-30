-- Gmail read: ingested mail, threads, and the state of the ingestion itself.
--
-- D38 does not apply: three new tables, nothing rebuilt.
--
-- WHERE THE BODIES GO, AND WHY NOT HERE.
--
-- Metadata lives in D1. Bodies live in R2, referenced by `body_key`. This is
-- the same reasoning as 0011 and it matters more here, not less.
--
-- D58's nightly backup enumerates `sqlite_master` and writes every D1 table to
-- R2. A body column would mean copying the full text of Paul's mailbox into a
-- new R2 object every night, for the whole retention window, growing without
-- bound. Bodies in R2 are written once and referenced.
--
-- Subjects and snippets ARE in D1 and so they are in the nightly dump. That is
-- a deliberate, narrower exposure: they are what makes a list readable, and a
-- list nobody can scan is not worth ingesting for. The full text is the part
-- that does not need copying nightly.
--
-- Nothing here can be written back to Gmail. No send scope exists (D70/D82).

CREATE TABLE email_threads (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  provider_thread_id TEXT NOT NULL,

  -- The most recent subject on the thread. Subjects drift as people reply, so
  -- this is a display convenience and never an identifier.
  subject TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  first_at TEXT,
  last_at TEXT,

  -- Set when a sender matches a known contact. Never guessed from the domain:
  -- two clients can share gmail.com, and a wrong client attribution on somebody
  -- else's mail is worse than no attribution at all.
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,

  -- The AI pass. Null until one has run, and `summary_at` says when, so a stale
  -- summary on a thread that has since grown is visible rather than assumed
  -- current.
  summary TEXT,
  summary_model TEXT,
  summary_at TEXT,

  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  UNIQUE (connection_id, provider_thread_id)
);

CREATE INDEX idx_email_threads_last ON email_threads (last_at DESC);
CREATE INDEX idx_email_threads_client ON email_threads (client_id);

CREATE TABLE email_messages (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  thread_id TEXT REFERENCES email_threads(id) ON DELETE CASCADE,

  provider_message_id TEXT NOT NULL,
  provider_thread_id TEXT NOT NULL,

  subject TEXT,
  from_email TEXT,
  from_name TEXT,
  -- Recipients as Gmail returned them, joined. Not normalised into a table:
  -- lean, and nothing in this pass queries by recipient.
  to_emails TEXT,
  cc_emails TEXT,

  -- From Gmail's `internalDate`, which is an instant. Rendered in Mountain
  -- Time by the display layer per D73, never stored shifted.
  sent_at TEXT NOT NULL,

  snippet TEXT,
  label_ids TEXT,
  is_unread INTEGER NOT NULL DEFAULT 0 CHECK (is_unread IN (0, 1)),

  -- R2 object holding the body. Null means the body was not stored, which is a
  -- real and expected state: a header-only pass is useful on its own.
  body_key TEXT,
  body_bytes INTEGER CHECK (body_bytes IS NULL OR body_bytes >= 0),

  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,

  fetched_at TEXT NOT NULL,

  UNIQUE (connection_id, provider_message_id),

  -- A recorded size with no object, or an object with no size, means one of the
  -- two writes did not happen. Either way the row is lying about what is in R2.
  CHECK ((body_key IS NULL AND body_bytes IS NULL) OR (body_key IS NOT NULL AND body_bytes IS NOT NULL))
);

CREATE INDEX idx_email_messages_sent ON email_messages (sent_at DESC);
CREATE INDEX idx_email_messages_thread ON email_messages (thread_id);
CREATE INDEX idx_email_messages_from ON email_messages (from_email);
CREATE INDEX idx_email_messages_client ON email_messages (client_id);

-- Ingestion is long, batched and resumable, so its state is a record rather
-- than a variable held in a request that will not survive.
CREATE TABLE email_ingest_state (
  connection_id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'running', 'paused', 'done', 'failed')),

  window_days INTEGER NOT NULL DEFAULT 30 CHECK (window_days > 0),

  -- Gmail's own pagination cursor. Null while idle or finished; holding one is
  -- what makes a run resumable rather than restartable.
  page_token TEXT,

  -- Gmail's `resultSizeEstimate`. An estimate, named as one, because showing it
  -- as a total would make a progress readout that never quite reaches its end
  -- look broken when it is merely honest.
  total_estimate INTEGER,

  discovered INTEGER NOT NULL DEFAULT 0,
  fetched INTEGER NOT NULL DEFAULT 0,

  started_at TEXT,
  updated_at TEXT,
  finished_at TEXT,
  last_error TEXT
);

-- A failed run must say why. Same rule as the ambiguous Asana link: a marker
-- nobody can act on is not worth setting.
CREATE TRIGGER trg_email_ingest_failed_needs_reason
BEFORE UPDATE ON email_ingest_state
WHEN NEW.status = 'failed' AND (NEW.last_error IS NULL OR TRIM(NEW.last_error) = '')
BEGIN
  SELECT RAISE(ABORT, 'A failed ingest must record why it failed.');
END;
