-- Migration 0029: what a project is made of, and what happened on a ticket.
--
-- The redesigned Projects module draws five things none of which had a row
-- anywhere: milestones, files, ticket comments, links between tickets, and time
-- logged against a ticket. All five are one to many, so all five are tables and
-- none could have been a column. Being new tables also satisfies the freeze,
-- but that is not why they are tables.
--
-- What is deliberately not here: a budget on the project. The prototype draws a
-- Budget used tile, and budget is a scalar on `projects`, which takes no ALTER
-- before Thursday. Inventing a side table to hold one number would be a table
-- to delete two days later, so the tile is absent rather than fabricated.

-- --- milestones ------------------------------------------------------------
--
-- `projects.next_milestone` is a free-text column somebody types. It stays,
-- because it is what every existing project has, but once a project has real
-- milestones the next undone one is the honest answer and the column is a
-- second place the same fact lives. The read prefers the rows and falls back to
-- the column, so a project with neither still says something true.

CREATE TABLE project_milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  title TEXT NOT NULL,

  -- When it is meant to land. Optional: a milestone with no date is still a
  -- milestone, and forcing one would mean inventing dates.
  due_date TEXT,

  -- When it actually did. Null means outstanding. A boolean would lose the
  -- date, and the date is what makes a slipped plan legible afterwards.
  done_at TEXT,

  -- Explicit order, because milestones are a sequence and sorting by date puts
  -- an undated one in an arbitrary place.
  position INTEGER NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_project_milestones_project ON project_milestones (project_id, position);

-- --- files -----------------------------------------------------------------
--
-- Same shape as `contract_files` from 0027 and `expense_receipts` from 0020,
-- deliberately. Three tables that hold a file in R2 and a row in D1 should look
-- the same, and a reader who has met one has met all three.

CREATE TABLE project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),

  -- Where the bytes are. Never a URL and never the bytes themselves.
  r2_key TEXT NOT NULL,

  uploaded_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_project_files_project ON project_files (project_id, uploaded_at DESC);
CREATE UNIQUE INDEX idx_project_files_key ON project_files (r2_key);

-- --- what happened on a ticket ---------------------------------------------
--
-- One table for both a person's comment and the app's own record of a status
-- change, because on screen they are one list read in one order. Separating
-- them would mean merging two queries by timestamp in the Worker to rebuild the
-- thing the reader was always going to see.
--
-- Append only by convention. Nothing updates or deletes these rows: a history
-- that can be edited is not a history. Same rule as invoice_events in 0024 and
-- action_item_events in 0025, and the same shape.

CREATE TABLE ticket_events (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,

  kind TEXT NOT NULL CHECK (kind IN (
    'comment', 'created', 'status', 'priority', 'assignee', 'due', 'linked', 'time'
  )),

  -- One plain sentence, already formatted for reading, so a line written today
  -- still reads correctly after the code that wrote it has changed.
  detail TEXT NOT NULL,

  -- Who said it, for a comment. Null for a line the app wrote about itself.
  author TEXT,

  created_at TEXT NOT NULL
);

CREATE INDEX idx_ticket_events_ticket ON ticket_events (ticket_id, created_at);

-- --- tickets that are about each other --------------------------------------
--
-- Stored once per pair, not twice. A row saying A blocks B is the same fact as
-- B is blocked by A, and writing both means two rows that can be deleted
-- separately and disagree. The read looks in both directions and inverts the
-- kind, which is arithmetic rather than storage.

CREATE TABLE ticket_links (
  id TEXT PRIMARY KEY,

  from_ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  to_ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,

  -- Read as "from <kind> to". 'blocks' has an inverse, 'relates' is its own.
  kind TEXT NOT NULL CHECK (kind IN ('blocks', 'relates', 'duplicates')),

  created_at TEXT NOT NULL,

  -- One link per ordered pair. A second link of a different kind between the
  -- same two tickets is a contradiction, not extra information.
  UNIQUE (from_ticket_id, to_ticket_id),

  -- A ticket cannot block itself.
  CHECK (from_ticket_id <> to_ticket_id)
);

CREATE INDEX idx_ticket_links_from ON ticket_links (from_ticket_id);
CREATE INDEX idx_ticket_links_to ON ticket_links (to_ticket_id);

-- --- time against a ticket --------------------------------------------------
--
-- Separate from `time_entries`, which is billable time against a client and a
-- billing period and feeds an invoice. This is effort against a ticket, which
-- is a different question with a different audience: one answers "what do we
-- bill", the other answers "what did this actually take". Merging them would
-- mean every logged hour needing a client and a rate before anyone could record
-- that a bug took an afternoon.

CREATE TABLE ticket_time (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,

  -- Minutes, not hours. Hours as a float means 0.1 + 0.2 and a total that ends
  -- in 0.30000000000000004, and rounding it for display hides the drift rather
  -- than removing it. The same argument money makes for cents.
  minutes INTEGER NOT NULL CHECK (minutes > 0),

  logged_on TEXT NOT NULL,
  who TEXT,
  note TEXT,

  created_at TEXT NOT NULL
);

CREATE INDEX idx_ticket_time_ticket ON ticket_time (ticket_id, logged_on);
