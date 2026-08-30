-- Proposed replies, and what was attached to a message.
--
-- D38 does not apply: one new table plus nullable columns added by ALTER.
--
-- A DRAFT HERE IS NOT A GMAIL DRAFT.
--
-- Nothing in this schema can reach Gmail. There is no send scope, no compose
-- scope, and no column that could hold a Gmail draft id, because creating a
-- draft in Gmail requires `gmail.compose` and that was never requested either.
-- A row here is a proposed reply that lives in this app and is copied out by
-- hand if Paul wants it. That is the entire mechanism, and it is deliberate:
-- the app suggests words, a person sends them.
--
-- Separately: unsent drafts in Paul's own mailbox are never ingested at all.
-- Reading correspondence never meant reading things he wrote and chose not to
-- send. See the DRAFT label exclusion in mail-jobs.ts.

CREATE TABLE email_drafts (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,

  -- The proposal itself, as plain text. Not markup: a reply is pasted into a
  -- mail client, and markup would arrive as visible tags.
  body TEXT NOT NULL,

  -- What it was written from, so a draft can be told to be stale when the
  -- thread has moved on since.
  based_on_message_id TEXT REFERENCES email_messages(id) ON DELETE SET NULL,
  based_on_last_at TEXT,

  model TEXT,

  -- Paul's edit, kept beside the model's version rather than over it. Same rule
  -- as the triage override: the pair is what shows how far off the draft was,
  -- and overwriting destroys the half that carries the lesson.
  edited_body TEXT,
  edited_at TEXT,

  -- Set when Paul copies it out. Not proof it was sent, and named so it cannot
  -- be mistaken for proof: this app has no way to know whether a message was
  -- ever sent, and a column called `sent_at` would eventually be read as if it
  -- did.
  copied_at TEXT,

  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_email_drafts_thread ON email_drafts (thread_id);

-- One live draft per thread. A second proposal for the same conversation is a
-- replacement, not an addition, and two of them would leave Paul choosing
-- between drafts instead of deciding what to say.
CREATE UNIQUE INDEX idx_email_drafts_one_per_thread ON email_drafts (thread_id);

-- Attachment metadata. The file itself is fetched from Gmail on demand and
-- cached in R2, because most attachments are never opened and downloading every
-- one during ingest would spend the whole budget on files nobody wants.
CREATE TABLE email_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,

  -- Gmail's handle for the data. Long lived enough to fetch later, which is
  -- what makes on-demand download possible at all.
  provider_attachment_id TEXT,

  filename TEXT,
  mime_type TEXT,
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),

  -- Set once the file has been pulled into R2. Null means metadata only, which
  -- is the normal state and not an error.
  r2_key TEXT,
  fetched_at TEXT,

  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  UNIQUE (message_id, provider_attachment_id),

  -- A key with no fetch time, or a fetch time with no key, means one of the two
  -- writes did not happen and the row is lying about what is in storage.
  CHECK ((r2_key IS NULL AND fetched_at IS NULL) OR (r2_key IS NOT NULL AND fetched_at IS NOT NULL))
);

CREATE INDEX idx_email_attachments_message ON email_attachments (message_id);
