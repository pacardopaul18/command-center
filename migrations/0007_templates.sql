-- Migration 0007: the templates library.
-- Data model is docs/Command_Center_Architecture.md section E.
--
-- A template is a reusable piece of Paul's writing: a reply pattern, a recurring
-- document. Its job in the architecture is to carry the partner's voice, so
-- exemplar text is the whole value of the row.
--
-- Drafts produced from a template are deliberately NOT stored. A draft is
-- something Paul copies out and sends from his own mail client; the app has no
-- send capability and storing every draft would accumulate stale near-duplicates
-- of the template it came from. Templates persist, drafts do not. See D48.

CREATE TABLE templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  -- When to reach for this one. Doubles as the AI's cue for what the template
  -- is for, so it is written for a reader and for a model at once.
  scenario    TEXT,
  body        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'email'
              CHECK (type IN ('email', 'doc')),
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'archived')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_templates_type ON templates (type);
CREATE INDEX idx_templates_status ON templates (status);

-- Archive rather than delete, consistent with SOPs (D33) and Clients. A template
-- that produced work should not vanish from the record.
