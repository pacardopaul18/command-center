-- Migration 0039: a commitment becomes a proposal, never an action item.
--
-- The Action items page is empty because nothing generates them. The context
-- pass extracts commitments from correspondence, and the obvious move is to
-- turn each one into an action item. That is the move this table exists to
-- prevent.
--
-- A commitment is the model's reading of a sentence in an email. Some of those
-- readings are wrong, and an action item is a statement that Paul owes somebody
-- something. Writing them directly would fill the one screen that says what he
-- owes people with things he may not owe anybody, and the screen would stop
-- being believed within a week. Once that happens no amount of accuracy brings
-- it back.
--
-- So the same shape as `meeting_action_proposals`, deliberately: a proposal
-- carries its evidence, a human accepts or rejects it, and only an accepted one
-- becomes an action item. The two tables stay separate rather than being merged
-- into one polymorphic proposals table, because their provenance differs in
-- kind. A meeting proposal points at a span of transcript; this points at a
-- specific message in a specific thread, and a shared table would have to make
-- both nullable and lose the NOT NULL that makes provenance real.

CREATE TABLE mail_action_proposals (
  id TEXT PRIMARY KEY,

  /*
   * The commitment this came from. NOT NULL, for the reason the commitment's
   * own source_message_id is NOT NULL: a proposal with no source is a claim
   * that Paul promised something with nothing to show for it.
   */
  commitment_id TEXT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,

  /** The thread and message, denormalised so a reviewer can open the evidence. */
  thread_id TEXT REFERENCES email_threads(id) ON DELETE SET NULL,
  source_message_id TEXT REFERENCES email_messages(id) ON DELETE SET NULL,

  title TEXT NOT NULL,
  context TEXT,
  owner TEXT,

  /*
   * A date only where the message stated one.
   *
   * `due_signal` is what the message said in its own words; `deadline` is a
   * date only when one was actually given. An inferred deadline on a proposal
   * is a fabrication with a date on it, and it would be accepted as fact the
   * moment somebody clicks accept.
   */
  due_signal TEXT,
  deadline TEXT,

  ambiguous INTEGER NOT NULL DEFAULT 0 CHECK (ambiguous IN (0, 1)),
  ambiguity_note TEXT,

  /** The sentence the model read this out of, so nobody has to search the thread. */
  evidence TEXT,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),

  /** Set when accepted. The link from proposal to the work it became. */
  action_item_id TEXT REFERENCES action_items(id) ON DELETE SET NULL,

  /** Where the thread mapped, when it mapped anywhere. Never guessed. */
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,

  /** Which model produced the commitment, so an accuracy question is answerable. */
  model TEXT,

  created_at TEXT NOT NULL,
  reviewed_at TEXT,

  -- Accepted means it became something. The database refuses the state where a
  -- proposal claims to have been accepted and points at nothing.
  CHECK (status != 'accepted' OR action_item_id IS NOT NULL),

  -- One proposal per commitment. Running the generator twice must not offer
  -- Paul the same sentence to review a second time.
  UNIQUE (commitment_id)
);

CREATE INDEX idx_mail_proposals_status ON mail_action_proposals (status, created_at);
CREATE INDEX idx_mail_proposals_thread ON mail_action_proposals (thread_id);
