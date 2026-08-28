# Command Center: Build Kickoff Plan

## Read me first
Two documents start this project:
1. **This plan**, which says what we are building, the decisions already locked, and how I want to work.
2. **The Command Center architecture document** (attached), which is the technical source of truth: the modules, the data model, the Cloudflare stack, auth, reports, and the phased roadmap.

When this plan and the architecture doc agree, follow them. Where something is missing or unclear, ask me rather than guessing.

## Who I am (context for you)
- Paul Pacardo. Remote Operations and Project Management Associate, on a Chief of Staff track, for a small US-based fractional consulting firm in consumer packaged goods (CPG).
- I am a solo, AI-assisted builder. I will build this with you, one step at a time.
- I work on US Mountain Time overlap.
- How I communicate: direct and terse. Give me a decisive recommendation, not a menu of options. Push back if I am wrong. Do not use em dashes anywhere, in chat, in code comments, or in UI copy. Do not wind the session down or suggest a stopping point while there is a next thing to build. Keep going until I call the stop.

## What we are building
A private, password-protected personal operations command center. One place where I:
- capture the action items that come out of client calls, structure them with owner, context, and deadline, and track them to completion,
- track projects from initiation to closing,
- write and maintain SOPs and workflows,
- run the weekly billing and payment cycle and watch aging,
- draft lower-complexity client replies in the partner's voice,
- and generate reports that show the partners their time is coming back.

It complements the firm's Asana, which stays their shared system of record. It does not replace it.

## Decisions locked (do not relitigate unless I raise it)
- **Host everything on Cloudflare** to keep cost near zero: Pages (front end), Workers or Pages Functions with Hono (API), D1 (database), R2 (files), KV (sessions and settings), Cron Triggers (scheduled digests), Resend (outbound email).
- **Password protection:** Cloudflare Access with One-Time PIN, on a custom domain, whitelisting my email. A Worker-based hashed-password plus signed-cookie approach is the documented fallback only.
- **Front end:** SvelteKit on Pages. Keep dependencies boring and standard. Astro only if we later decide the app is mostly static, which it is not.
- **Asana:** one-way push in v1 (store the Asana task id on each action item). No two-way sync until v2.
- **Single user (me).** Read-only shareable reports for the founders come later.
- **Cost:** stay on the free tier. Set a spend limit. Move to the 5 dollar Workers Paid plan only when the app is daily-critical or I want the longer database restore window.
- **Visual style:** clean, fresh, calm, low noise (a separate design prompt covers this in full). House tokens: navy #102A4C, gold #C9A84C (accent only), cream #FAF6EC, ink #1B2433, muted #5B6470, green #2E7D5B. Fonts DM Sans and DM Mono.

## The modules (from the architecture doc)
Today cockpit, Projects (five-phase lifecycle), Action Items tracker, Meetings log, SOP library (with version history), Invoicing and payments (with aging), Clients registry, Templates, Reports and exports, Settings.

## How the pieces must talk to each other (data flow)
This is the whole point of the build, so wire the relationships, not just the screens:
- **Meeting** produces **Action Items** (extracted from the transcript), which get routed to Asana and linked to a Project.
- **Project** is the hub: its Action Items, Meetings, Time Entries, and Invoices all roll up to it.
- **Time Entries** group into a **Billing Period**, get reconciled, become an **Invoice**, which feeds **Reports** and the aging view.
- **SOPs** stand alone but can link to a Project or a recurring task.
- Everything at risk anywhere (overdue action items, stalled follow-ups, overdue invoices) rolls up to the **Today** cockpit.
- **Reports** read from all of the above and export to PDF or a read-only link.
Every record should link to its related records so I can move between them in one click.

## Build order (from the roadmap)
1. **Stage 1, foundation.** Scaffold Pages plus a Hono Worker plus D1 plus KV, point a custom domain, turn on Cloudflare Access One-Time PIN, and build the **Action Items** module end to end to prove the whole stack. Done when I can log in by emailed PIN and create, read, and update action items that persist in D1.
2. **MVP.** Today cockpit, Projects (five-phase), SOP library with version history, Invoicing with aging, and the start-of-day and end-of-day digest via Cron plus Resend.
3. **v1.** Meetings (transcript import, AI summary, action-item extraction), Templates with AI drafting, Clients, Reports with PDF export, one-way Asana push.
4. **v2.** Partner-hours-saved dashboard, shareable read-only report links, two-way Asana sync, nightly D1 to R2 backups.

## Deployment and setup
Ship straight from Claude Code to Cloudflare. No manual file uploads. The mechanism is **Wrangler**, Cloudflare's CLI: Claude Code writes the code, then runs Wrangler commands (with my approval) that push to Cloudflare over the API.

**Deploy model: git-connected Pages (use this).** I push to a GitHub repo, and Cloudflare Pages auto-builds and deploys on every push. This gives a real history of what shipped, preview URLs for testing before production, and one-click rollback. Direct `wrangler deploy` is fine for quick tests, but git-connected is the default for anything that stays.

### One-time setup (walk me through each, in order)
1. **Wrangler and login.** Add Wrangler to the project and authorize my Cloudflare account:
   ```
   npm i -D wrangler
   npx wrangler login
   ```
2. **Create the resources** and wire the returned ids into `wrangler.toml`:
   ```
   npx wrangler d1 create command-center-db
   npx wrangler kv namespace create SESSIONS
   npx wrangler r2 bucket create command-center-files
   ```
3. **Database schema via migrations** (never hand-edit the live DB):
   ```
   npx wrangler d1 migrations create command-center-db init
   npx wrangler d1 migrations apply command-center-db --remote
   ```
4. **Connect the GitHub repo to Cloudflare Pages** in the dashboard (Workers and Pages, then Create, then connect the repo). One time, a few clicks. After this, pushing to the repo deploys automatically.
5. **Secrets** (never in code or `wrangler.toml`). For a Worker use `npx wrangler secret put NAME`; for Pages set them in the Pages project settings or `npx wrangler pages secret put NAME`. Set: `ASANA_TOKEN`, `RESEND_API_KEY`, and the AI key if used.

### Dashboard-only items (not shipped from code, call these out to me clearly)
- **The password gate (Cloudflare Access).** In Zero Trust, then Access, then Applications: create a self-hosted application on the custom domain, identity provider One-Time PIN, with a policy that allows only my email. This is clicks in the dashboard, not code, and it must sit on the custom domain, not the `pages.dev` subdomain.
- **Custom domain and DNS.** Add the domain to Cloudflare and attach it to the Pages project as a custom domain.
- **Spend limit.** Set one so nothing can run away.

### The ongoing loop after setup
Claude Code writes it, commits, and pushes. Cloudflare builds and deploys. I refresh the browser. When the schema changes, Claude Code adds a migration and runs `wrangler d1 migrations apply`. That is the whole cycle.

### What only I can provide (ask me for these up front, all at once)
- Cloudflare account access, and the `wrangler login` authorization in my browser.
- A domain (I will buy or point one through Cloudflare).
- GitHub account and repo access.
- The email address to whitelist for the One-Time PIN.
- An Asana Personal Access Token.
- A Resend API key (free account).
- An AI provider API key, if we turn on summarization or drafting.

## How to work with me
- Start by confirming the stack and scaffolding Stage 1. Build one module end to end before spreading wide.
- When you need something only I can provide (a domain name, Cloudflare account details, API tokens for Asana or Resend, my email for the PIN whitelist), ask me for exactly that and keep moving on everything else.
- Keep every secret as a Worker secret, never in code or config.
- Write clean, plain UI copy. No em dashes.
- Show me working software early and often. I would rather see the Action Items module live than read a longer plan.

## What success looks like
I run my whole week from this, and nothing slips. Within a couple of months, the partners' hours are measurably down, with a report that proves it.
