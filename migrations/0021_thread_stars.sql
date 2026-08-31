-- Starred threads, as a table of their own.
--
-- A column on email_threads would be the obvious shape, and email_threads is on
-- the rehearsal freeze list. A new table needs no ALTER, carries no risk to the
-- surface the rehearsal exercises, and is the same cost to read: one LEFT JOIN
-- against a table with one row per starred thread.
--
-- No connection_id. A star belongs to the thread, and the thread already knows
-- which account it came from; repeating it here would be a second place for the
-- same fact to be wrong. D131.
CREATE TABLE thread_stars (
  thread_id TEXT PRIMARY KEY REFERENCES email_threads(id) ON DELETE CASCADE,
  starred_at TEXT NOT NULL
);

CREATE INDEX idx_thread_stars_at ON thread_stars(starred_at);
