-- E4: the context engine's store.
--
-- D38 does not apply: five new tables, nothing rebuilt.
--
-- WHY THESE FIVE, AND WHY MOST OF IT IS NOT AI.
--
-- The pre-audit found 21 threads of 775 are real correspondence, and 18 senders
-- across 7 domains carry all of it. That is small enough that the contact graph
-- is derivable from headers by rule, with no model involved at all, and it is
-- the reason this is affordable: the expensive passes run over 2 MB rather than
-- over 36.
--
-- Automated, newsletter and notification threads never enter the AI passes.
-- Untriaged waits for triage rather than being read speculatively. That is not
-- a cost optimisation bolted on afterwards, it is the shape of the thing: a
-- context engine that read every job alert would be paying to learn nothing.
--
-- EVERY ROW CARRIES ITS ACCOUNT AND ITS PROVENANCE. `connection_id` because
-- context crossing accounts is the failure D111 governs, and a source message
-- id because a claim about somebody with no way back to what produced it cannot
-- be checked, corrected, or defended.

-- ---------------------------------------------------------------------------
-- 1. Contacts, derived from headers. No AI.
-- ---------------------------------------------------------------------------

CREATE TABLE mail_contacts (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,

  email TEXT NOT NULL,
  display_name TEXT,
  domain TEXT,

  -- Counted, not guessed. These are the whole relevance signal before any model
  -- is asked anything, and the pre-audit found they already agree with triage:
  -- Paul replied in 19 of the 21 correspondence threads.
  messages_received INTEGER NOT NULL DEFAULT 0 CHECK (messages_received >= 0),
  messages_sent_to INTEGER NOT NULL DEFAULT 0 CHECK (messages_sent_to >= 0),
  threads_involved INTEGER NOT NULL DEFAULT 0 CHECK (threads_involved >= 0),
  threads_replied INTEGER NOT NULL DEFAULT 0 CHECK (threads_replied >= 0),

  first_seen TEXT,
  last_seen TEXT,

  -- Highest severity ever assigned to a thread this person appears in, as a
  -- cheap standing importance signal.
  top_severity TEXT
    CHECK (top_severity IS NULL OR top_severity IN ('urgent','important','routine','noise')),

  -- Set when this person matches a Client 360 contact. Never inferred from the
  -- domain: two clients can share gmail.com, and a wrong attribution is worse
  -- than a blank one because the blank is visibly missing.
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,

  derived_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  UNIQUE (connection_id, email)
);

CREATE INDEX idx_mail_contacts_conn ON mail_contacts (connection_id);
CREATE INDEX idx_mail_contacts_client ON mail_contacts (client_id);

-- ---------------------------------------------------------------------------
-- 2. Contact profiles. AI, Sonnet grade, 18 rows at today's scale.
-- ---------------------------------------------------------------------------

CREATE TABLE contact_profiles (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  mail_contact_id TEXT NOT NULL REFERENCES mail_contacts(id) ON DELETE CASCADE,

  relationship TEXT,
  usual_topics TEXT,
  expected_tone TEXT,
  open_commitments TEXT,

  model TEXT,
  -- Re-work keys on identity, never recency: the newest message that went into
  -- this profile. Unchanged means there is nothing new to read, so nothing to
  -- pay for. A timestamp would re-run on any touch that moved a row.
  built_from_message_id TEXT,
  built_at TEXT NOT NULL,

  UNIQUE (connection_id, mail_contact_id)
);

-- ---------------------------------------------------------------------------
-- 3. Thread digests. AI, Haiku grade, correspondence only.
-- ---------------------------------------------------------------------------

CREATE TABLE thread_digests (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,

  summary TEXT,
  decisions TEXT,
  open_asks TEXT,
  paul_commitments TEXT,

  -- Who the thread is waiting on. Kept as a constrained value rather than prose
  -- because it is the one field a screen sorts by, and prose does not sort.
  next_move TEXT CHECK (next_move IS NULL OR next_move IN ('paul','them','nobody','unclear')),

  model TEXT,
  built_from_message_id TEXT,
  built_at TEXT NOT NULL,

  UNIQUE (connection_id, thread_id)
);

CREATE INDEX idx_thread_digests_move ON thread_digests (next_move);

-- ---------------------------------------------------------------------------
-- 4. Voice profile. AI, Sonnet grade, one per account.
--
-- The single most important table for drafts sounding like Paul. Built from his
-- own sent messages, 46 of them today, because voice is shown rather than
-- described: an adjective produces the average of everyone ever described that
-- way.
-- ---------------------------------------------------------------------------

CREATE TABLE voice_profiles (
  connection_id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,

  greetings TEXT,
  sign_offs TEXT,
  sentence_length TEXT,
  formality TEXT,
  recurring_phrases TEXT,
  notes TEXT,

  -- How much evidence it was built from, so a profile drawn from four messages
  -- is not mistaken for one drawn from four hundred.
  built_from_messages INTEGER NOT NULL DEFAULT 0 CHECK (built_from_messages >= 0),
  model TEXT,
  built_from_message_id TEXT,
  built_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 5. Commitments ledger.
--
-- What Paul promised, and to whom. Feeds drafting so a reply cannot re-promise
-- something already promised or contradict something already agreed, which is
-- the failure that would make a draft actively worse than none.
-- ---------------------------------------------------------------------------

CREATE TABLE commitments (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  thread_id TEXT REFERENCES email_threads(id) ON DELETE CASCADE,

  -- Provenance is NOT NULL here on purpose. Everywhere else a missing source is
  -- untidy; on a commitment it is a claim that Paul promised something with
  -- nothing to show for it, which is worse than having no record at all.
  source_message_id TEXT NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,

  owed_by TEXT NOT NULL CHECK (owed_by IN ('paul','them')),
  owed_to TEXT,
  what TEXT NOT NULL,

  -- What the message actually said about timing, in its own words, plus a date
  -- only when one was stated. An inferred deadline in a commitments ledger is a
  -- fabrication with a date on it.
  due_signal TEXT,
  due_date TEXT,

  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','done','dropped','superseded')),

  model TEXT,
  built_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_commitments_conn ON commitments (connection_id, status);
CREATE INDEX idx_commitments_thread ON commitments (thread_id);

-- A commitment with no text is a row that says somebody promised something and
-- cannot say what.
CREATE TRIGGER trg_commitments_need_substance
BEFORE INSERT ON commitments
WHEN NEW.what IS NULL OR TRIM(NEW.what) = ''
BEGIN
  SELECT RAISE(ABORT, 'A commitment must say what was promised.');
END;
