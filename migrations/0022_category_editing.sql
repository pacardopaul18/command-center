-- Editing categories, and the guards that editing needs.
--
-- 0019 enforced one-level nesting and matching kinds with BEFORE INSERT
-- triggers, which was complete for a table nothing could edit. The category
-- editor makes re-parenting possible, and an UPDATE walks straight past an
-- INSERT trigger: a child could be moved under a grandchild, or an income
-- category moved under an expense one, and nothing would object.
--
-- Written as the editor is built rather than after something slips through.
-- New triggers only, no ALTER.

CREATE TRIGGER ledger_category_one_level_update
BEFORE UPDATE OF parent_id ON ledger_categories
FOR EACH ROW WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'A category may nest one level. Its parent already has a parent.')
  WHERE (SELECT parent_id FROM ledger_categories WHERE id = NEW.parent_id) IS NOT NULL;
END;

CREATE TRIGGER ledger_category_kind_matches_parent_update
BEFORE UPDATE ON ledger_categories
FOR EACH ROW WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'A child category must have the same kind as its parent.')
  WHERE (SELECT kind FROM ledger_categories WHERE id = NEW.parent_id) IS NOT NEW.kind;
END;

-- A category cannot be its own parent. Trivially true on insert because the row
-- does not exist yet; on update it is one mis-click away.
CREATE TRIGGER ledger_category_not_self_parent
BEFORE UPDATE OF parent_id ON ledger_categories
FOR EACH ROW WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'A category cannot be its own parent.')
  WHERE NEW.parent_id = NEW.id;
END;

-- A parent may not become a child while it still has children of its own, which
-- is the other way to end up two levels deep.
CREATE TRIGGER ledger_category_parent_keeps_children
BEFORE UPDATE OF parent_id ON ledger_categories
FOR EACH ROW WHEN NEW.parent_id IS NOT NULL AND OLD.parent_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'That category has children, so it cannot itself be nested.')
  WHERE EXISTS (SELECT 1 FROM ledger_categories WHERE parent_id = NEW.id);
END;
