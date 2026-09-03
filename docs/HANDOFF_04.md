# HANDOFF 04

Session 05, Tuesday 2026-09-02 into Wednesday 2026-09-03. Append-only.
`HANDOFF_03.md` is inherited unaltered and nothing in it is deleted, edited,
summarised or rewritten here. Where an item in its registry has moved, this
document states the new state; the old entry stands as written.

`HANDOFF_02.md` and `HANDOFF_01` remain inherited through `HANDOFF_03.md` on the
same terms.

Paul calls the final word on this handoff. It is not a session close.

Branch `realdata/stage-a`, through commit `a1ff574`, pushed green. **Not merged.
Nothing from this session is on production.**

---

## 1. What this session did, in one paragraph

The app stopped running on invented data. Paul's firm's real Asana workspace and
real Dropbox tree were mirrored into a local database, projected onto the app's
own screens, and then reviewed by Paul against what he knows to be true. That
review produced eight work items, P1 through P8, all of which are now done. Two
of the eight found that the premise of the finding was wrong, and those
corrections are recorded here alongside the fixes. Separately, Paul's work
mailbox and calendars were connected read-only with Dustin Finkel's approval,
Pillar 4's context pass ran for the first time on real mail, and the first SOP
was written, installed and left as a draft awaiting Dustin.

---

## 2. The real-data program

### 2.1 Stage A, the Asana pull

Run through the app's own sync code, not a one-off script, so that what proved
it could be pulled is the same code that will keep it current. Paging respected,
150 requests per minute respected, resumable, keyed on gid and never on
timestamps.

Completed `2026-09-01T16:23:10Z`. Final counts, as they stand in the mirror now:

| | |
|---|---|
| workspace | 1, MacGray Consulting |
| teams | 1 |
| projects | 66, of which **24 archived** |
| sections | **281**, recorded verbatim |
| tasks | 2,597 in the mirror table, of which **414 are subtask links** |
| distinct assignees | 6 |
| follower rows | 2,958 |
| tags | 1 |
| custom field values | 309, against 10 definitions |
| attachments, metadata only | 66, across 48 tasks |
| stories | **10,062** |

Sections were stored verbatim rather than mapped, because they are the firm's
own vocabulary and Thursday's reconciliation needs them as the firm writes them,
not as this app would prefer them.

The archived third matters. A live-only pull would have under-reported the
workspace by 24 of 66 projects, and 98 open tasks sit inside archived projects.

### 2.2 Stage B, the Dropbox local mirror

A read-only walk of the already-synced folder on Paul's machine. No credentials,
no API, nothing written. The OAuth connector is a later job.

| | |
|---|---|
| folders | 2,183 |
| files | 11,150 |
| total | 415 GB (415,490,250,543 bytes) |
| unreadable | 0 |
| client-depth folders | 52, of which **38 matched and 14 unassigned** |
| files reachable from a matched client | **10,456** |
| files under an unmatched client folder | 692 |
| files above client depth entirely | 2 |

The last three add to 11,150. **694 files are not reachable from a client**,
which is 692 under the fourteen unmatched folders plus 2 that sit above client
depth. Both figures are correct and they answer different questions; the earlier
report of 694 was the second one.

Names, sizes and dates only. The app holds a map of where the client work is,
not the client work.

### 2.3 Stage A2, the projection

The mirror rendered on the app's existing screens rather than on new ones.
Idempotent, re-runnable, keyed on gid. Every projected row carries its
provenance. Stories became an activity trail and never action items, because a
comment is not a commitment. Files are rendered, never copied.

Manual overrides win: `phase_is_manual` and `status_is_manual` mean a projection
re-run cannot undo a judgement Paul made on a screen.

The app now holds 66 projects, 45 clients and 2,597 tickets, all real.

### 2.4 The environment split

`.wrangler/state/v3` holds the synthetic fixture the suite runs against.
`.wrangler/real/v3` holds the mirror. `CC_DATA=real` selects the second. The
footer says which is loaded by looking for the fixture's marker row rather than
by reading the flag that started the server, so it reports what is there rather
than what was intended.

**The `v3` on the real path is load bearing.** Wrangler's CLI appends it to
`--persist-to`; miniflare through the vite plugin does not. Without it there are
two databases and the health check reports an empty schema on the one that has
every migration in it. Carried forward from `HANDOFF_03.md` section 12 and still
true.

### 2.5 The crosswalk and the roster

Crosswalk: 55 rows in the file, 55 in the table, **0 gids lost**, 45 distinct
clients, 43 rows carrying a gid, 47 carrying a Dropbox name. Migration 0035
re-keyed it on the row after an earlier version keyed on `canonical_name` and
dropped 10 gids into 45 slots.

Roster: 36 rows, 36 written, 36 matched exactly, 0 unmatched, 0 normalised
guesses. 24 active, 7 dormant, 3 reclassify_active, 1 reclassify_completed, 1
reclassify_unknown.

Precedence is one chain in one place: gid, manual override, dropbox_name,
normalised name, unassigned. D181.

### 2.6 The unassigned buckets

**16 Asana projects and 14 Dropbox client folders.** Every one of the 16 is
archived. This is the bucket working as ruled, not a failure: they are counted
rather than hidden, visible on `/clients/unassigned`, and resolvable by editing
the crosswalk or setting an override.

### 2.7 Migrations

**0032 through 0045, applied to both local databases. None on remote.**

| | |
|---|---|
| 0032 | the Asana mirror, 17 tables |
| 0033 | the client crosswalk |
| 0034 | the Dropbox mirror, 3 tables |
| 0035 | re-keys the crosswalk on the row |
| 0036 | roster, roster loads, client overrides |
| 0037 to 0042 | projection, mail context, calendar detail, dashboard, proposals, mirror freshness |
| 0043 | Quick Add parity: `meetings.notes` |
| 0044 | rich text: five `_html` columns |
| 0045 | `sop_verifications` |

`schema:check` on both local databases reports 45 applied, latest
`0045_sop_verifications.sql`.

---

## 3. The work-mailbox connection

Paul's MacGray Workspace account is connected **read-only**. Scopes are
`gmail.readonly` and `calendar.readonly` and nothing else. Dustin Finkel's
approval was obtained and relayed by Paul.

**That clearance covers the local mailbox connection and does NOT cover Stage
C.** It was given for reading Paul's own work mail into a local database on
Paul's own machine. Whether firm data may sit on a hosted database is a separate
question that was not asked and has not been answered. Anyone reading this and
about to apply a migration to remote: that approval is not this approval.

### 3.1 The calendar rule, and its live verification

A calendar Paul does not own stores **free and busy only**. Start, end, and
nothing else. Those meetings belong to other people who never agreed to have
them stored here.

Enforced at the write, not at the read, so nothing about somebody else's meeting
ever reaches the database rather than surviving exactly as long as every future
query remembered to exclude it. Ownership is decided from `accessRole` as Google
reports it on `calendarList`, never inferred from the calendar's name: Paul's own
calendars are named after him too.

Verified against the live mirror, not against the code:

| | |
|---|---|
| calendars | 7: **1 owner, 6 reader** |
| events held | 360 |
| events on non-owned calendars | **355** |
| non-owned events carrying any of summary, description, location, organizer, attendee_count, html_link or conference_url | **0** |
| attendee rows against a non-owned event | **0** |

A backfill clears anything a previous sync stored before the rule existed, and
anything stored before a share was narrowed. Enforcing it only on new writes
would have made the property true of the code and false of the database.

**The join link joined the same boundary at the moment it was added.** A meeting
link is a door into a room and is the furthest thing from free/busy there is. It
was put behind the rule when the field was introduced, not remembered later, and
the layer 2 test lists it by name so the next field read from Google has to be
placed deliberately.

---

## 4. Pillar 4, the context pass on real mail

### 4.1 The named run and the projection before spending

A named backfill run was opened, `pillar4-macgray-2026-09-02`, with a $50
allowance, so that a corpus pass draws on its own allowance and not on the
month. The projected cost was reported before anything was spent, which is the
order that was ordered.

### 4.2 What was actually there

The local mail was smaller than the design assumed, and the numbers are the
finding as much as the pass is:

| | |
|---|---|
| messages | 20 |
| threads | 17 |
| correspondence threads | 1 |
| commitments extracted | 3 |
| proposals from mail | 3 |

### 4.3 Spend

All figures computed from `ai_usage` at the model prices in
`src/lib/server/ai-usage.ts`.

| Window | Calls | Cost |
|---|---|---|
| context pass | 20 | $0.0584 |
| meeting summaries | 8 | $0.1086 |
| transcript extraction | 2 | $0.3155 |
| **total, month to date** | **30** | **$0.4825** |

The $0.167 reported at the time of the Pillar 4 report was the first two windows,
which was everything spent at that moment. The transcript extraction came later
the same day.

### 4.4 What the run proved, and what it could not

**Proved.** The chain runs end to end on real firm mail: read, triage, escalate,
extract commitments, propose, hold for a human. Both tiers were exercised, Haiku
for triage and Sonnet for escalation. The spend stop was in force throughout and
every call was metered.

**Could not prove.** Nothing about accuracy at volume. One correspondence thread
is not a sample. The extraction quality question is answered by Paul's verdicts
on the proposals, not by this run.

### 4.5 The run allowance has never been charged

**Open, and worth naming.** `ai_budget_runs` holds the run. `ai_run_usage` holds
**zero rows**. The context pass ran at 14:02, the run was created at 14:24, so
the whole $0.167 fell to the monthly ceiling rather than to the run's allowance.

The writer now exists, `openOrCreateRun()`, and it was added because the table
had three readers and no writer at all. But **the attribution path has still
never been exercised**, which is the same shape as D107's dispatcher branch: a
mechanism that is present, believed, and unobserved. Treat it as a watch item,
not as a working feature.

### 4.6 Transcript extraction, on two real meetings

Two real MacGray transcripts, supplied by Paul.

| | |
|---|---|
| proposals produced | **24** |
| carrying evidence, a verbatim quote from the transcript | **24 of 24** |
| with no stated date | **19 of 24** |
| meetings attributed to a client | **0 of 2** |

The last two lines are findings, not defects.

**Nineteen without a date** is the transcripts telling the truth. People say "I
will get that over to you" and do not say when. Inventing a deadline would have
produced a tracker full of dates nobody agreed to, and a date Paul did not set
is worse than no date because it will be believed.

**Neither meeting attributed to a client** because neither transcript names one
in a way anything could match. The correct behaviour is to say so and let Paul
attribute them, which is what the screen does.

### 4.7 The unified queue

Mail proposals and meeting proposals reach **one review queue on the Action
items page**, with the evidence in front of the reader. 3 from mail, 24 from
transcripts: **27 pending, all still pending.**

Nothing auto-creates an action item. The chain is commitment, proposal, human,
action item, and it stays that way. Four counted refusals exist on that path so
that a bad reading is refused loudly rather than becoming a false obligation.

---

## 5. The P1 through P8 batch

Paul reviewed the app against real data and produced eight items. All eight are
done. Ordered here as ruled, which is not the order they were built in.

### P4, project accuracy: **the premise was wrong, and that is the finding**

**Ordered as:** the projection is producing numbers Paul does not trust. Audit
it against Asana directly and report before fixing.

**What the audit found.** A three-way read-only audit across Asana, the mirror
and the app, over 942 tasks: **zero mirror-to-app discrepancies.** The
projection is faithful. Ten of twelve projects matched exactly.

The eleven tasks the app did not have were **all created after the pull
finished**. That was established by reading `created_at`, not inferred from the
absence, and it is the only check that discriminates a lossy pull from new work.

**The real defect is staleness.** A one-time snapshot with no re-pull and no
signal on any screen that it was old. Logged as a correction to the ordering
premise, because a report that quietly fixed something else would have left the
wrong lesson.

Commit `245d5c0`.

### P4b, incremental re-pull: promoted ahead of P8 on the correction

Asana re-pulls on the cron firings using `modified_since`, keyed on gid, with a
ten-minute overlap window because `modified_since` is exclusive and a boundary
that is exactly a timestamp loses whatever happened during that second. Archived
projects included. Every mirror-sourced screen shows its age in words and offers
a manual refresh where one is possible. Where a refresh is impossible, as with
Dropbox from a Worker, the screen says what does work instead of drawing a button
that does nothing.

**Staleness is visible, never inferred.** Commit `abd1926`.

### P8, the dashboard

Rebuilt from the projected mirror so its figures agree with the pages they link
to, one expression per concept. A zero now says whether it means measured-and-none
or never-loaded. Commit `2e78935`.

### P3, action items

The page was empty because extraction had only run on a two-day mailbox.
Surfaced the proposal queue on the Action items page itself with accept and
reject, and wired transcript extraction so a transcript produces proposals with
evidence and a human gate. Commit `b6a6e20`.

### P5, meetings: **titles were not missing**

**Ordered as:** declared and upcoming meetings render without titles.

**What it was.** The privacy rule was working and the label was not. Every event
in the current window sits on a non-owned calendar, so every one of them read as
"(no title)" or "Untitled call": a correct privacy boundary presented as a data
failure. The rule was applied in two of four places, and it looked broken
wherever it was missed.

One shared `label()` function, used by all four views, returning `Busy · <calendar
name>`. Plus the week grid Paul asked for, time-positioned blocks with lane
packing proved separately in nine unit tests, because a real week often has no
overlaps and the packing is exactly what live data will not exercise.

Commits `7255d9a`, D216, D217.

### P6, calendar detail: **attendees were never missing**

**Ordered as:** attendees are missing on owned events.

**What it was.** They were stored and were not being rendered. Same family as
P5: the finding named a data problem and the defect was in the view. Attendees,
organizer, location, description and the join link now surface for owned
calendars. Non-owned stays free/busy, and that boundary did not move.

Commit `afa123a`, D219.

### P1, Quick Add parity

Audited every Quick Add form against its destination page.

**The finding.** The Meeting form's "Agenda or notes" box posted `notes`, the
route returned 201 with a meeting, and the words were discarded: no column, no
route field, and a success either way. Confirmed empirically with a probe row
before anything was built.

Seven more fields were rendered and never sent: ticket `start_date`,
`estimate_hours`, `status`, `reporter`; project `owner_id`, `start_date`; meeting
`recording_url`. All wired. **Client and Template were checked and are not
defects**, with the reasons recorded so nobody re-audits them.

Two judgement calls, both ratified: a blank estimate sends `null` rather than
`0`, because zero claims the work takes no time and that flows into the variance
figures; and the project owner picker reads the users roster by id, because
`owner_id` is a foreign key and a display name would fail it.

Commits `244a314`, `bc2e64c`.

### P2, the shared editor

One `RichTextEditor` and one `RichText` reader across ticket descriptions,
project descriptions, client notes, meeting notes, SOP bodies and the Quick Add
equivalents. Migration 0044 adds a second column beside each existing one: HTML
in `<field>_html`, the plain-text projection in the original column, derived on
write by one function so the two cannot drift. Every existing reader, search
included, kept working untouched.

Parsed and rebuilt from an allow list rather than filtered, which is the approach
`email-html.ts` and the markdown renderer already use. `{@html}` appears nowhere.
The allow list is Asana's, so a description round-trips.

The server is the boundary. The editor sanitises so the writer sees what will be
stored, but the value that reaches the database is the one the route built.

Commit `e396f6e`, D223.

### P7, the SOP template and the verification log

The house SOP shape in `src/lib/sop-template.ts`, which the New SOP form starts
from. Migration 0045 adds the verification log. SOP-001 written, installed, and
left as a draft. Details in section 7.

Commits `196b4b6`, `a1ff574`, D224, D225.

---

## 6. Decisions D214 through D225

Each traced to what produced it.

| D | What it says | What produced it |
|---|---|---|
| D214 | No-data is not zero, and it never alarms | A dashboard tile reading 0 when nothing had loaded |
| D215 | One review queue, on the page the reviewing is for | P3: proposals invisible behind their own screen |
| D216 | The titles were not missing, the rule was applied in half the places | P5 |
| D217 | A week against the clock, and the packing proved separately | P5's grid: overlaps are what live data will not exercise |
| D218 | Extraction on two real transcripts | P3, and the 19-without-a-date finding |
| D219 | The join link, and what P6 actually found | P6 |
| D220 | A correct absence reads as a failure, and the fix is the label | Three occurrences in one evening |
| D221 | The Quick Add audit, and the one thing it found | P1 |
| D222 | A guard proven only by passing is a family | The orphan check that passed with an unwired field injected |
| D223 | One rich-text editor, stored as two columns | P2 |
| D224 | The house SOP shape, and a log that makes compliance a number | P7 |
| D225 | The uncommitted source, and the shape of an honest skip | P7's clean-checkout problem |

### The review checklist as it now stands

Eleven numbered items plus five named notes, each traceable to a specific
failure:

| Item | Produced by |
|---|---|
| 1. Off by decision, or only by missing configuration? | D184, the unchosen setting |
| 2. Does every early exit say that it stopped, and why? | The silent cap |
| 3. Can the test fail? | D80 |
| 4. Does what it reports match what is stored? | The meter that could not see `context.ts` |
| 5. Is the answer derived, or guessed? | Free/busy inference from calendar names |
| 6. Does it write to a system it is supposed to read? | The Asana push guard |
| 6b. Is the rule applied at every site, or only at some? | P5, two views of four |
| 6c. Does a rule make most of this view empty? | D220 |
| 7. Was it looked at, at both widths? | The centred layout, twice |
| 8. When something names more than one cause, which one was it? | P4's `created_at` check |
| 9. Is the property asserted about the thing that answers? | D193 |
| 10. Does anything write this? | F-EMPTY-WRITER |
| 11. Does a zero mean measured-and-none, or never-loaded? | D214 |
| *A note on revising a finding* | The `DIGEST_TO` severity correction, downward |
| *Why the synthetic fixture exists* | D192, `HAVING` binding to the column not the alias |
| *A 200 is not evidence of storage* | P1 |
| *What is stored is answered by reading storage* | P2's at-rest test |
| *A lossy transform is data loss, even when nothing errors* | The `&mdash;` corruption |

---

## 7. SOP-001 and the SOP module

### 7.1 What was built

**The template**, `src/lib/sop-template.ts`. Nine sections, and every one earns
its place: a procedure written from a blank box gets the parts its author was
thinking about and misses the ones that only matter when something has gone
wrong. Roles carry a deputy. Every step carries a deadline and a check. Failure
modes are keyed on the symptom, because the symptom is what the reader has when
they come looking. Any step where something produces work for a person is
written as propose, review, push.

The New SOP form starts from it and counts the placeholders still to fill in.

**The verification log**, migration 0045. One row per check: who, when, which
step, what was being looked at, pass or fault. Whether the procedure was followed
and how often it fails come off the same rows, which closes SOP-001's original
first open question. Append only, with no route that edits or deletes: a
compliance log that can be tidied afterwards is not evidence of anything. A fault
requires a note, enforced at the route so the reader gets a sentence and again as
a CHECK constraint so the rule is true of the data. No fault rate until something
has been verified: **null, never zero**, per D214.

Currently 0 verifications logged, and the screen says so in those words.

### 7.2 SOP-001, as it stands

Installed in the real database, id `d708a58e-6997-4b69-8cf9-b4cf6849cce7`,
**version 5, DRAFT**.

The four accepted additions are all in it:

1. **Per-step timing.** Same day for Generate, because an ungenerated recording
   does not fail, it waits, and waiting is invisible. Next business morning for
   steps 2 through 8.
2. **The verification log as a table in the app**, not prose in the document.
3. **A named deputy across steps 2 through 8**, not only Generate. The Filer's
   deputy is deliberately `[TO BE NAMED]`.
4. **Steps 6 and 7 as propose, review, push**, so the app taking the extraction
   over later is a change of tooling and not a change of policy.

The Chasin Dreams confidentiality exception is intact and marked non-optional.

**Nothing marks it approved and nothing can.** Approval is Dustin's act. The
status says DRAFT in the title, in the body and in the installer, and the tests
assert that none of them says otherwise.

### 7.3 The three noise versions

Versions 2 through 4 are identical to version 1. The installer compared its
generated HTML against the stored HTML to decide whether to write a version, and
those are never equal, because the route parses and rebuilds every value. Every
re-run added a version.

**They stay.** The immutability trigger exists to prevent exactly the tidying
that would remove them, and deleting them to make the record look clean is the
thing the rule forbids. Version 5 is current and its change note carries the
source fingerprint.

The installer now keys on a hash of the markdown source, which both it and
`verify-sop.mjs` compute, so neither carries a second copy of the converter.

---

## 8. Findings and families, named

### F-EMPTY-WRITER, its own family

**A table with readers and no writer.** `ai_budget_runs` had three readers and
no writer at all, so a named run was inert: it existed, screens read it, and
nothing ever put a row in it. Every spend it should have carried fell to the
monthly ceiling instead.

The family shape: **a feature whose read path is complete and whose write path
was never built reads as working from every direction except the one that
matters.** Checklist item 10 is the standing question, and it is asked of the
table, not of the feature.

Commit `0ba09b3`, `60aabfc`.

### D220, correct absence reading as failure

**The condition:** a privacy or filtering rule empties most of a view, and the
correct absence becomes indistinguishable from a failure to load.

Three occurrences in one evening:

1. The meetings list and meeting detail showed "(no title)" against partner
   meetings, which describes a deliberate privacy boundary as a data failure.
2. A dashboard tile reading 0 where nothing had loaded.
3. A fault rate of 0% where nothing had been verified.

**The remedy is always the label**, never a change to the rule. Somebody would
otherwise go looking for the bug, find nothing, and either give up or "fix" it by
storing the titles.

### D222 and D223, proving a guard by breaking it

**D222** names the family: **a guard proven only by passing has demonstrated
nothing.** Three members. D80, a matcher that named the index rather than the
column and so could never have failed. D116, guarantee tests written after the
code and mutation-checked afterwards. And this session's: a static check that
Quick Add sends every field it renders, which passed on its first run and passed
again with a deliberately unwired field injected, because the escaping had
collapsed and the regex was matching a backspace character rather than a word
boundary.

**The rule: break the thing it guards, watch the failure, restore.**

**D223 refines it, and the refinement is the more useful half.** With layered
guards, a single break that does not fail is **ambiguous**. Removing the rich-text
discard set alone let nothing through, because the accept map caught it. Making
the accept map pass unknown tags alone let nothing through either, because the
discard set had already thrown the tag away. Only breaking both produced a
failure.

So a non-failing break means either the guard is dead or a second guard covered
it, and **those look identical from the outside**. The corrected form:
**break to the point of failure, then restore.**

Applied through the rest of the session. Every new guard in P1, P2 and P7 was
broken until it failed and then restored, and two more defects were found that
way: the Asana fidelity check that looked for `<u` and was satisfied by `<ul>`,
and the trigger assertion aimed at `WHERE 1 = 0`, which matches no rows so a
BEFORE DELETE trigger never fires.

---

## 9. Open items registry, as at session 05

Inherited items keep their state from `HANDOFF_03.md` section 8 unless this
session moved them. Items moved by this session say so.

| Item | DRI | State |
| --- | --- | --- |
| R7, digest deliverability | Paul | **OPEN**, unchanged |
| T-obs-token | Paul | **OPEN**, unchanged. A scoped Cloudflare API token with Workers Observability Read and nothing broader. Still the reason a cron firing's log line cannot be read. D61 |
| T-W1 | Next session | **OPEN**, unchanged |
| O3, partner-hours baseline | Paul | **OPEN, NOT STARTED** |
| Partner-permission conversation | Paul | **PARTIALLY MOVED.** Dustin's approval obtained for the read-only mailbox connection and relayed. The Stage C question was not asked and is not covered |
| Google restricted-scope verification | Paul | **OPEN**, long lead |
| T-silent-writes | Next session | **PARTIAL**, unchanged from session 04 |
| First draft generation | Paul | **STILL NEVER EXERCISED.** Not on the cron; Paul presses it |
| D107 dispatcher check | Next session | **WATCH**, unchanged. The stuck-ingest branch has still never run |
| Pillar 4 proper | none | **RESOLVED in part**, session 05, `da298b6` and `1c0649f`. The chain ran end to end on real mail. Accuracy at volume is unproven and is not closed by this |
| Run allowance attribution | Next session | **NEW WATCH.** `openOrCreateRun()` exists; `ai_run_usage` holds zero rows and the path has never been exercised. Section 4.5 |
| Stage A, the Asana pull | none | **RESOLVED**, session 05, `a89ae98` through `4eeab42` |
| Stage B, the Dropbox mirror | none | **RESOLVED**, session 05, `a89ae98`. Local script only; see next row |
| Dropbox re-walk | Next session | **OPEN.** `scripts/dropbox-scan.mjs` on this machine. A Worker has no filesystem, so the OAuth connector is what makes this refreshable from the app. The Files screen says so rather than drawing a button that does nothing |
| Stage A2, the projection | none | **RESOLVED**, session 05, `2ee1ab8` |
| P1 through P8 | none | **ALL RESOLVED**, session 05. See section 5 for commits |
| Stage C, gate 1: does firm data sit on a hosted database | Paul | **OPEN.** The Dustin approval covers the local connection only |
| Stage C, gate 2: the D50 evidence pattern, per migration | Next session | **OPEN.** Fourteen migrations, 0032 to 0045, none applied to remote |
| SOP source uncommitted | none | **RESOLVED as designed**, `a1ff574`. `docs/data/` stays ignored. The suite skips the SOP-001 content tests with a stated reason and prints "SOP source not present, install unverified"; `npm run verify:sop` fails loudly where the file is present and the install disagrees |
| SOP-001 noise versions | none | **RETAINED as history.** Versions 2 to 4, by ruling. Section 7.3 |
| The 27 proposals | Paul | **OPEN.** 3 from mail, 24 from transcripts, all pending |
| SOP-001 to Dustin | Paul | **OPEN.** Deputy question first |
| MacGray engagement | Paul | **UNDER WAY** since 2026-09-02 |

---

## 10. Standing constraints, added this session

The constraints in `HANDOFF_03.md` section 7 all still hold. These are additions.

- **Route order matters in Hono.** A literal path declared after a parameterised
  one is unreachable. `/proposals` was shadowed by `/:id` and the test now
  asserts the order, not just the behaviour.

- **A dev server started before a migration reports drift and will not serve the
  suite.** `__EXPECTED_MIGRATION__` is computed when vite loads its config. Apply
  a migration, restart the server. This cost two full-suite runs this session and
  the drift detector was right both times.

- **A stale server squatting on a port is a real hazard.** Playwright's webServer
  will not start behind one, and layers 1 and 2 will happily run against it.
  Check `/api/health` for `data_environment` before believing a run.

- **`localhost` resolves to two addresses and only one gets bound.** Pin scripts
  and servers to `127.0.0.1`. Carried from session 05's first half and still the
  cause of any bare `fetch failed`.

- **Escaping collapses when writing code through a shell heredoc.** It happened
  four separate times this session, twice producing a test that could not fail.
  When a file needs a backslash escape, write it with an editor tool and read the
  bytes back.

---

## 11. State of record, and the session 06 opener

**This document is the state of record.** `HANDOFF_03.md` stands as written and
is inherited unaltered, and through it `HANDOFF_02.md` and everything before.

The next session opens by reading, in order:

1. **This file.** Section 3 first, because the mailbox clearance and its
   boundary are the thing most likely to be misread as broader than it is. Then
   section 9, the registry.
2. **`docs/DECISIONS.md`, D193 and D203 first**, then **D214 through D225**.
   D193 and D203 keep the position `HANDOFF_03.md` section 11 gave them: they
   are the two entries that name reasoning errors rather than defects, and
   anybody about to write a safety check reads both before writing it.
3. **`docs/REVIEW_CHECKLIST.md`**, all eleven items and the five notes.
4. Section 9 of this file for what is open and who owns it.

Three entries from this session carry the most weight, and they belong with
D193 and D203 rather than after them:

- **D223's refinement of D222.** With layered guards, a break that does not fail
  is ambiguous between "the guard is dead" and "the other guard covered it".
  Break to the point of failure, then restore. This is the practical instruction
  that D193 and D203 imply and do not state.
- **D220.** A rule that empties a view makes correct absence indistinguishable
  from failure, and the fix is always the label. Three occurrences in one
  evening.
- **F-EMPTY-WRITER**, checklist item 10. Ask of the table, not of the feature:
  does anything write this?

### What is authorized, and what is held

**Authorized: nothing.** The batch of eight is closed and no further work is
authorized. This session holds.

**Held, explicitly:**

- **Stage C.** Nothing goes to remote. Fourteen migrations wait, and both gates
  are open: whether firm data may sit on a hosted database at all, and then the
  D50 evidence pattern per migration.
- **Pushing to Asana** stays off, D184, until Paul turns it on. The golden rule
  stands: fetch only, change nothing on Asana or Dropbox.
- **Merging `realdata/stage-a`.** Not merged, not on production.

**Three things are Paul's, and only the last is time-sensitive:**

1. **SOP-001 to Dustin, deputy question first.** Steps 2 through 8 have one name
   against them.
2. **The 27 proposals.** The verdicts are what tell us whether the extraction is
   worth trusting; the run proved the chain and could not prove the accuracy.
3. **Stage C**, the narrow question of whether firm data sits on a hosted
   database.

---

*Session 05. Nothing above alters `HANDOFF_03.md`, which stands as written, or
anything it inherits. This is a handoff update and not a session close; Paul
calls the close.*

---

## 12. AMENDED 2026-09-03, at the opening of session 06

Three corrections ruled by the PM against section 11. Appended rather than
edited in: the entries above stand as written and these state the right answer,
which is the same discipline this document applies to everything it inherits.

### 12.1 This document is a handoff update, not a session close

Already stated in two places, at the top and in the closing line, and both stand.
The line that could be read the other way is in section 11:

> **Authorized: nothing.** The batch of eight is closed and no further work is
> authorized. This session holds.

That was true when it was written and is now superseded. Session 06 authorizes
work; see 12.4. The batch of eight is closed; the session is not.

### 12.2 T-obs-token is two scopes, and the second is a widening

Section 9's registry row said "Workers Observability Read and nothing broader".
That is D61's original text and it is stale. `docs/DECISIONS.md` line 31 has the
current state and is the authority:

> **T-obs-token.** Scoped Cloudflare API token: Workers Observability Read,
> **plus Workers Builds read**. D61, **widened by D64**.

**Recorded as a deliberate widening, not as prior state.** D61 chose the
narrowest scope that answered the question it faced, and said so. D64 then hit a
second 403 on a different question, whether non-production branches build, could
not answer it, and deferred it with the note that adding Workers Builds read
would make the next answer one call instead of a deferral. The second scope is
that decision, taken later and for a stated reason. It is not something D61
included and this document forgot.

`CLAUDE.md` carried the same stale text and is corrected in the same commit,
with the widening named.

### 12.3 `main` auto-deploys. Verified live, and it moves the merge inside gate 2

**Verified, not assumed.** `wrangler deployments list` against the live Worker,
correlated against `origin/main`:

| main merge | UTC | next deployment | gap |
|---|---|---|---|
| `ea4be3d` | 09-01 01:34:16 | 09-01 01:49:06 | 14.8 min |
| `5cec39d` | 09-01 02:32:36 | 09-01 02:44:58 | 12.4 min |
| `d3e424b` | 09-01 02:52:41 | 09-01 03:05:12 | 12.5 min |
| `0d53a8f` | 09-01 03:21:42 | 09-01 03:35:05 | 13.4 min |
| `a1ad72b` | 09-01 03:49:24 | 09-01 04:03:28 | 14.1 min |

Five merges, five deployments, one for one, every gap between 12 and 15 minutes.

**The discriminating half.** A correlation like that is also what a coincidence
looks like if deployments happen on their own, so the other side was checked:
`realdata/stage-a` has been pushed to origin twelve times across 2026-09-02 and
2026-09-03, and **the deployment list has no entry after 2026-09-01T04:03:28Z**.
Pushes to a non-production branch produce no deployment. Pushes to main produce
one every time.

That also answers the question **D64 deferred** and recorded as undeterminable
from that session. It is answered now, by outcome rather than by the Workers
Builds API, so it needed no new token: non-production branches do not build here.
The safe default D64 adopted turns out to have been correct, and the reason it
was adopted, that a branch build running `wrangler deploy` would push a branch's
config to production, does not arise.

**The consequence, which is the point of the check.** Merging
`realdata/stage-a` into main deploys it, about a quarter of an hour later, with
nobody pressing anything. The branch's code expects migrations 0032 through
0045. Confirmed live and read-only, `wrangler d1 migrations list --remote`
reports **exactly 14 unapplied: 0032 through 0045.** The remote database holds
none of them.

So a merge alone ships code that queries fourteen migrations' worth of tables
against a database that has none, which is the D50 ordering failure that took
`/templates` down in production on 2026-08-29, at fourteen times the size.

**The merge of `realdata/stage-a` is therefore inside Stage C gate 2 and is not
available before it.** Section 11 listed the merge as held; this says why it is
held, which is stronger than a preference. It is not a separate decision anybody
can take on its own.

### 12.4 What is authorized at the opening of session 06

Superseding 11's "Authorized: nothing".

1. **Exercise the run allowance attribution path end to end.** Section 4.5's
   watch item sits on a money path, so D166 applies: break to failure per D223,
   restore, run one real metered call inside a named run, and read the row back
   out of `ai_run_usage` rather than trusting a 200.
2. **Pillar 2 status reconciliation**, under the ruling that arrived with it:
   the 281 verbatim sections map to coarse status through an **editable
   crosswalk with provenance on every row, never through inferred logic**, and
   an unmapped section **renders as unmapped and never falls into a default
   bucket**. The same shape as the client crosswalk.
3. **The calendar free and busy gap finder**, if the first two land. Its use
   case now exists in the SOP scheduling work.

**Still held, both gates, unchanged.** Stage C. Dustin's clearance covers the
local mailbox connection only and the hosted question was never asked. Nothing
goes to remote. The D50 per-migration evidence pack may be assembled against a
scratch database as fill work, **applying nothing**.

**Paul's, unchanged.** The 27 proposals, SOP-001 to Dustin with the deputy
question first, and the two token grants. **Extraction is not tuned before the
verdicts exist**, because tuning against no verdicts is tuning against a guess.

*Session 06. Nothing in this section alters sections 1 to 11, which stand as
written, or anything this document inherits.*
