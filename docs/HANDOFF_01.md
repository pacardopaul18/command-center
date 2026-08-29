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
| Migration level | **7 of 7**, latest `0007_templates.sql`. Verified with `npm run schema:check` |
| KV | `SESSIONS`, id `9671c77ef65242ebb96b4e7d771cb530`. Holds digest idempotency markers and Asana settings |
| R2 | `command-center-files`. Holds meeting transcripts |
| Cron | `0 0,13,14,23 * * *`, registered and confirmed live via the Cloudflare API |
| Observability | Enabled, `head_sampling_rate = 1`, `invocation_logs: true`. Free plan: 200k events a day, **3 day retention** |
| Plan | Workers Free. No spend control exists on Free; it hard-stops at its limits rather than billing, T6 |

**Secrets set on the Worker**, confirmed by name against the Cloudflare API. Values
were never read and must never be printed:

- `ANTHROPIC_API_KEY`
- `ASANA_TOKEN`
- `RESEND_API_KEY`

**Digest configuration**, plain vars in `wrangler.toml`, not secrets:
`DIGEST_FROM = digest@kabuhayan.app`, `DIGEST_TO = pacardopaul18@gmail.com`,
07:00 and 17:00 Mountain, D43 as amended.

### Stages

| Stage | State |
| --- | --- |
| Stage 1, foundation | **CLOSED** 2026-08-29, re-closed the same day on corrected evidence after a false claim about the login method |
| MVP | **CLOSED** 2026-08-29. Today cockpit, Projects, SOPs, Invoicing, digests |
| v1 | **PENDING**. Built in full; five verifications outstanding with Paul. Gate table written out in `docs/DECISIONS.md` |
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

The mitigation is live: `DIGEST_FROM` moved from the shared `onboarding@resend.dev`
to `digest@kabuhayan.app`, a domain verified in Resend with DKIM and SPF.

Not yet closed, because placement has not been observed. This matters more than
it looks: a digest that lands in spam does not fail loudly, it fails by being
absent from a screen nobody is looking at, which is the exact failure this
product exists to prevent.

Closes when Paul confirms where digests land over several days, not one.

### O3: partner time baseline not captured, OPEN. DRI Paul

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
