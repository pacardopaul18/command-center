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
