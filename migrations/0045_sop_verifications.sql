-- The verification log. P7.
--
-- A SOP says what to check at each step. Until now there was nowhere to record
-- that somebody did, so compliance was a claim and the fault rate was
-- anecdotal: "the automation gets it wrong sometimes" is not a number anybody
-- can act on.
--
-- One row per verification event. Who checked, when, which step, what they were
-- looking at, and whether it passed. The fault rate falls straight out of it,
-- which is what closes SOP-001's first open question: how often the procedure
-- fails becomes measurable from the same record that shows it was followed.
--
-- A table in the app rather than a section in the document, deliberately. A log
-- kept inside a SOP body would be edited into the procedure itself, and a SOP
-- version is immutable history: every verification would create a new version
-- of the procedure, which is exactly backwards.

CREATE TABLE sop_verifications (
  id            TEXT PRIMARY KEY,
  sop_id        TEXT NOT NULL REFERENCES sops(id) ON DELETE CASCADE,

  -- Which step was checked. Null means the whole procedure was run through,
  -- which is a real and different fact from checking step 3 on its own.
  step_number   INTEGER,

  -- What was being verified: the meeting, the invoice, the record. Free text,
  -- because it names something in another system and this app should not
  -- pretend to hold a key for it.
  subject       TEXT NOT NULL,

  verified_by   TEXT NOT NULL,
  verified_at   TEXT NOT NULL,

  -- pass or fault. Two values on purpose: a verification that found a problem
  -- is the entire point of keeping the log, and burying it in a note would
  -- make the fault rate unreadable.
  outcome       TEXT NOT NULL CHECK (outcome IN ('pass', 'fault')),

  -- Required when the outcome is a fault. A fault with no description is a
  -- number with nothing behind it, and the next person cannot act on it.
  note          TEXT,

  created_at    TEXT NOT NULL,

  CHECK (outcome = 'pass' OR (note IS NOT NULL AND TRIM(note) != '')),
  CHECK (step_number IS NULL OR step_number > 0)
);

CREATE INDEX sop_verifications_by_sop ON sop_verifications (sop_id, verified_at DESC);
