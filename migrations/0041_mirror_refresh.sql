-- Migration 0041: the mirror knows when it was last refreshed.
--
-- The accuracy audit found the app faithful to the mirror and the mirror two
-- days behind Asana, because the pull was a one-time snapshot and nothing
-- re-pulled. Eleven tasks and one status across twelve projects, and no sign of
-- it anywhere on screen.
--
-- Two columns, and the second is the point.

/*
 * When an incremental refresh last completed.
 *
 * Separate from `finished_at`, which records the end of a full pull. A refresh
 * and a full pull answer different questions and must not overwrite each other:
 * "when did we last walk everything" and "when did we last catch up" are both
 * worth knowing, and one column would lose whichever ran second.
 */
ALTER TABLE asana_sync_state ADD COLUMN refreshed_at TEXT;

/*
 * The watermark the next refresh asks Asana about.
 *
 * NOT A CURSOR, and the distinction is the whole of D169. A cursor is where the
 * walk got to, and a timestamp cursor loses rows on ties and re-syncs the world
 * on a bulk edit. This is a query filter: "what changed since", asked of Asana,
 * with identity and upsert still entirely by gid. Nothing here decides where
 * the walk resumes.
 *
 * Stored a little behind the true finish time on purpose. Asana's
 * `modified_since` is exclusive and two writes can land in the same second, so
 * a watermark set exactly at the finish can skip a task modified during the
 * run. Overlapping costs nothing because every write is an upsert keyed on gid:
 * re-reading a row that has not changed is wasted bytes, and missing one is a
 * wrong number on a screen.
 */
ALTER TABLE asana_sync_state ADD COLUMN refresh_watermark TEXT;
