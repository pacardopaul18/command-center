-- Triage, and keeping the rich body so mail can be read rather than decoded.
--
-- D38 does not apply: nullable columns added by ALTER, nothing rebuilt.
--
-- TWO PROBLEMS, ONE MIGRATION.
--
-- First, the stored body was the stripped-text version. That is right for
-- feeding a summariser and wrong for showing a person: a marketing email
-- stripped of its markup is a wall of tracking URLs, which is what Paul saw and
-- correctly called broken. The rich body is now kept and `body_format` records
-- which kind it is, so a reader can be rendered properly and a summariser can
-- still be given something plain.
--
-- Second, triage. The summariser already understood that a thread was an
-- automated job alert with nothing to decide; that understanding just had
-- nowhere to live. These columns are that home.

ALTER TABLE email_messages ADD COLUMN body_format TEXT
  CHECK (body_format IS NULL OR body_format IN ('text', 'html'));

-- NULL means the body predates this migration and is stripped text. That is
-- also the signal the ingest uses to know a message is worth re-reading: a
-- message with no recorded format has an impoverished body, so one more pass
-- upgrades it rather than skipping it forever.

ALTER TABLE email_threads ADD COLUMN category TEXT
  CHECK (category IS NULL OR category IN
    ('correspondence', 'automated', 'newsletter', 'notification'));

ALTER TABLE email_threads ADD COLUMN severity TEXT
  CHECK (severity IS NULL OR severity IN ('urgent', 'important', 'routine', 'noise'));

-- One line, for the list. Distinct from `summary`, which is paragraphs and
-- belongs inside the thread. Putting a summary in a list row is what made the
-- list unreadable: a list needs a label and a glance, not an essay.
ALTER TABLE email_threads ADD COLUMN gist TEXT;

ALTER TABLE email_threads ADD COLUMN classified_at TEXT;
ALTER TABLE email_threads ADD COLUMN classified_model TEXT;

-- Paul's corrections. Kept SEPARATE from the model's answer rather than
-- overwriting it, for two reasons. The pair is the training signal: what the
-- model said next to what it should have said is the only thing that can teach
-- it, and overwriting destroys exactly the half that carries the lesson. And a
-- correction must survive re-classification, which overwriting would not.
ALTER TABLE email_threads ADD COLUMN category_override TEXT
  CHECK (category_override IS NULL OR category_override IN
    ('correspondence', 'automated', 'newsletter', 'notification'));

ALTER TABLE email_threads ADD COLUMN severity_override TEXT
  CHECK (severity_override IS NULL OR severity_override IN
    ('urgent', 'important', 'routine', 'noise'));

ALTER TABLE email_threads ADD COLUMN corrected_at TEXT;

-- Triage state that belongs to this app and is never pushed to Gmail.
--
-- Archiving in Gmail needs `gmail.modify`, a write scope this app deliberately
-- never requested (D70, D82). So archived here means archived here. The mailbox
-- is untouched, which is the whole point: read like Gmail, organise like Gmail,
-- never write to Gmail.
ALTER TABLE email_threads ADD COLUMN archived_at TEXT;
ALTER TABLE email_threads ADD COLUMN read_at TEXT;

CREATE INDEX idx_email_threads_triage
  ON email_threads (COALESCE(severity_override, severity), last_at DESC);

CREATE INDEX idx_email_threads_archived ON email_threads (archived_at);
