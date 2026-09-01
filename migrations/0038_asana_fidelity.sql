-- Migration 0038: a ticket synced from Asana arrives complete.
--
-- The ALTER freeze is lifted. It existed to protect a rehearsal that did not
-- happen, and it is now the thing stopping Paul from reviewing his own data.
--
-- The standard this sets, stated plainly because it is the point: a ticket
-- created in Asana and synced must arrive with everything Asana holds about it.
-- The first projection carried a title, a description, two dates and
-- complete-or-not, because those were the only columns that existed. Assignee
-- identity, priority, estimates, tags, custom field values, followers and the
-- section name had nowhere to go and were reported as dropped. Reporting them
-- was right; leaving them dropped was temporary.
--
-- WHY COLUMNS HERE AND SIDE TABLES THERE. A field that belongs to one ticket
-- and that the app itself might author gets a column: Paul creates tickets in
-- this app too, and those need a priority and an assignee as much as Asana's
-- do. A field that is a set, or whose shape belongs to the workspace rather
-- than to the app, gets a side table. Widening `tickets` with a tags column
-- would mean parsing a delimited string, and a custom field column per
-- definition would mean a migration every time somebody edits a dropdown in
-- Asana.
--
-- THESE ARE THE APP'S OWN ROWS, not a second mirror. The mirror stays the
-- record of what Asana said; these are the projection's output and the
-- projection rewrites them. That is why every one is nullable: a ticket Paul
-- writes here has no Asana anything.

-- --- fidelity columns on the ticket -------------------------------------------

/*
 * The section a task sits in, exactly as Asana spells it.
 *
 * The app's own status is deliberately coarse, because Asana's real vocabulary
 * is 103 section names across 66 projects and mapping those is Thursday's
 * reconciliation. Carrying the section onto the ticket means the screen can
 * show the app's guess beside the fact it was guessed from. D171.
 */
ALTER TABLE tickets ADD COLUMN asana_section TEXT;

/*
 * Who Asana says is on it, by gid.
 *
 * `assignee` already exists and holds a display name. That is what a person
 * reads, and it is useless for grouping: two people can share a name and one
 * person can be renamed. The gid is the identity, and it joins to asana_users
 * for anything that needs the current spelling.
 *
 * No user rows are invented for these people. Six Asana assignees are not six
 * members of this app, and creating them would put strangers in a roster
 * nobody added.
 */
ALTER TABLE tickets ADD COLUMN asana_assignee_gid TEXT;

/** Asana's own last-modified, kept so a stale projection is visible as stale. */
ALTER TABLE tickets ADD COLUMN asana_modified_at TEXT;

/** A direct link back. The one thing that makes "open this in Asana" possible. */
ALTER TABLE tickets ADD COLUMN asana_url TEXT;

CREATE INDEX idx_tickets_asana_assignee ON tickets (asana_assignee_gid);
CREATE INDEX idx_tickets_asana_section ON tickets (asana_section);

-- --- tags ---------------------------------------------------------------------
--
-- A set, so a table. Named rather than keyed to the Asana tag, because a ticket
-- Paul writes here can carry a tag that exists nowhere in Asana, and a foreign
-- key to the mirror would make the app's own tags impossible.

CREATE TABLE ticket_tags (
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,

  /* 'asana' rows are the projection's to rewrite. Manual ones are not. */
  source TEXT NOT NULL DEFAULT 'asana' CHECK (source IN ('asana', 'manual')),

  PRIMARY KEY (ticket_id, tag)
);

CREATE INDEX idx_ticket_tags_tag ON ticket_tags (tag);

-- --- followers ----------------------------------------------------------------
--
-- Asana's watchers. The app has an assignee and a reporter and no watcher list,
-- and 2,958 follower rows is not a field worth discarding: "who else is
-- expecting this" is a real question about a ticket.

CREATE TABLE ticket_followers (
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,

  /** Gid where it came from Asana, so the name can be looked up rather than frozen. */
  person_gid TEXT,

  /** The spelling at projection time, for anything with no gid. */
  name TEXT NOT NULL,

  source TEXT NOT NULL DEFAULT 'asana' CHECK (source IN ('asana', 'manual')),

  PRIMARY KEY (ticket_id, name)
);

-- --- custom fields ------------------------------------------------------------
--
-- Keyed, not columnar. A custom field can be renamed, retyped or deleted in
-- Asana at any time, and a column per definition would need a migration every
-- time somebody edits a dropdown.
--
-- The value is Asana's own `display_value`, a string, for the same reason the
-- mirror stores it that way: the typed value is recoverable from the mirror if
-- one specific field ever earns real handling, and until then a string is what
-- a screen renders anyway.

CREATE TABLE ticket_custom_values (
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,

  /** The field's Asana gid, so a rename does not orphan the value. */
  field_gid TEXT NOT NULL,

  /** Its name at projection time, so a screen can label it without a join. */
  field_name TEXT NOT NULL,
  field_type TEXT,

  display_value TEXT NOT NULL,

  PRIMARY KEY (ticket_id, field_gid)
);

CREATE INDEX idx_ticket_custom_values_field ON ticket_custom_values (field_gid);

-- --- projects ------------------------------------------------------------------

/** Asana's own link, for the same reason the ticket has one. */
ALTER TABLE projects ADD COLUMN asana_url TEXT;

/*
 * Whether the phase and status on this project were set by a person.
 *
 * Both are otherwise derived, from ticket completion, overdue counts and target
 * dates. A derived value that somebody has overridden must say so, or the next
 * derivation quietly reverts their decision and they have no way to know why.
 * The screen shows the override; this is what it reads.
 */
ALTER TABLE projects ADD COLUMN phase_is_manual INTEGER NOT NULL DEFAULT 0
  CHECK (phase_is_manual IN (0, 1));

ALTER TABLE projects ADD COLUMN status_is_manual INTEGER NOT NULL DEFAULT 0
  CHECK (status_is_manual IN (0, 1));
