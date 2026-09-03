-- What the section says about a ticket, kept apart from what the app says.
--
-- `tickets.status` is NOT NULL with a CHECK, so every ticket must carry one of
-- the six. Today that value means only what Asana reports: completed or not.
-- Writing a section-derived status into it would force every unmapped section
-- to pick one, and `open` would become the default bucket the ruling forbids:
-- 2,400 tasks claiming a status nobody assigned, on a screen that then looks
-- finished.
--
-- So the crosswalk's answer lives in its own nullable column. NULL means no
-- decision has been made about this ticket's section, and the screen says so in
-- those words. The app's own status is untouched and keeps meaning what it has
-- always meant.
--
-- `section_status_via` carries the provenance through to the row, so a reader
-- can see whether the answer came from a decision about this one section or
-- about every section sharing its name.

ALTER TABLE tickets ADD COLUMN section_status TEXT;
ALTER TABLE tickets ADD COLUMN section_status_via TEXT;
