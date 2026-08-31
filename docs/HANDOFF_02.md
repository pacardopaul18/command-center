# HANDOFF 01

Written 2026-08-29. First handoff for Command Center.

Append-only. Never delete inherited content. When this is superseded, copy it
forward to `HANDOFF_02.md`, keep everything, and mark resolved items inline with
the session and commit hash that resolved them.

This document assumes no prior context. Read `CLAUDE.md` first, then
`docs/Command_Center_Build_Plan.md` and `docs/Command_Center_Architecture.md`,
then `docs/DECISIONS.md`, which is the authority on every decision, risk and
gate. This file summarises state; the ledger explains why.

---

## 1. What this is

A private, single-user operations command center for Paul Pacardo. It
complements the firm's Asana, which stays their shared system of record. It
never replaces it.

Built on Cloudflare: one Worker with Static Assets serving both a SvelteKit
front end and a Hono API, with D1, KV, R2, Cron Triggers, Resend and Cloudflare
Access.

---

## 2. Live state

| Thing | Value |
| --- | --- |
| URL | `https://work.kabuhayan.app`, and nowhere else |
| Auth | Cloudflare Access, One-Time PIN plus Cloudflare SSO, both gated by a single Paul-only email policy. No auth UI exists in the app and none will, D25 |
| Public surface | `workers_dev = false`, `preview_urls = false`. Confirmed live: `{"enabled":false,"previews_enabled":false}`. R6 closed |
| Deploy model | Git-connected Workers Builds. Push to `main`, Cloudflare builds and deploys. Not Pages, D29 |
| Worker | `command-center`, account `09d30ac2fb14b703740140910d92b108` |
| Database | D1 `command-center-db`, id `00922b27-9b84-4097-ba4e-568a8f06c6ee`, primary region APAC |
| Migration level | **7 of 7**, latest `0007_templates.sql`. Verified with `npm run schema:check` &middot; **SUPERSEDED, session 02, `4d22251`: now 16 of 16, latest `0016_calendars.sql`. See section 8** |
| KV | `SESSIONS`, id `9671c77ef65242ebb96b4e7d771cb530`. Holds digest idempotency markers and Asana settings &middot; **EXTENDED, session 02: also the Asana sync cursor and the Google OAuth tokens. Tokens are deliberately NOT in D1, because the nightly backup copies every D1 table to R2, D81** |
| R2 | `command-center-files`. Holds meeting transcripts &middot; **EXTENDED, session 02: also nightly D1 dumps, email bodies and, on demand, attachments** |
| Cron | `0 0,13,14,23 * * *`, registered and confirmed live via the Cloudflare API &middot; **SUPERSEDED, session 02, `ab5c786`: now `0 0,9,10,13,14,23 * * *`, the added hour being the nightly backup. See section 8** |
| Observability | Enabled, `head_sampling_rate = 1`, `invocation_logs: true`. Free plan: 200k events a day, **3 day retention** |
| Plan | Workers Free. No spend control exists on Free; it hard-stops at its limits rather than billing, T6 |

**Secrets set on the Worker**, confirmed by name against the Cloudflare API. Values
were never read and must never be printed:

- `ANTHROPIC_API_KEY`
- `ASANA_TOKEN`
- `RESEND_API_KEY`
- `GOOGLE_CLIENT_ID` **added session 02.** Not a secret by nature: an OAuth
  client id appears in the consent URL every user sees. Stored as one anyway,
  which resolves identically at runtime
- `GOOGLE_CLIENT_SECRET` **added session 02**

**Digest configuration**, plain vars in `wrangler.toml`, not secrets:
`DIGEST_FROM = digest@kabuhayan.app`, `DIGEST_TO = pacardopaul18@gmail.com`,
07:00 and 17:00 Mountain, D43 as amended.

### Stages

| Stage | State |
| --- | --- |
| Stage 1, foundation | **CLOSED** 2026-08-29, re-closed the same day on corrected evidence after a false claim about the login method |
| MVP | **CLOSED** 2026-08-29. Today cockpit, Projects, SOPs, Invoicing, digests |
| v1 | **PENDING**. Built in full; five verifications outstanding with Paul. Gate table written out in `docs/DECISIONS.md` &middot; **UPDATED, session 02: four of the five verifications closed. Row c closed by a real Asana push, gid `1217972687132070`. The `/api/backups` glance remains the one unverified box. The gate table in DECISIONS.md remains the record; no separate audit file exists** |
| v2 | Not started. See section 6, which is unscoped |

### Modules live

Today cockpit, Action Items, Projects on the five PMI phases, SOP library with
immutable version history, Clients, Invoicing with four aging bands, Meetings
with transcript import and AI summary and extraction, Templates with AI
drafting, Reports with PDF export, Settings, and the twice-daily digests.

---

## 3. Open items, with DRIs

Nothing here is blocked on code unless it says so.

### R7: digest deliverability, OPEN. DRI Paul

> **REDEFINED, session 02.** Closure is now absence-based rather than
> observation-based: R7 closes when several consecutive days pass with no
> digest found in spam, not when one is seen in an inbox. A single sighting
> proves one delivery and nothing about the pattern. The multi-day clock is
> running from 2026-08-29.

The mitigation is live: `DIGEST_FROM` moved from the shared `onboarding@resend.dev`
to `digest@kabuhayan.app`, a domain verified in Resend with DKIM and SPF.

Not yet closed, because placement has not been observed. This matters more than
it looks: a digest that lands in spam does not fail loudly, it fails by being
absent from a screen nobody is looking at, which is the exact failure this
product exists to prevent.

Closes when Paul confirms where digests land over several days, not one.

### O3: partner time baseline not captured, OPEN. DRI Paul

> **STILL NOT STARTED as at session 02 close, 2026-08-31.** First line not
> yet written. The week it was scheduled for begins 2026-08-31.

Prerequisite for the v2 partner-hours-saved dashboard. Starting the week of
2026-08-31 as a running 15-minute-increment note.

The dashboard cannot be built honestly without it. Its own method starts with a
baseline audit, and a headline "hours reclaimed" computed against an invented
baseline looks like evidence while being a guess, D52.

What the dashboard will need: per-task-type baseline minutes, volume handled,
briefing and review time, and a separate slips-caught register with a
conservative rework-hours-avoided figure. Those become the `TimeSavedLog` and
`SlipsCaught` tables, neither of which is created until there is real data.

### O2: Zero Trust plan state. DRI Paul

Activated on the free plan during Stage 1. Carried here only because the entry
predates activation and has never been formally retired.

### The ambiguity backstop is untuned. DRI Paul

The extraction backstop flags any item missing an owner or a deadline. Whether
that threshold floods a busy call is unknown: the one live test was an
interview-shaped call producing a single action item, which cannot exercise it.

It stays as built. Tuning against data that cannot exercise the rule would be
fitting it to the wrong evidence. Waits for a task-heavy client call transcript.
No code changes until one exists.

### Design debts, deferred with revisit points

Carried forward from the MVP gate. None is a defect; each was an explicit
omission rather than a silent one.

- **Today's meetings cockpit card.** The design's cockpit has four cards. The
  meetings card was deferred when Meetings did not exist. Meetings exists now,
  so this is buildable and unblocked.
- **The invoice alert cockpit card.** Same shape, also now unblocked.
- **The project phase checklist**, and the Meetings, Time and Invoices panels on
  the project detail screen. No checklist data model exists; adding one is a
  module of its own.
- **The client column on the projects list**, omitted rather than shipped
  reading "no client" on every row. Clients exists now, so this is unblocked.

Governing rule, D27: UI copy never references an affordance that does not exist
yet, and guideline strings adopt when their feature ships.

### Structural debt worth naming

- **Reports are computed live and never stored**, D51. Correct for v1. The
  `reports` table arrives with v2, when shareable links and stored PDFs give it
  something to hold.
- **Asana is one-way**, D4. Two-way sync is v2 and is genuinely harder. Do not
  attempt it until the standalone app is stable.
- **No backups beyond D1's own.** Nightly D1 to R2 backups are v2. D1 on the
  Free plan retains 7 days of point-in-time restore; Paid extends it to 30.

---

## 4. The digest incident, and what it taught

Worth reading in full even by someone who never touches the digest, because both
lessons generalise.

### What happened

No scheduled digest had ever arrived. The only email ever sent was a forced
manual test.

**Root cause: the cron never had an eligible firing.** The trigger was created
on the Worker at `2026-08-29T00:13:09Z`, 45 seconds after the commit that added
it, and 73 minutes after the `23:00Z` firing it was supposed to serve. The
`00:00Z` firing was 12 minutes before that commit. Nothing failed. The feature
shipped after the only firing time that had passed.

Established from four independent sources before anything was changed: the
Cloudflare `/schedules` API, the commit timestamp normalised to UTC, the
deployment list, and the cron expression itself.

### The finding that mattered more

The question "what do the logs show for that invocation" had no answer.
`observability` was unset, so nothing had ever been recorded, and the next
firing would have been equally unanswerable.

A scheduled job here has no HTTP response, runs twice a day, cannot be retried
by the platform, and writes its only durable trace after it has already
succeeded. Without logs it is invisible in the one failure mode that matters:
running and doing nothing.

Fixed. Observability on at full sampling, because sampling a twice-daily job
means losing whole firings. Every firing logs now, including the three in four
that do nothing, because an absent digest and a broken one looked identical from
outside.

### Two standards that came out of it

**Run every path before trusting it.** The cron path had been written, reviewed,
deployed and reasoned about across two sessions without ever executing once. It
was correct, but nobody knew that. Correctness that has never run is a belief.

**A scheduled handler is ordinary code and can be called like ordinary code.**
`wrangler dev --test-scheduled` proves the entry point is reachable but ignores
every attempt to override `scheduledTime`, so it can only ever exercise whichever
branch the wall clock happens to select. The hour-dependent branches were driven
directly against the built `_scheduled.js` with a stubbed environment: morning,
evening, a dead hour, the winter case, and a database fault. Waiting for a real
firing to find out whether a handler works is not a test strategy.

Recorded as D56. The rendering fix that shipped alongside it is D57.

### Related: the /templates 500

A separate incident the same day, worth pairing with it. Code auto-deploys on
push; D1 migrations are applied by hand. A push carrying both shipped code that
queried a table production did not have.

The ruling is an ordering rule, not automation: migrate remote first, push the
dependent code second, D50. Applying migrations inside the build was rejected
because it would put an unreviewed irreversible schema change on production every
push. The rule holds only for additive migrations; a destructive one needs
expand-then-contract across two deploys.

Detection shipped alongside, because a rule that depends on memory is exactly
what had just failed: the build bakes the expected migration into the bundle,
`/api/health` returns 503 on drift naming the fix, and `npm run schema:check`
fails before a push.

---

## 5. How to work in this repo

The full set is in `CLAUDE.md` and `docs/DECISIONS.md`. The ones that bite:

- **Read the existing modules before writing date, money or auth logic**, D54.
  The codebase is its own reference now. This rule exists because a report
  rewrote timezone handling from scratch and regressed, while three correct
  implementations already sat in the repo.
- **Dates.** `src/lib/server/dates.ts` is the reference. Never take the date of a
  stored UTC timestamp with `date()` in SQL. Cron Triggers are UTC only.
- **Money.** Integer cents end to end. Aging derived at read time, never stored.
- **Table rebuilds.** `DROP TABLE` fires `ON DELETE` referential actions and will
  silently destroy links. Stash, rebuild, restore, verify. D38.
- **Migrations.** Snapshot before every remote migration, unconditionally, never
  waived, D39. Migrate before pushing dependent code, D50.
- **AI output.** Anything that must always hold is enforced in code, not
  requested in a prompt, D48. A prompt is a request, not a constraint.
- **Never `{@html}`.** The markdown renderer is safe by construction, D44.
- **No em dashes**, anywhere. Not chat, code, UI copy or commit messages.
- **Ask before anything that deploys, applies a remote migration, or touches the
  Cloudflare account.**

### Testing habits that have caught real defects

- Grep the *rendered* region, not the whole page. Three false alarms came from
  matching strings that lived only in SvelteKit's hydration payload.
- Check dev-mode artifacts against a production build before reporting them.
- On Windows, `pkill` silently does nothing. Use `Get-NetTCPConnection` and
  `Stop-Process`, and run dev servers with `--strictPort`.
- A single failed API call is not evidence. A transient 7403 nearly sent the
  `/templates` investigation the wrong way; the retry succeeded.

---

## 6. v2 vision

> **UNSCOPED. CHANGE-CONTROLLED. NOT APPROVED FOR BUILD.**
>
> Nothing in this section is a commitment, an estimate, or a design. It is
> Paul's stated direction, recorded so it is not lost and not misremembered.
>
> **A scoping session is required before any v2 work begins.** No code, no
> schema, no spike.
>
> **Prerequisite: the partner-permission conversation.** Most of what follows
> touches the partners' email, the clients' correspondence and the firm's
> documents. That is not Paul's data alone, and consent is a precondition of
> scoping, not a step inside it.

### The direction

The product moves from a place where Paul records his work to one where it
drafts and reasons on his behalf, with a human approving every outward step.

### Themes as described

**Email account integration for context-aware drafting.** Connect a mail
account so drafting happens with the real correspondence in view, producing
replies in the partner's voice and in each client's register rather than in a
generic professional one.

**Thread history as drafting context.** A reply is drafted against the thread it
belongs to, so it inherits what was already said, agreed and promised, instead
of being written from a prompt in isolation.

**AI-proposed templates with approval gates.** Rather than Paul authoring every
template, the system observes recurring correspondence shapes and proposes new
templates. Nothing enters the library without explicit approval.

**Document upload with AI reading.** Charters, timelines and process documents
uploaded and read against live state, so the system can report risk and progress
by reconciling what a document promised against the tickets and blockers that
exist now.

**Agent with approval as the product's direction.** The through-line. The system
proposes and prepares; a human approves before anything leaves it.

### What scoping will have to settle

Listed to size the conversation, not to pre-empt it.

- Consent and scope of access to partner and client correspondence, before
  anything technical.
- Which mail provider, which auth model, and whether tokens can be held at all
  under the firm's obligations.
- Data residency and retention for correspondence and uploaded documents, and
  whether client material may be sent to a model provider at all.
- Whether "the partner's voice" is one voice or several, and who arbitrates.
- What an approval gate means concretely: what is shown, what is logged, and
  what is irreversible once approved.
- How this interacts with Asana staying the firm's system of record, D4.
- Whether the existing single-user assumption survives any of it.

### Existing v2 items, already logged and unaffected

These predate the vision above and stay as scoped work rather than direction:
partner-hours-saved dashboard (blocked on O3), shareable read-only report links,
two-way Asana sync, nightly D1 to R2 backups.

---

## 7. Immediate next actions

1. **Paul:** the five v1 gate verifications, in flight at the time of writing.
   The 13:00Z digest firing, the `onboarding@resend.dev` search, the D55 Asana
   link click, the Templates register retest with a real exemplar, and the
   `/reports` check.
2. **Paul:** start the O3 baseline note, week of 2026-08-31.
3. **Next session:** on gate close, close v1 in `docs/DECISIONS.md` against the
   table already written there, then pull the 13:00Z invocation record while it
   is still inside the 3-day log retention window.
4. **Not before a scoping session:** anything in section 6.


---

# SESSION 02 UPDATE

Appended 2026-08-31 at session close, commit `4d22251`. Nothing above this line
was removed. Rows that no longer hold carry an inline SUPERSEDED note with the
session and the commit that changed them, and the superseded value is left
visible beside the new one, per D60.

Every figure below was read from the live database or the live config at the
time of writing, not from memory or from earlier in the session. Where the
number differs from what was believed during the session, the verified one is
used and the difference is named.

---

## 8. State summary, verified 2026-08-31

| Thing | Verified value |
| --- | --- |
| Remote migrations | **16 of 16**, latest `0016_calendars.sql`. Read from `d1_migrations` |
| Suite | **213 unit and contract tests, 55 browser tests, green.** Ten test files |
| Cron | `0 0,9,10,13,14,23 * * *`, read from `wrangler.toml`. Six firings; three do nothing but the backup, the two digests and mail work now ride them |
| Nightly backups | Restore-proven, D58. A dump was written to production R2, pulled back and restored into an empty database with identical rows, links, indexes and triggers |
| Production seed data | **None.** `clients WHERE id LIKE 'v-%'` returns 0 |
| Mail: messages | **865** |
| Mail: HTML bodies | **863.** The other two are genuinely plain-text messages |
| Mail: threads | **775** |
| Mail: triaged | **583** |
| Mail: awaiting triage | **192** |
| Calendars discovered | **3.** Two owned, one with an access role of `reader`, which is somebody else's calendar already shared with Paul |
| Calendars syncing | **3, all on.** See the correction below: this is not the design default |
| Asana | Two-way polling live via `modified_since`. Webhooks excluded from lean entirely, D68, not deferred within it |
| Tickets and rate model | In schema and live, D71 and D72 |
| Client 360 | Live. Contacts and contracts exist; both tables are currently empty |
| Google connection | `pacardopaul18@gmail.com`, status `connected` since 2026-08-30T08:44:26Z. Paul's own account only |
| Google scopes | `gmail.readonly` **RESTRICTED**, `calendar.readonly` **SENSITIVE**, read off the consent screen, D78 |
| Token expiry | Testing mode expires the refresh token every 7 days. Connected 2026-08-30, so **first re-auth due about 2026-09-06** |
| Attachments | 30 rows of metadata. No files pulled into R2 yet; they are fetched on demand |

### Three corrections to figures quoted during the session

Named rather than silently replaced, because the difference is the point of
verifying.

1. **Threads are 775, not 773. Triaged is 583, not 586. Awaiting triage is 192,
   not 187.** The session's figures were read before the last ingest steps
   added threads. The queue for the reset is 192.
2. **All three calendars are currently syncing, and Paul did not choose them.**
   The session enabled them to verify the per-calendar read path. The design
   default is off, and the code default is off; the live state is on because of
   a test. Paul should turn off any he does not want before the rehearsal, or
   leave them, but he should know they were not his choice.
3. **`ai_usage` holds 0 rows.** The spend meter has therefore recorded nothing.
   Every triage so far ran before the meter existed, so the meter itself is
   also unexercised and its first data arrives at the reset.

### NEVER EXERCISED

Two things are built, typechecked, wired and pushed, and have never run. They
are not done and must not be reported as done.

- **The drafting pass has never produced a draft.** `email_drafts` holds 0 rows.
  It has been exercised on no thread, real or otherwise. Paul reading a draft is
  the test, and nobody may call it tested before that.
- **The two-tier triage path has never run under a real cron firing.** No firing
  has executed it, and `ai_usage` confirms no call of any kind has been recorded
  through the new code. Both first run at the **2026-09-01 00:00 UTC** Anthropic
  usage reset, which is 18:00 Mountain on 2026-08-31.

---

## 9. Open items registry

The entries in section 3 above stand as written and are not repeated here. This
section adds what is open as at session 02 close.

| Item | DRI | State |
| --- | --- | --- |
| R7, digest deliverability | Paul | **OPEN, REDEFINED.** Closure is absence-based: several consecutive days with no digest in spam. A single inbox sighting proves one delivery and nothing about the pattern. Multi-day clock running from 2026-08-29 |
| T-obs-token | Paul | **OPEN, WIDENED.** Now needs **Workers Observability Read plus Workers Builds Read**. Builds Read was added because the branch-build question hit the same 403 and had to be deferred, D64. Delivered by `wrangler secret put`, never in chat |
| O3, partner-hours baseline | Paul | **OPEN, NOT YET STARTED.** Week of 2026-08-31. First line unwritten |
| Partner-permission conversation | Paul | **OPEN. Opener email DRAFTED, NOT YET SENT.** Gates section 6 in full and every firm-account connection. Nothing in the vision register may be built before it |
| Google restricted-scope verification | Paul | **OPEN, long lead.** Publishing a `gmail.readonly` app needs Google verification plus a CASA assessment. Twin to the partner conversation: both take calendar time, both gate partner accounts, neither gates Paul's own use, D78 |
| T-silent-writes | Next session | **PARTIAL.** 24 call sites still to route through `apiWrite`. Each to be verified by intercepting a response, not by reading the code, D66 |
| 192 queued triages | Machine | **QUEUED for the reset.** Drains under the two-tier regime |
| First two-tier firing | Machine | **NEVER EXERCISED.** First run at the reset |
| First draft generation | Machine, then Paul | **NEVER EXERCISED.** First run at the reset; Paul's judgment is the test |
| Reset-time dispatcher check, D107 | Next session | **OPEN.** Confirm the ingest takes a share and triage gets the remainder, and that the log says which ran. The failure this guards against is invisible: a firing that did nothing and a firing that was busy look identical unless the log distinguishes them |
| Workstream 3 residual | none | **NONE.** Migration 0010 applied; Client 360 complete |
| Rehearsal | Paul | **Tuesday 2026-09-01.** Seed reload first, because the volume seed is Mountain-anchored and expires nightly. Then H1 and H2 verdicts, the backup glance, chip corrections on triage misses, and draft judgment |
| MacGray engagement | Paul | **Starts Wednesday 2026-09-02** |

---

## 10. Paul's concerns register

What Paul asked for in his own terms, tagged by what actually happened. Kept
because a request satisfied by accident is indistinguishable from one satisfied
on purpose unless it is written down.

| Concern | State |
| --- | --- |
| Progress must be visible, never inferred | **SHIPPED.** Stored readouts with honest counters. No percentage is drawn from an estimate the run has already exceeded, D85 and D90 |
| Long jobs must never depend on a tab staying open | **SHIPPED.** Jobs run as passengers on the existing cron firings, D95 |
| Estimated time remaining on long runs | **SHIPPED.** Measured from the run's own rate, and withheld when the estimate is known to be wrong |
| Automatic sync, no manual driving | **SHIPPED.** Manual buttons remain, but nothing depends on them |
| Automatic triage labels, human corrections as signal only | **SHIPPED.** Two-tier regime **QUEUED** for the reset. Corrections stored beside the model's answer, never over it, D92 |
| Mail must render like real email | **SHIPPED, RENDER-2.** HTML preferred, links stay links, hard-wrap compression removed, quote trails collapsed, signatures dimmed, D91 and D99 |
| Attachments, logos, inline images, full visual fidelity | **Metadata SHIPPED.** Inline images **opt-in by design**, because a remote image is a tracking pixel as often as a picture. Full visual fidelity is **INTAKE**, not promised |
| The drafts folder is private, never ingest unsent drafts | **SHIPPED.** Double exclusion: the Gmail query and a label check on the way in. Three stored drafts purged and verified gone, D98 |
| One-click thread open, no click per message | **SHIPPED.** Latest message open on arrival, its body sent with the page |
| Severity filtering, Gmail style, with counts | **SHIPPED** |
| Pagination user-controllable | **SHIPPED,** 10 to 500 |
| Headers distinct, active-nav pill, click-to-filter cards, dropdowns not free text | **SHIPPED,** Bucket A |
| API cost must be visible and controlled in-app | **SHIPPED.** Two-tier models, per-run budgets and a token meter. The meter itself has recorded nothing yet, see section 8 |
| The app must be fast at volume | **SHIPPED.** Server-side pagination, profiled first: load 4747ms to 1047ms, DOM 130,225 nodes to 2,870. Sidebar sticky |

---

## 11. Vision register

**Pointer only. The content is not reproduced here and must not be.** F1 to F18
and section 6 live in Paul's PM-side `VISION_SCOPING_INTAKE` document. All of it
is **UNSCOPED, CHANGE-CONTROLLED and NOT APPROVED FOR BUILD**, pending the
partner conversation and a scoping session. The freeze is structural: keeping
the content out of the repo is what stops it being treated as a backlog.

| F | One line |
| --- | --- |
| F1 | Universal intake and living memory |
| F2 | Schedule intelligence |
| F3 | Capability-aware assignment |
| F4 | Transcript to execution |
| F5 | Org charts |
| F6 | Company-health accounting |
| F7 | PTO |
| F8 | Phase checklists with nudges |
| F9 | Time analytics |
| F10 | Workflows |
| F11 | SOP evolution |
| F12 | QuickBooks-grade invoicing |
| F13 | Jira parity with Tempo-style time |
| F14 | Calendar sync and context-aware meeting AI, deduplicated against history |
| F15 | Report library |
| F16 | Today to Dashboard. **Done lean.** Full version INTAKE |
| F17 | SOP shelves |
| F18 | Client 360. **Done lean.** Full version INTAKE |

Note on F14: the "subscribe to whoever" half arrived by scope design rather than
by building anything. `calendar.readonly` already lists every calendar shared
with the account, so a colleague sharing a calendar in Google is all that is
required, D105. Their **mail** remains governed by the partner conversation, and
that boundary has not moved.

---

## 12. Standing rules added across sessions 01 and 02

Numbers are ledger ids in `docs/DECISIONS.md`, where the reasoning lives.

| Rule | Meaning in one line |
| --- | --- |
| D63 | Density and spacing judged against volume renders, not against empty screens |
| D64 | Held work parks on a side branch; local `main` tracks `origin/main` |
| D65 | Never offer an option whose selection produces a broken record |
| D67 | Evidence over memory, whoever holds the belief |
| D68 | Phase 2 sequencing; Asana lean is polling only, webhooks excluded rather than deferred |
| D69 | A deleted Asana task marks the item ambiguous, never touching status, never clearing the gid |
| D70 | A scope never granted cannot be reached by a later bug |
| D71 | Tickets and action items are two entities; actual hours are never stored |
| D72 | The rate model is additive: copied on write, never looked up at read |
| D74 | Mutual verification; a test that passes once then skips is lying twice |
| D77 | Tests set up their own state when the code under test writes the field it reads |
| D78 | `gmail.readonly` is RESTRICTED; the cost lands on partner accounts, not on the build |
| D79 | Client 360 reads like a UI job and is not |
| D80 | An error matcher is verified only by causing the error, never by reading it |
| D81 | Credentials do not go in D1, because the backup would spread them |
| D82 | The scope list is the safety mechanism, and the suite guards it |
| D84 | Ingestion is batched and resumable, and its progress is a stored record |
| D85 | A per-page estimate shown as a total reads as a bug |
| D86 | Mail bodies do not go in D1, for the same reason credentials do not |
| D87 | Parsing is where a mail reader actually breaks |
| D88 | A summary reports what the thread says, including that nothing happened |
| D89 | Verify mail by counts, never by content |
| D90 | A status field recording intent rather than activity will eventually lie |
| D107 | A job making no progress must not hold the whole budget |

Additional standing rules, stated as practice rather than as a single numbered
decision:

- **Held work parks on a side branch.** Never on `main`, D64.
- **Evidence-window freezes are enforced structurally**, not by remembering.
- **Irreversible production deletes require a verified snapshot first**, and the
  rows must be confirmed recoverable from it before anything is removed.
- **Production writes through a preview binding need per-operation
  authorization.** A remote-bound preview writes to the real database.
- **Paul-verification tasks are non-transferable.** A box only he can check does
  not get closed by inference.
- **Identity, not recency, for re-work keys.** Tonight's body re-read moved every
  thread's `last_at` while changing nothing anybody wrote; under a timestamp key
  that would have queued a full re-summarise of 865 threads on the expensive
  model, D103.
- **A mitigation that reduces frequency is not a fix**, and is dangerous because
  it looks like one. The test is whether the change removes the cause, D106.
- **Recovery must distinguish transient from permanent.** Writing a row off over
  a network blip is a second failure mode wearing recovery's clothes, D97.
- **Verbatim state travels with a quote.** A gate row or open item carries its
  state wherever it is repeated, D60.

---

## 13. Next session, first business, in order

1. **Reset-time verification.** The D107 dispatcher check: confirm the ingest
   takes a share, triage gets the remainder, and the log says which ran. Then
   the first two-tier firing logs, then the 192 drain.
2. **First draft generation, and Paul's judgment of it.** Voice: does it sound
   like him. Hard rule: did it commit to anything not already agreed in the
   thread, and are there bracketed blanks where decisions belong. Nobody calls
   the drafting pass tested before this.
3. **Tuesday rehearsal findings into same-day fixes.** No new features that day.
4. **Nothing lands Wednesday.** Paul's first day at MacGray.

---

*Session 02 closed 2026-08-31 at commit `4d22251`. Paul calls the final word on
this handoff.*


---

# SESSION 03 UPDATE, CR-1

Append-only. Nothing above is altered.

## 10. CR-1, Mail redesign

Both Mail views rebuilt against the supplied prototype. Complete at about 8
hours, inside the 7 to 9 window. Held on branch `mail/redesign` at `1e761f3`.
Not pushed, not merged. Merge GO is queued behind Tuesday's sequence and the
rehearsal.

Suite at hold: 251 unit and contract, 61 browser, 673 files typechecked with 0
errors.

Decisions D123 to D128 recorded and ratified.

### F1: the page-scope miss, logged

The thread detail page never passed account scope. Page load, body fetch and all
five writes threw once a second account existed.

E1's 13-case segregation suite did not catch it, because it tested API routes
and this was a page loader calling them. With one account connected,
`resolveAccount` returns the only account and the fault is invisible.

Caught pre-merge by CR-1's guarantee tests, which were written first and run
against the old views before any redesign work. No production exposure:
production has one connected account. E1 is not reopened. The fix ships in CR-1.

The rule is D127. Segregation guarantees cover page loaders and server load
functions, not only the routes beneath them.

**Two siblings found while recording that rule, logged and deliberately not
fixed**, because nothing further was authorized before the reset:
`src/routes/meetings/+page.ts` and `src/routes/settings/+page.ts` fetch
account-scoped data without naming an account. Neither leaks and neither
crashes. `resolveAccount` refuses rather than guessing once more than one
account is connected, and both loaders treat a non-ok response as null, so they
go silently blank. Settings matters most: it holds the calendar list and the
mail ingest progress, and it is where somebody would go to find out why. Open,
unowned, not scheduled.

### Two defects found by rendering, not by reading

- **The archived count reported the inbox total.** The list endpoint pins its
  counts block to non-archived rows, correctly, because it feeds the severity
  chips. Asking it with `archived=true` returned inbox numbers. The same fault
  ran the other way: the chips counted the inbox while the reader was looking at
  the archive. D124. Would have shown wrong numbers on every archive view.
- **The remote-image hold was tested one layer from where it lives.** The parser
  test covers which sources survive parsing; whether the browser is ever pointed
  at one is a different question, answered by the template. Now asserted on the
  rendered page against a real body seeded into R2, mutation checked both ways.
  D125.

Both are the argument for D128, rendered verification on every UI epic.

### NEVER EXERCISED, added by CR-1

Both are built, typechecked and tested against synthetic fixtures only. Neither
has met real data. Their verdicts are rehearsal findings.

- **Attachment download has never run on a real thread with real attachments.**
  The route is new: bytes are fetched from Gmail on request, ownership asserted,
  nothing stored. No real attachment has passed through it.
- **Neither drafting mode has run on a real thread.** This compounds the
  standing entry that the drafting pass has never produced a draft at all. CR-1
  adds a second mode, drafting from Paul's own words, and it is equally
  unexercised.

The prototype's sample threads and message bodies were read for layout only.
Nothing from them was seeded anywhere, and no mail content appears in this
document.

### Rehearsal scope, CR-1 additions

Rehearsal runs on the `mail/redesign` preview, seed or preview bindings only.
Production writes via preview bindings remain per-operation authorized and none
is granted. Added to scope: attachment download on a real thread with real
attachments, and both drafting modes on a real thread.

### Order for Tuesday, unchanged

The 08:00 PH four-step sequence runs first and takes absolute priority: verify
the firing, let triage drain, the supervised E4 pass, first drafts, then STOP
for Paul's verdicts. Production drafts in step 4 are judged where they appear.
Rehearsal follows on the redesign preview when Paul calls start. Merge GO on
`mail/redesign` issues after rehearsal findings, alongside E4 merge GO if the
supervised pass reports clean.


### CR1-F4: the centred layout, raised by Paul

Mail rendered inside the shell's 1200px cap and centred, where the design is
full width with the rail against the right edge. Opened and closed the same day.
Fixed by a route-level opt-out, not by moving the cap; other modules measured
unchanged. The rule is D129.

Missed by the CR-1 fidelity pass because that pass rendered at 1440px, where the
cap reads as padding. It was obvious at Paul's width and nowhere else.

### CR-1 merge condition, the only one left

Everything on `mail/redesign` is ratified through `6d8af9d`. Merge is gated on a
single test no automated check can perform: opening a real thread in Paul's own
mailbox, pressing Send via Gmail, and confirming three things. Whether Gmail
opened on the right account, whether the body arrived with spaces intact, and
whether To and Cc landed.

It cannot be run from the build environment. The local preview holds fictional
accounts and the real connection lives in remote D1, so pressing the button
there would compose to an address that does not exist. Paul's click is the test.

Pass issues merge GO. Fail opens CR1-F5, fixed on the branch.

