-- Migration 0042: the join link.
--
-- The one thing a person actually clicks on a calendar entry, and the app has
-- never read it. Google carries it as `hangoutLink` for Meet, and as
-- `conferenceData.entryPoints` for everything else including Zoom and Teams,
-- and neither was requested or stored. A screen showing every other detail of a
-- call and not the way into it is a screen somebody leaves for Google Calendar.
--
-- Nullable, like everything else read from Google: most events have no
-- conferencing at all, and an event Paul writes here has none either.
--
-- SUBJECT TO THE SAME BOUNDARY AS EVERY OTHER DETAIL. A partner's meeting link
-- is exactly the kind of thing this app has no business holding: it is a door
-- into a room, and the whole point of storing free and busy only is that the
-- app knows when they are busy and nothing about what they are doing. The sync
-- writes null here for any calendar Paul does not own, on the same line as the
-- title and the attendees.

ALTER TABLE calendar_events ADD COLUMN conference_url TEXT;
