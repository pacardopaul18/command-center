# The Command Center: An Architecture & Build Plan for a Cloudflare-Hosted Operations Workbook

## TL;DR
- **Build a single-user "personal command layer" on Cloudflare that complements Asana rather than replacing it** — a lightweight full-stack app (SvelteKit or Astro on Pages, Hono API on Workers/Pages Functions, D1 for data, R2 for files, KV for sessions, Cron Triggers for digests) organized around a daily "Today" cockpit plus modules for Projects, Action Items, Meetings, SOPs, Invoicing, and Clients/Templates/Reports. Realistic cost is **$0/month** on the free tier for a single user, or **$5/month** if you want the safety and headroom of the Workers Paid plan (which also extends D1 backup restore from 7 to 30 days).
- **For password protection, use Cloudflare Access (Zero Trust) with One-Time PIN email login** gating your custom domain — it's free for up to 50 users, requires no code, and puts auth at Cloudflare's edge before traffic reaches your app. Keep a Worker-based hashed-password + signed-cookie fallback documented only if you outgrow Access.
- **The app's job is to catch what would otherwise slip and to prove it.** Ground every module in a proven ops workflow (meeting-to-action-item capture, weekly billing/reconciliation cadence, email triage, SOP versioning) and instrument a defensible **"partner hours saved"** metric (baseline time-audit × volume handled, net of review time, plus a "slips caught" register) so the partners see their working hours measurably decrease.

## Key Findings

**Cloudflare is genuinely a near-zero-cost home for this app.** The Workers Free plan includes 100,000 requests/day and 10ms CPU per invocation; D1 (SQLite) free tier gives 5 GB storage with 5 million rows read/day and 100,000 rows written/day; R2 gives 10 GB storage with 1M Class A (write) and 10M Class B (read) operations/month and zero egress fees; KV gives 1 GB storage, 100,000 reads/day and 1,000 writes/day; and Cron Triggers are included at no extra cost (3 per Worker on Free, 5 on Paid). A single-user ops app will not come close to these ceilings.

**Cloudflare Access is the pragmatic password wall.** Cloudflare's Zero Trust free plan covers up to 50 users at no cost indefinitely (no credit card; paid Pay-as-you-go is $7/user/month), and its One-Time PIN identity provider emails a login code to approved addresses with no identity provider or SMTP setup required — Cloudflare sends the email itself. This authenticates users at the edge before requests reach the app. Note the "50-user cliff": a "user" is a seat consumed per authentication event, which is a non-issue for a single user. The one wrinkle: on Pages, enabling Access on the `*.pages.dev` domain requires manual steps, and you should protect your **custom domain** with a self-hosted Access application. Cloudflare has also recently made it possible to attach an Access policy directly to a Worker so every hostname is protected in one click.

**MailChannels' free Workers email is gone; use Resend.** Per MailChannels' "End of Life Notice – Cloudflare Workers": "As of August 31, 2024, MailChannels no longer provides a free email-sending service for Cloudflare Workers users." Cloudflare's own docs now point to Resend as the recommended path. Resend's free plan covers 3,000 emails/month **but is capped at 100 emails/day** — the daily cap, not the monthly total, is the binding limit for daily digests, and 100/day is far more than a single user needs.

**The five role areas map cleanly onto proven operations workflows** — the PMI five-phase project lifecycle (initiating, planning, executing, monitoring/controlling, closing), the "Four D's" email triage framework (Do/Delegate/Defer/Delete), a weekly billing cadence with AR aging buckets (0–30/31–60/61–90/90+ days), and structured SOP authoring with version history. AI (Claude/ChatGPT) accelerates the transcription→action-item, drafting, and reporting steps.

**The success metric is measurable.** The strongest anchor is Julian Birkinshaw & Jordan Cohen, "Make Time for the Work That Matters," Harvard Business Review (Sept 2013): "knowledge workers spend a great deal of their time—an average of 41%—on discretionary activities that offer little personal satisfaction and could be handled competently by others," and acting on this can "free up significant time—maybe as much as 20% of your workday." Combine a baseline time-audit — using the method from Michael Porter & Nitin Nohria's "How CEOs Manage Time," HBR (July–Aug 2018), where "each CEO's executive assistant (EA) was trained to code the CEO's time in 15-minute increments, 24 hours a day and seven days a week, and to regularly verify that coding with the CEO" (~60,000 hours across 27 CEOs) — with volume-handled tracking and a "slips caught" log to produce a credible monthly one-pager.

## Details

### A. Efficient Processes & Workflows (one per role area)

**1) Project management out of client meetings (meeting → action items → Asana → done).**
The proven loop is Capture → Structure → Route → Track → Surface:
- **Capture (within hours):** Import the call recording's transcript. Use an AI meeting assistant or feed the raw transcript to Claude/ChatGPT. Research shows workers in frequent-meeting roles save meaningful time when AI handles transcription and summary, and action-item capture improves substantially versus relying on memory after the call. Meetings of 45–90 minutes with a clear agenda produce the most reliable AI summaries; for very long transcripts, split by agenda topic and summarize each section.
- **Structure (owner/context/deadline):** Run a standard extraction prompt that returns each action item with an owner, one-line context, and an explicit deadline. Keep a human in the loop on names, dates, numbers, and ownership — those are the fields that cause downstream problems when wrong.
- **Route:** Push each structured item into Asana (via the Asana API using a Personal Access Token) and assign to the right teammate. In the command center, keep the canonical follow-through record with a link back to the Asana task.
- **Track to completion & flag ambiguity:** Every item has a status; ambiguous items are flagged immediately ("needs clarification") before they stall. The daily cockpit surfaces anything overdue or at-risk.
- **Cadence:** Process each recording the same day; a start-of-day sweep confirms nothing from yesterday's meetings is unrouted.

**2) Recurring administration & operations (email, calendar, invoicing, scheduling, travel, SOPs).**
- **Email triage** using the Four D's (Do/Delegate/Defer/Delete) layered on a lightweight state system (Action / Waiting / Reference / FYI). Process email in two dedicated windows per day rather than continuously; convert anything actionable into a tracked task; keep 4–6 folders, not dozens. Reusable snippets/templates handle scheduling, quick declines, and next-steps replies.
- **Conflict & stall monitoring:** A recurring scan for scheduling conflicts, stalled follow-ups (items in "Waiting" past their expected date), and recurring errands.
- **SOPs for repeating tasks:** Every task done more than twice gets a lightweight SOP (see area 5's authoring workflow).

**3) Internal billing & client payment tracking (own the cycle end-to-end).**
Establish a repeatable **weekly billing cadence**: a simple, defensible policy is *time entries in by close of business Friday, reviewed/approved Monday, invoiced Tuesday*. The weekly review is also the moment to catch missing entries, unclear descriptions, and work drifting outside scope.
- **Reconcile client hours:** Pull hours from Clockify (or similar), compare against what was invoiced, and flag discrepancies.
- **AR aging:** Run an accounts-receivable aging report weekly using standard buckets (current/0–30, 31–60, 61–90, 90+ days). The majority of invoices should sit in 0–30; anything sliding into 60+/90+ is a red flag requiring escalating action. Review weekly so you catch a 30-day balance before it becomes a 60- or 90-day problem.
- **Discrepancy loop:** Flag → investigate → contact → resolve → close the period.

**4) Client-facing written communication (draft in the partner's voice).**
Maintain a Templates library of the partner's voice patterns and past exemplar replies. For lower-complexity requests, draft a response with AI seeded by those exemplars, review, and send — reducing routine requests that reach the partners. For complex items, escalate with a clear, one-line recommendation attached. Track "requests handled without partner involvement" as a proxy for load removed.

**5) Reporting & Microsoft Office support.**
Build simple, repeatable tools for recurring Word/Excel needs. Identify any tracking need done more than twice and templatize it. AI accelerates drafting Excel formulas, cleaning data, and generating first-draft Word documents from structured data.

**SOP creation & maintenance (cross-cutting).**
Use a consistent SOP template: title + document ID, version number, effective date, owner, purpose & scope, roles/responsibilities, numbered steps (one action per step, plain language), and a **version history log**. Best practice is a risk-based review schedule (critical/rapidly-evolving SOPs quarterly; stable ones annually or biennially) plus ad-hoc reviews triggered by process/tool changes. Keep only the current version editable while archived versions remain available read-only for audit trail.

### B. Information Architecture & Module Design

**Site map:**
```
/ (Today cockpit)
/projects            → list + lifecycle board
/projects/:id        → project detail (phases, tasks, status)
/actions             → action-item / follow-through tracker
/meetings            → meetings log
/meetings/:id        → transcript, summary, extracted items
/sops                → SOP / workflow library
/sops/:id            → SOP detail + version history
/invoices            → invoicing & payment tracker (+ aging)
/clients             → clients / contacts registry
/templates           → client-comms drafts + recurring docs
/reports             → reports & exports
/settings            → auth, integrations, preferences
```

**Home / Today cockpit** — the single most important screen. Shows: what needs attention now (overdue + due-today action items), "what will slip" (at-risk items, stalled follow-ups), today's meetings/follow-ups, overdue billing and aging alerts, and quick-add. Primary actions: mark done, snooze/defer, jump to source.

**Projects** — a board or list filterable by the five PMI phases (Initiating → Planning → Executing → Monitoring/Controlling → Closing) with status (on-track/at-risk/blocked/done), client, owner, next milestone. Detail screen shows phase checklist, linked action items, linked meetings, and linked invoices. Actions: advance phase, set status, add milestone.

**Action Items / follow-through tracker** — the heart of "nothing slips." Each row: title, owner, context, deadline, status, source (meeting/email/manual), Asana link. Views: overdue, due-today, waiting-on, by-project. Actions: capture, edit owner/deadline, flag ambiguous, push to Asana, mark done.

**Meetings log** — each entry: date, client, attendees, recording link, AI summary, and the list of extracted action items (with a one-click "create action item" per line). Actions: import transcript, generate summary, extract items.

**SOP / Workflow library** — categorized, searchable list of SOPs. Detail screen renders the current version with a version-history panel. Actions: author (with template scaffold), edit (creates a new version), archive, categorize, set review date.

**Invoicing & Payment tracker** — a billing-period-centric view: for each client/period, hours reconciled, amount invoiced, amount paid, outstanding balance, and aging bucket. A dashboard band shows total outstanding by bucket. Actions: create billing period, reconcile hours, mark invoiced/paid, log discrepancy.

**Clients / Contacts registry** — lightweight: client name, key contacts, billing terms (e.g., net-30), notes, links to that client's projects and invoices.

**Templates** — the partner's-voice reply templates and recurring document templates, tagged by scenario. Actions: create, edit, "use" (copies into a draft, optionally AI-personalized).

**Reports / exports** — see section D.

### C. How It Keeps Him On Top Of Everything

- **One daily cockpit** is the default landing screen; everything at-risk rolls up here so there is a single place to look.
- **Start-of-day digest** (email, ~7:00 MT): today's meetings, due/overdue action items, overdue invoices/aging alerts, and anything flagged ambiguous. **End-of-day digest** (~5:00 MT): what's still open, what slipped, tomorrow's first items.
- **Reminders & nudges:** items approaching deadline surface as "due soon"; items past deadline become "overdue"; "Waiting" items past their expected reply date become "stalled follow-ups."
- **Notification mechanism:** a Cloudflare **Worker Cron Trigger** runs on a schedule (e.g., a single per-minute or twice-daily cron that branches on time), queries D1 for due/overdue/at-risk items, and sends the digest via Resend. Because Cron Triggers are UTC-only, convert Mountain Time to UTC in the schedule and account for DST. Note Cron Triggers do not auto-retry on failure, so keep digests idempotent and, if reliability becomes critical, trigger the Worker's HTTP endpoint from an external scheduler.

### D. Report Generation

**Reports that matter:**
1. **Weekly billing & payment status + aging** — outstanding by client and by bucket (0–30/31–60/61–90/90+), DSO trend, discrepancies open.
2. **Project status roll-up** — each project's phase, status, next milestone, at-risk flags.
3. **Follow-up / action-item completion** — completed vs. open, overdue count, on-time delivery %, average resolution time.
4. **Partner-time-saved** — the success metric (below).
5. **Overdue/at-risk items** — a single "what's slipping" list.

**How they're generated:** each report is a parameterized SQL query against D1, rendered on-screen as a table/summary. For sharing: (a) an on-screen view, (b) a **PDF export** (generate clean printable HTML and use the browser's print-to-PDF, or a lightweight client-side PDF library — this avoids Cloudflare's paid Browser Rendering product), and (c) a **read-only shareable link** implemented as a tokenized, time-limited URL that renders a specific report without requiring login (guard it with an unguessable signed token). Store generated PDFs in R2 if you want persistent shareable artifacts.

**Measuring "partner hours saved" (the success metric):**
The defensible method, drawn from HBR research and delegation-industry practice:
- **Baseline first.** In the first month, time-audit the partners' pre-handoff minutes per task type in 15-minute increments (the method Porter & Nohria used, where an assistant coded CEO time in 15-minute blocks and verified it with the CEO) — this avoids arbitrary targets.
- **Ongoing formula:** `Time saved = (baseline minutes per task × volume handled) − time spent briefing/reviewing you`, with a conservative haircut. Prioritize **recurring** tasks because their savings compound (a daily 20-minute task delegated ≈ three full working days/year).
- **Proportional attribution:** if you handle 80% of a task, claim 80% of its time — don't claim 100%.
- **Pair hours removed with a "slips caught" register:** log every intercepted error, prevented double-booking, and saved deadline, and assign a conservative "rework hours avoided" value. This directly evidences "catching what would otherwise slip."
- **Show where the time went:** because reclaimed time is often reinvested rather than banked, note what higher-value work the partners did instead — this makes the number credible rather than a vanity metric.
- **Dashboard:** four headline tiles (Hours Reclaimed net, Tasks Handled, On-Time Delivery %, Slips Caught), monthly roll-up with a weekly log beneath, and a transparency footer stating all assumptions (per-task baselines, hourly rate) so the partners can stress-test it. Benchmarks from delegation vendors cluster around 10–20 hours/week reclaimed when a principal offloads email, scheduling, admin, and follow-up — a useful sanity-check range, though these are vendor claims rather than peer-reviewed figures.

### E. Data Model (relational, SQLite/D1-style)

```
Users            id, email, display_name, role, created_at
Clients          id, name, billing_terms, status, notes, created_at
Contacts         id, client_id→Clients, name, email, phone, role
Projects         id, client_id→Clients, name, phase(enum: initiating|planning|
                 executing|monitoring|closing), status(enum: on_track|at_risk|
                 blocked|done), owner_id→Users, start_date, target_close, next_milestone,
                 description, created_at, updated_at
Meetings         id, client_id→Clients, project_id→Projects(nullable), title, meeting_date,
                 recording_url, transcript_ref(R2 key), summary, created_at
ActionItems      id, title, context, owner(text or →Users), deadline, status(enum: open|
                 waiting|blocked|done|ambiguous), source(enum: meeting|email|manual),
                 meeting_id→Meetings(nullable), project_id→Projects(nullable),
                 asana_task_gid, created_at, completed_at
SOPs             id, title, category, current_version_id→SOPVersions, owner_id→Users,
                 review_due, status(enum: active|archived), created_at
SOPVersions      id, sop_id→SOPs, version_number, body(markdown), change_note,
                 author_id→Users, created_at
BillingPeriods   id, client_id→Clients, period_start, period_end, status(enum: open|
                 reconciled|invoiced|paid), created_at
TimeEntries      id, client_id→Clients, project_id→Projects, billing_period_id→BillingPeriods,
                 entry_date, hours, description, billable(bool), source(enum: clockify|manual)
Invoices         id, client_id→Clients, billing_period_id→BillingPeriods, invoice_number,
                 issue_date, due_date, amount, amount_paid, status(enum: draft|sent|
                 partial|paid|overdue), aging_bucket(derived)
Templates        id, name, scenario, body, type(enum: email|doc), created_at
Reports          id, type, params(json), generated_at, r2_key(nullable), share_token(nullable),
                 share_expires_at
TimeSavedLog     id, task_type, baseline_minutes, volume, review_minutes, net_hours,
                 week_of, note
SlipsCaught      id, description, category, rework_hours_avoided, caught_date
Settings/Sessions → stored in KV, not D1
```
Key relationships: a Client has many Projects, Contacts, BillingPeriods, and Invoices; a Project has many ActionItems, Meetings, and TimeEntries; a Meeting yields many ActionItems; a BillingPeriod aggregates TimeEntries and produces an Invoice; an SOP has many SOPVersions (version history).

### F. Cloudflare-Only Build Architecture

**Components:**
- **Front end → Cloudflare Pages.** Host the SPA/SSR app. Pages bandwidth is free/unlimited and integrates natively with Workers, D1, R2, KV.
- **Back-end API → Pages Functions or a Workers app (Hono framework).** Hono is purpose-built for the Workers runtime (Fetch API native; Express does not work on Workers because there is no Node.js `fs`/`child_process`). Pages Functions are billed as Workers and share the same free-tier limits.
- **Structured data → D1** (SQLite). All relational entities above.
- **Files/attachments → R2** (SOP doc exports, generated PDFs, transcript files). Zero egress.
- **Settings/sessions → KV** (fast reads; note the 1,000 writes/day free limit, which is ample for a single user's sessions).
- **Scheduled digests/reminders → Workers Cron Triggers** (start-of-day / end-of-day digests, weekly billing sweep).
- **Outbound email → Resend** (free 3,000/month, 100/day) called via `fetch()` from the Worker. MailChannels' free tier is discontinued.
- **AI → call Claude or ChatGPT APIs via `fetch()`** from a Worker for summarization/drafting (external API, billed by the AI provider), or optionally Cloudflare Workers AI (10k inferences/day free on select models) for lighter tasks. Keep API keys as Worker **secrets**.

**Password protection — recommendation and comparison:**

| Option | How it works | Cost | Pros | Cons |
|---|---|---|---|---|
| **Cloudflare Access + One-Time PIN (RECOMMENDED)** | Zero Trust application in front of your custom domain; approved emails get an emailed login code | Free ≤50 users | No code; edge-enforced before app; no SMTP/IdP setup; Cloudflare sends the email | Must configure a self-hosted Access app for the custom domain; `*.pages.dev` protection needs manual steps |
| **Worker-based auth (fallback)** | Hashed password verified in a Worker; issue a signed JWT/session cookie (HttpOnly, Secure, SameSite=Strict); store session in KV | Free | Full control; no dependency on Access | You own all the security-critical code; more to get wrong |

Recommendation: **use Cloudflare Access with One-Time PIN**, whitelisting only Paul's email(s). It's the least code, is enforced at the edge, and is free at this scale. Keep the Worker-auth pattern documented as a fallback. Whichever you choose, gate the **custom domain** (buy/point a domain through Cloudflare) rather than relying on the `pages.dev` subdomain.

**Realistic monthly cost:** **$0** on the free tier for a single user. Optionally **$5/month** for the Workers Paid plan buys headroom (no daily request cap, longer CPU limits, more D1 allowance, and extended D1 backup restore from 7 to 30 days) and peace of mind — worth it if the app becomes daily-critical, but not required.

**Security best practices for a single-user private app:**
- Auth at the edge via Access; if using Worker auth, cookies must be `HttpOnly; Secure; SameSite=Strict` and sessions stored server-side in KV.
- Store all API keys/tokens (Asana PAT, Resend key, AI keys) as Worker **secrets**, never in code or `wrangler.toml` vars.
- Set security headers (HSTS, CSP, X-Content-Type-Options, X-Frame-Options).
- Validate all input server-side.
- **Backups:** D1 **Time Travel** is always on and requires no manual snapshots — but the restore window depends on plan: **7 days on the Workers Free plan, 30 days on Workers Paid** (both at no additional cost). Because the free-tier window is only 7 days, add a scheduled Worker/Workflow that exports D1 to R2 nightly (a documented Cloudflare pattern) so you hold your own copies beyond the built-in window. Use `wrangler d1 export` / Time Travel (`wrangler d1 time-travel restore`) for recovery.
- Set a custom spend limit to prevent runaway bills.

### G. UX / Design Principles

- **One primary cockpit.** The Today screen answers "what needs my attention?" first; everything else is one click away.
- **Progressive disclosure.** Show summaries; reveal detail on demand. Don't put every field on the list view.
- **Minimal navigation.** ~8 top-level destinations, no nested mega-menus.
- **Keyboard-fast entry.** A global quick-add (keyboard shortcut) to capture an action item or note from anywhere; sensible defaults (new action item defaults to today+2 days, status "open").
- **Sensible defaults & low friction.** Pre-fill owner, client, and project from context when creating items from a meeting.
- **Avoid feature bloat.** Every feature must map to a role area; if it doesn't help catch something that would slip or save time, leave it out.
- **Clean, professional visual style.** Neutral palette, generous whitespace, one accent color for status/at-risk, a single readable typeface, clear status chips. Consistency over decoration.

### H. Phased Execution Roadmap

**Tech choice for the front end:** **SvelteKit** on Cloudflare Pages is the recommended default — it aligns closely with Cloudflare's edge model, produces small bundles, has excellent DX, and its SSR/adapter config for Pages is minimal. **Astro** is a strong alternative (Cloudflare-owned as of early 2026, best-integrated with the platform) but its islands model adds friction for an app where nearly every screen is interactive and auth-gated; prefer Astro only if you want mostly static content with interactive islands. Avoid a heavy Next.js setup for a solo build. Pair the front end with **Hono** for the API layer on Workers/Pages Functions.

**MVP (smallest useful version — build first):**
1. Cloudflare project scaffold: Pages + Worker/Hono + D1 + KV, custom domain, Cloudflare Access One-Time PIN.
2. **Today cockpit** (read-only roll-up to start).
3. **Action Items** tracker (capture, owner/context/deadline, status, overdue/at-risk views) — the highest-value module.
4. **Projects** (five-phase lifecycle + status).
5. **SOP library** (author/edit + version history).
6. **Invoicing** (billing periods, hours reconciliation, outstanding + aging).
7. Start-of-day/end-of-day **digest** via Cron + Resend.

**v1 additions:**
- **Meetings log** with transcript import + AI summarization + one-click action-item extraction.
- **Templates** (partner's-voice drafts) + AI-assisted drafting.
- **Clients/Contacts** registry.
- **Reports** with on-screen + PDF export.
- **Asana light linking** (store Asana task GID on action items; one-way push via Asana API PAT).

**v2 additions:**
- **Partner-hours-saved** dashboard (baseline audit, TimeSavedLog, SlipsCaught, transparency footer).
- Read-only shareable report links (tokenized).
- Two-way Asana status sync (poll Asana for completion).
- Nightly D1→R2 export backups.
- Deeper AI (auto-draft digests, auto-summarize the week).

**Recommended build order for a solo AI-assisted builder:** stand up auth + one module end-to-end (Action Items) to prove the full stack (Pages ↔ Worker ↔ D1 ↔ Access), then replicate the pattern module by module. Get the Cron digest working early — it's what makes the app "reach out" to you. Defer anything requiring external polling (two-way Asana sync) to v2.

### Asana integration — recommendation
Keep the app a **standalone personal command layer that complements Asana**, not a replacement. Asana remains the firm's shared PM system of record; your command center is where *you* capture from meetings, decide, and track your own follow-through. Add **optional light linking**: store the Asana task GID on each action item and push new items to Asana one-way via the Asana API (Personal Access Token, `POST /tasks`, base URL `https://app.asana.com/api/1.0`). Defer two-way sync to v2. This avoids fragile bidirectional sync while still giving you one place to see everything.

### AI & transcript import
- **Summarization/drafting:** call Claude or ChatGPT from a Worker via `fetch()`; store prompts as reusable templates. Use a two-stage pattern for summaries (full internal summary first, then audience-specific versions).
- **Transcript import:** paste or upload the transcript (store the file in R2, the text in D1); if you only have a recording, run it through an AI meeting assistant or transcription service first, then import the text. Keep the transcript linked to its Meeting record so extracted action items retain context back to the source.

## Recommendations

**Stage 1 — This week (foundation):** Register a domain on Cloudflare, scaffold Pages + Hono Worker + D1 + KV, and turn on **Cloudflare Access with One-Time PIN** whitelisting your email. Build the **Action Items** module end-to-end to validate the whole stack. *Threshold to proceed:* you can log in via emailed PIN and CRUD action items that persist in D1.

**Stage 2 — Weeks 2–4 (MVP):** Add Today cockpit, Projects (five-phase), SOP library with version history, and Invoicing with aging. Wire the **Cron + Resend** start/end-of-day digests. *Threshold:* you're using it daily and receiving digests.

**Stage 3 — Month 2 (v1):** Add Meetings (transcript import + AI summary + extraction), Templates + AI drafting, Clients, Reports with PDF export, and one-way Asana push. *Threshold:* meeting-to-action-item time drops noticeably.

**Stage 4 — Month 3+ (v2):** Build the partner-hours-saved dashboard (start the baseline time-audit now so you have data), shareable report links, two-way Asana sync, and nightly D1→R2 backups.

**Cost governance:** Stay on the free tier; set a spend limit. Move to Workers Paid ($5/mo) only when the app is daily-critical and you want the headroom or the 30-day D1 restore window — the trigger is either approaching free-tier limits (unlikely for one user) or wanting the reliability guarantees.

**Metric to change the plan:** if the partners' self-reported/audited hours aren't measurably decreasing after ~8 weeks of v1 use, redirect effort from new features toward the two modules that most directly remove partner load (Action Items follow-through and client-comms Templates) before building anything else.

## Caveats

- **Cloudflare free-tier limits and pricing change.** The figures here (Workers 100k req/day & 10ms CPU; D1 5 GB / 5M reads-day / 100k writes-day; R2 10 GB / 1M-10M ops; KV 1 GB / 100k reads-day / 1k writes-day; Access free ≤50 users) reflect current 2026 reporting and Cloudflare docs, but verify against Cloudflare's official pricing/limits pages before building, as some numbers are reported by third-party trackers and Cloudflare periodically adjusts allowances.
- **D1 Time Travel restore is only 7 days on the free plan** (30 days on Paid). This is the single most important reason to add your own nightly D1→R2 export if you stay free — the built-in safety net is shorter than most people assume.
- **KV write limit (1,000/day free)** is the one Cloudflare limit to watch if you use KV for anything beyond sessions/settings; keep high-write data in D1.
- **Resend's free plan is capped at 100 emails/day** (not just 3,000/month) — irrelevant for a single user's digests, but note it before adding any bulk-email feature.
- **Cron Triggers are UTC-only and don't auto-retry.** Convert Mountain Time to UTC, handle DST, keep digests idempotent, and consider an external scheduler if digest reliability becomes mission-critical.
- **Cloudflare Access on Pages has documented rough edges** around `*.pages.dev` vs. custom-domain protection; follow Cloudflare's current "known issues" guidance and protect the custom domain.
- **The "partner hours saved" number is an estimate, not an audited figure.** Hours reclaimed are often reinvested rather than banked; present the metric transparently (stated assumptions, conservative haircut, paired with "slips caught") and treat vendor benchmarks (10–20 hrs/week) as directional, not proof.
- **Asana two-way sync is genuinely harder than one-way push;** don't attempt it until the standalone app is stable, to avoid data-consistency headaches.
- **AI extraction makes mistakes** on names, dates, and ownership — always keep a human review step before routing action items.
