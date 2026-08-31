-- Migration 0026: the people whose free time this app shows.
--
-- The calendar redesign draws a left rail of calendars: the ones the account
-- owns, and under them the people Paul follows so their busy blocks appear
-- beside his own when he is looking for a slot.
--
-- Follow and Leave are local, and that is the whole point. The prototype drew
-- them as Google's own subscribe and unsubscribe, which writes to the user's
-- CalendarList. This app holds calendar.readonly and will never hold more, so
-- the buttons keep their names and change only what this app shows. Nothing
-- here reaches Google's copy of anything. D70 is the rule; this table is how
-- the feature survives it.
--
-- What following buys is a free and busy read against that address. Google
-- answers with busy blocks and nothing else, and only when the person has
-- shared their free and busy, which is the sentence the screen already says.
-- No event title, no guest list, no location ever arrives through this path.
-- If the person has shared nothing, the answer is an empty list and the row
-- says so rather than pretending they are free.
--
-- Per connection, not global. Following someone on the work account has no
-- business changing what the personal account shows, and a single global list
-- would be the same defect D110 was: two accounts silently unioned.
--
-- A new table, no ALTER, which is what the freeze on the rehearsal surfaces
-- requires and what this feature wanted anyway.

CREATE TABLE followed_calendars (
  id TEXT PRIMARY KEY,

  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,

  -- The calendar address, which for a person is their email. Stored as given
  -- and compared lowercased, because Google treats them that way and a list
  -- holding both cases of one address would show the person twice.
  email TEXT NOT NULL,

  -- What to call them on screen. Optional: an address alone is a usable label.
  display_name TEXT,

  -- The dot beside their name, so two followed people are told apart at a
  -- glance in a week grid. Chosen by the app from a fixed set, never by Google.
  color TEXT,

  created_at TEXT NOT NULL,

  UNIQUE (connection_id, email)
);

CREATE INDEX idx_followed_calendars_conn ON followed_calendars (connection_id, email);
