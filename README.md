# Command Center

Private, single-user operations command center. Cloudflare Workers with Static Assets, plus Hono, D1, KV and later R2.
Context: [CLAUDE.md](CLAUDE.md), [docs/Command_Center_Build_Plan.md](docs/Command_Center_Build_Plan.md),
[docs/Command_Center_Architecture.md](docs/Command_Center_Architecture.md).

## Status

Stage 1 is CLOSED. The app is live at **work.kabuhayan.app**, behind Cloudflare
Access with One-Time PIN, whitelisting Paul only.

MVP stage in progress. Today cockpit, Action Items, Projects, the SOP library,
Clients and Invoicing with aging are built. The Cron and Resend digests are next.

| Resource | State |
| --- | --- |
| D1 `command-center-db` | created, id wired, migration 0001 applied remote |
| KV `SESSIONS` | created, id wired |
| R2 `command-center-files` | not created, deferred to the v1 gate (T-v1-0) |
| Worker service | live, git-connected Workers Builds |
| Custom domain | work.kabuhayan.app, attached |
| Cloudflare Access | live, One-Time PIN, single Paul-only Allow policy |

## Stack

| Layer | Choice |
| --- | --- |
| Front end | SvelteKit 2 with Svelte 5 runes, `@sveltejs/adapter-cloudflare` targeting Workers |
| API | Hono, mounted at `/api` by one catch-all SvelteKit endpoint |
| Database | D1 (`command-center-db`), binding `DB` |
| Sessions and settings | KV, binding `SESSIONS` |
| Files | R2 (`command-center-files`), binding `FILES`, not enabled yet |

### Why one catch-all endpoint

Hono lives inside the SvelteKit route tree at
[src/routes/api/[...path]/+server.ts](src/routes/api/%5B...path%5D/+server.ts). One build,
one deploy artifact, the same bindings for pages and API. On Workers with Static Assets, a
request matching a built asset is served without invoking the Worker, and everything else,
including every `/api` route, falls through to it.

### Deploy target

Workers with Static Assets, not Pages. See D29 in
[docs/DECISIONS.md](docs/DECISIONS.md). `adapter-cloudflare` chooses its target by reading
`wrangler.toml`: Pages when `pages_build_output_dir` is set, Workers when `main` or
`assets` is set. Never set both.

## Local development

```
npm install
npm run db:migrate:local     # creates the local D1 database under .wrangler/state
                             # re-run this after any change to the wrangler
                             # target shape, see D31
npm run db:seed:local        # optional sample projects, local only
npm run dev                  # http://localhost:5173
```

`vite dev` and `vite preview` emulate the wrangler.toml bindings with miniflare, so the app
talks to a real local SQLite database. No Cloudflare login is needed for local work.

Other scripts: `npm run check` (types), `npm run build` (produces `.svelte-kit/cloudflare`).

## Layout

```
migrations/                     D1 migrations, the only way the schema changes
seed/dev-seed.sql               local sample data, never run against remote
src/lib/types.ts                shared enums and row shapes
src/lib/format.ts               deadline and date display helpers
src/lib/server/dates.ts         Mountain Time date logic for overdue and due today
src/lib/server/api/             Hono app: action-items, projects, validation
src/routes/api/[...path]/       SvelteKit to Hono bridge
src/routes/+page.svelte         Today cockpit
src/routes/actions/             Action Items screen
src/routes/projects/            Projects list and detail
src/routes/sops/                SOP library and version history
src/routes/clients/             Clients registry
src/routes/invoices/            Invoicing, billing periods and aging
src/app.css                     design tokens and base styles
wrangler.toml                   bindings: D1 and KV live, R2 pending
```

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | returns today's Mountain Time date |
| GET | `/api/today` | cockpit bands: overdue, due today, what will slip, plus totals |
| GET | `/api/action-items` | `view=all\|open\|overdue\|today\|waiting\|done`, `q=`, `project_id=` |
| POST | `/api/action-items` | |
| GET | `/api/action-items/:id` | |
| PATCH | `/api/action-items/:id` | partial, only the fields sent are written |
| DELETE | `/api/action-items/:id` | |
| GET | `/api/projects` | with open and overdue action item rollups |
| POST | `/api/projects` | |
| GET | `/api/projects/:id` | project plus its linked action items |
| PATCH | `/api/projects/:id` | partial. Advance phase and set status use this |
| DELETE | `/api/projects/:id` | action items survive unlinked, not deleted |
| GET | `/api/sops` | `status=active\|archived\|all`, `q=`, `category=` |
| POST | `/api/sops` | writes the SOP and version 1 in one batch |
| GET | `/api/sops/:id` | SOP, history without bodies, and one body via `?version=` |
| PATCH | `/api/sops/:id` | metadata and archive only. Never the body |
| POST | `/api/sops/:id/versions` | editing means adding a version |
| POST | `/api/sops/:id/versions/:vid/restore` | carries an old body forward as a new version |

Overdue and due-today are decided against the America/Denver calendar date, not UTC, so an
item does not flip to overdue at 6pm local when UTC rolls over.

## Cloudflare setup

Done:

1. `npx wrangler login`
2. `npx wrangler d1 create command-center-db`
3. `npx wrangler kv namespace create SESSIONS`
4. Real ids wired into [wrangler.toml](wrangler.toml)
5. `npm run db:migrate:remote`

All dashboard work is done:

1. Worker created through Workers Builds, git-connected to this repo.
2. Spend limit closed by inspection. Workers Free exposes no control and
   hard-stops at its daily limits instead of billing.
3. `work.kabuhayan.app` attached as a custom domain.
4. Zero Trust activated, Access self-hosted application with One-Time PIN and a
   single Allow policy naming pacardopaul18@gmail.com.

The workers.dev surfaces are switched off in wrangler.toml rather than gated:
`workers_dev = false` and `preview_urls = false`. Both stay false. Turning
either on puts an unauthenticated copy of the app on the public internet.

Deferred to the v1 gate (T-v1-0): enable R2 in the dashboard, run
`npx wrangler r2 bucket create command-center-files`, then uncomment the
`[[r2_buckets]]` block in wrangler.toml. A payment method already exists on the
account, so there is no billing step attached.

Secrets (`ASANA_TOKEN`, `RESEND_API_KEY`, AI keys) go in via `wrangler pages secret put NAME`
or the Pages project settings. Never in code, never in wrangler.toml.

## Schema

[migrations/0002_sops.sql](migrations/0002_sops.sql) creates `sops` and `sop_versions`,
with triggers enforcing that versions are immutable and undeletable and that the current
version only ever moves forward. See D32 to D34 in [docs/DECISIONS.md](docs/DECISIONS.md).

[migrations/0001_init_action_items.sql](migrations/0001_init_action_items.sql) creates
`users`, `projects` and `action_items` per section E of the architecture doc. `projects.client_id`
and `action_items.meeting_id` are carried as unconstrained columns because Clients and Meetings
do not exist yet; the migrations that create those tables add the foreign keys.
