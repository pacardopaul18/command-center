-- Migration 0006: AI-extracted action item proposals.
--
-- New table only. No rebuild, so D38 does not apply; D39 still does, and this
-- goes to remote behind a snapshot.
--
-- Why a table rather than a JSON column on meetings, or transient results:
--
-- The architecture doc is explicit that AI extraction gets names, dates and
-- ownership wrong, and that a human review step must sit before anything is
-- routed. That review is worthless if it cannot be interrupted. A proposal has
-- to survive a page reload, and accepting one has to be recorded so re-opening
-- the meeting does not offer it again and quietly create a duplicate.
--
-- So a proposal is a real row with a real lifecycle: pending, accepted, or
-- rejected. Accepting one writes an action item and records which one, which is
-- the audit trail from "the model suggested this" to "this is being tracked".
--
-- Nothing here is an action item. A proposal that is never accepted never
-- becomes work, which is the entire point.

CREATE TABLE meeting_action_proposals (
  id             TEXT PRIMARY KEY,
  meeting_id     TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  context        TEXT,
  owner          TEXT,
  deadline       TEXT,
  -- The model's own judgement that something is unclear. Architecture section
  -- A calls for ambiguous items to be flagged immediately rather than left to
  -- stall, so the model is asked to say so and the reason is kept.
  ambiguous      INTEGER NOT NULL DEFAULT 0 CHECK (ambiguous IN (0, 1)),
  ambiguity_note TEXT,
  -- The span of transcript the model says this came from. A reviewer checking a
  -- name or a date should not have to search the transcript by hand.
  evidence       TEXT,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'rejected')),
  -- Set when accepted. The link from proposal to the work it became.
  action_item_id TEXT REFERENCES action_items(id) ON DELETE SET NULL,
  -- Which model produced it, so a later accuracy question can be answered.
  model          TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  reviewed_at    TEXT,
  CHECK (status != 'accepted' OR action_item_id IS NOT NULL)
);

CREATE INDEX idx_proposals_meeting ON meeting_action_proposals (meeting_id, status);
CREATE INDEX idx_proposals_action_item ON meeting_action_proposals (action_item_id);

-- ON DELETE CASCADE on meeting_id is deliberate and is the one cascade in the
-- schema. A proposal has no meaning without its meeting: it is a suggestion
-- about that transcript, not a record of work. Accepted proposals leave behind
-- an action item, which survives independently under its own ON DELETE SET NULL.
