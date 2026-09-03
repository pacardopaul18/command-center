-- Migration 0043: the fields Quick Add offers, given somewhere to land.
--
-- The audit found one defect and several gaps. The defect is the reason this
-- migration exists: Quick Add's Meeting form has a Notes textarea, the value was
-- posted as `notes`, the route did not accept it and the table had no column for
-- it. The request returned 200 with the meeting and the note was gone.
--
-- A field that takes input and returns success while discarding it is the worst
-- shape this project keeps finding: there is no error, no empty state, and no
-- signal for weeks. The person believes they wrote something down.
--
-- The rule that follows: a form field either persists or does not exist.

/*
 * A person's own note about a meeting.
 *
 * Separate from `summary`, which is written by the model and carries a review
 * state, and from `transcript_text`, which is what was said. This is what Paul
 * thought. Merging any two of those would mean a regenerated summary could
 * overwrite something he typed.
 */
ALTER TABLE meetings ADD COLUMN notes TEXT;
