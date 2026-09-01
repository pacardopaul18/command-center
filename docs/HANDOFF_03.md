# HANDOFF 03

Session 04, Tuesday 2026-09-01. Append-only. `HANDOFF_02.md` is inherited
unaltered and nothing in it is deleted or rewritten here; where an item in its
registry has moved, this document says so with the new state.

Paul calls the final word on this handoff.

---

## 1. What this session did

Two things, in the wrong order, and the order is itself a finding.

1. **The UI redesign programme.** Twelve pages plus the Quick add shell,
   rebuilt against Paul's prototypes. Thirteen merges to `main`, all on
   production. Migrations 0024 through 0030.
2. **The post-reset sequence**, which was first in priority and was reported on
   only after the twelve pages had landed. See I9 below.
3. **The spend stop**, built out of the sequence's largest finding: there was
   no spend control of any kind. Migration 0031.

---

## 2. I9: the priority miss

Logged as a process finding, not an incident. No harm resulted.

The standing instruction was that the reset takes priority the moment it lands:
pause, run the five steps, resume. The reset landed at 00:00 UTC (08:00 PH) and
twelve pages landed ahead of it. The 00:00 firing ran unattended and did the
right thing, so nothing was lost, but that was luck rather than sequencing.

**Rule adopted:** any instruction of the form "first when X lands" is checked at
every report boundary, and a report that lands after X states X's status before
anything else.

---

## 3. The UI programme, as merged

| Page | Commit |
| --- | --- |
| Invoicing | `24a1cce` |
| Inventory and audit | `b35dfb7` |
| Dashboard | `d1fa245` |
| Action items | `dfff9d2` |
| Quick add | `a9ecede` |
| Calendar | `7448cee` |
| Meetings | `bec5a37` |
| Clients | `ed569fc` |
| Ledger | `2d1f0ea` |
| Templates | `87f1ce4` |
| Projects | `d5f85a3` |
| SOPs | `1d4467c` |
| Reports | `7940511` |
| Settings | `ea4be3d` |
| Spend stop | `5cec39d` |

Decisions **D144 to D166**, all ratified.

### Send-surface translations, numbered as ordered

Every control in a prototype that implied a capability this app does not hold
was translated rather than drawn. The pattern is the Invoicing one: keep the
job, lose the verb.

| D | Prototype drew | Built as |
| --- | --- | --- |
| D148 | New invite, "writes go through the Google Calendar API" | Draft invite: a prefilled link into Google's own event form |
| D149 | Follow and Leave, subscribing a calendar in Google | A local followed list. Nothing touches the user's CalendarList |
| D150 | RSVP | Dropped. Accepting an invitation has no honest local translation |
| D151 | Find a time | A live free/busy read that names every calendar it could not read |
| D152 | "Move demo to Tue, 1:00 PM" | A clash notice and a link to the event in Google |
| D154 | Contract authoring | Upload only. The prototype's own copy settled it |
| D156 | Pencil and bin on every ledger row | Correctable unless this app posted the line |
| D162 | Role-based SOP access | No roles table. Ownership is a name, and the page says so |
| D164 | About thirty settings | Eleven wired to something real, six named as not built with reasons |

---

## 4. Migrations applied to remote this session

Each under D50 with the full evidence pattern: exactly one pending, snapshot
taken and replayed into a scratch database with counts matched against live,
suite green before, objects and columns read back from live state after, prior
row counts intact, `schema:check` OK.

| Migration | What |
| --- | --- |
| 0024 | Invoice detail (applied under an earlier ruling) |
| 0025 | `action_item_events` |
| 0026 | `followed_calendars` |
| 0027 | `contract_files` |
| 0028 | `template_uses` |
| 0029 | Project detail: milestones, files, ticket events, links, time |
| 0030 | SOP shelves, books, chapters, placements |
| 0031 | AI budget: `ai_budget_runs`, `ai_run_usage` |

`schema:check` reports 31 applied, latest `0031_ai_budget.sql`.

**The freeze held.** No ALTER touched an existing table after 0024. Every schema
need was met with a new table or a side table.

---

## 5. The post-reset sequence, as observed

Reported after the fact rather than run as a sequence. See I9.

### (0) The 00:00 UTC firing — RAN

```
first AI call    2026-09-01T00:00:48Z
last AI call     2026-09-01T00:01:25Z
ai_usage rows    11        (was 0 at session 02 close)
```

Two-tier path **exercised**: 10 triage calls on `claude-haiku-4-5`, 1 escalation
to `claude-sonnet-5`. The regime change is visible in the data: 575 threads
carry `classified_model = claude-sonnet-5` from 2026-08-30, 10 carry
`claude-haiku-4-5` from 2026-09-01.

Meter **recording real usage** for the first time.

**D107's dangerous branch remains unexercised.** `email_ingest_state` is `done`,
so the ingest branch was skipped and triage took the full share. The case D107
exists for, an ingest stuck at `running` with nothing left to do, has still never
happened. **Watch item, not a finding.**

The firing's log line could not be read: T-obs-token is still open and still
Paul's.

### (1) Calibration, against the API's own token counts

```
triage      10 calls   9,653 in    394 out   haiku    $0.011623
escalation   1 call      687 in    114 out   sonnet   $0.003771
                                             total    $0.015394
```

**$1.54 per 1,000 threads blended. $1.16 triage-only floor.**

Escalation rate 1 in 10, **n=1 and flagged weak**. The triage figure has n=10 at
about 965 input and 39 output tokens per call and is solid.

This number supersedes the spike's estimate.

### (2) Workers AI and Vectorize — not used

Bindings are `ASSETS`, `DB`, `SESSIONS`, `FILES`. No AI binding, no Vectorize
binding, no `@cf/` model reference anywhere in `src`. **No Cloudflare Paid
upgrade is required by anything currently running.**

### (3) Backfill

**Corrected framing, so nobody reads this as Pillar 4 in progress:** what is
running is the triage drain of the remaining threads. Pillar 4 proper — full
corpus ingest, embeddings, the E4 context passes against real mail — **has not
started**. The retrieval architecture from the spike is ratified and unbuilt.

```
threads          775 total, 585 triaged, 190 awaiting
spend so far     $0.0154 since the reset
cost to drain    $0.29 for the remaining 190 at the calibrated rate
drain rate       ~10 per firing observed, 14 is the budget ceiling
crons            0, 9, 10, 13, 14, 23 UTC
projected clear  2 to 3 days
```

**The finding: there was no spend stop.** Built the same session. See section 6.

### (4) First drafts — not generated

`email_drafts` holds 0 rows. Drafting is an on-demand route; **nothing on the
cron calls it**, so the reset could never have produced one. The handoff 02
expectation that it would first run at the reset was wrong about the mechanism.

It cannot be run from a session either: production is behind Cloudflare Access
and that boundary is not to be bypassed. **Paul presses it. That remains the
test.**

---

## 6. The spend stop, D165

Ordered built the same night rather than Thursday, with the numbers ruled rather
than chosen unsupervised.

`costCents` had been written, tested and exported, and had no caller outside its
own test. The only dollar figure in the running app was
`ceiling_usd_per_month: 30`, a display constant nothing read to decide anything.
Exposure on the day was twenty-nine cents. The problem was that a control
everybody believed existed did not.

**Monthly ceiling $30 hard**, checked before every AI call site from
month-to-date `ai_usage`. **Backfill allowance $50** per named run, consumed only
by that run, with run usage excluded from the monthly figure so neither
allowance can eat the other.

Attribution is per call, not a time window: a window would sweep up every
ordinary call made while a backfill happened to be running, which is the mixing
itself. Both ceilings live in `src/lib/ai-budget.ts`, read by the check and by
the meter route, which closes the original failure at its source.

Refusals carry both figures. The cron returns through the `stopped` field
`TriageOutcome` already had, the context pass through `stopped_early`, the four
routes as `402`. Verified live at the ceiling on all four.

**Deployed at 02:50 UTC, six hours before the 09:00 UTC firing.** The drain
resumes under a real stop.

### Two findings closed while building it

Both the same shape as the original: a cost the meter could not see.

- **`context.ts` was unmetered.** It counted its own tokens into its outcome and
  wrote nothing to `ai_usage`. The most expensive pass in the app was invisible
  to any ceiling reading the meter. Now metered and guarded.
- **`UsageKind` named six kinds; migration 0015 allows three.** The three extra
  had no caller, so nothing had ever hit the CHECK, and `recordUsage` swallows a
  failed write by design. The first code to use one would have spent unrecorded.
  The union is narrowed to the truth; `profile`, `digest` and `voice` are on
  Thursday's ALTER queue. Recording as `summary` until then is accepted as
  truthful.

`summariseTranscript`, `extractActionItems` and `draftFromTemplate` returned no
usage at all and now do, so the meeting and template routes are metered for the
first time.

### D166: the rule that outlives the stop

Any path that spends money must be **structurally unable** to spend unrecorded.
A guarantee test walks `src/lib/server`, finds every caller of a function in
`ai.ts`, and fails by filename if that caller does not reference both
`checkAiBudget` and `recordUsage`. It also asserts the scan found at least five
files, because a loop over an empty result passes every case it contains.

A source scan rather than a runtime assertion, deliberately: the failure being
prevented is a call site added later by somebody who has not read the entry, and
a runtime check only fires if a test happens to exercise that path with a live
key.

---

## 7. Standing constraints for the next session

- **A server module a test imports cannot use the `$lib` alias.** `vitest.config.ts`
  has no resolver for it, and the failure is a suite that will not load rather
  than a type error. `src/lib/server/ai-budget.ts`,
  `src/lib/server/api/email.ts` and `src/lib/server/settings.ts` use relative
  paths for this reason. Cost a red suite to find.

- **Seed guards assert the property, never the zero.** Four streams were added
  to the volume fixture this session (contacts, ledger, tickets and their
  events, template uses, SOP hierarchy) because five redesigns could not be
  judged against empty tables. Each broke a layer-1 guard written as "the seed
  creates none of these". Every one was rewritten to the property that actually
  mattered — **no row exists that the fixture did not write** — rather than
  deleted. Both the loader and layer 1 now count rows carrying the `v-` prefix.
  **This is the pattern for every future seed stream.**

- **Do not push in the background while still editing.** One push failed on a
  test that was fine, because its pre-push suite ran against a dev server whose
  code was being edited underneath it. The gate was right.

- **The build holds `.svelte-kit/cloudflare` open.** Any change to the scheduled
  bundle needs: stop the dev server, `npm run build`, restart, then `npm test`.

---

## 8. Open items registry, as at session 04 close

Inherited items keep their state unless this session moved them.

| Item | DRI | State |
| --- | --- | --- |
| R7, digest deliverability | Paul | **OPEN**, unchanged. Absence-based closure over several days |
| T-obs-token | Paul | **OPEN**, unchanged. Still the reason the 00:00 firing's log line is unreadable |
| O3, partner-hours baseline | Paul | **OPEN, NOT STARTED** |
| Partner-permission conversation | Paul | **OPEN.** Opener drafted, not sent |
| Google restricted-scope verification | Paul | **OPEN**, long lead |
| T-silent-writes | Next session | **PARTIAL.** 24 call sites still to route through `apiWrite` |
| Queued triages | Machine | **190 awaiting**, was 192. Drains at 6 firings a day under the spend stop |
| First two-tier firing | Machine | **CLOSED.** Exercised 2026-09-01T00:00:48Z, session 04 |
| First draft generation | Paul | **STILL NEVER EXERCISED.** Not on the cron; Paul presses it |
| D107 dispatcher check | Next session | **WATCH.** Healthy branch observed; the stuck-ingest branch has never run |
| Pillar 4 proper | Next session | **NOT STARTED.** Retrieval ratified, unbuilt. E4 passes unrun |
| Thursday ALTER queue | Next session | **QUEUED.** See section 9 |
| MacGray engagement | Paul | **Starts Wednesday 2026-09-02** |

---

## 9. Thursday, in order

1. **The ALTER queue, as one D50 migration where possible.**
   - `action_items`: priority, effort, waiting_on, waiting_since
   - `clients`: website, industry, source
   - `templates`: category
   - `projects`: budget
   - `ai_usage`: widen the `kind` CHECK to admit `profile`, `digest`, `voice`
2. **Pillar 2 status-model reconciliation.**
3. **Pillar 4 proper opens**, with the E4 context pass as a **Paul-triggered
   run** against triaged correspondence, **under a named backfill run** so it
   draws on the $50 allowance and not the month.

Nothing lands before Thursday except findings.

---

*Session 04. Nothing above alters `HANDOFF_02.md`, which stands as written.*

---

## 10. F-CR1-F4-REPEAT: the centred layout, a second time

Raised by Paul, after the twelve pages had shipped, by looking at his own
screen. Closed structurally the same session.

**What happened.** Every page rendered inside the shell's 1200px cap and
centred, on designs that are full width. At 1920 that is 248px of dead space
each side with the table crammed into the middle.

**Why it survived.** Identical to the original CR1-F4, and the cause was already
written down in `HANDOFF_02.md` and in D129: the fidelity pass rendered at 1440,
where a 1200px cap leaves 120px each side and reads as padding. D128 mandated
rendering "at the desktop width", which is not a width, so the pass picked the
one where the fault is invisible. Twelve times.

**Three closes, because one would not have been enough.**

- **D128 amended.** The widths are named: **1920 and 412, never 1440 alone.** A
  rule that says "look at it" must say what to look at it on, or the person
  following it picks the setting where the fault hides.
- **D167.** Full width is the default and `NARROW_ROUTES` names the prose
  exceptions. D129's principle is untouched, its direction is superseded: an
  opt-in list is something the next page's author must remember, and that is
  precisely what was forgotten.
- **The guard.** An e2e test at 1920 measuring both kinds, over the thirteen
  navigable routes and the five detail routes, plus the capped procedure page.
  Proved by reintroducing the defect on one route, watching it fail, and
  restoring.

**Standing rule from this:** any route added later that is not in the guard's
route set is itself a finding. The guard is the list of screens somebody has
actually looked at.

Detail routes now covered: `/clients/[id]`, `/projects/[id]`, `/meetings/[id]`,
`/tickets/[id]`, `/sops/books/[id]`. Ids are discovered from the API rather than
written in, so a fixture change cannot fail as a layout defect.

---

## 11. State of record, and the session 04 opener

**This document is the state of record.** `HANDOFF_02.md` stands as written and
is inherited unaltered.

The next session opens by reading, in order:

1. **This file**, sections 2 and 5 first: the priority rule from I9, and what the
   post-reset sequence actually found.
2. **`docs/DECISIONS.md`, D108 through D167.** D108 to D143 are the account
   segregation, job and seed rules the modules are built on. D144 to D167 are
   this session: the send-surface translations, the derived-not-stored rules, the
   spend stop, and the two layout entries.
3. Section 9 of this file for Thursday's order of work.

Three entries carry the most weight for anyone touching this code next:

- **D166**, because it is the one that stops a fourth unmetered call site.
  Careful is not a control.
- **D167** with the amended **D128**, because the layout defect reached Paul
  twice and the second time the rule was already written.
- **D157**, the seed-guard property rule, because every future fixture stream
  will meet it.

*Session 04 continued and closed at `main` after the layout fix. Nothing above
alters `HANDOFF_02.md`.*

---

## 12. Stage A and B: the real-data mirror

Branch `realdata/stage-a`, commit `a89ae98`, pushed green. Not merged, not on
production.

### What runs

Two local databases. `.wrangler/state/v3` holds the synthetic fixture the suite
runs against; `.wrangler/real/v3` holds the mirror. `npm run dev:real` or
`CC_DATA=real` selects the second, and the footer says which is loaded by
looking for the fixture's marker row rather than by reading the flag that
started the server.

The `v3` on the real path is load bearing and must not be tidied away. Wrangler's
CLI appends it to `--persist-to`; miniflare through the vite plugin does not.
Without it there are two databases, and the health check reports an empty schema
on one that has every migration in it.

Both scripts and both dev servers are pinned to `127.0.0.1`. `localhost`
resolves to two addresses on this machine, Node picks one per request without
falling back, and vite binds one. Half the calls were refused with a bare
`fetch failed`.

### Migrations 0032 to 0035

Applied to both local databases. **Not applied to remote.** That is Stage C and
needs the D50 evidence pattern per migration.

- `0032` the Asana mirror, 17 tables
- `0033` the client crosswalk, superseded in part by 0035
- `0034` the Dropbox mirror, 3 tables
- `0035` re-keys the crosswalk on the row and adds the two honest counts

### Counts, as of the handoff

Asana, workspace `MacGray Consulting`:

| | |
|---|---|
| projects | 66, of which 24 archived |
| sections | 281, stored verbatim |
| tasks | 2,171 |
| subtasks | 72 and climbing, details phase still running |
| distinct assignees | 6 |
| follower rows | 2,593 |
| custom field values | 265 |
| attachments, metadata only | 32 and climbing |
| stories | 3,840 and climbing |

Filing of the 66 projects: 43 by Asana gid, 7 by name, 0 by hand, 16 unassigned.

The crosswalk: 55 rows in the file, 55 in the table, 0 gids lost, 45 distinct
clients, 43 rows carrying a gid, 47 carrying a Dropbox name.

Dropbox, local walk of the synced folder in 1,467 seconds: 2,183 folders,
11,150 files, 415 GB, 0 unreadable. 52 folders at client depth, 38 filed
against a client, 14 unassigned.

### Reconciliation that gives confidence in the task count

The crosswalk's own `asana_total_tasks` column sums to 1,853 across the projects
it names by gid. The mirror holds 1,858 tasks in those same projects. The two
numbers were produced by different tools weeks apart.

### Open

1. **The details phase is still running.** Subtasks, stories and attachments,
   three requests per task over 2,171 tasks. Resume with
   `node scripts/asana-mirror.mjs 1209746078758723 --port 5174 --budget 12`.
   It resumes where it stopped; running it twice costs time and nothing else.
2. **Nothing is on remote.** Migrations 0032 to 0035 and the mirror itself are
   local only.
3. **16 Asana projects and 14 Dropbox client folders are unassigned.** That is
   the bucket working as ruled, not a failure. They are visible and resolvable
   by editing the crosswalk and re-loading.
4. **`name_drift` says 9, the brief said 20.** The file has 35 `no`, 11 `n/a`
   and 9 `yes`. Reported as the file reads, not adjusted to match the brief.
5. **`macgray_client_roster.csv` is not loaded.** 36 rows on a different shape
   (`name, status, shared_mount, last_activity, evidence, notes`). It is a
   status overlay, not a matching authority, and it needs its own loader.
6. **`docs/data/` is gitignored.** Real client names, gids and activity dates.
   The loader reads them from disk; nothing needs them in a remote repository,
   and putting them there is a one-way step nobody has asked for.

### The safety gap this work exposed

`layer2-api.test.ts` claimed a seeded `v-` row could not be pushed to a real
Asana workspace. It was passing because there was no Asana token locally, so
every push stopped at the missing-token check and the guard the test named had
never run. Configuring a token to build the mirror made it fail.

There is now an actual guard, refusing on the fixture prefix, placed before the
token and the workspace are looked at. The test asserts the reason, not just
that something went wrong.

*Session 05. Nothing above alters sections 1 to 11.*

---

## 13. The roster, the unassigned bucket, and what the mirror shows

Branch `realdata/stage-a`, through commit `b1a2a83`, pushed green. Still not
merged, still nothing on production.

### Built

- **Migration 0036**: `client_roster`, `client_roster_loads`, and
  `client_overrides`. Applied to both local databases, not to remote.
- **The roster loader**, its own route at `/api/crosswalk/roster`. 36 rows in
  the file, 36 written, 36 held, 36 matched exactly, 0 unmatched, 0 normalised
  guesses. Statuses: 24 active, 7 dormant, 3 reclassify_active, 1
  reclassify_completed, 1 reclassify_unknown.
- **`/clients/unassigned`**, the resolution screen. Verified rendered at 1920
  and 412 against the real mirror, one H1, 44px tap floor, no page overflow.
  The override round trip was exercised on live data and left clean: 16
  unassigned to 15 with `by_manual: 1`, then back to 16.
- **Precedence** is now one chain in one place: gid, manual override,
  dropbox_name, normalised name, unassigned. D181.

### What the mirror shows

Numbers, not conclusions. 2,585 tasks across 66 projects.

| | |
|---|---|
| open tasks | 790 |
| open with no assignee | **561** |
| open with no due date | 152 |
| open and past due | 189 |
| open inside an archived project | 98 |
| open with no section | 364 |
| distinct section names | **103** across 66 projects |
| custom field definitions | 10, carrying 265 values |
| tags defined in the whole workspace | 1 |

Clients: 45 in the app. 36 carry a roster row, 38 have an Asana project, 38
have a Dropbox folder, 32 have both, 1 has neither.

Dropbox: 2,183 folders, 11,150 files, 415 GB. 2 client folders hold no file at
all; 4 have not been touched in twelve months; 2,928 files were modified in the
last ninety days.

Disagreements worth a person looking at: 4 clients the roster calls dormant
still have open Asana tasks. 16 unassigned projects, every one of them
archived.

### Open

1. **The details sweep is on its second pass.** The first pass walked
   `gid > cursor` over a table that grew as it discovered subtasks: 335 of 349
   subtasks carried a gid below the cursor and were walked past. Fixed in
   `b1a2a83`; the second sweep is running and will take about ninety minutes.
   Structure, sections, tasks, assignees, followers and custom values are
   complete and unaffected.
2. **Nothing on remote.** Migrations 0032 to 0036 are local only. Stage C is
   gated on Paul's findings and on a ruling about whether production carries
   firm client data before the partner conversation.
3. **`docs/data/` stays gitignored.** Holding there by ruling.

*Session 05, second half. Nothing above alters sections 1 to 12.*

---

## 14. The Asana pull is complete

Finished `2026-09-01T16:23:10Z`, four hours fifty-three minutes after it
started. Phase `done`, no error, cursor cleared.

| | |
|---|---|
| workspace | 1, MacGray Consulting |
| teams | 1 |
| projects | 66, of which 24 archived |
| sections | 281, verbatim |
| tasks | 2,171 |
| subtasks | 414 |
| distinct assignees | 6 |
| follower rows | 2,958 |
| tags | 1 |
| custom field values | 309, against 10 definitions |
| attachments, metadata only | 66, across 48 tasks |
| stories | 10,062 |

Coverage checks. 2,584 of the 2,585 tasks carry at least one story, which is
what a completed details walk looks like. There are no sub-subtasks, so nothing
sits below the depth the pull reached. The crosswalk's own `asana_total_tasks`
sums to 1,853 across the projects it names by gid and the mirror holds 1,858 in
those same projects, two figures produced weeks apart by different tools.

The second sweep found no tasks the first had not, so the phase moved to `done`
rather than sweeping a third time. That is the D169 rule working: the first
sweep had walked past 335 of 349 subtasks, and without the count comparison it
would have reported done over a set it never finished.

### Still open, unchanged

1. **Nothing on remote.** Migrations 0032 to 0036 are local only. Stage C is
   gated on Paul's findings and on a ruling about whether production carries
   firm client data before the partner conversation.
2. **16 Asana projects and 14 Dropbox client folders unassigned.** Every one of
   the 16 is archived. Resolvable on `/clients/unassigned`.
3. **`docs/data/` stays gitignored** by ruling.
4. **Pushing to Asana is switched off** (D184) and stays off until Paul turns
   it on.

*Session 05. Nothing above alters sections 1 to 13.*
