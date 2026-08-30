# Phase 2 estimates

Written 2026-08-30, before any Phase 2 code. Dual estimates per the standing
rule, plus the dependency sequence PM asked for and the things only Paul can
supply.

Nothing here is built. Everything below waits on a ruling.

---

## The thing that changes the sequence

**Four of the five workstreams need a migration.** That was not obvious from the
brief, and it is the single biggest driver of the order below.

| Workstream | Schema needed |
| --- | --- |
| 1, Asana two-way | sync log, plus Asana state fields on `action_items` |
| 2, Tickets | `tickets`, `ticket_comments`, `ticket_attachments` |
| 3, Client 360 | `contacts` **and** `contracts`, neither of which exists |
| 4, Connections | `connections`, holding OAuth tokens |
| 5, Rate model | rate columns, additive |

Client 360 reads like a UI job and is not. The architecture named `Contacts` in
section E and it was never built, and **contracts do not exist anywhere** in the
schema, the docs, or the code. Half of that workstream is a new entity.

Every migration is a D39 snapshot and a D50 ordering window, so batching is
worth real time. Where two workstreams can share one window, the estimate says
so.

---

## 1. Two-way Asana sync

Pull tasks and status back, reconcile, Asana wins on status, app wins on
metadata, every sync logged.

**Checked, not assumed.** `GET /tasks` supports `modified_since`, which is what
makes incremental polling possible rather than a full-table scan every run; a
task counts as modified when any property or association changes. Filtering
needs either `project`, or `assignee` **and** `workspace` together. Pagination
is `limit` (1 to 100) and an `offset` token. Asana's published rate limits and
webhook requirements were not on the pages fetched and stay unverified.

| | Lean | Full |
| --- | --- | --- |
| | **6 to 8h** | **2.5 to 3 days** |
| Trigger | Rides the existing cron, one extra Mountain hour | Webhooks, with polling as the fallback |
| Scope | Only items the app already pushed, matched by stored gid | Everything assigned to Paul in the workspace, including tasks created in Asana |
| Reconcile | Status only: done in Asana closes the item here | Status, assignee, due date, plus a real merge on metadata |
| Log | A `sync_runs` row per run with counts and errors | Per-field change log, replayable, with a diff view in Settings |
| Deletions | Ignored, gid kept | Detected and surfaced for a decision |

**The conflict rule has a hole worth ruling on before either estimate is real.**
"Asana wins on status, app wins on metadata" says nothing about a task deleted
in Asana, and nothing about an item whose gid no longer resolves. Silently
reopening a closed item, or silently clearing a gid, are both bad. My
recommendation: a deleted or unresolvable task marks the item `ambiguous` with a
note and never changes its status, because that is the state this app already
uses for "a human needs to look at this".

Lean does not need a webhook, a public endpoint, or an Asana app registration.
Full needs all three, and a webhook needs a publicly reachable URL, which
collides with the app being behind Access on every route. That is not a small
detail: it means a full build adds an unauthenticated endpoint, which is the
category R6 was closed on.

**Recommendation: lean.** It closes the loop that matters, which is a task Paul
completes in Asana no longer nagging him here.

---

## 2. Ticket entity, with the rate model batched in

Entity fork confirmed: tickets and action items are two things. Action items stay
the capture layer, tickets are the worked unit under a project.

| | Lean | Full |
| --- | --- | --- |
| | **1.5 to 2 days** | **4 to 5 days** |
| Schema | `tickets` with the named fields, one migration | Plus `ticket_comments`, `ticket_attachments` to R2, `ticket_events` for the audit trail |
| Status | The five project statuses reused | A real machine with allowed transitions enforced in the database, as the SOP triggers do |
| Estimate vs actual | Two numeric fields, variance computed at read | Rolls up to the project, and into a variance report |
| Convert | Action item to ticket, one direction, link kept both ways | Plus splitting one item into several tickets |
| UI | List under a project, plus a detail page | Board view, drag between statuses, filters |

**Batching #5 here is free and I recommend it.** The rate model is additive:
`rate_cents` on `time_entries` and a `default_rate_cents` on `clients`, both
nullable, with computed amounts offered and never imposed. Entered amounts stay
valid forever, which was the ruling. Adding it to the ticket migration costs
about 30 minutes and saves a whole D39 and D50 window later.

One thing to decide, because it is cheaper now than after there is data:
**does a ticket carry time directly, or only through its project?** If tickets
should be billable units, `time_entries` needs a nullable `ticket_id` in this
same migration. Adding it later is another rebuild under D38, which this project
has already paid for twice.

**Recommendation: lean, with #5 batched, plus the `ticket_id` column even if
nothing uses it yet.**

---

## 3. Client 360

| | Lean | Full |
| --- | --- | --- |
| | **1.5 to 2 days** | **3.5 to 4 days** |
| Schema | `contacts` and `contracts`, both new | Plus contract line items and renewal tracking |
| Contacts | Name, email, phone, role, one per client | Deduplicated across clients, primary contact, history |
| Contracts | Title, dates, value, a fulfillment status enum | Deliverables against the contract, percentage fulfilled, alerts on drift |
| Page | One client page pulling contacts, projects, invoices, contracts | Plus meetings, SOPs, tickets, and a money summary with aging for that client alone |
| Reuse | Existing queries, filtered by client | New rollup queries |

**Fulfillment status is the undefined part.** "Contracts with fulfillment
status" needs a definition before it can be built: fulfilled against what.
Deliverables the app does not model, hours against a cap, invoices raised
against a value, or a status somebody sets by hand. The lean estimate assumes
the last, a hand-set enum, because that is honest and takes an hour. Any of the
others is a second entity and belongs in full.

**Recommendation: lean, with fulfillment as a hand-set status until there is a
reason to compute it.**

---

## 4. Connections, built dark

Google OAuth, calendar read, email read. Paul's own account only.

| | Lean | Full |
| --- | --- | --- |
| | **2 to 2.5 days** | **4 to 5 days** |
| Auth | Authorisation code flow, refresh token stored, one account | Multiple accounts, per-account scopes, revocation, re-consent handling |
| Calendar | Read today's events, matched to meetings by time | Two-way, event creation, attendee sync |
| Gmail | Read message metadata and bodies for a thread on demand | Indexed thread history as drafting context, which is Section 6 and stays frozen |
| Storage | Tokens in KV, encrypted at rest by Cloudflare | Envelope encryption with a key in a Worker secret, so a KV read alone is not enough |
| Safety | Draft only, no send scope requested at all | Same, permanently |

**Three findings that change this workstream, all verified rather than assumed.**

**Restricted scopes may require a third-party security assessment.** Google's
production-readiness page states that apps requesting restricted scopes must
submit to "an annual security assessment from a Google empanelled group of
security assessors" when data is accessed "from or through a third-party
server". A Cloudflare Worker is a third-party server. What I could **not**
confirm from Google's own pages is whether `gmail.readonly` is classified
restricted. It is my strong expectation, and it is unverified, and the
difference is weeks of process. **This is checkable in 30 seconds in the Cloud
Console when the OAuth client is created**, and it should be checked before any
Gmail code is written.

**The partner conversation is not the only gate.** Even with the partners'
permission, an app in Testing status serves only listed test users, and Google
caps that list and shortens the refresh token lifetime. Connecting a partner
account therefore needs Google's verification as well as the partners' consent,
and those are different processes on different clocks. Settings copy must say
so, which PM already asked for; the point is that the copy is describing a
technical limit, not only a policy.

**No send scope, ever, is enforceable rather than intentional.** The app never
requests `gmail.send` or `gmail.compose`. A token that was never granted a scope
cannot be made to send by any later bug, which is a stronger guarantee than a
code path that chooses not to.

**Recommendation: lean, and Gmail last.** Calendar read is the smaller risk and
the faster win. Gmail should not start until the scope classification is
confirmed.

---

## Sequence, by dependency

1. **Tickets plus the rate model**, one migration window. Nothing else depends
   on them, and they are the biggest schema change, so they go first while the
   database is simplest.
2. **Asana two-way**, its own small migration. Independent, and it makes the
   push already shipped worth having.
3. **Client 360**, after tickets, so the client page can show tickets rather
   than being rebuilt to add them.
4. **Connections**, in parallel from the start in wall-clock terms, because it
   blocks on Paul provisioning a Google Cloud project and that wait can overlap
   everything above.

---

## What only Paul can provide

Asked once, up front, per CLAUDE.md.

- A **Google Cloud project** with an OAuth client, and the redirect URI
  registered. The client ID is not a secret; the client secret is, and goes in
  by `wrangler secret put`.
- The **scope classification** for `gmail.readonly` as shown in that project's
  consent screen, which settles the biggest unknown in workstream 4.
- A ruling on the **Asana deletion case**, which the conflict rule does not
  cover.
- A ruling on whether **tickets carry time directly**, which decides one column
  in a migration that is cheap now and expensive later.
- A definition of **contract fulfillment**, or agreement that it is hand-set for
  now.

---

## Standing constraints these estimates assume

Suite green per push. Production clean of seed data. Cron surface untouched
without an evidence window, which workstream 1 touches and therefore needs.
Wednesday's rehearsal is reserved and Phase 2 pauses for it. Every migration
takes a D39 snapshot and follows the D50 ordering rule.
