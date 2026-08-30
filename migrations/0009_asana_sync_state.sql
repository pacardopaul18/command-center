-- Two-way Asana sync: the state a link is in, and what to say about it.
--
-- D38 does not apply. Every column here is nullable and added by ALTER, which
-- SQLite performs in place. No table is rebuilt, so no referential action
-- fires and nothing needs stashing and restoring. Recorded here, at the site
-- where the next reader will wonder, for the same reason 0008 says it.
--
-- Three columns, each earning its place:
--
--   asana_sync_state  NULL until the item has ever been reconciled. 'ok' means
--                     the last poll resolved the gid and the two agree.
--                     'ambiguous' is D69: Asana no longer returns the task, or
--                     returns it in a state the sync cannot resolve.
--
--   asana_sync_note   Why. Always set when the state is 'ambiguous', and also
--                     used to record a local value that a pull overwrote, so a
--                     sync never destroys something without saying so.
--
--   asana_synced_at   When Asana last confirmed the link. Distinct from
--                     updated_at, which moves for local edits too, and it is
--                     the field that makes a stale link visible.
--
-- Deliberately absent: any column the sync would write to say an item is
-- deleted or closed. D69 is explicit that an unresolvable gid never touches
-- status and never clears the gid. There is no column here that could.

ALTER TABLE action_items ADD COLUMN asana_sync_state TEXT
  CHECK (asana_sync_state IS NULL OR asana_sync_state IN ('ok', 'ambiguous'));

ALTER TABLE action_items ADD COLUMN asana_sync_note TEXT;

ALTER TABLE action_items ADD COLUMN asana_synced_at TEXT;

-- A sync state without a gid is nonsense: it would claim a link that does not
-- exist. SQLite cannot add a table CHECK by ALTER, and the obvious trick of a
-- unique index on a constant expression does NOT work here: it permits the
-- first violating row and only rejects the second. That was tried and the row
-- went straight in, so it is written down rather than left for someone to
-- rediscover. Triggers state the rule exactly and fire on every row.

CREATE TRIGGER trg_action_items_sync_state_insert
BEFORE INSERT ON action_items
WHEN NEW.asana_sync_state IS NOT NULL AND NEW.asana_task_gid IS NULL
BEGIN
  SELECT RAISE(ABORT, 'An Asana sync state requires an Asana task gid.');
END;

CREATE TRIGGER trg_action_items_sync_state_update
BEFORE UPDATE ON action_items
WHEN NEW.asana_sync_state IS NOT NULL AND NEW.asana_task_gid IS NULL
BEGIN
  SELECT RAISE(ABORT, 'An Asana sync state requires an Asana task gid.');
END;

-- An ambiguous link must say why. A marker with no explanation is the state
-- D69 exists to prevent: a flag nobody can act on.
CREATE TRIGGER trg_action_items_ambiguous_needs_note
BEFORE UPDATE ON action_items
WHEN NEW.asana_sync_state = 'ambiguous'
 AND (NEW.asana_sync_note IS NULL OR TRIM(NEW.asana_sync_note) = '')
BEGIN
  SELECT RAISE(ABORT, 'An ambiguous Asana link must record why.');
END;
