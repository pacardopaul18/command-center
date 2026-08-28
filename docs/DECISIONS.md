# Decision and risk ledger

Append only. Never delete an entry. Mark items RESOLVED inline with the session
and commit hash that closed them. Newest section at the bottom.

The architecture doc and the build plan are the technical source of truth. This
file records what was decided along the way that neither of them says, and why.

## Tasks

| Id | Task | State |
| --- | --- | --- |
| T5 | Cloudflare wiring: login, D1, KV, remote migration | DONE, commit f94faab |
| T6 | Dashboard step 2, spend limit | CLOSED BY INSPECTION. Workers Free exposes no spend control; the plan hard-stops at its daily limits instead of billing, so there is nothing to cap |
| T-v1-0 | Enable R2 in the dashboard, restore the `[[r2_buckets]]` binding, flip `FILES` back to required | SEEDED at the v1 gate. Reduced: a payment method already exists on the account, so this is dashboard clicks plus one binding, no billing step |
| T7 | Dashboard step 1, git-connected build project | DONE. Created via Workers Builds, not Pages. First deploy failed on a Pages-shaped config; fixed in 8bfc68b. Version f6d05619 deployed 2026-08-28T21:18Z with DB, SESSIONS and ASSETS all resolving |
| T8 | Dashboard steps 3 and 4, custom domain then Access | DONE. work.kabuhayan.app is attached and behind Access with a single Paul-only Allow policy, verified from incognito |
| T9 | Close the workers.dev surface | DONE. `workers_dev = false` and `preview_urls = false` |

## Decisions

### D15: R2 deferred to the start of v1

Stage 1 through MVP write zero files. R2 first matters at v1, for transcript
storage and generated PDFs. `wrangler r2 bucket create` returns error 10042
because R2 is not enabled on the account. Not now.

AMENDED. The original entry said enabling R2 requires adding a payment method.
A payment method already exists on the account, so T-v1-0 is dashboard clicks
plus restoring the binding. No billing decision is attached to it any more,
which removes the only reason this was more than a chore.

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

SUPERSEDED BY D29. The project is a Worker, not a Pages project, so this entry
no longer governs. Kept because the reasoning still holds for anyone who
reintroduces Pages: `wrangler pages project create` produces a direct-upload
project, a direct-upload project cannot be converted to git-connected
afterwards, and creating it from the CLI would burn the project name.

### D19: the Claude Design export is a visual reference spec, never merged as code

Renumber note. This decision was originally issued PM side as D17. This ledger
had already assigned D17 to the Hono catch-all endpoint decision above, and this
file owns the numbering, so the design decision is D19. There is exactly one D17
and it is the Hono one. Any PM side reference to "D17, design export" means D19.

The export in [design/](design/) is a reference specification. Its files are
never merged into the app as code. It is React JSX, the app is Svelte, so the
patterns get ported into Svelte components rather than copied.

It is a starting point, not a contract. The design improves as the build goes.
Where the export and a real usability need disagree, the need wins, and the
change gets recorded rather than silently absorbed.

### D20: overdue gets a dedicated red token, gold keeps at risk and due soon

The export ships no red at all and paints overdue gold, the same hue as at risk,
separated only by shade. For an app whose whole purpose is that nothing slips,
that is too weak a signal on the most important state.

One red is added, used for overdue only. Verified in every role it takes:

| Role | Pair | Ratio | Need |
| --- | --- | --- | --- |
| Text on card | `#B3261E` on `#FFFFFF` | 6.54 | 4.5 |
| Text on page | `#B3261E` on `#FDFCF8` | 6.37 | 4.5 |
| Text on cream | `#B3261E` on `#FAF6EC` | 6.06 | 4.5 |
| Chip | `#B3261E` on `#FBEBE9` | 5.65 | 4.5 |
| Border or left rule | `#B3261E` on `#FFFFFF` | 6.54 | 3.0 |

No adjustment was needed. Gold remains the only accent for at risk and due soon,
so the palette still reads as one accent plus one alarm, not a rainbow.

### D21: four accessibility fixes applied against the export

The export fails WCAG 2.1 AA in four places. All four are corrected in the app.
Ratios were computed, not estimated.

| Item | Export | Ratio | Fixed to | Ratio |
| --- | --- | --- | --- | --- |
| Chip done foreground | `#2E7D5B` on `#E3F0EA` | 4.27 | `#245F47` | 6.39 |
| Chip at risk foreground | `#8A6D1E` on `#F6EED8` | 4.23 | `#7A5F19` | 5.21 |
| Input border | `#D9D5C9` on white | 1.47 | `#949484` | 3.08 |
| Focus indicator | soft ring flattens to `#DDE1E5` | 1.31 | solid navy outline | 14.41 |

Chips are 11px mono, so the 4.5 threshold applies rather than the large-text 3.0.
The input border and the focus ring are the serious two: the export carried the
whole input boundary on a 1.47 border, and gave keyboard users a 1.31 focus cue.

### D22: mobile first responsive layer, and a 44x44 tap target floor

The export contains no `@media` query in any of its 76 files. It is desktop
first, with a fixed 224px sidebar and a 1200px content cap. Paul tests at 412px
on a Samsung A35, so the entire responsive layer is ours to specify.

Every multi column block declares its single column fallback first and widens
from there. Tap targets are 44x44 minimum everywhere, which the export violates:
its medium button is about 32px tall, and `IconButton` defaults to 32 and is
called at 26 inside ActionItemsScreen.

AMENDED, session of the Action Items restyle, commit 8015ce8. This entry
originally specified a single breakpoint at 720px. Building the restyle showed
that one number cannot serve both cases, so there are two:

| Breakpoint | What changes |
| --- | --- |
| 720px | Content blocks. Form grids go from one column to two. |
| 960px | Shell and tables. The top bar becomes the 224px sidebar, and the card list becomes the table. |

They are separate because they answer different questions. A two column form
works from 720px, but a seven column table and a fixed 224px rail do not: at
720px the rail would leave 496px of content, and at 412px it would leave 188px,
which is unusable. Adding no further breakpoints without amending this entry
again.

State of the code: both breakpoints are exercised, and the split matches this
entry. Verified against the compiled CSS rather than the source, so what ships
is what is described here.

| Breakpoint | Compiled selectors |
| --- | --- |
| 720px | `.grid`, `.span-all`, `.filters` |
| 960px | `.list`, `.table-wrap`, `table`, `th`, `td`, and the table cell rules, plus `AppShell` in its own file |

The earlier note in this entry, that only 960px was exercised, is superseded.
The form grid moved to 720px in the commit that added this table.

### D23: 14px type scale adopted, inputs render 16px on touch

The export's 14px base is adopted over the 16px the app shipped in Stage 1, along
with the rest of its scale.

One exception. Any input, select or textarea renders at 16px on touch pointers,
because iOS Safari auto zooms the viewport on focus of any field below 16px and
never zooms back out. The rule is scoped with a coarse pointer media query so
desktop keeps 14px.

### D24: brand-voice.html wins over screen copy

The export contradicts itself. Its `guidelines/brand-voice.html` says second
person is avoided, and seven of the eleven screens use "your" or "you". The two
also disagree on the flagship empty state.

The guideline wins. Second person is stripped during each port. The Action Items
empty state follows the guideline wording, not the screen wording.

The guideline's other rules already hold and stay: no em dashes, no emoji, no
exclamation points, sentence case everywhere, DM Mono for numbers, dates and
codes, and the fixed status vocabulary.

### D25: no auth UI is ever built

`ui_kits/command-center/LoginScreen.jsx` is never ported and no login route is
ever added.

Cloudflare Access with One-Time PIN is enforced at the edge, before a request
reaches Pages. By the time any app code runs the user is already authenticated,
so a login screen would be unreachable, and a hand rolled one would be a second
auth path to get wrong. The Worker based hashed password fallback in the
architecture doc stays documented and unbuilt.

### D26: the design export lives at docs/design/

Moved from `design/Command Center Design System/`, which had spaces in the path,
to [design/](design/). All 76 files were diffed against the source and confirmed
identical before the original was removed. It is committed to the repo so the
reference travels with the code, and it stays reference only per D19.

### D27: UI copy never references an affordance that does not exist

No string may name a button, shortcut, screen or capability that is not built
and reachable at the time the string ships. This holds even when a design
guideline prescribes the exact wording.

The case that produced it: `guidelines/brand-voice.html` prescribes the Action
Items empty state as "No action items yet. Add one with quick add, or press N."
Neither quick add nor the N shortcut exists, so that string would have promised
two affordances that are not there. The empty state follows the guideline's rule
instead, and reads "No action items yet. Add the first one above."

A guideline string blocked this way is adopted verbatim the moment its feature
ships. Quick add and the N shortcut are the outstanding case; when the quick add
component lands, the empty state changes to the guideline's exact wording.

This is a claim discipline rule, the same family as never stating a proposed
regulation as enacted. UI copy is a claim about what the software does.

### D28: one sanctioned divergence between display and record

An action item stored as `open` whose deadline has passed renders the overdue
chip, not the open chip. The stored status stays `open` in D1, and the edit
panel shows the real stored value.

This is deliberate. Overdue is derived from the deadline against the Mountain
Time date, and it is the single state the whole product exists to surface. A row
that reads "Open" while being eight days late would be the app failing at its
one job.

This is the only place display and record are allowed to disagree. Any future
divergence needs its own decision entry before it is built. The rule is not
"derived display is fine", it is "this one is, and it was argued for".

### D29: Workers with Static Assets, not Pages

The project was created through the Workers Builds flow rather than classic
Pages, so it exists as a Worker service at `workers/services/view/command-center`.
Its first build compiled cleanly and then failed at deploy with "Missing
entry-point to Worker script or to assets directory", because `wrangler.toml`
was written for Pages: it had `pages_build_output_dir` and neither `main` nor
`assets`.

The decision is to keep it as a Worker and fix the repo, not to delete it and
recreate it as Pages. Workers with Static Assets is the platform's current
direction, it is what `wrangler deploy` expects, and bindings come from
`wrangler.toml` rather than from dashboard state, which suits a git-driven
project better.

What the config change is:

| Key | Before, Pages | After, Workers |
| --- | --- | --- |
| `pages_build_output_dir` | `.svelte-kit/cloudflare` | removed |
| `main` | absent | `.svelte-kit/cloudflare/_worker.js` |
| `[assets] directory` | absent | `.svelte-kit/cloudflare` |
| `[assets] binding` | absent | `ASSETS` |

`@sveltejs/adapter-cloudflare` needs no code change. It picks its target by
reading this file: Pages when `pages_build_output_dir` is set or `CF_PAGES` is
in the environment, Workers when `main` or `assets` is set. The two must never
both be set. Confirmed by reading the adapter at
`node_modules/@sveltejs/adapter-cloudflare/index.js`, not by assumption.

The output shape changes accordingly, and was verified after a rebuild:
`_worker.js` is a single file rather than a directory, `.assetsignore` is
written so the Worker script is never served as a public asset, and
`_routes.json` and the `404.html` fallback are gone because both are Pages-only.
Unmatched requests now fall through to the Worker and render the SvelteKit
error page, which is better than a static 404.

`wrangler deploy --dry-run` passes and reports the bindings resolving from the
file: `env.DB`, `env.SESSIONS`, `env.ASSETS`, with 46 assets read.

### D30: Node 24 on the build runner is accepted, and nothing is pinned

Workers Builds ran the build on nodejs 24.18.0 while local development is on
22.21.0. The build was green either way.

Ruled out rather than assumed: every one of the 55 installed packages that
declares `engines.node` declares an open ended range or one that explicitly
includes 24. None caps below it. With `engine-strict=true` in `.npmrc` a cap
would have failed the install, and there is no cap.

No version is pinned. The root `package.json` declares no `engines`, and no
`.node-version` file is added. Adding one would assert a mechanism that has not
been verified in the Workers Builds flow, and an unverified pin is worse than
none. If a future runner default does break the build, `.node-version` is the
lever to reach for, and this entry gets amended with the evidence.

### D31: switching the wrangler target orphans the local D1 database

Changing `wrangler.toml` from the Pages shape to the Workers shape changed the
key miniflare uses to store the local D1 database. A second, empty SQLite file
appeared under `.wrangler/state/v3/d1/` and the dev server bound to it, so every
API call returned "no such table: action_items" while the old file still held
the schema and its rows.

The important part is that the CLI and the dev server stayed consistent with
each other. After the switch, `wrangler d1 migrations apply --local` and
`vite dev` both target the new file, so there is no split brain. The recovery is
just to re-run the local migration and the local seed.

Remote D1 is unaffected. It is addressed by `database_id` through the API and
never touched by this.

The rule that follows: any change to the wrangler target shape is followed by
`npm run db:migrate:local`, and local data is treated as disposable. Anything
that matters lives in a migration or in the seed file, never only in
`.wrangler/state`, which is gitignored precisely because it is scratch.

## Risks

### R6: public unauthenticated window. CLOSED 2026-08-29

From the first successful deploy until Cloudflare Access went live, the app was
publicly reachable and unauthenticated. Mitigation while it was open: sample
data only. Remote D1 held zero rows for the whole window, and the seed rows are
deliberately generic.

The entry was amended twice while open, and both amendments mattered.

First amendment. The original text said the risk closes when Access is live on
the custom domain. That was wrong. An Access application protects only the
hostnames it names, so the platform hostname would have stayed public while the
app looked gated.

Second amendment, after D29. The platform hostname is not
`command-center.pages.dev`. The project is a Worker, so it is
`command-center.<subdomain>.workers.dev`, plus a per version
`<version>-command-center.<subdomain>.workers.dev`.

Closed by two independent measures, not one:

| Surface | How it is closed |
| --- | --- |
| `work.kabuhayan.app` | Cloudflare Access self-hosted application, One-Time PIN, a single Allow policy naming pacardopaul18@gmail.com |
| `command-center.<subdomain>.workers.dev` | `workers_dev = false` |
| `<version>-command-center.<subdomain>.workers.dev` | `preview_urls = false` |

Both flags are set explicitly rather than left to their defaults, because these
are the settings that decide whether an unauthenticated copy of the app is on
the public internet, and a default is not a decision.

Evidence, all verified rather than assumed. Deployed version
`4d8e76c4-55bc-45ef-8107-4bcab7d308bb`.

Access half, verified by Paul: an incognito request to `work.kabuhayan.app`
returned the Access login wall, a One-Time PIN arrived at
pacardopaul18@gmail.com, the PIN was accepted, and the session landed on Action
items with existing data intact.

Access half, verified again by request: an unauthenticated GET to
`https://work.kabuhayan.app/` redirects to
`green-art-143b.cloudflareaccess.com/cdn-cgi/access/login/work.kabuhayan.app`
with `auth_status: NONE` in the meta token. Nothing from the app is served
before authentication.

workers.dev half, verified by request against the real hostnames. The account
subdomain is `pacardopaul18`, read from
`GET /accounts/{id}/workers/subdomain`, because wrangler exposes no command for
it and guessing would have proved nothing.

| Hostname | Result |
| --- | --- |
| `command-center.pacardopaul18.workers.dev/` | HTTP 404 |
| `command-center.pacardopaul18.workers.dev/api/health` | Cloudflare error 1042, no app response |
| `4d8e76c4-command-center.pacardopaul18.workers.dev/` | HTTP 404 |

One caveat worth stating plainly. All three hostnames still resolve in DNS,
because `*.workers.dev` is a wildcard. They return 404 because no Worker is
bound to the route, not because the name is gone. Flipping `workers_dev` or
`preview_urls` back to true would bring them live again immediately. That is
exactly why the standing rule is in CLAUDE.md rather than only here.

Standing rule, now in CLAUDE.md: `workers_dev` and `preview_urls` stay false.
Turning either on reopens this risk.

## Open questions

### O1: custom domain, DRI Paul. RESOLVED

Resolved as case (a). The app lives at **work.kabuhayan.app**. `kabuhayan.app`
is already active in this Cloudflare account, so the DNS record is created
automatically when the hostname is attached to the Pages project.

Corroborated by `wrangler pages project list`: the existing `kabuhayan-me`
project already serves `me.kabuhayan.app`, which confirms both that the zone is
in this account and that subdomain attachment is the working pattern here.

The apex may serve a public site. That is unaffected. A subdomain behind Access
is gated independently of anything else on the zone.

### O2: Zero Trust is not activated on the account, DRI Paul

The dashboard still shows the "Set up Zero Trust" button, so no Zero Trust
organisation exists yet. Access applications cannot be created until one does.

This is a prerequisite inside dashboard step 4, tracked as step 4.0. Free plan,
up to 50 users, no card required. It needs a team name, which becomes the
permanent `<team-name>.cloudflareaccess.com` login domain.

## Stage gates

### Stage 1: CLOSED 2026-08-29

The threshold from the build plan was: Paul can log in by emailed PIN and create,
read and update action items that persist in D1. That is met.

| Requirement | Evidence |
| --- | --- |
| Scaffold, Hono API, D1, KV | Worker version f6d05619 deployed with `env.DB`, `env.SESSIONS`, `env.ASSETS` all resolving from wrangler.toml |
| Custom domain | work.kabuhayan.app attached and serving |
| Access OTP | Incognito hits the Access wall, PIN delivered to pacardopaul18@gmail.com, accepted, session lands on the app |
| Action Items end to end | Create, read, edit, mark done, reopen and delete, all persisting. Exercised by hand in the browser as well as by API |
| Schema through migrations only | `0001_init_action_items.sql`, applied local and remote. No hand editing of any live database at any point |

Two things carried out of Stage 1 that were not in its scope. The design system
was ported (D19 to D28), which was pulled forward because restyling later would
have meant redoing the module. And the deploy target moved from Pages to Workers
(D29), which was forced by how the project got created.

Two things deliberately left undone. R2 is deferred to the v1 gate (D15,
T-v1-0). No auth UI exists and none will (D25).

Next is the MVP stage: Today cockpit, Projects with the five PMI phases, SOP
library with version history, Invoicing with aging, and the start-of-day and
end-of-day digests via Cron and Resend.
