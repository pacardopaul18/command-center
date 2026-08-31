-- Migration 0025: a trail on an action item.
--
-- The redesigned tracker opens a row to a history: captured from a call,
-- reminder sent, deadline pushed, moved to waiting, marked done. None of that
-- was recorded anywhere. An item carried its current state and no account of
-- how it got there, so the only answer to "why is this still open" was to ask
-- the person who last touched it.
--
-- A new table, not a column, and not only because of the freeze: this is one to
-- many by nature and could never have been a column. Same shape as
-- invoice_events from 0024, deliberately. Two tables that record the same kind
-- of fact should look the same, and a reader who has met one has met both.
--
-- Append only by convention. Nothing updates or deletes these rows, because a
-- history that can be edited is not a history.
--
-- THE FREEZE. `action_items` is a rehearsal surface table and takes no ALTER
-- before Thursday. Three fields the redesign draws are therefore not built
-- here: priority, effort, and who a waiting item is waiting on. They are
-- columns on the item and nothing else, so faking them in a side table would
-- mean creating a table to delete two days later. The screen ships without
-- them rather than with a worse version of them, and the columns land on
-- Thursday in one ALTER.

CREATE TABLE action_item_events (
  id TEXT PRIMARY KEY,
  action_item_id TEXT NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,

  -- When it happened, which is not always when it was recorded.
  occurred_at TEXT NOT NULL,

  kind TEXT NOT NULL CHECK (kind IN (
    'created', 'edited', 'status', 'deadline', 'owner', 'reminded', 'ticket', 'note'
  )),

  -- One plain sentence, already formatted for reading, so a trail written today
  -- still reads correctly after the code that wrote it has changed.
  detail TEXT NOT NULL,

  created_at TEXT NOT NULL
);

CREATE INDEX idx_action_item_events_item ON action_item_events (action_item_id, occurred_at);
