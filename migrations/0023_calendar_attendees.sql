-- Calendar: attendees, and a place to record that an event was cancelled.
--
-- NEW TABLES ONLY. `calendar_events` is on the rehearsal freeze list, so the
-- two facts that would naturally be columns on it live in a side table instead:
-- whether the event was cancelled, and what Paul answered. Both are per event
-- and one to one, so a side table costs a join and nothing else.
--
-- CANCELLED IS A STATUS, NOT A DELETION. A cancelled meeting is information:
-- it was in the diary, it is not any more, and the row is the provenance of
-- both. The view excludes it; the record keeps it.
--
-- Before this, `listEvents` filtered cancelled events out at the fetch and the
-- upsert only ever inserted or updated. An event cancelled in Google was simply
-- never mentioned again and its row stayed forever, so a meeting Paul cancelled
-- would still be sitting on his week view.

CREATE TABLE calendar_event_state (
  event_id TEXT PRIMARY KEY REFERENCES calendar_events(id) ON DELETE CASCADE,

  -- When Google last reported this event as cancelled. NULL means it stands.
  cancelled_at TEXT,

  -- Paul's own answer: accepted, declined, tentative, needsAction. Stored
  -- because "am I going" is a different question from "does this exist", and
  -- a declined meeting should not read the same as an accepted one.
  own_response TEXT CHECK (
    own_response IS NULL
    OR own_response IN ('accepted', 'declined', 'tentative', 'needsAction')
  ),

  updated_at TEXT NOT NULL
);

CREATE INDEX idx_calendar_event_state_cancelled ON calendar_event_state(cancelled_at);

-- Who is coming.
--
-- The mapper kept only a count, so "event detail with attendees" could not be
-- built from stored data at all. Names and response status are what turn a
-- number into an answer to "who is this with".
--
-- No connection_id: an attendee belongs to an event, and the event already
-- knows its account. Repeating it would be a second place for the same fact to
-- be wrong. D131.
CREATE TABLE calendar_event_attendees (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  response_status TEXT,
  is_organizer INTEGER NOT NULL DEFAULT 0,
  is_self INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_calendar_attendees_event ON calendar_event_attendees(event_id);

-- One row per person per event. A re-sync replaces rather than duplicates, and
-- an attendee with no address (Google allows it for resources) is keyed by name.
CREATE UNIQUE INDEX idx_calendar_attendees_unique
  ON calendar_event_attendees(event_id, COALESCE(email, display_name, id));

-- How far back each calendar has been filled, so the first sync can reach back
-- 90 days once and later syncs need not.
CREATE TABLE calendar_sync_state (
  calendar_id TEXT PRIMARY KEY REFERENCES calendars(id) ON DELETE CASCADE,
  backfilled_from TEXT,
  last_synced_at TEXT,
  updated_at TEXT NOT NULL
);
