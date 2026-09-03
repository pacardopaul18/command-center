-- Rich text for the fields people write prose into. P2.
--
-- A second column beside each existing one rather than a change to it. The
-- existing column keeps the plain-text projection, so search, the digests, the
-- AI prompts, the CSV exports and every screen that reads it today keep working
-- untouched and none of them had to learn about markup.
--
-- The projection is derived from the HTML on write, in one place, so the pair
-- cannot drift. A row with a NULL html column is one nobody has edited since
-- this shipped, and it renders as the plain text it has always been.

ALTER TABLE tickets ADD COLUMN description_html TEXT;
ALTER TABLE projects ADD COLUMN description_html TEXT;
ALTER TABLE clients ADD COLUMN notes_html TEXT;
ALTER TABLE meetings ADD COLUMN notes_html TEXT;

-- SOP bodies are versioned and a version is immutable history. The column is
-- added to the version rather than to the SOP, so an old version keeps
-- rendering as the markdown it was written as and a new one carries HTML.
ALTER TABLE sop_versions ADD COLUMN body_html TEXT;
