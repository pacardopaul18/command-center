# Decision and risk ledger

Append only. Never delete an entry. Mark items RESOLVED inline with the session
and commit hash that closed them. Newest section at the bottom.

The architecture doc and the build plan are the technical source of truth. This
file records what was decided along the way that neither of them says, and why.

## Tasks

| Id | Task | State |
| --- | --- | --- |
| T5 | Cloudflare wiring: login, D1, KV, remote migration | DONE, commit f94faab |
| T-v1-0 | Enable R2, add payment method, restore the `[[r2_buckets]]` binding | SEEDED at the v1 gate, do not start early |

## Decisions

### D15: R2 deferred to the start of v1

Stage 1 through MVP write zero files. R2 first matters at v1, for transcript
storage and generated PDFs. `wrangler r2 bucket create` returns error 10042
because R2 is not enabled on the account, and enabling it requires adding a
payment method. Not now.

The `[[r2_buckets]]` block in [../wrangler.toml](../wrangler.toml) is commented
out rather than left pointing at a bucket that does not exist, because a Pages
deploy carrying a binding to a missing bucket fails. `App.Platform['env'].FILES`
is typed optional to match. Reversing this is three uncommented lines plus one
type change, tracked as T-v1-0.

### D16: D1 primary region APAC, accepted

`command-center-db` (`00922b27-9b84-4097-ba4e-568a8f06c6ee`) auto-selected APAC
at create time, served from HKG. Paul is the only writer and is in the
Philippines, so this is the fastest primary for every interactive use.

The only readers who would feel US latency are the read-only shareable report
links for the partners, which is v2. Revisit only if that surfaces as a real
problem, and solve it with read replication or caching rather than by moving the
primary.

### D17: Hono mounted by a catch-all SvelteKit endpoint, not Pages Functions

With `adapter-cloudflare`, a top level `functions/` directory takes precedence
over the generated `_worker.js` and shadows the SvelteKit app. Keeping the Hono
app inside the route tree at `src/routes/api/[...path]/+server.ts` gives one
build, one deploy artifact, and the same bindings for pages and API.

### D18: Pages project must be created git-connected from the dashboard

`wrangler pages project create` produces a direct-upload project, and a
direct-upload project cannot be converted to git-connected afterwards. Creating
it from the CLI would burn the project name and force a delete and redo. The
project is therefore created through the dashboard Connect to Git flow, which is
the one part of the setup that cannot be scripted.

## Risks

### R6: public pages.dev window, OPEN

From the moment the first Pages deploy succeeds until the Cloudflare Access
application is live on the custom domain, `command-center.pages.dev` is publicly
reachable and unauthenticated.

Mitigation: sample data only. No client names, no real action items, no real
project names. The remote D1 is empty at the time of writing, and the two seed
rows in [../seed/dev-seed.sql](../seed/dev-seed.sql) are deliberately generic.

Closes at dashboard step 4, when Access with One-Time PIN allows
pacardopaul18@gmail.com only. Record the closing commit here when it lands.

## Open questions

### O1: custom domain, DRI Paul

Which case applies: (a) a domain already on Cloudflare in this account, (b) a
domain held elsewhere whose nameservers move to Cloudflare, or (c) no domain,
buy through Cloudflare Registrar.

Blocks dashboard steps 3 and 4 only. Access must sit on the custom domain, not
on `pages.dev`. Steps 1 and 2 are unblocked and run in parallel.

Note on (c): buying through Cloudflare Registrar adds a payment method to the
account, which incidentally unblocks R2 for T-v1-0 at no extra cost.
