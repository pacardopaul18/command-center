-- Migration 0031: a stop on what the AI may spend.
--
-- The finding this exists for: there was no spend stop of any kind. `costCents`
-- was written, tested and exported, and had no caller outside its own test. The
-- only dollar figure in the running app was a display constant the meter route
-- returned, which nothing read to decide anything. The exposure was twenty-nine
-- cents; the problem was the belief that a control existed.
--
-- Two allowances, and they do not mix. That separation is the whole design.
--
-- The monthly ceiling is the ongoing cost of the app running: triage on new
-- mail, a draft here and there, a meeting summarised. It is a recurring number
-- and it should stay small.
--
-- A backfill allowance is a one-off: a corpus pass over mail that already
-- exists, which is a known quantity of work done once. Charging it against the
-- monthly ceiling would mean one corpus pass eating the month and every
-- ordinary call after it being refused, which is a stop firing on exactly the
-- wrong thing. Letting the monthly ceiling absorb it silently is the same
-- failure in the other direction: the month looks fine and the corpus pass was
-- never separately accountable.
--
-- Attribution rather than a time window. A run could have been "everything
-- between these two timestamps", and that would have swept up every ordinary
-- call made while a backfill happened to be running, which is the mixing this
-- is built to prevent. So each usage row is attributed to a run explicitly, at
-- the moment it is recorded, or to nothing.
--
-- A side table rather than a column on `ai_usage`, because `ai_usage` is an
-- existing table and takes no ALTER before Thursday. It is also the better
-- shape: most usage belongs to no run, and a column would be null on almost
-- every row.

CREATE TABLE ai_budget_runs (
  id TEXT PRIMARY KEY,

  -- What the run is, in words, and unique so two runs cannot share a name and
  -- have their spend silently added together.
  name TEXT NOT NULL,

  -- The one-off allowance for this run, in cents. Ruled at 50 USD for the first
  -- corpus pass; stored per run rather than as a constant because the next one
  -- is a different size.
  allowance_cents INTEGER NOT NULL CHECK (allowance_cents > 0),

  started_at TEXT NOT NULL,

  -- Set when the run is finished. A closed run stops accepting attribution, so
  -- a stray call afterwards falls to the monthly ceiling where it belongs
  -- rather than quietly drawing on an allowance nobody is watching any more.
  closed_at TEXT,

  note TEXT
);

CREATE UNIQUE INDEX idx_ai_budget_runs_name ON ai_budget_runs (name);

-- One row per attributed call. The primary key is the usage row, so a call can
-- belong to at most one run: attributing it twice is not a thing that can
-- happen, rather than a thing the code is careful about.
CREATE TABLE ai_run_usage (
  usage_id TEXT PRIMARY KEY REFERENCES ai_usage(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES ai_budget_runs(id) ON DELETE CASCADE,

  /*
   * The cost in cents at the time of the call, stored rather than recomputed.
   *
   * Deliberately unlike everything else in this app, which derives money at
   * read time. Prices change, and a run's spend is a historical fact about what
   * was actually incurred: recomputing it from today's price list would quietly
   * rewrite what a completed run cost. The monthly figure is recomputed from
   * current prices on purpose, because it is a live budget rather than a
   * record.
   */
  cost_cents REAL NOT NULL,

  at TEXT NOT NULL
);

CREATE INDEX idx_ai_run_usage_run ON ai_run_usage (run_id, at);
