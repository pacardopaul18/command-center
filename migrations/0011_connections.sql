-- Connections to outside accounts. Google first, built dark.
--
-- D38 does not apply: one new table, nothing rebuilt.
--
-- WHAT IS DELIBERATELY NOT HERE: the tokens.
--
-- The estimate said "connections, holding OAuth tokens" and this table does not
-- hold them. The reason is D58's nightly backup, which enumerates
-- `sqlite_master` and dumps every table in the database to R2. A refresh token
-- is a long-lived credential that can mint access tokens until it is revoked.
-- Putting one in a D1 table means writing that credential, in plaintext, into a
-- new R2 object every night, and keeping it there for the whole retention
-- window. The backup was built to make data recoverable, and it would silently
-- have become a mechanism for spreading a credential.
--
-- So tokens live in KV under `google:tokens`, and this table holds only what is
-- safe to back up: which account is connected, what it may read, and when it
-- was last refreshed. KV is not part of the D1 dump.
--
-- The consequence is deliberate and correct: restoring a backup gives back the
-- connection record without the credential, and the app says "reconnect". A
-- restored database should not silently regain the ability to read somebody's
-- mail.

CREATE TABLE connections (
  id TEXT PRIMARY KEY,

  provider TEXT NOT NULL CHECK (provider IN ('google')),

  -- Which account this is. Shown in Settings so that "connected" is never
  -- ambiguous about whose data is being read.
  account_email TEXT,

  -- Space separated, exactly as Google returned them. Stored rather than
  -- assumed, because what was actually granted can be narrower than what was
  -- requested, and acting on the request is how an app ends up calling an
  -- endpoint it has no permission for.
  granted_scopes TEXT,

  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connected', 'needs_reauth', 'disconnected')),

  -- Why it needs attention, in words. Same shape as the Asana sync note: a
  -- marker nobody can act on is not worth setting.
  status_note TEXT,

  connected_at TEXT,
  last_refresh_at TEXT,
  last_read_at TEXT,

  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  -- One connection per provider. This is a single-user app and two Google
  -- connections would make "which account did this read come from" a question
  -- with no answer.
  UNIQUE (provider)
);

-- A connected account must say which account it is. "Connected" with no email
-- is the state where Paul cannot tell whose calendar he is looking at, and it
-- is reachable if a token exchange half succeeds.
CREATE TRIGGER trg_connections_connected_needs_account
BEFORE UPDATE ON connections
WHEN NEW.status = 'connected' AND (NEW.account_email IS NULL OR TRIM(NEW.account_email) = '')
BEGIN
  SELECT RAISE(ABORT, 'A connected account must record which account it is.');
END;

-- Cached calendar events, so the app can show a day without calling Google on
-- every page load. Read only in every sense: nothing here is ever written back.
CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,

  -- Google's own event id, so a re-read updates rather than duplicates.
  provider_event_id TEXT NOT NULL,

  summary TEXT,
  description TEXT,
  location TEXT,

  -- Stored as Google returns them: an all-day event carries a date, a timed
  -- event carries an instant. Flattening the two loses which kind it was.
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),

  organizer TEXT,
  attendee_count INTEGER,
  html_link TEXT,

  -- Set when Paul links an event to a meeting record. Nothing does this
  -- automatically: guessing which calendar entry became which meeting would be
  -- wrong often enough to be worse than not guessing.
  meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,

  fetched_at TEXT NOT NULL,

  UNIQUE (connection_id, provider_event_id),
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

CREATE INDEX idx_calendar_events_start ON calendar_events (starts_at);
