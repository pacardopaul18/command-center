-- Cost controls: two tier triage, and a record of what the AI actually spent.
--
-- D38 does not apply: nullable columns added by ALTER, plus one new table.
--
-- THE POINT IS THAT NOT EVERY THREAD DESERVES THE EXPENSIVE MODEL.
--
-- Triage answers a four way question from a subject, a snippet and the start of
-- the first message. That is a job for a small fast model, and most of a
-- mailbox is noise that never needs anything further. A paragraph summary is
-- only worth writing for the threads that turned out to matter.
--
-- Keyed on the last message rather than on a timestamp. `summary_at < last_at`
-- works until two writes land in the same second, and it re-runs on any touch
-- that moves `last_at` without changing what was said. The id of the newest
-- message is exact: if it has not changed, there is nothing new to read.

ALTER TABLE email_threads ADD COLUMN triaged_message_id TEXT;
ALTER TABLE email_threads ADD COLUMN summary_message_id TEXT;

-- What each run cost, so the meter shows measured usage rather than an
-- estimate derived from counting rows.
CREATE TABLE ai_usage (
  id TEXT PRIMARY KEY,

  -- 'triage', 'summary' or 'draft'. Kept as free text with a CHECK rather than
  -- a foreign key: the set is small, and a new kind should be a one line change.
  kind TEXT NOT NULL CHECK (kind IN ('triage', 'summary', 'draft')),
  model TEXT NOT NULL,

  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),

  -- Null when the call was not about one thread, and set otherwise so a
  -- surprising bill can be traced to the conversation that caused it.
  thread_id TEXT,

  at TEXT NOT NULL
);

CREATE INDEX idx_ai_usage_at ON ai_usage (at DESC);
CREATE INDEX idx_ai_usage_kind ON ai_usage (kind, at DESC);
