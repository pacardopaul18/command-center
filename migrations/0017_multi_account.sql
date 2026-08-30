-- Multi-account foundation. E1.
--
-- D38 APPLIES IN FULL, AND THE HAZARD IS THE LARGEST THIS PROJECT HAS FACED.
--
-- The only blocker to a second Google account is `UNIQUE (provider)` on
-- `connections`, added in 0011. SQLite cannot drop a table constraint, and the
-- implicit auto-index behind it cannot be dropped either, so the table has to
-- be rebuilt. Seven tables cascade off it, 1,675 rows in total.
--
-- WHY EVERY DEPENDENT IS STASHED, WRITTEN DOWN BECAUSE THE FIRST VERSION OF
-- THIS MIGRATION DID NOT AND DESTROYED ALL OF THEM.
--
-- The first attempt relied on `PRAGMA defer_foreign_keys` alone, on the
-- reasoning that the cascade would be held until commit and the rebuilt table
-- would restore the same primary keys before constraints were checked. That is
-- true only inside an explicit transaction. Statements applied in autocommit
-- each commit on their own, there is nothing to defer to, and the cascade fires
-- the instant `connections` is dropped.
--
-- Tested against a restore of the real production snapshot: 865 messages, 775
-- threads and every other dependent went to zero. The verification step caught
-- it and aborted, which is the only reason this is a paragraph rather than an
-- incident.
--
-- So: stash everything that cascades, rebuild, restore in dependency order,
-- and verify the counts. The pattern is 0005's, and the lesson is that the
-- ceremony is not optional just because a pragma looks like it covers it.

PRAGMA defer_foreign_keys = true;

-- ---------------------------------------------------------------------------
-- 1. Capture the counts we must end with.
-- ---------------------------------------------------------------------------

CREATE TABLE _0017_counts (
  tbl TEXT PRIMARY KEY,
  before_n INTEGER NOT NULL
);

INSERT INTO _0017_counts (tbl, before_n) VALUES
  ('connections',        (SELECT COUNT(*) FROM connections)),
  ('email_messages',     (SELECT COUNT(*) FROM email_messages)),
  ('email_threads',      (SELECT COUNT(*) FROM email_threads)),
  ('email_attachments',  (SELECT COUNT(*) FROM email_attachments)),
  ('calendars',          (SELECT COUNT(*) FROM calendars)),
  ('calendar_events',    (SELECT COUNT(*) FROM calendar_events)),
  ('email_ingest_state', (SELECT COUNT(*) FROM email_ingest_state)),
  ('email_drafts',       (SELECT COUNT(*) FROM email_drafts));

-- ---------------------------------------------------------------------------
-- 2. Stash every row that would cascade.
--
-- `CREATE TABLE ... AS SELECT` copies data without copying constraints, so the
-- stash tables have no foreign keys of their own and nothing cascades into
-- them when the parent goes.
-- ---------------------------------------------------------------------------

CREATE TABLE _0017_connections       AS SELECT * FROM connections;
CREATE TABLE _0017_email_threads     AS SELECT * FROM email_threads;
CREATE TABLE _0017_email_messages    AS SELECT * FROM email_messages;
CREATE TABLE _0017_email_attachments AS SELECT * FROM email_attachments;
CREATE TABLE _0017_email_drafts      AS SELECT * FROM email_drafts;
CREATE TABLE _0017_calendars         AS SELECT * FROM calendars;
CREATE TABLE _0017_calendar_events   AS SELECT * FROM calendar_events;
CREATE TABLE _0017_ingest_state      AS SELECT * FROM email_ingest_state;

-- ---------------------------------------------------------------------------
-- 3. Rebuild connections without UNIQUE(provider).
-- ---------------------------------------------------------------------------

DROP TABLE connections;

CREATE TABLE connections (
  id TEXT PRIMARY KEY,

  provider TEXT NOT NULL CHECK (provider IN ('google')),

  -- Now part of the identity rather than incidental detail. One row per
  -- account per provider, which is the whole point of E1.
  account_email TEXT,

  granted_scopes TEXT,

  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connected', 'needs_reauth', 'disconnected')),

  status_note TEXT,

  connected_at TEXT,
  last_refresh_at TEXT,
  last_read_at TEXT,

  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  -- WAS: UNIQUE (provider), which permitted exactly one Google account. It is
  -- also why the OAuth callback used ON CONFLICT(provider) DO UPDATE, which
  -- would have silently replaced Paul's account with any second one connected.
  UNIQUE (provider, account_email)
);

-- ---------------------------------------------------------------------------
-- 4. Restore, parents before children.
-- ---------------------------------------------------------------------------

INSERT INTO connections
  (id, provider, account_email, granted_scopes, status, status_note,
   connected_at, last_refresh_at, last_read_at, created_at, updated_at)
SELECT
   id, provider, account_email, granted_scopes, status, status_note,
   connected_at, last_refresh_at, last_read_at, created_at, updated_at
FROM _0017_connections;

INSERT INTO email_threads      SELECT * FROM _0017_email_threads;
INSERT INTO email_messages     SELECT * FROM _0017_email_messages;
INSERT INTO email_attachments  SELECT * FROM _0017_email_attachments;
INSERT INTO email_drafts       SELECT * FROM _0017_email_drafts;
INSERT INTO calendars          SELECT * FROM _0017_calendars;
INSERT INTO calendar_events    SELECT * FROM _0017_calendar_events;
INSERT INTO email_ingest_state SELECT * FROM _0017_ingest_state;

DROP TABLE _0017_connections;
DROP TABLE _0017_email_threads;
DROP TABLE _0017_email_messages;
DROP TABLE _0017_email_attachments;
DROP TABLE _0017_email_drafts;
DROP TABLE _0017_calendars;
DROP TABLE _0017_calendar_events;
DROP TABLE _0017_ingest_state;

-- The trigger was defined on the old table and went with it.
CREATE TRIGGER trg_connections_connected_needs_account
BEFORE UPDATE ON connections
WHEN NEW.status = 'connected' AND (NEW.account_email IS NULL OR TRIM(NEW.account_email) = '')
BEGIN
  SELECT RAISE(ABORT, 'A connected account must record which account it is.');
END;

-- ---------------------------------------------------------------------------
-- 5. Spend becomes attributable per account.
-- ---------------------------------------------------------------------------

ALTER TABLE ai_usage ADD COLUMN connection_id TEXT;

-- Deliberately no foreign key. Usage is a ledger: a record of money spent must
-- survive the account it was spent on being disconnected, or the bill loses
-- the rows that explain it.

CREATE INDEX idx_ai_usage_connection ON ai_usage (connection_id, at DESC);

-- ---------------------------------------------------------------------------
-- 6. Verify. A mismatch aborts rather than reporting success.
--
-- RAISE(ABORT) inside a trigger is the only way SQLite offers to fail a
-- statement conditionally, so the check is an insert into a table whose
-- trigger refuses the row when any count moved. This is what caught the first
-- version of this migration deleting everything.
-- ---------------------------------------------------------------------------

CREATE TABLE _0017_verify (checked_at TEXT);

CREATE TRIGGER trg_0017_verify
BEFORE INSERT ON _0017_verify
WHEN (
  SELECT COUNT(*) FROM _0017_counts c WHERE c.before_n <> (
    CASE c.tbl
      WHEN 'connections'        THEN (SELECT COUNT(*) FROM connections)
      WHEN 'email_messages'     THEN (SELECT COUNT(*) FROM email_messages)
      WHEN 'email_threads'      THEN (SELECT COUNT(*) FROM email_threads)
      WHEN 'email_attachments'  THEN (SELECT COUNT(*) FROM email_attachments)
      WHEN 'calendars'          THEN (SELECT COUNT(*) FROM calendars)
      WHEN 'calendar_events'    THEN (SELECT COUNT(*) FROM calendar_events)
      WHEN 'email_ingest_state' THEN (SELECT COUNT(*) FROM email_ingest_state)
      WHEN 'email_drafts'       THEN (SELECT COUNT(*) FROM email_drafts)
    END
  )
) > 0
BEGIN
  SELECT RAISE(ABORT, 'Row counts changed during the connections rebuild. Migration aborted.');
END;

INSERT INTO _0017_verify (checked_at) VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

DROP TRIGGER trg_0017_verify;
DROP TABLE _0017_verify;
DROP TABLE _0017_counts;
