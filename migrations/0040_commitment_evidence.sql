-- Migration 0040: the sentence a commitment was read out of.
--
-- `commitments.source_message_id` is NOT NULL and was described as the
-- provenance, which it is: it says which message the claim came from. It does
-- not say which sentence, and a reviewer holding a four-paragraph email and a
-- one-line claim has to find the sentence themselves before they can judge it.
--
-- That is the difference between provenance and evidence. Provenance is where
-- it came from; evidence is the thing somebody reads to decide whether the
-- claim is true. A proposal offered for review without evidence asks the
-- reviewer to trust the model rather than to check it, which defeats the point
-- of having a reviewer.
--
-- Nullable, because every commitment written before this migration has no
-- sentence recorded and inventing one is not available. The proposal generator
-- falls back to the message snippet where it is null, and counts the rows where
-- neither exists rather than offering a claim with nothing behind it.

ALTER TABLE commitments ADD COLUMN evidence TEXT;
