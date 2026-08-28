# Command Center

Private, single-user operations command center. Cloudflare Pages + Hono + D1 + KV + R2.
Context: [CLAUDE.md](CLAUDE.md), [docs/Command_Center_Build_Plan.md](docs/Command_Center_Build_Plan.md),
[docs/Command_Center_Architecture.md](docs/Command_Center_Architecture.md).

## Status

Stage 1. Action Items module runs end to end against local D1, and the schema is
applied to remote D1. Nothing has been deployed. No Pages project exists yet.

| Resource | State |
| --- | --- |
| D1 `command-center-db` | created, id wired, migration 0001 applied remote |
| KV `SESSIONS` | created, id wired |
| R2 `command-center-files` | not created. R2 is not enabled on the account |
| Pages project | not created |
| Custom domain | not attached |
| Cloudflare Access | not configured |

## Stack

| Layer | Choice |
| --- | --- |
| Front end | SvelteKit 2 with Svelte 5 runes, `@sveltejs/adapter-cloudflare` |
| API | Hono, mounted at `/api` by one catch-all SvelteKit endpoint |
| Database | D1 (`command-center-db`), binding `DB` |
| Sessions and settings | KV, binding `SESSIONS` |
| Files | R2 (`command-center-files`), binding `FILES`, not enabled yet |

### Why one catch-all endpoint instead of a `/functions` directory

With `adapter-cloudflare`, a top level `functions/` directory takes precedence over the
generated `_worker.js` and would shadow the SvelteKit app. Keeping Hono inside the route
tree at [src/routes/api/[...path]/+server.ts](src/routes/api/%5B...path%5D/+server.ts) gives
one build, one deploy artifact, and the same bindings for pages and API. That is the clean
option for git-connected Pages.

## Local development

```
npm install
npm run db:migrate:local     # creates the local D1 database under .wrangler/state
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
src/routes/actions/             Action Items screen
src/app.css                     design tokens and base styles
wrangler.toml                   bindings: D1 and KV live, R2 pending
```

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | returns today's Mountain Time date |
| GET | `/api/action-items` | `view=all\|open\|overdue\|today\|waiting\|done`, `q=`, `project_id=` |
| POST | `/api/action-items` | |
| GET | `/api/action-items/:id` | |
| PATCH | `/api/action-items/:id` | partial, only the fields sent are written |
| DELETE | `/api/action-items/:id` | |
| GET | `/api/projects` | with open action item counts |
| POST | `/api/projects` | |

Overdue and due-today are decided against the America/Denver calendar date, not UTC, so an
item does not flip to overdue at 6pm local when UTC rolls over.

## Cloudflare setup

Done:

1. `npx wrangler login`
2. `npx wrangler d1 create command-center-db`
3. `npx wrangler kv namespace create SESSIONS`
4. Real ids wired into [wrangler.toml](wrangler.toml)
5. `npm run db:migrate:remote`

Still to do, all dashboard work, in this order:

1. Create a Pages project connected to this repo. Build command `npm run build`,
   output directory `.svelte-kit/cloudflare`, and add the D1 and KV bindings to
   both Production and Preview.
2. Set the account spend limit.
3. Attach the custom domain to the Pages project.
4. Create the Cloudflare Access self-hosted application on that custom domain,
   identity provider One-Time PIN, policy allowing pacardopaul18@gmail.com only.

Optional, whenever files are needed: enable R2 in the dashboard, run
`npx wrangler r2 bucket create command-center-files`, then uncomment the
`[[r2_buckets]]` block in wrangler.toml.

Secrets (`ASANA_TOKEN`, `RESEND_API_KEY`, AI keys) go in via `wrangler pages secret put NAME`
or the Pages project settings. Never in code, never in wrangler.toml.

## Schema

[migrations/0001_init_action_items.sql](migrations/0001_init_action_items.sql) creates
`users`, `projects` and `action_items` per section E of the architecture doc. `projects.client_id`
and `action_items.meeting_id` are carried as unconstrained columns because Clients and Meetings
do not exist yet; the migrations that create those tables add the foreign keys.
