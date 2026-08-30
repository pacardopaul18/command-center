-- Calendars, chosen one by one.
--
-- D38 does not apply: one new table plus a nullable column added by ALTER.
--
-- `calendar.readonly` already lists every calendar the account can see, which
-- includes every calendar anybody has shared with Paul. So subscribing to a
-- colleague's calendar needs no new permission at all: they share it in Google,
-- which is ordinary office behaviour, and it appears here.
--
-- Nothing syncs by default. A list of every calendar an account can see is
-- mostly noise, holidays and week numbers included, and pulling all of them
-- would spend the budget on events nobody asked for. Each one is turned on
-- deliberately.

CREATE TABLE calendars (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,

  provider_calendar_id TEXT NOT NULL,
  summary TEXT,
  description TEXT,
  time_zone TEXT,

  -- Google's own flags, stored rather than inferred. `access_role` in
  -- particular says whether this is Paul's calendar or one shared with him,
  -- which is exactly the distinction the partner conversation will care about.
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  access_role TEXT,
  background_color TEXT,

  -- Off until chosen. See the header.
  sync_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sync_enabled IN (0, 1)),

  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  UNIQUE (connection_id, provider_calendar_id)
);

CREATE INDEX idx_calendars_enabled ON calendars (sync_enabled);

-- Which calendar an event came from. Nullable because events already stored
-- predate the concept and belong to the primary calendar.
ALTER TABLE calendar_events ADD COLUMN calendar_id TEXT REFERENCES calendars(id) ON DELETE CASCADE;

CREATE INDEX idx_calendar_events_calendar ON calendar_events (calendar_id);
