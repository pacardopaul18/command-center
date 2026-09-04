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
| T-v1-0 | Enable R2, restore the binding, flip `FILES` to required | DONE 2026-08-29. Bucket created, binding live, verified by a transcript round trip |
| T7 | Dashboard step 1, git-connected build project | DONE. Created via Workers Builds, not Pages. First deploy failed on a Pages-shaped config; fixed in 8bfc68b. Version f6d05619 deployed 2026-08-28T21:18Z with DB, SESSIONS and ASSETS all resolving |
| T8 | Dashboard steps 3 and 4, custom domain then Access | DONE. work.kabuhayan.app is attached and behind Access with a single Paul-only Allow policy, verified from incognito |
| T9 | Close the workers.dev surface | DONE. `workers_dev = false` and `preview_urls = false` |
| T-mvp | MVP stage gate | CLOSED 2026-08-29. Build criteria evidenced; the daily-use half of the threshold is Paul's to confirm over time |
| T-clients-0 | Rebuild `projects` with a real `client_id` foreign key | DONE, migration 0003. Verified: rows survive byte-for-byte, action item links survive, a bogus client_id is rejected on INSERT and UPDATE |
| T-meetings-0 | Rebuild `action_items` with a real `meeting_id` foreign key | DONE 2026-08-29, migration 0005 under the full D38 standard. Verified local and remote: rows byte-for-byte identical, all links preserved, bogus meeting_id rejected |
| T-inc-1 | Live 500 on /templates: migration 0007 never applied to remote | DONE 2026-08-29. Diagnosis confirmed before any change, snapshot taken, 0007 applied, remote at 7 of 7. Root cause and the ordering rule are D50 |
| T-v1-reports | Reports with PDF export via a print route | DONE 2026-08-29. Four of the five in section D, live queries, no migration. Screen and print verified to show identical figures. Partner time saved deferred, D52 |
| T-v1-asana | One-way Asana push per D4 | BUILT 2026-08-29, unverified against a real token. All failure paths tested, including a live 401 from Asana. Awaiting `wrangler secret put ASANA_TOKEN` and one real push |
| T-digest-1 | Digest incident: no scheduled digest had ever sent | **CLOSED 2026-08-29.** The 13:00Z firing ran and sent. Dashboard log read by Paul: `morning digest due, sending` at 13:00:00.532Z and `morning digest sent` at 13:00:02.763Z, subject matching the delivered email verbatim. The 14:00Z no-op guard captured working in the same read. D56 |
| T-debt-1 | Three unblocked design debts: meetings cockpit card, invoice alert card, client column on Projects | DONE 2026-08-29. All three read real data only. The design's mocked meeting times and "agenda drafted" state are not in the schema and were not rendered, D27. Cockpit invoice alerts cross-checked identical to the Invoicing screen's overdue set |
| T-backup-1 | Nightly D1 to R2 backups, pulled forward from v2 | BUILT 2026-08-29, D58 and D59. Dump proven to restore into an empty database with identical rows, links, indexes and triggers. Module and routes pushed; cron wiring committed and HELD pending the 13:00Z evidence |
| T-asana-first | First production Asana push: create a real action item, push it, click the returned link | OPEN, DRI Paul, now. Closes v1 gate row c and settles the `permalink_url` question left open in D55. The push has zero production executions, so this is a first run rather than a re-verification |
| T-reports-preview | One report print preview, judged as a document rather than as a screen | OPEN, DRI Paul, now. Closes the second half of v1 gate row e |
| T-log-read | Read the 13:00Z invocation record from the Cloudflare dashboard | OPEN, DRI Paul, tonight. Workers and Pages, command-center, Logs. 3 day retention, so it expires 2026-09-01. D61 |
| T-obs-token | Scoped Cloudflare API token: Workers Observability Read, plus Workers Builds read | OPEN, DRI Paul. D61, widened by D64. Builds read added because the branch-build question hit the same 403 and had to be deferred. Delivered by `wrangler secret put`, never in chat |
| T-asana-fix | Push sets an assignee and warns when no project is chosen | DONE 2026-08-29. Defect D-asana-1: the first production push created a task with no assignee, invisible in My Tasks. Assignee now defaults to the token owner and cannot be blank |
| T-asana-repush | Re-push one action item after the assignee fix | DONE 2026-08-29. Task visible in My Tasks, assignee Paul Pacardo, due Monday, gid `1217968531303699`. Row c closed. The permalink question was then answered separately on 2026-08-30 by a production push of `First Week Checklist`, gid `1217972687132070` |
| T-volume-seed | Local volume seed and rendered screenshots at load | DONE 2026-08-29, D62. 44 action items, 23 invoices across all bands, 14 projects. Remote verified clean of every seeded row |
| T-density | Sticky sidebar and the spacing pass, judged against the volume renders | DONE 2026-08-29, D63. Sidebar fills and sticks, headings group with their tables, rows banded |
| T-hold-branch | Park held cron wiring on `hold/cron-wiring`, local main tracks origin main | DONE 2026-08-29, D64. Branch created and verified to carry the six-hour cron; main verified unchanged and equal to origin. Branch stays local until the freeze lifts, because a branch build of unknown configuration could deploy it |
| T-silent-writes | Route every client write through `apiWrite` | PARTIAL 2026-08-29, D66. Quick add and the action items screen converted and verified against an intercepted 200 HTML response. Ratified as post-gate work: the remaining 24 sites get the same treatment, each verified by intercepting a response rather than by reading the code. Carries an open question, below |
| T-dup-cleanup | Four duplicate action items on production from the retry loop | DONE 2026-08-29 on PM go. Snapshot taken first and all five ids confirmed recoverable from it before any delete. Four rows written, count 8 to 4, keeper `944e4e5a` intact with the three originals |
| T-backup-prod | Prove the backup write path against production before the first firing | DONE 2026-08-30, D58. Wrote 28,661 bytes to production R2 from real D1, pulled it back and restored it clean. 09:00Z now tests only the scheduled trigger |
| T-ws1-tickets | Phase 2 workstream 1: tickets entity and the additive rate model | DONE 2026-08-30, D71 and D72. Migration 0008 applied local then remote, 8 of 8, snapshot `snapshot-2026-08-30-pre-0008.sql` taken first. All twelve constraints probed individually, conversion uniqueness and the computed actual proven live. Suite extended: layer 2 contract tests for tickets, conversion and rates, layer 3 flows, and a layer 1 leak guard because tickets have no seeded rows |
| T-ws2-asana | Phase 2 workstream 2: two-way Asana sync by polling | BUILT 2026-08-30, D75 to D77, unverified against a real token. Migration 0009 applied local then remote, 9 of 9, snapshot `snapshot-2026-08-30-pre-0009.sql` taken first. All nine constraint cases probed. Reconciler tested as a pure function and mutation-checked; the run tested end to end against the real schema with Asana stubbed, including the D69 path. Run by hand from Settings; nothing wired to cron |
| T-ws3-client360 | Phase 2 workstream 3: Client 360, contacts and contracts | DONE 2026-08-30, D79 and D80. Migration 0010 applied local then remote, 10 of 10, snapshot `snapshot-2026-08-30-pre-0010.sql` taken first. All 13 constraint cases probed. Money proven identical to the Invoicing screen on 22 invoices before the page was built, and asserted in the suite. Defect found live and fixed: partial unique index matchers named the index rather than the column, in contacts and in tickets |
| T-ws4-google | Google Cloud OAuth client, Paul's own account | DONE 2026-08-30, D78. Client created, redirect URIs registered, `GOOGLE_CLIENT_SECRET` on the Worker (confirmed by name only). Client ID still to land as a plain var. Google restricted-scope verification and CASA logged as a long-lead gate on partner accounts, not on the build |
| T-ws4-connections | Phase 2 workstream 4: connections, Google, built dark | CALENDAR HALF BUILT 2026-08-30, D81 to D83. Migration 0011 applied local then remote, 11 of 11, snapshot taken first. All 13 constraint cases probed. OAuth flow, token refresh, calendar read and the Settings panel done and probed live for every path that does not need a real client id. Tokens in KV, never D1, per D81. Scope guard tests mutation checked. AWAITING `GOOGLE_CLIENT_ID` to run one real authorization; Gmail read not started |
| T-ws4-gmail | Phase 2 workstream 4: Gmail read, ingest, browse and the AI pass | BUILT 2026-08-30, D84 to D88. Migration 0012 applied local then remote, 12 of 12, snapshot taken first. All 15 constraint cases probed. Exercised against Paul's real account: 186 messages and 162 threads ingested over a three day window, pause and resume proven, bodies round-tripped out of R2, five threads summarised clean of em dashes. Two defects found by running it: a per-page estimate shown as a total (D85) and a comma inside a quoted display name (D87). Bodies in R2, never D1, per D86. Client linking returns nothing until contacts carry email addresses, which is correct and currently empty |
| T-v2-baseline | Partner time baseline audit, running 15-minute-increment note | OPEN, DRI Paul, starting week of 2026-08-31. Prerequisite for the v2 partner-hours-saved dashboard, D52. Nothing blocks on it in v1 |

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
ships.

RESOLVED for the outstanding case. Quick add and the N shortcut shipped with the
Today cockpit: a dialog reachable from the sidebar button on every screen and
from the N key, which is ignored while typing and while a modifier is held. The
Action Items empty state now reads the guideline's exact wording, "No action
items yet. Add one with quick add, or press N." The rule stands for the next
case.

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

### D32: SOP versions are immutable and undeletable

A version is a historical fact. Editing one rewrites the audit trail, which is
the only reason the table exists. Deleting one puts a hole in it.

Enforced in the database, not by convention. Migration 0002 adds two triggers,
`sop_versions_immutable` and `sop_versions_undeletable`, that RAISE(ABORT) on any
UPDATE or DELETE against `sop_versions`. Verified against local D1: both attempts
return SQLITE_CONSTRAINT_TRIGGER and the row is untouched afterwards.

The API validates the same rules so a caller gets a clear message rather than a
raw constraint error. PATCH on a SOP rejects a `body` key with "Editing a SOP
body creates a new version." The triggers are the backstop, not the error text.

One consequence, accepted: local test SOPs cannot be cleaned up. Neither the SOP
nor its versions can be deleted through any path, so a throwaway SOP written
while developing is permanent until the local database is reset. That follows
from D31, which already treats local state as disposable and rebuildable from
migrations plus the seed.

### D33: SOPs archive, never delete. No destroy path in v1

There is deliberately no DELETE route on `/api/sops`. Archiving is the only way
to retire a SOP, and it is reversible.

Archiving drops a SOP from the default list, which is the point, but the record
stays fully readable at its own URL with its history intact. An archived SOP
cannot take a new version until it is restored to active; the API returns "This
SOP is archived. Restore it to active before editing." rather than silently
accepting an edit to a retired procedure.

The foreign keys are `ON DELETE RESTRICT` in both directions, so even a direct
database delete of a SOP fails while it has versions, and versions cannot be
deleted at all. There is no accidental path to destruction.

### D34: current_version_id moves forward only

History is linear. Restoring an older version means writing a new version that
carries the old body forward, never repointing the SOP at an earlier row.

The difference matters. Repointing would make the current version ambiguous and
would silently orphan everything written after it. Carrying forward keeps every
revision in sequence, so the history reads as what actually happened.

Enforced by the `sops_current_version_forward_only` trigger, which aborts any
update setting `current_version_id` to a version whose number is not greater than
the current one. Verified: moving backwards from v2 to v1 aborts, moving forward
from v2 to v3 succeeds.

The restore endpoint is `POST /api/sops/:id/versions/:versionId/restore`. It
copies the old body into a new version and defaults the change note to "Restored
the content of version N", so the audit trail says plainly what happened.
Verified end to end: a SOP at v3 restored from v1 becomes v4, v4's body equals
v1's body exactly, and v1 through v3 remain readable and unchanged.

### D35: local D1 is reset rather than cleaned, and the corollary for immutability tests

Local D1 is reset by deleting `.wrangler`, re-running the migrations and
re-running the seed. There is no cleanup path and there should not be one.

The corollary matters for testing D32. SOP versions cannot be updated or deleted
through any path, so any SOP written while developing is permanent for the life
of that local database. Immutability tests therefore run on data created for the
test after a reset, and the test data is not undone afterwards, by design. That
is the feature working, not a gap.

Nothing that matters may live only in `.wrangler/state`. Anything worth keeping
belongs in a migration or in `seed/dev-seed.sql`, both of which are in the repo.

### D36: markdown rendering deferred to v1, decided once for SOPs and Meetings. CLOSED

SOP bodies render as preformatted plain text for the MVP. Deferred, not
rejected.

The revisit point is v1, when Meetings arrives. Meeting summaries and imported
transcripts have the same question, and answering it twice invites two different
answers. One renderer and one sanitiser, chosen once, covering SOP bodies,
meeting summaries and AI-drafted content.

Until then plain text stands. Numbered steps, which is what the SOP template
asks for, read correctly without it.

CLOSED at the v1 kickoff by D44.

### D37: Clients ships as a thin module alongside Invoicing

Invoicing needs a real clients table. A table with no screens is a phantom: rows
appear only through migrations or the API, nobody can correct them, and the data
rots without anyone seeing it.

So Clients ships in the same pass as Invoicing, thin but complete: list, create,
edit, and archive. Archive rather than delete, consistent with SOPs under D33 and
with the `ON DELETE RESTRICT` on `projects.client_id`. Contacts, billing history
and the rest of the registry wait for v1.

### D38: DROP TABLE fires referential actions, so table rebuilds must stash and restore links

Caught by verification, not by reading. The first version of migration 0003
silently nulled every `action_items.project_id`.

`DROP TABLE` performs an implicit delete of every row, which fires `ON DELETE`
actions on child tables. `action_items.project_id` is `ON DELETE SET NULL`, so
dropping `projects` during the rebuild wiped every link. `PRAGMA
defer_foreign_keys` does not help: it defers constraint *checking*, not the
actions themselves. `PRAGMA foreign_keys = OFF` would stop them but is a no-op
inside a transaction, and D1 runs migrations in one.

The standard for every future table rebuild, including T-meetings-0:

1. Stash the child links in an ordinary scratch table before the drop.
2. Rebuild, drop, rename, recreate indexes.
3. Restore the links from the scratch table, then drop it.
4. Verify by diffing before and after, not by reading the SQL.

The verification is the point. This migration read correctly and was wrong. It
was caught because the check compared actual rows before and after rather than
asserting that the migration looked right.

### D39: a remote snapshot is taken before every remote migration, unconditionally

`npx wrangler d1 export command-center-db --remote --output <file>` runs
immediately before any `migrations apply --remote`, every time, with no
exceptions.

The rule is written to survive the argument against it. "Nothing is at risk"
and "the table is empty" are exactly the conditions under which the habit gets
skipped, and a habit that is skipped when it seems unnecessary is not a habit.
The cost is seconds. The case it protects against is the one nobody predicted,
which is the only kind that matters.

This sits on top of D1 Time Travel, which is always on but gives only a 7 day
restore window on the Workers Free plan. An exported file is ours, is not
governed by that window, and can be inspected without a restore.

Remote migrations are also batched rather than applied one at a time, so a
verified local sequence lands as a single remote change with a single snapshot
in front of it.

Snapshots are gitignored. An export of the live database can contain real client
data, and the repository is not the place for it.

The habit paid for itself the first time it ran. The snapshot taken before the
0002 to 0004 batch showed `d1_migrations` containing only `0001`, contradicting
a claim made earlier in the session that remote was already at 0002. Nothing had
been checked; it had been assumed. The batch was three migrations, not two. That
is the whole argument for the rule: the snapshot is a reading of what is
actually there, taken at the moment it matters.

### D40: the digest cron fires four times a day and mostly does nothing

Cron Triggers are UTC only and the working zone observes DST, so a fixed UTC
schedule drifts by an hour twice a year. Rather than accept that, the trigger
fires at all four UTC hours that could be 07:00 or 17:00 Mountain in either half
of the year, and the handler decides which firing is real:

    crons = ["0 0,13,14,23 * * *"]

`digestDueAt` reads the Mountain hour and returns morning, evening, or nothing.
Three of every four firings do nothing. That is the price of a UTC-only
scheduler, and it is cheap: a no-op invocation costs almost nothing against a
100,000 request per day allowance.

Verified by simulating every firing across four windows rather than by reasoning
about offsets. Each full Mountain day gets exactly one morning and exactly one
evening digest through the spring-forward week, the fall-back week, an ordinary
summer week and an ordinary winter week.

One trap this walked into and out of: the evening digest for the fall-back day
fires at 00:00Z on the *following* UTC date. A first test that only examined the
four cron hours on the changeover date itself reported that nothing fired, which
was the test being wrong rather than the schedule.

### D41: Cron Triggers do not retry, and the mitigation is ordering, not hope

Cloudflare Cron Triggers do not retry a failed invocation. This is a real gap
and is not closed, only narrowed.

What is done about it:

1. The idempotency marker is written to KV **only after Resend accepts the
   message**. A failed send leaves the day unmarked, so it stays retryable
   instead of being recorded as done.
2. `POST /api/digests/run?kind=...` sends on demand, and `?force=1` overrides the
   marker, so a genuinely missed digest can be sent deliberately.
3. `GET /api/digests/status` shows whether each digest has gone out today, so a
   missing email is distinguishable from a broken schedule.
4. The no-op path logs the reason, so an absent digest in the logs is
   distinguishable from a crashed one.

What is not done: nothing polls for a missed digest and nothing alerts on one.
If digests become critical, the architecture doc's suggestion stands, which is to
drive the HTTP endpoint from an external scheduler that does retry. That is a v2
decision, not an MVP one.

### D42: the built Worker is wrapped to add a scheduled handler

`@sveltejs/adapter-cloudflare` emits a Worker whose default export has only
`fetch`. A Cron Trigger against it fails, because Cloudflare invokes `scheduled`.
Confirmed by reading the adapter's worker template, not assumed.

The options were a second Worker deployed by hand, or stitching a `scheduled`
export onto the built one. The second Worker loses the git-connected deploy
model, which is the thing that makes shipping one push, so the build wraps
instead. `scripts/wrap-worker.js` runs after `vite build`:

1. moves the adapter output aside to `_app-worker.js`
2. bundles `src/lib/server/scheduled.ts` to `_scheduled.js`
3. writes a new `_worker.js` re-exporting the app's `fetch` and adding `scheduled`
4. appends both generated files to `.assetsignore` so neither is served publicly

The script fails the build loudly if the adapter output is missing, is already
wrapped, or has no recognisable default export. A silent failure here would ship
a Worker with no cron handler and no error, which is exactly the outcome worth
spending a guard on.

Verified from the bundled output: the deployed Worker exports both `fetch` and
`scheduled`.

### D43: digest sender and times are locked at the defaults

Sender is `onboarding@resend.dev`. Times are 07:00 and 17:00 Mountain.

Both were built as configuration with those values as defaults, and both are now
the decision rather than a placeholder. Changing either is a change request, not
a correction.

AMENDED 2026-08-29. `kabuhayan.app` turned out to have been verified in Resend
five months ago, with DKIM and SPF both passing. `DIGEST_FROM` is now
`digest@kabuhayan.app`, which is the R7 mitigation live rather than pending.

The original entry assumed the domain was unverified and reasoned from there.
It was never checked. The shared sender was the right default under that
assumption and the wrong one in fact, which cost nothing here but is the same
shape as the mistake the snapshot habit caught: reasoning forward from an
assumption instead of reading the state.

The times come from the architecture doc. Changing them is a one line change to
the cron expression, but note it is not a free edit: the four UTC hours in the
expression exist to cover those two Mountain hours across DST, so new times mean
recomputing the set. See D40.

### D44: one markdown renderer, safe by construction rather than by filtering

Closes D36. `src/lib/components/Markdown.svelte` is the single renderer for SOP
bodies, meeting summaries and AI drafted content. Renderer is `marked`, chosen
for being small, standard and having zero dependencies.

All content is untrusted regardless of author, as ruled. An AI summary of a
client transcript is untrusted by definition, and "Paul wrote it" is not a
security property when the text arrives through an import.

The ruling asked for a mandatory sanitiser. What shipped is stronger, and the
difference is worth stating rather than glossing.

A sanitiser takes an HTML string and removes the dangerous parts, which means
the dangerous parts existed and the filter has to be right. This renderer never
builds an HTML string at all. Markdown is lexed to tokens and the tokens are
rendered as Svelte elements, so markup in the source has no path to becoming
markup on the page. There is no `{@html}` anywhere in the application, verified
by grep, and that absence is the security design. Nothing is sanitised because
nothing unsafe is ever constructed.

Two things still needed explicit handling, because they are data rather than
markup:

- **Link schemes.** Only `http:`, `https:`, `mailto:` and app-relative paths
  become links. A `javascript:` or `data:` URL renders its label as plain text
  with no anchor. External links carry `rel="noopener noreferrer nofollow"`.
- **Raw HTML blocks.** Rendered as visible characters in a monospace paragraph,
  never interpreted.

Verified against a SOP whose body was a set of attacks, then re-verified
precisely after the first check produced two false alarms:

| Input | Rendered as | Result |
| --- | --- | --- |
| `<script>` payload | escaped text | no script element |
| `<img onerror=...>` | escaped text | `onerror` appears as characters, not an attribute |
| `<iframe>` | escaped text | no iframe element |
| `[x](javascript:alert(1))` | label only | never becomes an href |
| `[x](data:text/html,...)` | label only | never becomes an href |
| `[x](https://example.com)` | real link | with rel and target |
| bold, lists, inline code | correct elements | safe markdown unaffected |

The first pass flagged `onerror=` and `javascript:alert` as present. Both were
false: the first was the escaped text of the payload inside a paragraph, the
second was in SvelteKit's hydration data rather than in the rendered region. A
substring search over a whole page cannot tell live markup from serialised
source, and the check had to be narrowed to the rendered region to mean
anything. Worth recording as the shape of a bad security test.

If a sanitiser is still wanted on top, say so and it goes in, but it would be
filtering a string that is never produced.

### D45: AI extraction produces proposals, never action items

Nothing the model extracts becomes tracked work without an explicit accept.

The architecture doc says plainly that extraction gets names, dates and
ownership wrong and that a human review step must sit before anything is routed.
That review is only real if it can be interrupted, so a proposal is a row in
`meeting_action_proposals` with its own lifecycle, not a transient result and not
JSON on the meeting. Pending, accepted, or rejected.

Accepting writes one action item and records which one, so there is a trail from
"the model suggested this" to "this is being tracked". Re-running extraction
deletes only pending proposals: a rejected proposal is never offered again, and
an accepted one is never duplicated.

The accept call may correct any field first. That is the point of review. The
model got a name wrong in testing and the reviewer fixed it at the moment of
acceptance rather than accepting something wrong and repairing it later.

### D46: ambiguity is resolved by supplying what is missing, not by clicking past it

An item the model flagged as ambiguous becomes an action item with status
`ambiguous` unless the reviewer supplied both an owner and a deadline. It then
surfaces in the cockpit's "what will slip" band instead of looking like settled
work.

There is a backstop under the model's own judgement: whatever it claims, an item
with no owner or no deadline is treated as ambiguous, because those are exactly
the two fields the architecture doc warns extraction gets wrong. The model is
asked to flag, and the code assumes it sometimes will not.

Verified end to end: an ambiguous proposal accepted with no corrections became an
`ambiguous` action item; the same shape accepted with a corrected owner and an
added deadline became `open`.

### D47: the Anthropic SDK, not raw fetch

The Claude call goes through `@anthropic-ai/sdk`, not a hand-rolled `fetch`.

Reaching for `fetch` was the instinct, because the architecture doc describes
calling the AI provider via fetch from a Worker and because a raw call looks
lighter. It is the wrong instinct in a TypeScript project: the SDK is the
supported surface, it carries the typed error classes the UI branches on, and it
handles retries and response shapes that a hand-rolled call gets subtly wrong.

Model is `claude-sonnet-5`, per Paul's ruling. Two properties of it shape the
code and were checked rather than recalled: adaptive thinking is on by default,
so `max_tokens` must leave room for it or responses truncate mid-answer; and
`temperature`, `top_p` and `top_k` are rejected outright, so behaviour is steered
by the prompt alone.

Extraction uses structured outputs with a JSON schema rather than tool use, since
it is a single extraction call rather than an agentic loop. The output is still
validated field by field before it reaches the database: a schema constrains the
shape, but this is model output crossing a trust boundary.

`stop_reason` is checked on every call. A refusal and a truncation are real
outcomes, and returning half a summary silently would be worse than failing.

### D48: house style is enforced in code, not requested in a prompt

F2 from the first live extraction test. The summary prompt already said "never
an em dash" and the model emitted one anyway.

That is the lesson, not the bug. A prompt is a request. Anything that must always
hold is enforced in code, and the prompt exists to make the enforcement rarely
necessary rather than to be the enforcement. Same shape as D44: make the bad
outcome structurally impossible rather than asking for it not to happen.

`src/lib/server/house-style.ts` holds both halves. `HOUSE_STYLE` is prepended to
every AI prompt in the app, currently three of them, and `enforceHouseStyle` runs
over every string an AI produces before it is stored or shown. Dashes between
digits become "to", every other forbidden dash becomes a comma, and the
punctuation damage that replacement causes is repaired rather than left.

One deliberate exception: the `evidence` field on an extracted proposal is never
style-enforced. It is a verbatim quote from the transcript, and rewriting a quote
to satisfy house style would destroy the only check available on whether the
model invented it. The confabulation test that passed on the first live run
depends on that field being untouched.

The prompt also gained a rule against merging two names into one entity, from F1,
where the summary read a Nashville agency and an Austin one as a single employer
with "inconsistent references". Paul is correcting that instance by hand, which
exercises the edit-counts-as-reviewed path. The prompt guard is mine, added
because the failure will recur otherwise.

### D49: drafts are not stored

A template persists. A draft made from it does not.

`POST /api/templates/:id/draft` returns a draft and writes nothing. The app has
no send capability, so a draft is something Paul reads, edits, and copies into
his own mail client. Storing every draft would accumulate stale near-duplicates
of the template that produced them, and a stored draft implies a workflow, an
outbox, a status, that does not exist.

The template body is passed to the model as an exemplar to imitate, not as
instructions to follow. That is the mechanism the architecture asks for: a model
told to "be professional" writes like a model, and one told to match a specific
piece of real writing matches it. The situation is the only new information, and
anything it does not establish comes back as a bracketed placeholder rather than
a plausible invention, because a confidently invented commitment in a
client-facing email is the most expensive output this app could produce.

Every draft carries the same unreviewed banner the meeting summaries do, and is
rendered through the one markdown component.

### D50: migrations are applied to remote before the code that needs them is pushed

On 2026-08-29, `/templates` returned a 500 on the live site. The cause was not
in the Templates code. It was the deploy model.

**What happened.** The commit that added Templates carried both the code and
migration `0007_templates.sql`. Pushing to main auto-builds and auto-deploys the
Worker, so the code went live within minutes. D1 migrations are applied by hand
and nobody had run one. Production was running code that does
`SELECT * FROM templates` against a database with no `templates` table.

**Verified before anything was touched**, per the instruction and because a
plausible diagnosis is not a confirmed one:

| Check | Result |
| --- | --- |
| `wrangler d1 migrations list --remote` | `0007_templates.sql` listed as pending |
| `SELECT name FROM d1_migrations` on remote | 0001 through 0006, nothing else |
| `SELECT name FROM sqlite_master WHERE name='templates'` on remote | empty |
| Pre-migration snapshot, D39 | 12 `CREATE TABLE` statements, no `templates` |

Four independent reads agreeing. Note the first `migrations list` call returned a
transient 7403 authorization error; the retry succeeded. A single failed API call
is not evidence of anything, and treating that 7403 as the finding would have
sent the whole investigation the wrong way.

**The root cause, stated plainly.** This is a structural gap in the deploy model,
not a mistake in one commit. Code deployment is automatic and migration
application is manual, so the two halves of a schema change travel at different
speeds. Every push that contains both a migration and the code that needs it
opens a window where production runs against schema that does not exist. The
window closes only when a human remembers. Nothing in the system was watching,
and the first signal was Paul hitting a 500 in his own browser.

**Options considered.**

*Apply migrations in the build step.* Workers Builds would run
`wrangler d1 migrations apply --remote` before deploying, closing the window
completely. Rejected. It puts an unreviewed, irreversible schema change on the
production database on every push, with no snapshot and no human in the loop.
That directly contradicts D39, which makes the pre-migration snapshot
unconditional and explicitly never waived by "nothing is at risk", and it
contradicts CLAUDE.md's rule that Paul is asked before anything touches the
Cloudflare account. It also removes the human from an operation that, under D38,
is already known to be capable of destroying data silently. Trading a
five-minute outage for the possibility of an unattended bad migration is a bad
trade.

*A version check alone.* Make the app detect the mismatch. This does not close
the window; it only makes the failure legible. Necessary, not sufficient.

*An ordering rule.* Apply the migration to remote first, then push the code that
depends on it. **This is the decision.** It closes the window with no new
machinery, and it preserves the snapshot and the human decision that D39 and
D38 exist to protect. It works because migrations here are additive: a database
carrying `templates` before the Templates code ships is simply a database with an
unused table, and the previously deployed code neither knows nor cares.

That last sentence is the condition the rule depends on, so it is stated as a
constraint rather than left implicit. **The rule holds for additive migrations.
It does not hold for a migration that drops or renames something the deployed
code still reads.** For those, applying first breaks production immediately
instead of five minutes later. A destructive schema change is done in two
deploys: first ship code that tolerates both shapes, then migrate, then remove
the old path. No such migration has been needed yet. When one is, this is the
constraint it has to satisfy.

**Built alongside the rule**, because a rule that depends on memory is the thing
that just failed:

- `vite.config.ts` reads `migrations/` at config time and bakes the highest
  filename into the bundle as `__EXPECTED_MIGRATION__`. It is derived from the
  same tree that produced the code, so it means exactly "the schema this build
  was written against". The build fails rather than emitting a schema-blind
  bundle if the directory is empty.
- `src/lib/server/schema-version.ts` compares that constant against
  `d1_migrations` at runtime. `GET /api/health` returns **503** on drift, with
  the direction of the drift and the exact command to fix it. A Worker whose
  database is behind it is not healthy: some route is going to 500 as soon as
  somebody opens it. Reading wrangler's own bookkeeping table rather than probing
  for named tables means every future migration is covered the moment its file
  exists, with nothing to remember to add.
- `npm run schema:check` compares the tree against remote before a push and exits
  non-zero if the database is behind, printing the snapshot and apply commands in
  order. `schema:check:local` does the same for the dev database.

Verified by simulation rather than by reading: adding an unapplied migration file
made `schema:check` exit 1 naming it, and deleting the 0007 row from the local
`d1_migrations` made `/api/health` return 503 with
`applied: 0006_meeting_proposals.sql` against `expected: 0007_templates.sql`.
Both were restored afterwards and both endpoints confirmed green again.

Detection does not replace the rule. The rule prevents the outage; the check
catches the day the rule is forgotten.

### D51: reports are computed live and never stored

Architecture section E has a `reports` table: `id, type, params(json),
generated_at, r2_key, share_token, share_expires_at`. No such table exists and
none is created here.

Look at what those columns are for. `r2_key` holds a generated PDF kept as a
persistent artifact. `share_token` and `share_expires_at` implement the
tokenised public link. Both are v2: shareable read-only reports are a locked v2
decision, and PDF export in v1 is the browser's own print-to-PDF, which produces
a file on Paul's disk rather than an object in R2.

Strip those three and the row records that somebody once opened a page. It would
also go stale immediately, because every figure in a report is derived from
today, so a stored report is a snapshot whose numbers are wrong tomorrow and
whose staleness is invisible.

So each report is a parameterised query answered live, and the parameters live
in the URL. That makes a report linkable and re-runnable, which is most of what
storing one would have bought. Same reasoning as D49 for drafts.

The table arrives with v2, when it has something to hold.

### D52: partner time saved is not built, and the reason is the baseline

Section D names five reports. Four are built. The fifth, partner time saved, is
not, and this is a deliberate omission rather than an oversight.

It needs `TimeSavedLog` and `SlipsCaught`, neither of which exists, and the
build plan puts that dashboard in Stage 4. More to the point, the architecture's
own method for it starts with a baseline: time-audit the partners' pre-handoff
minutes per task type in 15-minute increments, then compute savings against
that. No baseline has been captured. Building the dashboard now would mean
picking baseline numbers, and the report's whole purpose is to be credible
enough that the partners can stress-test it. A headline "hours reclaimed" built
on an invented baseline is worse than no report, because it looks like evidence.

The Reports index says so on the page rather than hiding the gap, and names what
is missing.

Revisit when the time audit has run. That audit is Paul's to start, and the
sooner it starts the sooner this report has something true to say.

### D53: PDF export is the browser's print-to-PDF over a shared component

Section D offers two routes to a PDF: clean printable HTML through the browser's
own print-to-PDF, or a client-side PDF library. It also names the thing both
avoid, Cloudflare's paid Browser Rendering product.

Print-to-PDF wins. A PDF library is a dependency that has to be taught
pagination, page breaks, table headers repeating across pages, and fonts, all of
which the browser already does. It contradicts the standing preference for
boring dependencies, and it would ship a second rendering engine whose output
nobody checks against the screen.

The shape is a separate route, `/reports/:type/print`, not a print stylesheet
bolted onto the main screen. The route re-runs the same query from the same URL
parameters, so opening or refreshing a print URL gives a correct report rather
than an empty one, and the URL is worth having on its own as a clean read-only
view.

The part that matters is what the two routes share. The report itself is one
component, `ReportBody.svelte`, rendered by both. Only the page around it
differs: the screen route wraps it in the app shell with a date-range form, the
print route wraps it in a titled sheet with a generated-at stamp. A print
stylesheet drifts from the screen it was written for. Two routes rendering the
same component cannot show different numbers, and that was verified rather than
asserted: every figure on each screen route was checked to appear on its print
route, across all four reports.

Three smaller calls inside this, each with a reason:

- **Nothing auto-prints.** A page that opens a print dialog on load takes the
  decision away from the reader.
- **Print drops tinted backgrounds instead of forcing them.** Every alarm state
  already carries its meaning in words, per D28's never-colour-alone rule, so
  printing to paper does not need to spend toner on red rows.
- **Every printed page is stamped** with generated-at in Mountain Time, the
  as-of date, and the window it covers. A report with no as-of date is one
  somebody misreads three weeks later.

The root layout renders print routes without the app shell, matched on the route
id rather than on the URL string, so a record named "print" cannot strip its own
chrome.

### D54: read how the existing modules solved it before writing date, money or auth logic

Paul's ruling, issued after the Mountain Time bug in the completion report.

The report wrote a fourth version of "which day is this timestamp on" and got it
wrong, while three correct versions already sat in the repo: the Today cockpit,
the start-of-day digest and the end-of-day digest all bind
`workingDayStartUtc(day)` and compare instants, and the cockpit query carries a
comment saying exactly why. Nothing about the new code was novel. It was a
rewrite of solved work, done from scratch, and it regressed.

So: before writing anything that touches dates, money or auth, read how the
modules that already do it solved it, and follow that. The codebase is its own
reference now. It is old enough and consistent enough to be the authority, and
consulting it is faster than rederiving.

The three current references, so there is no ambiguity about what to read:

- **Dates and time zones.** `src/lib/server/dates.ts`, and how `today.ts` and
  `digest.ts` use `workingDayStartUtc`. Never take the date of a stored UTC
  timestamp with `date()` in SQL.
- **Money.** Integer cents end to end, and aging derived at read time and never
  stored. `invoicing.ts` is the reference, and `reports.ts` follows it closely
  enough that the two produce identical aging bands, which is checked.
- **Auth and secrets.** Access is edge-enforced and there is no auth UI (D25).
  Secrets are Worker secrets, read from `c.env`, never logged, never returned.
  The pattern for a missing one is a 503 naming the `wrangler secret put`
  command, as in `meeting-ai.ts`, `templates.ts` and now `asana.ts`.

This does not forbid changing how something is done. It forbids changing it by
accident, which is what happened.

### D55: the Asana push is one explicit action per item, and it writes nothing on failure

D4 in shape, with the specifics settled here.

**Explicit, per item.** `POST /api/action-items/:id/asana`. There is no hook on
create, no hook on accepting an extracted proposal, and no batch endpoint. Asana
is the firm's shared system of record, and a personal capture tool that silently
posted into it would put half-formed notes in front of the partners. A push
happens because Paul clicked push on that item.

**Never blocks local tracking.** The push is its own endpoint and the only thing
it ever writes is `asana_task_gid`, after Asana has accepted the task. Every
failure path returns before touching D1. This was verified rather than assumed:
with a deliberately invalid token, the push returned a mapped 502 and the item
kept its title, status, deadline and null gid, and could still be marked done
and reopened afterwards.

Same rule the digests already follow with their sent marker, per D54: the record
of having done a thing is written after the thing succeeded, never before.

**Pushing twice is a 409.** Asana has no idea two tasks would be duplicates, so
nothing but this check prevents them. The response names the existing gid rather
than just refusing.

**A workspace is required before any push.** Asana requires `workspace` on task
creation unless `projects` or `parent` is supplied, so a token alone is not
enough to create a task. Rather than have Paul dig a gid out of an Asana URL,
the workspaces and projects his token can see are listed from the API and he
picks from them on the Settings screen. The chosen workspace, optional project
and optional default assignee live in KV, which is where the architecture puts
settings. The names are stored beside the gids purely as labels; every request
to Asana uses the gid.

**Failure is legible.** Every status code with a distinct cause gets its own
sentence naming what to do about it, and Asana's own message rides along when it
had one, because on a 400 it names the offending field better than any wording
here could. Confirmed live against the real API: an invalid token produced
`Asana rejected the token. Set a current personal access token with wrangler
secret put ASANA_TOKEN. Asana said: Not Authorized`.

**What is checked and what is not.** The endpoint, the auth header, the `data`
envelope on both request and response, `data.gid`, the `due_on` format, the
required-workspace rule and the `{ errors: [{ message }] }` error shape were all
read from developers.asana.com, and the error shape was then confirmed against
the live API. One thing was not: the Task object reference truncated at the
point where `permalink_url` would appear, twice, so whether Asana returns a
ready-made task URL is unconfirmed. The push requests it via `opt_fields` and
uses it when present, falls back to building
`https://app.asana.com/0/0/<gid>` when absent, and reports which happened as
`url_from_asana`. The first live push settles it, and this paragraph gets
updated with the answer rather than left as a guess.

Stored links are always built from the gid, since D4 stores the gid and not a
URL.

#### Amended 2026-08-29: no production push has ever succeeded

Paul reported that the "Trying out Asana" task in his My Tasks was entered by
hand, not created by the app, and asked which it was. Checked against remote
production rather than local:

| Check | Result |
| --- | --- |
| Action items carrying an `asana_task_gid` | **0** |
| Action items in production, total | 2 |
| An item titled "Trying out Asana" | does not exist |
| Asana workspace in remote KV | present, `1217966932722649`, "My workspace" |

There is no stored gid, so there was no task to look up and no app-created task
to compare against. Two facts make this conclusive rather than merely
consistent. The push writes `asana_task_gid` only after Asana returns one, so
zero stored gids means no push has ever returned a task. And the push copies the
action item's title verbatim as the task name, so the app could not have
produced a task named "Trying out Asana" when no action item has ever carried
that title.

Corroborating: both surviving items were last updated at 04:30:57Z and
2026-08-28T21:20:48Z, while `ASANA_TOKEN` was set at 05:53Z. Neither has been
touched since the token existed, and a successful push bumps `updated_at`.

The configuration was not the blocker. A workspace was saved, so the push was
available and simply was not exercised, or failed before reaching Asana.

So the permalink question this decision left open is still open. `permalink_url`
remains unconfirmed, and the first real push settles it.

#### First production push, 2026-08-29, and the defect it exposed

The mechanism works. Paul created a real action item, pushed it, and the link
opened the correct task. GID `1217967895665406` stored on
`Send week-1 recap and 30-60-90 outline`, confirmed present in remote D1.

Then the task vanished. It was not in My Tasks, not on any board, and once the
detail pane was closed there was no obvious way back to it.

**D-asana-1.** The push created the task with no assignee and no project. Asana's
My Tasks lists only what is assigned to you, so a task with neither is real,
reachable by search and by permalink, and invisible in every view a person
actually opens. The settings supported both fields and both were optional, so
leaving them empty produced a task nobody would ever see. Optional was the wrong
default for a field whose absence hides the record.

Fixed by making the assignee default to `me`, which Asana resolves to the token
owner. There is deliberately no way to request an unassigned task, because that
is the defect rather than a preference. The project stays optional, since a task
can legitimately sit outside one, but Settings now warns when none is chosen and
says why it matters.

The push response now reports where the task landed and whether the link came
from Asana's own permalink or was built from the gid, so the next push answers
the `permalink_url` question in the notice rather than in a JSON body nobody
reads. That question is still open: the first push predates this, and its
`url_from_asana` value was not captured.

#### Row c closed 2026-08-29, and the one datum still missing

The post-fix push worked. The task appears in Asana My Tasks, assigned to Paul
Pacardo, due Monday, which is the same run confirming D-asana-1 fixed: before
the fix the task existed and was invisible, after it the task is where a person
looks.

#### The permalink question, ANSWERED 2026-08-30

**Asana does return `permalink_url`** when it is asked for through `opt_fields`
on `POST /tasks`. Read from the response of a real production push rather than
from a log, because a path to the production bindings existed that made the
direct answer available:

    gid             1217972687132070
    assignee        me
    url_from_asana  true
    url             https://app.asana.com/1/1217966932722649/project/1217966932722956/task/1217972687132070

This closes the one thing D55 recorded as unconfirmed, and it was worth
confirming rather than assuming, because **the permalink is not the shape this
code guesses**. Asana's own URL is
`/1/<workspace>/project/<project>/task/<gid>`. The fallback in `taskUrl` builds
`/0/0/<gid>`, which is a different form entirely.

The fallback is nonetheless correct: Paul clicked the "In Asana" link on a stored
action item, which is built from the gid by that exact function, and it opened
the right task. So Asana resolves both forms and the app is right either way.
That is now known rather than hoped, which is the whole difference. Had the
constructed form been wrong, every stored link in the app would have been broken
and nothing would have said so.

The push response carries Asana's permalink and the UI link is rebuilt from the
gid. Both work. D4's decision to store only the gid holds, ratified, and is not
disturbed by this.

**It was not recoverable from stored data, which is why the logging was added.**
`url_from_asana` is computed in `createTask`, returned in the push response, and
rendered in the notice. It is never persisted, because D4 stores the gid and
nothing else. So the answer existed once, on screen, and nothing wrote it down.

Two ways it can still be answered. Paul read the notice and can report the
wording. Or the next push reports it: `console.log` now records the gid, the
`url_from_asana` flag, the assignee and the project on every push, which lands
in Workers Logs and stays readable for three days. That line exists because this
question demonstrated the gap: an outcome visible only in a transient notice is
an outcome nobody can check later, which is the same lesson the digest incident
taught about firings that leave no trace.

Deliberately not solved by storing the flag on the action item. It is metadata
about one push, not a property of the item, and D4's decision to store only the
gid holds.

A create-push-then-delete sequence would leave the same trace and cannot be
excluded from the database alone. It does not need to be: PM ruling is that a
fresh verified run supersedes the archaeology, and the run produces the gid, the
permalink answer and the row closure together.


### D56: the digest incident, and why a cron with no logs is not a cron you can trust

The first digest incident, 2026-08-29. No scheduled digest had ever arrived.

**Root cause: the cron never had an eligible firing.** Established before
anything was changed, from four sources:

| Fact | Source |
| --- | --- |
| Cron trigger created on the Worker | 2026-08-29T00:13:09Z, Cloudflare API `/schedules` |
| Commit that added `[triggers]` | 2026-08-29T00:12:24Z, 45 seconds earlier |
| The firing Paul was waiting on | 2026-08-28T23:00:00Z |
| Next firing after creation | 2026-08-29T13:00:00Z, not yet reached |

The trigger did not exist for another 73 minutes after the firing it was
supposed to serve. The 00:00Z firing was still 12 minutes before the commit.
Nothing failed. The feature shipped after the only firing time that had passed.

The trigger is registered and correct, `0 0,13,14,23 * * *`, and its
`modified_on` tracks each deploy, which confirms Workers Builds re-applies
`[triggers]` every time and that the dashboard secret change did not disturb it.

**The finding that mattered more than the root cause.** Paul asked what the
Worker logs showed for the 23:00Z invocation. There were none. `observability`
was unset and `logpush` false, so nothing had ever been recorded. The question
was unanswerable, and would have been equally unanswerable for the next firing.

A scheduled job here has no HTTP response, runs twice a day, cannot be retried
by the platform, and writes its only durable trace after it has already
succeeded. Without logs it is invisible in exactly the failure mode that
matters: running and doing nothing. Workers Logs is enabled now, at
`head_sampling_rate = 1`, since sampling a twice-daily job would mean losing
whole firings. Included on the Free plan at 200,000 events a day with 3-day
retention, checked against the Cloudflare docs rather than assumed.

**The handler now awaits its own work.** It previously handed the send to
`ctx.waitUntil` and returned. That is legal and the work does run, but the
invocation is recorded as finished before the send happens, and a throw inside
`runDigest` becomes an unhandled rejection against an invocation already marked
successful. For this job the outcome of the firing has to be the outcome of the
send. It is awaited, failures are logged with context and rethrown so the
invocation is recorded as failed, and every firing logs, including the three in
four that do nothing. An absent digest and a broken one looked identical from
outside, which is precisely what made this incident hard to close.

**The cron path had never once executed.** That is the uncomfortable part. It
was written, reviewed, deployed and reasoned about across two sessions without
ever being run. Now exercised against the built bundle:

| Firing | Result |
| --- | --- |
| 13:00Z Aug 29, MDT | morning digest due, sending, reaches `runDigest` |
| 23:00Z Aug 29, MDT | evening digest due, sending |
| 14:00Z Aug 29, MDT | no digest due at this Mountain hour |
| 14:00Z Jan 15, MST | morning digest due, sending |
| database fault | logged with context, rethrown, invocation fails |

`wrangler dev --test-scheduled` proved the entry point is reachable but ignores
every attempt to override `scheduledTime`, so the hour-dependent branches were
driven directly against `_scheduled.js` with a stubbed environment. Worth
recording as the technique: a scheduled handler is ordinary code and can be
called like ordinary code, and waiting for a real firing to find out whether it
works is not a test strategy.

#### CLOSED 2026-08-29 on the 13:00Z firing

The first scheduled digest in the app's history ran and sent. Evidence read by
Paul from the Cloudflare dashboard, which is the path D61 established because
the wrangler token cannot reach Workers Logs:

| Time | Log line |
| --- | --- |
| 13:00:00.532Z | `morning digest due, sending` |
| 13:00:02.763Z | `morning digest sent` |
| 14:00Z | the no-op guard, firing and doing nothing |

The subject in the log matched the delivered email verbatim, which is what ties
the invocation to the message and makes this an incident close rather than a
coincidence. Outcome evidence alone would have shown a marker, a Resend entry
and an inbox, and proved only that something sent a mail. The 2.2 seconds
between the two lines is the send.

Both digests ran on 2026-08-29, the first full day of scheduled operation in the
app's history. KV markers, which are written only after Resend accepts:

| Marker | Written |
| --- | --- |
| `digest:2026-08-29:morning` | 2026-08-29T13:00:02.015Z |
| `digest:2026-08-29:evening` | 2026-08-29T23:00:53.636Z |

The morning marker sits between the two dashboard log lines Paul read, at
13:00:00.532Z and 13:00:02.763Z, which is the ordering the code requires: the
marker is written after Resend accepts and before the completion is logged.
Three independent records agreeing on the same two seconds.

The evening firing matters for a second reason. It happened at 23:00Z, after the
backup cron deployed at 15:10:51Z, so it is the first digest to run under the
six-hour expression and it confirms the schedule change did not disturb the
digests it shares a handler with.

The 14:00Z capture matters as much as the 13:00Z one. It is the first direct
observation of a firing that correctly does nothing, which was previously
indistinguishable from a firing that was broken. That ambiguity is what made
this incident hard to close, and the logging added in D56 is what removed it.

Root cause stands as recorded: the cron never had an eligible firing, because
the trigger was created 73 minutes after the only firing time that had passed.
Nothing was ever broken. What was missing was the ability to tell.

### D57: the digest sends text and HTML, from one source

Paul reported the digest rendering as "2026-08-28Nothing needs attention",
missing the separator after the date.

The body was not missing it. Replaying the empty branch shows the text contains
a real blank line, and stripping newlines with no substitution reproduces the
reported string exactly, including the run-on into "Open the cockpit". The
collapse is in the surface it was read on, not in the string.

Fixed anyway. A body whose meaning lives entirely in whitespace is fragile in
exactly the surfaces a digest is read in first, and the fix is cheap: send an
HTML part alongside the text. Paragraphs and lists survive whitespace
collapsing because the structure is in the markup rather than in the spacing.

The HTML is derived from the same `parts` array the text is joined from, so the
two cannot disagree about content. Same reasoning as one `ReportBody` serving
both the screen and the print route, and the same reasoning as D54: the way to
stop two renderings drifting is to give them one source, not to keep them in
step by hand.

Every dynamic value is escaped. Titles and client names reach the digest from
the database and some were written by a model. A digest is not where anyone
should discover that a task title contained a tag.

`/api/digests/preview` returns the HTML as well, so the rendering can be checked
without sending anything.

### D58: the backup is a SQL dump written by the Worker, not an export

Nightly D1 to R2 backups, pulled forward from v2 by PM ruling on 2026-08-29 and
change-logged here.

D1 on the Free plan already keeps 7 days of its own point-in-time restore. That
is a real safety net, but it is not one Paul controls, it cannot be read without
the Cloudflare API, and it disappears with the database. The backup produces a
file he owns, in his own bucket, restorable with one wrangler command.

**Why the dump is hand written.** `wrangler d1 export` is a CLI command and does
not exist inside a Worker. The D1 REST export endpoint does, but calling it needs
a Cloudflare API token stored as another secret. That is a new credential, a new
rotation burden and a new failure mode, for something achievable with the
binding already in scope. So the dump is assembled from `sqlite_master` and a
read of each table.

Four properties that took deliberate care, each verified rather than assumed:

- **Dependency order.** Tables are inserted parents first, ordered by the
  `REFERENCES` clauses read out of each table's own DDL, so the ordering cannot
  drift from the schema. Restoring in `sqlite_master` order would fail on
  foreign keys depending on what order the catalogue happened to return.
- **Triggers come after the data.** The SOP immutability triggers reject updates
  to existing versions, D32. Installed before the inserts they would fire on the
  restore itself and a backup would refuse to load its own contents.
- **Internals are excluded.** `_cf_METADATA` is D1's own bookkeeping and
  `sqlite_%` is SQLite's. Neither belongs in a restore.
- **Unsupported types throw.** The schema is TEXT, INTEGER and REAL, checked
  across every migration, with no BLOB anywhere. Anything else reaching the
  serialiser means the schema changed without this being revisited, and it fails
  rather than guessing. A backup that silently mangles a column is worse than
  one that fails.

**Two limits stated rather than implied**, both written into the file header so
whoever restores it reads them. The dump is not transactionally consistent: D1
gives no snapshot across statements, so a write landing between two table reads
would be caught half-in. And the whole dump is built in memory, which is right
at this size and wrong at a large one, so it fails loudly above a ceiling
instead of truncating.

**The prune runs only after the write succeeds**, so a failed backup can never
remove a good one. Same rule as the digest sent marker and the Asana gid: the
record of an action is written after the action. Keys that do not carry a date
are left alone, because deleting things the prune does not understand is how a
prune becomes an incident.

**Proof it restores**, which is the only thing that makes a backup a backup. The
live local dump, 32,384 bytes over 13 tables and 53 rows, was pulled out of R2
and loaded into an empty SQLite database: 13 tables, 53 rows, 29 indexes and 3
triggers restored, `integrity_check` ok, and `foreign_key_check` clean with
foreign keys switched back on. `action_items` was then compared row for row and
field for field against the source and was identical, with all 7 meeting and
project links intact.

Retention is 30 days. The boundary was checked at exactly 30 days, which is
kept, and at 31, which is deleted.

#### Proven against production, 2026-08-30

Run ahead of the first scheduled firing deliberately, so that 09:00Z tests only
the trigger and not the write path underneath it. Reached through
`wrangler dev --remote`, which binds the real D1, KV and R2 to a preview worker
without touching the production deployment, since the API itself sits behind
Access and cannot be called from here.

| Step | Result |
| --- | --- |
| `POST /api/backups/run` | wrote `backups/d1/2026-08-29.sql`, 28,661 bytes, 14 rows over 13 tables |
| `GET /api/backups` | the object listed, uploaded 2026-08-30T00:16:35Z |
| Pulled from production R2 and restored | 13 tables, 14 rows, `foreign_key_check` clean, `integrity_check` ok |
| Asana gids after the round trip | both survive intact |

The key is `2026-08-29` because the backup is named for the Mountain day and the
run happened at 18:16 Mountain. That is the same day boundary the digests use and
it is correct, not a defect. It also means this manual run cannot collide with
the 09:00Z firing, which will be 03:00 Mountain on the 30th and will write
`2026-08-30.sql`.

### D59: the backup gets its own cron firing, not a ride on the digest

03:00 Mountain, its own firing, rather than appended to the morning digest.

A dump that is slow or throws must not be able to delay or break the digest, and
an operator reading the logs should be able to tell which job failed without
untangling one invocation that did two things. The extra firing is free.

The schedule follows the digest pattern rather than inventing a second one, per
D54: Cron Triggers are UTC only, so it fires at both UTC hours that could be
03:00 Mountain in either half of the year, 09:00Z in summer and 10:00Z in
winter, and the handler reads the Mountain hour to decide which is real. The
expression becomes `0 0,9,10,13,14,23 * * *`: six firings, three of which do
nothing.

Verified across both halves of the year against the built bundle. Summer routes
09:00Z to the backup, 13:00Z to the morning digest and 23:00Z to the evening;
winter routes 10:00Z, 14:00Z and 00:00Z. Exactly one of each job per Mountain
day in both. The empty-database guard and the rethrow were exercised too: a
database reporting no tables fails the invocation rather than writing an empty
file.

**Held from main at the time of writing.** PM ruling: nothing touching the
scheduled handler, `wrap-worker.js` or the wrangler config ships until the
13:00Z invocation evidence from the digest incident is pulled clean. The backup
module and its HTTP routes shipped separately, since they touch no cron surface
and a manual backup is useful on its own. The cron wiring is committed and
waiting.

### D60: evidence over memory, catch four, and the record that held

Fourth time on this project that live state has contradicted something believed
to be true, after the remote migration level, the Stage 1 login method, and the
digest cron. Logged because the pattern is now a standard, not an anecdote.

**The correction inside the correction.** The PM ruling that logged this catch
described it as the first instance of the handoff itself being the stale record.
It was not, and recording that would have put a false statement in the ledger
while trying to record a lesson about false statements. Every written record was
accurate at the time it was read:

| Record | What it actually said |
| --- | --- |
| `HANDOFF_01` section 7 | lists "the D55 Asana link click" as an outstanding verification |
| v1 gate row | "PENDING, Paul making one real push and clicking the resulting link" |
| Task `T-v1-asana` | "BUILT, unverified against a real token. Awaiting `wrangler secret put ASANA_TOKEN` and one real push" |
| D55 | "Confirmed live against the real API: an **invalid token** produced..." |

A search for any phrasing implying a push had happened returned nothing across
`docs/`.

**So what drifted was the conversation, not the documents.** The gate row said
PENDING and named the prerequisite. In discussion that compressed to "the D55
link click", which reads as a step in a sequence whose earlier steps are done,
and from there to "the successful push" as an unexamined premise in a question.
Nobody wrote anything untrue. The claim was manufactured by paraphrase.

That makes this catch the opposite of the previous three in a useful way. The
ledger was the thing that held. The lesson is not that written records go stale,
it is that **summarising a PENDING row into the name of its final step deletes
the word PENDING**, and the deletion is invisible because the summary sounds
like progress.

Practical rule, and the reason this is a decision rather than a note: when a
gate row is quoted or summarised, the state travels with it. "Row c, PENDING" is
the shortest honest form. "The link click" is not a shorter way of saying it, it
is a different claim.

The general rule stands unchanged and is now four for four: **where live state
and any recollection disagree, live state wins, and the check is cheap.** Four
queries against remote D1 and KV settled this one in under two minutes.

### D61: the evidence path for a cron incident is the dashboard today and a scoped token permanently

Discovered while preparing the 13:00Z evidence pull, three hours before the
firing rather than five minutes after it.

Workers Logs cannot be read with the credentials available to this session. The
wrangler OAuth token carries `workers_tail (read)` but no observability scope,
and the telemetry query endpoint returns 403. Isolated rather than assumed: a
control call to the schedules endpoint on the same token in the same minute
succeeded, so it is scope and not expiry. `wrangler tail` also produced no
output here, exiting silently, and it is live-only in any case.

Outcome-only evidence was offered and rejected by PM ruling. For a first-ever
firing the invocation record is the point of the incident close, not a nicety:
the KV marker, the Resend log and an inbox together prove a message was sent,
and prove nothing about whether the cron was what sent it. That distinction is
the entire incident.

So, two paths:

- **Today.** Paul reads Cloudflare, Workers and Pages, `command-center`, Logs,
  around 13:00Z, and pastes what is there. Retention is 3 days, so this has
  until 2026-09-01.
- **Permanently.** A scoped Cloudflare API token with Workers Observability
  **Read** and nothing broader, delivered by `wrangler secret put` and never in
  chat, per the standing rule on secrets. It exists so the next incident does
  not meet a 403 with a 3-day clock running.

This adds the first new provisioning item since the project began. CLAUDE.md's
list of what only Paul can provide gains one entry, and it is deliberately the
narrowest scope that answers the question.

### D62: volume testing happens on a local seed, never on production

Paul's judgement of the reports at low volume was that of course they look fine
when they are nearly empty, and the question is what they look like under real
load. Correct, and the obvious way to answer it would have been wrong.

**Seeding production would have destroyed tonight's evidence.** The digest reads
from the live database. Fake overdue items and fake past-due invoices inserted
now would appear in the 13:00Z digest as real fires, in the one firing the whole
day has been protected to observe. The evidence and the test would have
destroyed each other, and the contamination would have looked like data rather
than like a mistake.

So: volume testing is a local seed plus rendered screenshots, judged from the
images. `seed/volume-seed.sql` carries 44 action items across every status and
deadline band, 23 invoices populating all four aging bands plus paid and
not-yet-due, 14 projects across all five phases and all four statuses, meetings
dated today, and a backlog of pending proposals. Every id carries a `v-` prefix
so seeded rows can be found and removed.

Production seeding is prohibited before the digest evidence is pulled. A
production dress rehearsal, if it is ever wanted, is post-gate work and needs a
cleanup plan written before the first insert rather than after.

Verified rather than assumed: after seeding locally, remote was checked for
`v-` prefixed rows across `action_items`, `clients`, `projects`, `invoices`,
`meetings`, `templates` and `sops`. Zero in every table. The only change to
remote that day was Paul's own pushed action item.

### D63: the reports were spaced for three rows, and it showed at forty

Two defects, both invisible until the volume seed existed, both reported by Paul
before the screenshots were taken.

**The sidebar scrolled away with the content.** On a long page, reaching another
module meant scrolling back to the top first. Now sticky. Two bounds are needed
and the reason is worth recording: `align-self: flex-start` is what lets a flex
child stick at all, but it also collapses the sidebar to its content height,
which left the navy column ending partway down with page background below it.
`min-height: 100dvh` fills the column, `max-height: 100dvh` with internal scroll
stops a long nav pushing its own last item off screen.

**The tables were spaced for three rows.** Two specific failures at volume, not
a general feeling:

- Every child of the report body had the same gap, so a heading sat as far from
  its own table as from the previous section. Nothing grouped, and the page read
  as one undifferentiated column. The gap is now tight and the headings carry
  the separation.
- The row border is a very light hairline, which is fine for four rows and
  useless for sixteen. The eye loses its place tracking across a wide table.
  Rows are banded now, using the `--surface-row-alt` token that already existed
  for exactly this and had never been used. Alarm rows are ordered to beat the
  banding, and both are dropped in print so a paper copy does not spend toner on
  fills that carry no meaning.

The lesson is not about spacing values. It is that a layout can only be judged
at the volume it will actually carry, and every screen in this app had been
reviewed at three rows.

**Ratified as a standing standard.** No screen is signed off at a trivial row
count again. Before any layout is accepted, it is rendered against a seed that
carries the volume it will really see, and judged from that. Reviewing at three
rows is not a lighter version of reviewing; it is reviewing a different artifact
that happens to share a stylesheet.

This is the app-side twin of the render-before-review rule, arrived at
independently in a second domain, which is usually a sign the rule is real
rather than local.

### D64: held work parks on a side branch, and local main tracks origin main

Ratified by PM after R11, replacing discipline with structure.

The freeze was enforced at commit level and released at branch level: the cron
wiring sat in its own commit, a later commit landed on top of it, and
`git push` with no refspec sent the whole branch. Explicit `<sha>:main` is
correct and was adopted immediately, but it is still a thing to remember, and
the whole point of R11 is that remembering failed once already.

So the rule is structural. **Held work lives on a side branch**, named for what
it is holding, `hold/cron-wiring` here. **Local main tracks origin main and
nothing else.** The held branch merges into main when the hold lifts. A push
from main then cannot carry held work, because held work is not in main to
carry, and the mistake stops depending on anyone noticing.

Explicit refspecs stay on top of it. Two independent guards, one of which does
not rely on attention.

**The branch question, answered as far as it can be.** The Workers Builds API
returns 403 to the wrangler OAuth token, the same scope gap D61 found on
observability, so whether non-production branches build here cannot be
determined from this session. It did not need to be: the hold lifted by merging
the branch into main and pushing main, so the branch never went to origin at
all. The question is deferred to the next hold, and the safe default until it is
answered is that a hold branch stays local. Add Workers Builds read to the
scoped token in T-obs-token so the next answer is one call rather than a
deferral.

**Not pushed to origin while the freeze held, and the reason is worth
recording.** Whether Workers Builds builds non-production branches here is not
established, and if it does and its build command is `wrangler deploy` rather
than a versions upload, a branch build would apply the six-hour cron expression
to production. That is exactly the failure R11 already caused once. The
deployment history shows only `Unknown (deployment)` and `Secret Change` as
sources, which does not settle it either way, so the branch stays local until
after tonight's evidence and the question gets answered properly before the
branch is pushed.

Nothing is at risk from keeping it local. `ab5c786` is in origin main's history,
reverted by `e5c373a`, so the branch is reconstructible from origin alone as a
revert of the revert even if this machine is lost.

### D65: do not offer an option whose selection produces a broken record

PM generalisation of the Asana assignee fix, and it earns its own entry because
it applies well beyond Asana.

The assignee field was optional. Leaving it empty produced a task that existed,
was reachable by permalink and by search, and appeared in no view a person
opens. The setting was not wrong to exist. It was wrong to be blankable, because
one of its values silently destroyed the usefulness of everything it touched.

This is D27 turned around and pointed at writes. D27 says the interface must not
reference an affordance that does not exist. D65 says the interface must not
offer a choice that produces a record nobody can find. Both are the same
instinct: the UI should not be able to describe a state the system cannot
honour.

The practical test, applied before adding any optional field: what does the
record look like when this is empty, and is that state reachable by the person
who will need it. If the answer is no, the field is not optional. It has a
default, or it is required, or the feature does not ship.

Applied here: assignee defaults to the token owner and cannot be blank. Project
stays optional, because a task outside a project is still visible to its
assignee, and the cost is discoverability rather than invisibility, so it earns
a warning rather than a default.

### D66: a 2xx that is not JSON is a failure, not a success

Reported as creation failing silently on both the quick add and the capture
form, console clean, starting right after a deploy. Two of those three framings
turned out to be wrong, and the third named a real defect that was not the one
suspected.

**The writes were landing.** Remote held five identical copies of
`Confirm operating cadence with Dustin and John`, created at 10:38:31, 10:38:45,
10:39:11, 10:39:34 and 10:40:33. Nothing was rejected. Paul clicked five times
because the screen showed him nothing, and every click saved.

**The server was never involved.** `POST /api/action-items` returns 201 for both
the minimal quick-add shape and the full capture-form shape, on the dev server
and on a production build. Every other write was checked for blast radius and
all pass: action item PATCH both directions, clients, projects, templates, SOPs.
Remote D1 accepted an insert and a delete. The suspected cause, the mandatory
assignee, touches only the Asana push path and cannot reach creation, which the
diff confirms.

**The real defect is in the client, and it was in all 26 write sites.** Every one
of them did this:

    const payload = (await res.json().catch(() => ({})));
    if (!res.ok) { errorMessage = ...; return; }
    await invalidateAll();

Correct for the two cases it considered and silent for a third. A response that
is 2xx but not JSON falls straight through: `res.ok` is true, `res.json()`
throws and is swallowed into an empty object, the error branch is skipped, and
the caller reports success. In the quick add it also closed the dialog, taking
the unsaved text with it.

That third case is not exotic. It is what an expired session returns when a
sign-in page is served in place of the API, what an edge error page returns, and
what any HTML response looks like. All of them mean the write did not do what
the caller believes.

So `src/lib/http.ts` now owns every client write, and there is no path through
it that returns success without a parsed JSON body. Proven rather than reasoned:
the create POST was intercepted in a real browser and answered with a 200 HTML
page, which is exactly the shape that used to be swallowed. The old code said
nothing. The new code shows the error and leaves the typed title in the field so
the work is not lost.

**What is still not explained.** Whether the deployed site's failure had this
shape is unconfirmed, because production sits behind Access and cannot be probed
from here. The timing pointed at a deploy whose only client change was confined
to the Asana push notice, so the correlation is probably coincidence, and
assuming otherwise is the mistake this ledger has recorded four times already.
The discriminating test is Paul reloading the page: if the five items appear,
the writes were always landing and only the view was stale, which is what the
database already says.

Two sites are converted, the two that were reported. The other 24 carry the same
defect and are tracked separately rather than changed in a rush before a freeze.

### D67: evidence over memory, catch five, and the first time it landed on PM

Second time in one day, and this time the wrong belief was the PM's.

The hypothesis was that the mandatory-assignee change had been applied to the
app's own create path and was rejecting writes, with the 4xx swallowed client
side. It was reasoned from timing: creation worked before a deploy and appeared
to fail after it, and a change about a required field had gone out in that
deploy. Every step of that is a reasonable inference and the conclusion was
wrong.

What killed it was not a better argument. It was hitting the server. `POST
/api/action-items` returned 201 on both request shapes, on dev and on a
production build; every other write returned 2xx; remote D1 accepted an insert
and a delete; and remote held five successful copies of the item that was
believed to have failed. The diff then confirmed the suspected code could not
reach the create path at all.

The instruction that produced this was the PM's own: verify server side first,
do not reason from the code. Issued in the same message as the hypothesis it
disproved, which is the useful part. The rule works precisely because it does
not care whose belief is being tested.

Five catches now, and the distribution is the point:

| Catch | Wrong belief held by |
| --- | --- |
| Remote migration level | the session |
| Stage 1 login method | the session |
| Digest cron never firing | both |
| The successful Asana push | the conversation, D60 |
| Assignee rejecting writes | PM |

The lesson stops being about who is careless once it has landed on everyone. It
is about how cheap the check is. Four queries and a curl settled this one in
under three minutes, against a hypothesis that would otherwise have driven a
code change to a path that was never broken.

Timing correlation is the specific trap in three of the five. A deploy happened,
then a symptom appeared, therefore the deploy caused the symptom. Here the only
client change in that deploy was confined to a notice string in the Asana push
handler and could not have touched creation. The correlation was real and the
causation was invented.

### D68: Phase 2 opened, five workstreams sequenced by dependency

Estimates accepted at `aa088c1`. Five workstreams, ordered by what each one
needs rather than by calendar:

1. Two-way Asana sync
2. Tickets and the rate model
3. F18-lean Client 360
4. Connection infrastructure, built dark
5. Rate model, additive

Lean across the board, confirmed, with one explicit addendum: Asana lean is
polling via `modified_since` only. Webhooks are out of lean entirely, not
deferred inside it. That distinction matters because a deferred item comes back
by default and an excluded one has to be argued for.

Standing rules carry forward unchanged. Dual estimates before each build, suite
green per push, production clean of test data, the cron surface untouched
without an evidence window review, and the dress rehearsal still pauses
everything.

Corrected 2026-08-30: the rehearsal was scheduled onto Paul's first day of work.
It moves to Tuesday 2026-09-01, with the engagement starting Wednesday
2026-09-02. Strictly better than a fix, not merely a reschedule: rehearse
Tuesday, same-day fixes land Tuesday night, and Wednesday morning starts with a
warmed-up app rather than a test plan.

### D69: a deleted Asana task marks the item ambiguous and touches nothing else

The conflict case that needed a rule: an item has a stored gid and Asana no
longer returns that task, or returns it in a state the sync cannot resolve.

The ruling is to mark the item ambiguous with a note, never touch its status,
and never clear the gid.

Each half of that is load bearing. Touching status would let a remote system
close Paul's own commitment, which inverts who owns the record. Clearing the gid
would destroy the only evidence that the two systems were ever connected, and it
would do it precisely at the moment that evidence is most needed, because a gid
that resolves to nothing is the thing worth investigating. Ambiguous is not a
failure state to be cleaned up. It is an accurate description of what is known,
and the honest output when the truth is that the two systems disagree.

### D70: a scope never granted cannot be reached by a later bug

Gmail stays draft-only. No send capability, period, and the form that rule takes
is the point.

The weak version is a policy: never call the send endpoint. That survives
exactly as long as every future change remembers it. The strong version is to
never request the send scope, so the token the app holds is physically incapable
of sending, and a bug, a bad refactor, or a confused model cannot produce a sent
message no matter what it tries. There is nothing to remember because there is
nothing to reach.

This is D65 applied to permissions rather than to form controls. D65 said do not
offer an option whose selection produces a broken record. This says do not hold
a permission whose use would be a breach. Both are enforcement by absence, which
is the standing form of the rule now: where a guarantee can be made structural,
making it structural beats documenting it.

The classification check is a hard precondition on all of it. No Gmail code gets
written until `gmail.readonly`'s restricted or sensitive status is read off the
actual consent screen, because the answer changes whether verification and CASA
are in scope, and that is a schedule question, not a detail.

Paul's, personally, and not delegable: the Cloud Console work. The OAuth client
must live in his own Google account and must not be created through any session
credential. An OAuth client created by a session is a production identity owned
by the wrong party.

### D71: tickets and action items are two entities, and actual hours are never stored

Workstream 1, built. Migration `0008_tickets_and_rates.sql`, applied local then
remote, 8 of 8.

The entity fork is confirmed rather than reconsidered: an action item is the
capture layer, a thing written down in ten seconds during a call, and a ticket
is what one becomes when somebody is going to work it. One table with optional
columns would have made every screen ask which kind of row it was holding.

Three properties are worth stating because they were choices, not defaults.

Actual hours are not a column. They are summed from `time_entries.ticket_id` on
every read. A stored actual is a second copy of a number that already exists,
and second copies drift; here the drift would be between an estimate and an
actual, which is the one comparison the ticket exists to support.

Conversion leaves the action item completely untouched. The item is the record
that the commitment was made, and closing or deleting it to tidy a list would
destroy capture history. A partial unique index enforces one ticket per item, so
a second conversion is a 409 rather than a quiet duplicate.

`completed_at` is enforced by a table CHECK in both directions: a finished
ticket must record when, and an unfinished one must not carry a stale timestamp.
Twelve constraints were probed individually before the remote apply, and every
one behaved.

D38 explicitly does not apply here. Nothing was rebuilt, because SQLite adds
nullable columns in place, so no referential actions fired and no stash and
restore was needed. Recorded so the next migration does not copy a ceremony it
does not need.

### D72: the rate model is additive and never rewrites an entered amount

`clients.default_rate_cents`, `time_entries.rate_cents`, both nullable.

A rate is a default that gets copied onto a time entry when one is created. It
is not a lookup performed at read time. That is the whole distinction: raising a
client's rate must not silently change what last quarter's work was worth, and
an amount already entered on an invoice stays valid forever. The suite asserts
this rather than trusting it, by reading the billing totals, changing a rate,
and reading them again.

Computed value is shown on the ticket and labelled as a computation, not an
invoiced amount. Nothing in this model writes to invoices.

Fulfillment status is hand-set for now, with linked invoices displayed
alongside. The column is shaped so a computed mode can arrive later without a
migration: a status plus an optional basis field, where the basis records what
the status was derived from once anything derives it.

### D73: the house timezone rule, in two deliberate cases

D54 said to read how the existing modules solved it before writing date logic.
This resolves that habit into a rule with two named cases, because the codebase
was applying one vague instinct to two genuinely different kinds of value.

A **bare date** is zoneless. A deadline of Sep 3 means Sep 3 wherever the reader
is standing. It formats in UTC, and the UTC is not an approximation of anything
true, it is a device to stop the browser shifting the day backwards for a reader
west of the line. `formatDay` does this.

A **stored instant** is a real moment. A `completed_at` happened at one point on
the clock, and the only honest way to show it is in the timezone the person was
working in. It formats in `America/Denver`, and Intl carries the DST rules so it
needs no arithmetic of its own. `formatMoment` does this.

Getting these the same way round is what the reports bug was: `date(completed_at)`
took the UTC date of an instant, so anything finished after 6pm Mountain landed
on the next day and fell out of the window. That was one symptom of not having
this rule. Now the two helpers sit next to each other in `format.ts` with the
distinction written between them, so the choice is made once rather than
re-derived at each call site.

### D74: mutual verification, and a test that passes once then skips is lying twice

Two test infrastructure rules, promoted from the ticket work.

**Mutual verification.** The layer 1 guard fails on any ticket row at all, since
tickets have no seeded rows. The layer 3 cleanup can only satisfy that guard if
`DELETE /api/tickets/:id` genuinely exists and works. Neither can pass while the
other is broken, so neither can rot quietly. This is the same shape as the seed
fingerprint, where the generator writes a value the suite reads back, and it is
the strongest form test infrastructure takes: not one component checking a
system, but two components that fail together.

**A test that passes once and skips afterwards lies twice.** The first
conversion test returned early on a 409, reasoning that an earlier run had
already converted the item. It passed on the first run by testing the thing, and
passed on every run after by testing nothing, reporting the same green either
way. The fix was to make it self-cleaning: it deletes the ticket it created,
which frees the item and makes the next run a real run. Not a tidiness measure.
A test whose green means two different things is worse than no test, because the
absence of a test is at least visible.

### D75: a poll reports presence, never absence, so the sync has two passes

Workstream 2, built. Migration `0009_asana_sync_state.sql`.

The design turns on one property of `modified_since` that is easy to miss.
It filters what Asana returns. It does not describe what exists. A task deleted
in Asana does not appear in a changed-tasks list, and neither does a task that
nobody touched, and from the list alone those two are identical. A poll can
learn that something changed. It can never learn that something is gone.

D69 is entirely about things being gone, so polling alone cannot implement it.
Hence two passes. The poll reconciles what changed, one request, every run. The
sweep fetches individual links directly, and only for links Asana has not
confirmed in `STALE_DAYS`, because a direct fetch is the only thing that can
tell a deleted task from an untouched one. Without the sweep a deleted task
would stay silently linked forever, which is exactly the state D69 exists to
surface.

Two smaller rules fell out of building it.

**Only completion crosses back.** Asana knows done and not-done. This app knows
open, in progress and done. Mapping not-done onto open would reset Paul's own
in-progress state on every single poll, and nobody would file that as a bug;
they would just quietly stop trusting the status field. So a pull changes status
only when the two genuinely disagree about completion.

**A 404 is not a failure.** `fetchTask` returns null on a 404 and throws on
everything else, and the distinction is load bearing. If an expired token or a
rate limit were treated as "the task is gone", one dead credential would mark
every linked item ambiguous. The error mapping had to be widened to carry the
original HTTP status for this, because the UI-facing status deliberately
flattens most Asana faults to 502.

The sync is run by hand, not on a schedule. Twice deliberate: a pull changes
Paul's records from a system he only partly controls, so he asks for it and sees
what came back; and the cron surface does not change without an evidence-window
review, which this has not had.

### D76: D69 is enforced by the database, not by the code that agrees with it

Migration 0009 does not merely record an ambiguous state. It makes the
alternatives impossible.

A trigger refuses any write that clears `asana_task_gid` while a sync state
stands, and another refuses an ambiguous marker with no note. Nothing in the
sync would do either of those things, and that is not the point. The point is
that nothing added later can do them either, without first deleting a trigger
and explaining why.

This is the same move as D70: where a guarantee can be made structural, making
it structural beats documenting it. D69 said never clear the gid. The honest
implementation of never is a database that will not accept it.

One thing was tried first and did not work, recorded so it is not retried. A
unique index on a constant expression with a `WHERE` clause looks like it should
forbid a class of row. It does not. It permits the first such row and rejects
only the second, because every qualifying row has the same key. The probe went
straight in. Triggers state the rule exactly and fire on every row.

### D77: tests that set up their own state, because a sync writes the field it reads

Caught in this build, and the same family as D74.

Three sync tests shared one fixture. The first run wrote `asana_synced_at` on
both links, which is exactly the field the sweep uses to decide what is stale.
So by the third test nothing was stale, the sweep never ran, and an assertion
about what the sweep does when the token is dead was passing without the sweep
executing at all.

It failed loudly rather than passing quietly, which is the only reason it was
found in minutes. But the shape is worth naming: when the code under test writes
the field that selects what the code under test looks at, shared setup stops
meaning what it says after the first run. Each test now seeds its own links.

### D78: gmail.readonly is RESTRICTED, and that lands on partner accounts

Read off the console, not inferred. `gmail.readonly` sits under "Your restricted
scopes"; `calendar.readonly` is Sensitive.

Restricted is the harder of the two answers, and the important part is where the
cost falls. Testing mode against Paul's own account is unaffected and proceeds
now. The seven-day refresh token expiry that Testing mode imposes is accepted as
known friction rather than worked around, because working around it means
publishing, and publishing a Restricted-scope app means Google's verification
plus a CASA security assessment.

So the gate is logged as long-lead and it lands on partner and firm accounts,
never on the build. It is the twin of the partner conversation: both are
prerequisites for the same step, both take calendar time rather than build time,
and neither blocks anything before that step.

The Cloud Console work was Paul's personally, by ruling. The OAuth client lives
in his own Google account and was not created through any session credential,
because an OAuth client made by a session is a production identity owned by the
wrong party. `GOOGLE_CLIENT_SECRET` is set on the Worker, confirmed by name
only; the client ID is a plain var and not a secret.

Redirect URIs registered, and the build will match them:
`https://work.kabuhayan.app/api/connections/google/callback` and
`http://localhost:5173/api/connections/google/callback`. Access does not break
the callback, because the redirect happens in a browser that already carries the
Access cookie; a server-to-server callback would have been blocked.

### D79: Client 360 reads like a UI job and is not

Workstream 3, built. Migration `0010_contacts_and_contracts.sql`.

Projects, invoices, meetings and tickets already existed and needed only
filtering by client. Contacts and contracts did not exist at all, and no amount
of page work conjures them. That is the whole reason this was estimated as a day
and a half rather than an afternoon.

**The money is imported, not reimplemented.** `INVOICE_SELECT` was made an
export and the client page uses the same expression the Invoicing screen uses.
A second outstanding-amount calculation would be a second thing to keep correct,
and the first time the two disagreed the client page is the one nobody would
believe. The suite asserts the agreement directly: it sums the Invoicing
endpoint for one client and compares all four figures. Verified live before the
page was built, on 22 invoices: outstanding, overdue and overdue count identical
to the cent.

**Contracts and invoices sit side by side and are never added together.** Nothing
in the schema records an invoice against a contract, so any "percent fulfilled"
figure would be invented. The page says fulfillment is set by hand, and an E2E
test asserts that sentence is on the screen, because the failure mode here is
not a wrong number but a number that looks computed.

`fulfillment_basis` ships now, always `'manual'`. It exists so a computed mode
is a code change rather than a migration, and so the two modes stay
distinguishable afterwards instead of one column quietly changing meaning on a
date nobody wrote down.

### D80: SQLite names the column, never the partial index, and both matchers were dead

Found by hitting the endpoint. A second primary contact returned 500 "Something
went wrong on the server" instead of the 409 the code plainly intended.

The matcher tested for `idx_contacts_one_primary`. SQLite's message is
`UNIQUE constraint failed: contacts.client_id`. It reports the indexed column,
never the index name, so a matcher keyed on the name reads correctly, reviews
correctly, and can never once fire.

The audit that followed found the same bug in `tickets.ts`, keyed on
`idx_tickets_converted_from`. That one is masked: the convert route checks first
and returns its own 409, so the constraint only fires if two conversions race.
Both are fixed to match by column. A backstop that cannot fire is not a backstop,
and the fact that one of them was invisible for a whole workstream is the
argument for fixing the visible one properly rather than locally.

Worth stating as a rule: an error matcher is not verified by reading it. It is
verified by causing the error.

### D81: credentials do not go in D1, because the backup would spread them

Workstream 4, calendar first. Migration `0011_connections.sql`.

The estimate said "`connections`, holding OAuth tokens". The table does not hold
them, and the reason is D58.

The nightly backup enumerates `sqlite_master` and dumps every table in the
database to R2. A Google refresh token is a long-lived credential that mints
access tokens until it is revoked. Putting one in a D1 column means writing that
credential, in plaintext, into a new R2 object every night, and keeping it for
the whole retention window. The backup exists to make data recoverable. It would
silently have become a mechanism for copying a credential into more places.

So tokens live in KV, which is not part of the D1 dump, and `connections` holds
only what is safe to back up: which account, what it may read, when it was last
refreshed. The consequence is deliberate: restoring a backup returns the
connection record without the credential, and the app says reconnect. A restored
database should not silently regain the ability to read somebody's mail.

Worth generalising. Adding a table is not only a schema decision now that
something copies every table off-site on a timer. The question "what happens to
this column in a backup" did not exist before D58 and applies to every migration
after it.

### D82: the scope list is the safety mechanism, and the suite guards it

Gmail is read-only and cannot send. The enforcement is that `gmail.send` is
never requested, so the token is physically incapable of it (D70). But that
guarantee lasts exactly as long as the scope list stays what it is, and a list
in a file is precisely the thing that grows quietly during an unrelated change.

So the list is now asserted. Five tests: the exact four scopes, no scope
containing any write capability, every Gmail and Calendar scope ending in
`.readonly`, no write endpoint referenced anywhere in the two source files, and
no token column in migration 0011. Mutation checked: adding `gmail.send` to the
list fails three of them, and the message names the decision being overturned
rather than reporting a mismatch.

The test asserting exactly one `method: 'POST'` in `google.ts` is the one worth
explaining. Every Google read goes through a GET-only helper. The single POST is
the OAuth token exchange, which writes nothing to the user's account. A second
POST appearing is either a write or a refactor that deserves a look, and both
are worth a failing test.

This is the D67 family again: every artifact this project trusts gets trusted
only after being exercised. Beliefs, bundles, fixtures, tests, error matchers,
and now permission lists.

### D83: built dark is enforced in copy, not left as intent

The ruling was that partner and firm accounts connect only after the partner
conversation, and that it be enforced in Settings copy rather than in intent.

The panel says, in the same words: your own account only, connecting a partner
or firm account is a conversation that has not happened yet, and do not sign in
here with an account that is not yours. It also states plainly that nothing is
ever written: no sending, no replying, no drafts, no labels, no calendar
changes, and that this follows from which permissions were requested rather than
from how the code behaves.

`GET /api/connections` returns `writes_anything: false` as a field. Stating it in
the API as well as the page means the claim sits next to the code that would
have to change to make it false, rather than only in prose a reader has to
trust.

### D84: ingestion is batched and resumable, and its progress is a record

Gmail read, built. Migration `0012_email_ingest.sql`.

Listing a month of mail is one cheap call. Reading it is one call per message,
hundreds of them, and a Worker request will not live long enough to do that. So
a run is a series of small batches, each recording where it got to before it
returns.

The consequence that matters is not performance. It is that nothing depends on
a single request surviving. A batch that fails costs one batch, the cursor stays
where it was, and the next attempt covers the same page again. Re-reading a page
is free; losing one silently is not, which is why the cursor is deliberately not
advanced on failure. Same rule as the digest sent marker and the Asana sync
cursor: the record of having done a thing is written after the thing succeeded.

Progress is stored rather than returned. Paul has to see ingestion state, not
infer it, and a number that exists only inside a request that has already ended
cannot be shown to anybody. A page opened halfway through a run shows the same
truth as one that watched it happen.

Proven on real mail: a three day window, 186 messages, 162 threads, every one
with a body, pause and resume exercised mid-run, and the completion transition
reached.

### D85: a per-page estimate shown as a total reads as a bug

Caught in the first real run, and it would have shipped as a visibly broken
progress bar.

Gmail's `resultSizeEstimate` is per page, not per query. The run reported 201 on
page one and 11 on the last. The code was overwriting the stored total each
page, so the readout would have said "186 of 11": a progress bar past its own
end, which reads as broken software rather than as an estimate behaving like an
estimate.

The first page's estimate is now kept and later ones ignored, because page one
is the closest thing Gmail offers to a total. The readout also says the word
estimate, so arriving early or late is honest rather than confusing.

Only visible by running it against real data. A fixture would have had one page.

### D86: mail bodies do not go in D1, for the same reason credentials do not

D81 said credentials stay out of D1 because the nightly backup dumps every table
to R2. Mail is the same argument at a larger scale: a body column would copy the
full text of Paul's mailbox into a new R2 object every night, for the whole
retention window, growing without bound.

So bodies live in R2 and are referenced. Written once.

Subjects and snippets ARE in D1, and so they are in the nightly dump. That is a
deliberate, narrower exposure rather than an oversight: they are what makes a
list readable, and a list nobody can scan is not worth ingesting for. The full
text is the part that does not need copying nightly to be recoverable.

D58 changed what a migration means. "What happens to this column in a backup"
did not exist as a question before something started copying every table
off-site on a timer, and it now applies to every table added after it.

### D87: the parsing is where a mail reader actually breaks

Seventeen tests against the decoding, and they are not ceremony. Fetching either
works or returns an error. Decoding fails quietly, and every failure looks like
working software: a body that is empty, a name that is mangled, a reply whose
text was silently dropped.

One real defect found this way. `parseAddressList` split the header on commas,
and a quoted display name routinely contains one: `"Acme, Inc." <a@x.test>` is
ordinary business mail. The naive split produced a fragment that parsed as the
address `"acme` and stored it as a recipient. It is right most of the time,
which is exactly why it survives review. Now split quote aware.

The other cases are the same family. Gmail's base64 is base64url, which `atob`
does not accept, and whether that matters depends on the content of the
particular message. A body decoded as latin1 mangles every accented name and
smart quote, which is most real correspondence. A reply with an attachment nests
its text one level deeper, so stopping at the top level loses the body of
precisely the messages that matter most.

### D88: a summary reports what the thread says, including that nothing happened

The AI pass reuses `summariseTranscript`'s shape exactly: same client, same
house style enforcement, same error handling. A thread and a transcript are both
a conversation somebody needs the gist of, and a second path would mean two
prompts to keep honest instead of one.

The prompt's load bearing instruction is the negative one: never infer a
decision from silence, never turn a proposal into an agreement, and if nothing
was decided say so. A summariser that manufactures a conclusion is worse than no
summary, because the conclusion is confident and the reader has no way to see it
was invented.

A thread with no readable body is skipped rather than summarised from its
subject line, for the same reason. Threads are re-summarised when they grow,
which is why `summary_at` is stored: a summary with no date cannot be known to
be stale.

Verified on real mail: five threads, 170 to 295 characters each, and zero em or
en dashes, which is the house style rule holding through a path that had never
been through it before.

### D89: verify mail by counts, never by content

Standing rule, ratified 2026-08-30, and it applies to every future pass over
Paul's mail.

Proving the ingestion worked did not require displaying any of it. The whole
build was verified on aggregates: message and thread counts, body sizes, sender
cardinality, ingest status, summary lengths, and an em dash count. Not one
subject, sender or body was printed into the session transcript.

That is the standard from here. Counts, sizes, aggregates, statuses. Never
content.

Two reasons it holds, and the second is the one that generalises.

A session transcript is a durable artifact in a place the mail was never
intended to reach. Reading a mailbox to build a feature does not require
reproducing the mailbox somewhere else, and every line printed is a copy that
now exists in a second location with different handling.

And it is the posture the partner conversation will need described. "The tool
reads mail and the operator never sees it in the build logs" is a sentence with
a demonstrable practice behind it. "We were careful" is not. The discipline is
worth more as an established habit with a record than as an assurance offered
when somebody finally asks.

This is enforcement by practice rather than by structure, which makes it weaker
than D70 and D82 and worth stating explicitly for that reason. Nothing in the
code prevents printing a body. The rule is the only thing that does, so it is
written down where it can be pointed at.

### D90: three defects from one evening of real use

Found by Paul using it, not by testing it. All three are the same species: code
that was correct in the case it was written for and wrong in the case that
actually happened.

**The thread page 404ed.** The list built links to `/mail/{id}` and that route
did not exist. Nothing caught it because nothing asked for it: the API was
tested, the list was tested, and the link between them was written once and
never followed. A link is a claim that a destination exists, and this one was
never checked.

**The readout contradicted itself.** The bar sat at 100% while the text beside
it read 64 of 201, in the same component. Two different quantities were being
rendered as one: `discovered` is what Gmail listed, `fetched` is what was newly
stored, and they diverge on every run after the first because most of the mail
is already held. On the run Paul saw they were 250 and 64.

The percentage is gone rather than fixed. Gmail's `resultSizeEstimate` said 201
while the run had listed 250, so the total was not merely approximate, it was
already exceeded. A bar drawn from a number the run has passed is a false
statement, and clamping it to 100% hides that rather than fixing it. Counts that
are true beat a bar that is not. This is D85 again, and D85 only fixed half of
it: the stored value stopped being overwritten, but the display kept treating it
as a total.

**The ingest stopped when Paul navigated away**, and the UI said "running" while
nothing was running. The diagnosis was confirmed from the record rather than
guessed: `started_at 09:29:41`, `updated_at 09:30:41`, status still `running`.
Ten batches in one minute, then nothing for the rest of the night.

That is inherent to driving the run from a page, and the fix is honesty plus
recovery rather than pretending otherwise: the readout distinguishes "reading
now" from "started, not currently reading", says plainly that reading happens
from this page and that nothing is lost, and Settings resumes a stalled run
automatically when it is opened. Moving the loop server-side would need a
Durable Object or the cron surface, and the cron surface does not change without
an evidence-window review.

The general lesson is the one worth keeping: a status field that records intent
rather than activity will eventually say "running" about something that is not.
Either the record has to be refreshed by the work itself, which is what
`updated_at` allows a reader to check, or the display has to compare the two and
say what it finds.

### D91: email HTML is rendered as elements, never as HTML

Paul's verdict on the first mail reader was that it looked broken, and he was
right. It showed the stripped-text extraction of HTML mail, which for anything
with a template is a wall of tracking URLs. Accurate and unreadable is its own
kind of wrong.

Gmail renders the HTML, so this has to. The constraint is that `{@html}` is
banned, and the answer is the one the markdown renderer already established:
parse the source into a validated tree and draw it as Svelte elements. No HTML
string is ever constructed, so there is nothing to sanitise. Unknown tags and
every attribute outside href, src and alt are dropped during parsing, and the
renderer is a long explicit branch per tag rather than a dynamic element, so
even a tag that somehow survived parsing has no branch that would render it.

This is the most hostile input the app handles, and it is now the most tested:
twenty cases naming the specific attack or malformation each one stops. Script
and style content discarded rather than rendered as prose. `javascript:`,
`data:` and `vbscript:` hrefs demoted to text. An href hidden behind entity
encoding, which a parser that decoded after checking the scheme would let
through. Unclosed tags, stray angle brackets and Outlook conditional comments,
because a parser that rejected malformed mail would refuse to show real mail.

Images render but do not load until asked. A remote image in an email is a
tracking pixel as often as it is a picture, and loading one tells the sender the
mail was opened.

The bodies had to change too. The stored body was the stripped text, which is
right for feeding a summariser and wrong for showing a person, so the rich
version is kept and `body_format` records which it is. The summariser is still
handed text, stripped at read time: giving a model markup spends its context on
tags and tracking URLs instead of on what the message says.

### D92: a list needs a label, not a summary

The second half of Paul's verdict, and the sharper half.

The mail list showed the full paragraph summary in every row. The understanding
was correct, the placement made it unusable, and the fix is not a better
summary: it is a different artifact. A list row gets a severity chip and one
line. The paragraph lives inside the thread where there is room for it.

So triage produces three things rather than one: a category, a severity, and a
gist of at most ninety characters. Measured on the first real batch, gists came
back between 61 and 90 characters, which is a line.

The load bearing instruction is that severity is about what PAUL must do, never
about how the sender wrote it. Marketing mail says urgent constantly. A
classifier that believed the sender would rank every promotion above a client's
actual question, which is the failure that makes a filter worthless. On the
first batch, seven of eight threads landed as noise and one as important
correspondence, which is the distribution a real mailbox has.

An answer outside the four allowed values is refused rather than coerced to the
nearest one. Quietly turning an unrecognised response into 'routine' would put a
confident label on a thread nothing understood, and a wrong label inside a
filter is worse than a missing one, because the missing one is visible.

Paul's corrections are stored beside the model's answer, never over it. The pair
is the entire training signal: what it said next to what it should have said is
the only thing that can teach it, and overwriting destroys exactly the half that
carries the lesson.

### D93: organise like Gmail, never write to Gmail

Archiving and marking read are real needs and they run into the no-write
guarantee, because both require `gmail.modify` in Gmail's own API. That scope
was never requested and will not be.

So triage state lives here. Archived means archived in this app; the mailbox is
untouched. That is a genuine limitation rather than a workaround, and the UI
says so in words rather than letting Paul discover it: "Archiving files it here.
Your Gmail is untouched, because this app has no permission to change it."

The trade is worth naming. What is given up is one-way tidying of the real
mailbox. What is kept is that nothing this app does, no bug and no future
change, can alter Paul's actual mail. For a tool that will eventually be
described to a partner, the second is worth more than the first.

### D94: an effect does not run during server rendering

Small, and it cost a verification cycle.

The thread page seeded its message bodies from the load inside `$effect`.
Effects do not run while the server renders, so the first paint had no body at
all and the message appeared only after hydration. It looked like the renderer
was broken; the renderer was fine and had nothing to render.

State that must exist in the server output is initialised where it is declared.
An effect is for keeping it in step afterwards, which here means re-seeding when
navigating between threads, since the component is reused.

Same family as the pre-hydration race the suite already chases: anything that
only happens on the client is invisible until the client arrives, and a check
run against the server output will not see it.

### D95: heavy work does not belong to a browser tab

The ruling, and it was overdue. Every heavy job ran inside a loop on the
Settings page, so ingesting mail and triaging it continued only while Paul kept
that tab open. He navigated away, everything stopped, and 747 threads sat
untriaged looking like a classifier that had failed rather than one that had
never been allowed to finish.

Ingest and triage are now shared jobs that the scheduled firings run. The API
routes call the same functions, so there is one implementation rather than a
cron copy that drifts from the interactive one.

Mail rides the existing firings rather than getting a cron of its own. The cron
surface does not change without an evidence-window review, and piggybacking
needs no expression change at all. It runs after the digest or the backup and
never throws: a passenger must not be able to take down the job the firing
exists for.

Each job takes a subrequest budget and stops when it runs low, rather than being
cut off part way through a write. Both are resumable, so stopping early costs
nothing. The ingest is careful about one thing in particular: the page cursor
advances only when every message on that page was handled, so a batch that ran
out of budget re-reads the page rather than stepping over the rest of it.

### D96: one bad row must not block the queue

Found by running the drain, and it is the more serious of the two defects the
drain exposed.

A thread whose summary hit the model's output limit threw, which killed the
batch. Because that thread stayed first in the ordering, every following run hit
it again and died in the same place. The backlog could not drain past it, and
nothing about the symptom said which thread was responsible.

Two fixes. The input is bounded per thread rather than only per message, since
twelve messages at eight thousand characters is ninety six thousand and the
model wrote until it hit its ceiling. And a failure now records the attempt and
moves on.

### D97: transient and permanent failures are not the same failure

Immediately after the fix above, and it is the reason that fix was not finished.

Recording every failure as attempted meant thirteen threads were written off in
one batch, all of them with the same cause: "Could not reach the Anthropic API".
A network blip says nothing whatever about a thread. Those thirteen were about
to be permanently excluded from triage over a condition that had already passed,
and the exclusion would have been invisible, because a thread nobody retries
looks exactly like a thread nobody has got to yet.

Now a rate limit or a 5xx ends the batch and leaves the thread untouched, so the
next run picks it up. Only a failure that will recur however often it is retried
is recorded as attempted. The thirteen were restored.

The general shape is worth keeping: recovery code that treats every error the
same is not recovery, it is a second failure mode wearing recovery's clothes.
Before writing a row off, the question is whether the cause was about that row.

### D98: unsent drafts are not correspondence

Paul's own unfinished drafts were being ingested and displayed. Reading his mail
never meant reading things he wrote and chose not to send, and a half-finished
sentence is the most private text in a mailbox.

Excluded twice over: `-in:drafts` in the Gmail query so they are never listed,
and a label check on the way in so one arriving anyway is dropped. Two guards
because the query is a string and strings get edited, and a typo there would
undo the whole intention silently.

Three stored messages were purged: rows from D1, bodies from R2 each confirmed
absent individually, and the three threads left with no messages removed. Counts
only were reported at every step, per D89.

### D99: the multipart walk stopped at the first alternative

The reason every rich message rendered as hard-wrapped text.

`extractBody` returned as soon as it found a `text/plain` part. In
`multipart/alternative` the plain part comes first by convention, so the HTML
sibling was never visited, and the caller's preference for HTML could never
apply to something it had not been shown.

The test that covered this asserted only that the plain part was found, which
was true with the defect present. A test that cannot fail on the defect it
covers is worse than no test, because it reads as coverage. It now asserts both
alternatives come back, and was mutation checked against the old behaviour.

Every stored body was extracted under the defect, so all 855 were re-read.
Confirmed on real mail: messages that previously stored as `text` now store as
`html`.

### D100: a rich body costs more CPU than a stripped one

Two resource failures came out of keeping the rich body, and both said the same
thing in different ways.

The re-read hit `error code 1102`, the worker exceeding its CPU limit, at
twenty five messages a call. Keeping HTML means decoding both MIME alternatives
rather than one and writing markup rather than stripped text, so a batch does
several times the work it used to for the same message count. The API budget
came down from four hundred units to thirty six, which is about six messages,
and more calls cost nothing because the job records its position after each one.

The deeper cause was in the decoder. `decodeBody` walks every character of the
payload to build its byte array, and marketing HTML runs to hundreds of
kilobytes, so the work was unbounded in the one place it looked like a detail.
The encoded input is now capped before decoding rather than after, on a four
character boundary because base64 encodes three bytes per four characters and
cutting mid-group produces an error rather than a shorter string.

Worth stating generally: a change that looks like "store a different string"
can be a change in the cost of every row, and the ceiling it hits will be one
nobody was watching.

### D101: the app proposes words, a person sends them

Drafting, built. Migration `0014_drafts_and_attachments.sql`.

A draft here is not a Gmail draft, and the schema cannot become one. There is no
send scope, no compose scope, and no column that could hold a Gmail draft id,
because creating a draft in Gmail needs `gmail.compose` and that was never
requested either. A row is a proposal that lives in this app and leaves it by
being copied out. The UI says so in those words.

The column that would have caused trouble is the one deliberately not called
`sent_at`. This app has no way to know whether a message was ever sent, and a
field named for sending would eventually be read as if it did. It is
`copied_at`, which is the only fact available.

The voice is shown, not described. Telling a model to write "professionally but
warmly" produces the average of everyone ever described that way; six messages
Paul actually sent carry his greeting, his sign-off, his sentence length and how
blunt he is willing to be, none of which he could have specified if asked. They
are found by matching the sender against the connected account, and short ones
are skipped because "thanks, will do" teaches nothing.

The prompt's hard rule is that it commits to nothing not already agreed in the
thread. No dates, no prices, no scope. Where a commitment is needed it leaves a
bracketed blank. A draft that invents a delivery date in Paul's voice is worse
than no draft, because it reads exactly like something he decided.

Paul's edit is stored beside the model's version rather than over it, and a
draft written before a newer message arrived is marked stale rather than
silently offered.

### D102: the AI stopped, and it was not a defect

The supervised drain reached 586 of 773 threads and stopped. The cause was not
in this app: `You have reached your specified API usage limits. You will regain
access on 2026-09-01 at 00:00 UTC.`

That is 18:00 Mountain on 31 August, which is before the rehearsal, so the
remaining 187 threads can be triaged then. Nothing is lost and nothing needs
re-running: the work is resumable and the cron picks it up.

Recorded because it is the sort of thing that looks like a defect at a glance
and would have cost an hour of debugging tomorrow. It also drew a line under
what could be built tonight: Gmail was not limited, so the body re-read and the
schema work went ahead, while every AI path was written and left unexercised.
The drafting pass has never produced a draft, and that is stated rather than
implied.

### D103: not every thread deserves the expensive model

Cost control, built into the shape of the work rather than bolted on as a limit.

Triage answers a four way question. It now runs on the small fast model and is
shown the subject, the sender and about twelve hundred characters of the
opening, because the rest of a conversation does not improve a four way answer.
Summaries stay on the larger model and are written only for threads triage
called urgent or important. On a real mailbox that is a small minority, and
paying the large model to recognise a job alert as a job alert was most of the
bill.

A thread only just judged urgent gets its summary in the same pass rather than
waiting for the next firing, so the expensive call follows the cheap one
immediately when it is warranted and never otherwise.

Nothing is redone for a thread whose newest message has not changed, and that is
keyed on the id of that message rather than on `summary_at < last_at`. A
timestamp comparison re-runs whenever anything touches `last_at`, including a
re-read that changed nothing anybody said, and it ties when two writes land in
the same second. An id is exact: unchanged means there is nothing new to read,
so there is nothing to pay for.

**Identity, not recency.** The near miss makes the rule concrete. Tonight's own
body re-read touched all 865 messages to store the rich version, which moved
every thread's `last_at`, while changing nothing anybody had written. Under a
timestamp key that would have queued a full re-summarise of every thread on the
expensive model: not a cost control at all, a cost bomb, triggered by a
maintenance job that improved nothing about what the summaries said. Keying on
the identity of the newest message rather than on when the row was last touched
is the difference, and it generalises to anything that decides whether work
needs redoing.

### D104: the meter reports tokens, not money

Every call now records what it cost, read off the API response rather than
estimated from row counts. A spend meter built on guesses is a second thing that
can be wrong about money.

No price is stored. A hardcoded rate goes stale silently, and a meter that is
confidently wrong about a bill is worse than one that reports tokens and lets
Paul apply the current rate himself. This is D65 applied to money: do not offer
a number whose correctness the app cannot maintain. The division is that the app
knows what it consumed and the human knows what it costs, and neither should
guess at the other's half. The table shows calls, input and output
tokens, broken down by job and by model, so a surprising bill can be traced to
the kind of work that caused it.

### D105: a shared calendar needs no new permission

`calendar.readonly` already lists every calendar the account can see, and that
includes every calendar anybody has shared with Paul. Confirmed on his real
account: three calendars, two his own and one with an access role of reader,
which is somebody else's diary already visible.

So subscribing to a colleague's calendar is not a feature this app has to build
a permission flow for. They share it in Google, which is ordinary office
behaviour, and it appears in the list. The only gate is the human one.

That is F14's "subscribe to whoever" delivered by scope design rather than by
building anything, and it changes what has to happen before it works: Dustin and
John sharing their calendars is a thing they do in Google, not an OAuth
conversation anybody has to have. The boundary does not move, though. Their mail
is still governed by the partner conversation, and nothing here touches it.

Nothing syncs by default. The list Google returns includes holidays, week
numbers and anything ever shared, and pulling all of it would fill the day view
with things nobody asked to watch. Each calendar is turned on deliberately, and
turning one off deletes the events it contributed, because a calendar Paul
stopped watching should not keep filling his day with entries he cannot trace.

The view is a list of days rather than a month grid. A grid is the wrong shape
for the question actually being asked, which is what is happening next and
whether anything collides with the work already planned, and a seven column grid
does not survive a phone.

### D106: decoding twice was the CPU ceiling

The third and last cause of the worker exceeding its limit during the body
re-read, and the one that actually fixed it.

Collecting both MIME alternatives was correct, and decoding both was not. The
walk decoded plain and HTML for every message and the caller then discarded one
of them, so half the most expensive operation in the ingest was work thrown
away. The walk now returns the encoded candidates and only the chosen one is
decoded.

With that, and the earlier input cap, the re-read ran to completion: 863 of 865
bodies now stored as HTML where they were previously stripped text. Verified on
a real urgent thread, which renders thirty seven paragraphs and nineteen real
links where it used to render a wall.

Three fixes for one symptom, and each looked sufficient at the time.

**A mitigation that reduces frequency is not a fix, and it is dangerous
precisely because it looks like one.** Cutting the batch size and capping the
decode input both made the failure rarer, and rarer reads as almost solved,
which is the point at which people stop looking. The cause was that both MIME
alternatives were decoded and one discarded: half the most expensive operation
in the ingest was work thrown away. Only removing that stopped it.

The test is whether the change removes the cause or reduces the exposure to it.
Both are worth having. Only one of them ends the bug, and calling the other one
finished is how a symptom comes back under load.

### D107: a job making no progress must not hold the whole budget

Caught before it ran, by checking what the cron would actually do rather than
assuming it would do the right thing.

`runMailMaintenance` gave the entire firing to the ingest whenever one was
unfinished, and fell through to triage only when none was. The re-read left the
ingest marked `running` with a cursor held, and every body had already been
stored, so each firing would have paged through two thousand listings, stored
nothing, and returned. The 187 outstanding triages would have waited
indefinitely behind a job that had nothing left to do.

The ingest now takes a share of the budget rather than all of it, and triage
always gets the remainder. Priority is right and exclusivity is not: a job that
should go first should not be able to starve one that should go second,
especially when the first one has quietly finished and nobody told the flag.

Worth stating as a rule: any dispatcher that picks one job over another needs an
answer to what happens when the preferred job stops making progress. Without
one, the failure is invisible, because a firing that did nothing and a firing
that was busy look identical in a log unless the log says which.

### D108: a named account that does not exist is refused, never defaulted away

The rule the whole of E1 hangs on, and the one place a scoping bug turns into a
leak that looks like it works.

`resolveAccount` takes the account a request names. If the name matches nothing
it is a 404, not a fallback to whichever connection came first. Falling back
would hand the caller a plausible answer about somebody else's mailbox with
nothing anywhere saying so, which is worse than an error by exactly the amount
that it is invisible.

With no name and one connection, that connection is used: a single-account setup
should not have to name itself. With no name and several, there is no sane
default, so the caller is told to say which rather than given one at random.

For rows reached directly, a thread or a message or a calendar, ownership is
asserted rather than filtered. A query that returns nothing and a request that is
denied look the same to a caller who guessed an id, but they are different
promises, and the second is the one segregation needs. The refusal is a 404
rather than a 403, because telling somebody a row exists but belongs to another
account is itself a small leak.

### D109: identity may be listed, content may not

Found by the segregation test refusing to pass, and worth the entry because the
easy fix would have removed the guarantee along with the failure.

`GET /api/connections` returns the account roster, so a picker can offer a
choice. That means it names every account, which the first version of the
segregation test called a leak. It could have been made to pass by dropping the
assertion.

The real line is narrower and stronger. Account IDENTITY may appear on the
roster endpoint and nowhere else. Account CONTENT, meaning mail, threads,
snippets, calendars and events, may cross nowhere at all. The test now asserts
both halves, and additionally asserts that the roster carries only identity
fields, because a content field would be least noticed sitting among legitimate
ones.

Every account is Paul's. The protection is not from him, it is from a query that
quietly widens and shows one client's correspondence while he is looking at
another's.

### D110: the calendar list was a leak that had already shipped

`GET /google/calendars` had no account filter. It returned every calendar across
every connection.

With one account that is invisible and harmless. The moment a second connects it
is a cross-account leak, and it would have arrived as one on the day
multi-account shipped rather than as a regression anybody would look for.

It was caught by the route classification hour, not by the code, and only
because two routes filed as "genuinely global" were read again rather than
trusted. The general shape: a query with no filter is correct exactly as long as
the data has only one of the thing it is not filtering on, and that is a
property of today's data, not of the code.

### D111: crossing accounts on request is a feature; crossing them by omission is the defect

The unified inbox reads every account at once, which is exactly what D110 was a
bug for doing. The difference is not the query, it is who asked.

`all` has to be typed. It is never the default and never arrived at by leaving a
parameter off, because the failure being guarded against is a query that widened
without anybody deciding it should. And every row it returns carries the account
it came from, so a unified list is never ambiguous about whose correspondence is
on screen. A unified inbox that did not attribute would be worse than none: it
would put one client's mail beside another's with nothing saying which.

The segregation suite asserts both halves. Scoped views stay clean, `all`
returns both accounts, and every row in the union names its account and names it
correctly rather than merely carrying the field.

**This governs every cross-account view, not only the inbox.** Search, digests,
a calendar union, anything the context engine reads across accounts, and
anything after it. Three conditions, all of them required:

1. The union is requested explicitly, by a value somebody typed.
2. It is never the default and never reached by omitting a parameter.
3. Every row names the account it came from, and the attribution is asserted
   correct rather than asserted present.

A view that meets one or two of these is not a partial success, it is the
D110 defect with better manners. The reason to write it as a rule now is that
the next cross-account reader will be built by somebody who did not watch the
calendar list leak.

### D112: the roster assertion stays exact

The segregation test pins the roster's fields as an exact set rather than
checking that content is absent. Adding the re-auth clock made it fail, which is
the assertion working: a new field on the account roster has to be looked at and
called identity before it ships, because the roster is the one endpoint allowed
to name every account and therefore the one where a content field would be least
noticed among legitimate ones.

Loosening it to a subset check would have made the failure go away and taken the
guard with it. This is the same instinct as D109, one level down.

### D113: no connected account is a state, not a failure

`/mail` returned a 500 when no Google account was connected.

That is the state every user is in before they connect one, and the state Paul
returns to the moment he disconnects the last account, which multi-account makes
reachable on purpose rather than only at the beginning. The page already knew
how to say that nothing had been read yet; it was simply never allowed to,
because the load threw on the API's honest 400.

Worth generalising: an empty precondition and a broken system produce the same
blank screen unless the code distinguishes them, and the one that is normal
should never be reported with the vocabulary of the one that is not.

### D114: most of a context engine is arithmetic, not inference

The E4 pre-audit found 21 of 775 threads are real correspondence, carried by 18
senders across 7 domains. That number decided the design before any budget
question was asked.

At that scale the contact graph falls out of the headers by counting. Who writes,
who Paul writes back to, how often, how recently, and the highest severity ever
attached to a thread they appear in. Asking a model to work that out would be
paying for arithmetic, and the counted version is exact where an inferred one
would be approximate.

The counting also produces the signal the expensive passes are then pointed at.
Paul had replied in 19 of the 21 correspondence threads, and on the seeded graph
he has replied to 13 of 17 contacts. That agrees with what triage decided
independently, and two signals agreeing is worth establishing before either is
trusted alone.

The rule is worth keeping past this feature: before adding a model to a problem,
find out how much of it is countable. Here it was most of it, and what remains
for the model is the part that genuinely needs judgement.

### D115: exclusions are a cost control, and a cost control with no test is a wish

Automated, newsletter and notification threads never enter the context engine,
and untriaged threads wait for triage rather than being read speculatively. That
single constraint is the difference between reading 2 MB and reading 36 MB, and
between a bill in cents and one in dollars.

It is also exactly the kind of constraint that decays without anyone deciding to
relax it. One more query written by somebody who did not know, and the engine
quietly starts reading job alerts. So it is expressed in one place, and the
suite asserts it holds.

The fixture is built to catch that specifically: the excluded threads carry
senders who appear nowhere else, so a contact derived from one of them is
unambiguous evidence rather than a coincidence of overlapping addresses.

### D116: tests written after the code must be mutation checked

These guarantee tests passed on their first run, because unlike the segregation
suite they were written after the code rather than before it. A test that has
never failed has not been shown to work.

So both were mutation checked. Removing the category filter fails six of eight;
removing the account filter fails the two segregation cases specifically. The
guarantees are real, not merely stated.

Writing the test first remains better, because it forces the failure to be
observed rather than manufactured afterwards. Where that did not happen, the
mutation check is the honest substitute, and skipping it would leave two
green tests standing in for two guarantees that had never been examined.

### D117: an AI pass is mostly not AI, and that part is testable today

The context runner had never executed, and it runs for the first time against
Paul's real mail under a shared spend cap. That is the worst moment to discover
the orchestration is wrong: a bad prompt costs one call, a bad loop costs all of
them.

So everything except the model's words was proved with the model stubbed. Which
threads it reaches for, that a second pass over unchanged mail does no work at
all, that one changed thread redoes exactly one thread, that it stops at its
call ceiling and says so, that a transient failure leaves no rows behind, that a
permanent one is counted and the pass continues, that every call is attributed
to the account that paid, and that re-reading a thread replaces its commitments
rather than stacking them.

The no-rework test is the one the cost model rests on. If a re-run redid the
work, the scheduled version would pay full price on every firing forever, and
the failure would look like an unexplained bill rather than a bug.

Same approach the Asana sync used. The lesson generalises: when a path cannot be
exercised end to end, find the part that can be, and be explicit about which
half remains unproven.

### D118: the runner refusing a job is not the runner failing

The first stub returned about fifty characters per message and the voice pass
skipped every time. It read as a defect and was the opposite: the runner
declines to learn how somebody writes from a one-line reply.

Better no voice profile than one inferred from "ok, thanks", because a
confident profile built on nothing then shapes every draft, and nothing
downstream would say where it came from. The fixture was lengthened and the
refusal was pinned by its own test rather than being lost to a longer fixture.

Worth remembering when reading a test failure: a component declining to act on
insufficient input looks identical to one that is broken, and only the reason
tells them apart.

### D119: D77 caught me again

Three of the runner tests leaned on state a previous test had left behind.
Inserting a new test between them, which called the fixture builder, wiped that
state and two tests failed for a reason that had nothing to do with the code
they cover.

This is D77 exactly, written by the person who wrote D77, four days later. The
rule was known and still not applied, which says the rule needs to be a habit at
the moment of writing rather than a thing recalled afterwards. Each test now
builds what it needs.

### D120: reconcile the status models now, because this is the cheapest it will ever be

Four entities carry four independent state vocabularies. `blocked` and `done`
appear in three, `waiting` only on action items, `in_review` only on tickets,
and projects carry status and PMI phase as separate axes. A workflow engine has
to compose steps across all of them, and today there is no shared idea of what
a step is or what finished means.

The pre-audit flagged this and hedged: three of the four are live in code, so
reconciliation looked expensive. The ruling reads the volumes the other way, and
it is right. Production holds 4 action items, 0 tickets, 0 projects. Live in
code is not the same as live in data, and reconciliation is only expensive when
there is history to migrate. Today it is a schema change over four rows. After
one real week it is a cross-entity migration over hundreds with meaning attached
to each.

The alternative was to wrap and translate, which would have encoded all four
vocabularies permanently and made every workflow step carry a translation table
forever. A compatibility layer is a decision to keep the problem.

One state machine: open, in_progress, waiting, blocked, in_review, done,
cancelled, with per-entity subsets. `ambiguous` becomes a flag on action items
rather than a state, because it describes confidence in the record, not where
the work has got to, and mixing those is why the vocabulary diverged in the
first place. Projects keep status and phase as orthogonal axes, which was
already correct.

### D121: Pillar 2 epic map, sequence fixed, estimates deliberately absent

| Epic | What |
| --- | --- |
| P2-E1 | Unified work state. Blocks everything below |
| P2-E2 | Workflows, F10. Definitions, instances, steps targeting tickets or action items |
| P2-E3 | Phase checklists and nudges, F8 |
| P2-E4 | Ticket to Asana path. Tickets have none; action items do |
| P2-E5 | Schedule intelligence, F2. Last, and estimate deferred |

Sequence: E1, then E2 and E4 in parallel, then E3, then E5.

**No hour figures.** The Pillar 1 audit reasoned from 865 real messages; this one
had 4 action items, 0 tickets, 0 projects and 0 time entries. The shapes are
solid and the volumes say nothing, so an estimate built on them would be built
on nothing. Deferred until one week of real work exists, which is the same
calibration rule that found the earlier pillar-level ranges inflated tenfold.

Generated workflow steps reuse the `meeting_action_proposals` shape rather than
a new proposal type. It already carries evidence, an ambiguity flag and a human
review gate, which is exactly what a generated step needs, and a second
proposal entity would mean two review surfaces to keep honest.

### D122: a nudge to anyone but Paul is a new send surface

Phase checklists want to nudge. Nudging Paul rides the existing digest and is in
scope. Nudging Dustin, John or any firm member is not a feature difference, it
is a category change: the app would begin sending mail to third parties.

That sits behind the partner gate with everything else firm-facing, and it is
worth naming separately because it does not look like a permissions question. It
looks like a reminder. The test is not what the message says, it is who receives
it, and the first message this app sends to somebody who did not ask for it is
the moment it stops being Paul's private tool.

## Interpretation notes

Not decisions. Judgment calls made inside an existing decision, recorded so the
reasoning is not lost and so nobody relitigates them as if they were open.

### The reports on-time rate was wrong in Mountain Time, and the existing code was already right

Found while verifying, not while reading. Two action items were marked done
through the API and then did not appear in the completion report at all.

`completed_at` is a UTC instant. The report window is a pair of Mountain Time
calendar dates. The first version filtered on `date(completed_at)`, which is the
UTC date, so anything finished after 6pm Mountain lands on the next UTC day and
falls outside a window that ends today. Both test items were completed at
05:09Z, which is 23:09 the previous evening in Denver. The report showed one
completed item where there were three.

The same bug sat in the on-time comparison, which measured a UTC date against a
deadline set on Paul's own calendar.

What makes this worth recording: the app already had the right answer. Both the
Today cockpit and the end-of-day digest bind `workingDayStartUtc(day)` and
compare instants, and the cockpit query carries a comment saying exactly why.
The new code was the outlier. Checking how the existing modules solved it,
before writing a fourth version of the same date logic, would have skipped the
bug entirely. D40's note that `workingDayStartUtc` is the reference
implementation was already there to be followed.

Fixed by bounding the window with `workingDayStartUtc(from)` and
`workingDayStartUtc(to plus one day)` as an exclusive upper bound, and deciding
on-time in JavaScript against the Mountain Time date of the completion, since
SQLite cannot apply a zone whose offset moves with daylight saving. Resolution
time became a rounded elapsed-day difference, which has no zone in it at all.

Verified after the fix: the completed count went from 1 to 3, and both items
resolved to Mountain day 2026-08-28 from a 2026-08-29 UTC timestamp, one on time
against a future deadline and one late against a past one.

### Reports headings skipped a level, caught by checking rather than by looking

The report body used `h3` for section headings under the page `h1`, on the
reasoning that the page title was the `h1` and sections sat below it. That skips
`h2`, which the accessibility baseline forbids outright.

It was invisible on screen, since `h3` was styled to look right, and it would
have stayed invisible. What found it was parsing the rendered markup of all nine
report routes and listing the heading levels in order. Moved to `h2`, rechecked,
and every route now reads h1 then h2 with no skips and exactly one h1.

The component carries a note that it must be mounted directly under a page h1,
because a shared component cannot see its own heading depth and the next person
to reuse it has no way to know.

### The /templates 500 leaked nothing, checked against a production build

Asked whether the outage exposed anything it should not have. It did not, and the
check is worth recording because the obvious way to run it gives the wrong
answer.

The failure was reproduced locally by renaming `templates` out of the way, since
fixing remote first would have destroyed the evidence. Results:

| Surface | Response |
| --- | --- |
| `GET /api/templates` | 500, body `{"error":"Something went wrong on the server."}` |
| `GET /templates` | 500, page renders `500` and `Internal Error` |
| Hydration payload | `error: {message:"Internal Error"}`, the same generic string |

No SQL text, no `no such table`, no table name, no D1 error code, no stack trace,
no filesystem path. The generic handler held at both the API layer and the
SvelteKit layer.

The reason this needed care: run the same probe under `vite dev` and the page
contains `/@fs/C:/Users/admin/Documents/command-center/...` paths. That is Vite's
dev-mode module loading, not the error handler, and reporting it as a leak would
have been wrong. So the scan was rerun against an actual production build via
`vite preview` on the built output, and the paths are absent there. Same shape as
the two earlier false alarms from grepping whole pages: the string was real, and
it meant nothing.

Deployed production was not probed directly. It sits behind Access, and the
locally built artifact is the same bundle Workers Builds produces from the same
tree.

### The cockpit cards show what is stored, not what the design mocked

The two held-back cockpit cards shipped once Meetings and Invoicing existed. Both
required deciding what to do about design content that has no schema behind it.

The design's meetings card shows clock times, "09:30" and "14:00", and an
"agenda drafted" state. `meetings` stores `meeting_date`, a date, and there are
no agendas. Rendering a time would have meant inventing one or leaving a mocked
value in place as if it were fact, which is what D27 exists to prevent. The rows
carry the client, the project, the count of proposals waiting on a decision and
the count of open follow-ups instead. All four are real and all four are
actionable, which the mocked time was not.

The invoice card is restricted to invoices actually past their due date. The
design shows a not-yet-due invoice alongside an overdue one, but a card called
"Invoice alerts" listing something inside its terms is not alerting to anything.
The bucket expression is the same one Invoicing and Reports use, and the cockpit
set was checked to be identical to the Invoicing screen's overdue set, values
included, so three screens cannot disagree about which band an invoice is in.

The client column on Projects is D27 read the other way round. It was previously
hidden when null, because at MVP there was no way to assign a client and every
row would have read "no client" against a feature that did not exist. Assigning
one is a real affordance now, so an unassigned project became a fact worth
showing rather than an absence to hide.

### A PM ruling does not exist for this session until it is relayed

R11, the freeze violation, was acknowledged and closed as contained in the PM
ledger at the time it was reported, with an additional structural rule attached.
None of that reached this session, so the violation was re-flagged in a later
report as unacknowledged, and the structural rule was absent from the work for
two more turns.

Nothing was wrong on either side. The ruling was made and recorded; it simply
was not relayed. The failure mode is worth naming because it is invisible from
both ends: PM sees a ruling on the record and assumes it is in force, and this
session sees silence and assumes the question is open.

So: a decision exists for this session when it arrives here, and not before. PM
will mark blocks intended for relay explicitly. This session, in turn, should
say plainly when it is treating something as unanswered rather than quietly
proceeding on its own reading, which is what re-flagging R11 did correctly by
accident.

Related to D60, which recorded the opposite direction of the same problem: there
the written record was right and the conversation drifted from it, here the
conversation was right and the record never travelled. Both are failures of
transmission rather than of judgement, and both are cheap to fix once named.

### Why the client saw a 2xx with a non-JSON body at all, OPEN

Parked on T-silent-writes deliberately, not chased.

D66 explains the silence completely: a 2xx whose body would not parse was
treated as success at all 26 write sites. It does not explain the body. Something
answered a `POST /api/action-items` with a 200 that was not JSON, and nothing in
the Worker does that. Every route returns `c.json(...)`, and a thrown error
returns a JSON error object.

The likeliest source is Cloudflare Access serving a sign-in page in place of the
API after a session expired. That would produce exactly this shape, would affect
every write at once, and would be invisible in the console. It is a recurring
condition rather than a one-off, so it will happen again.

Not confirmed, and deliberately not assumed, because assuming a plausible cause
from a matching symptom is what D67 was just written about.

**A 302 is what production returns to an unauthenticated write.** Confirmed
directly: `POST https://work.kabuhayan.app/api/backups/run` from outside the
Access session returns `302`. A browser follows that redirect, lands on the
Access sign-in page, and receives HTML with a 200. That is exactly the
2xx-non-JSON shape D66 describes, produced by the live system rather than by a
test harness.

This raises the Access explanation from plausible to mechanically demonstrated
as reachable. It still does not prove it happened to Paul on that occasion, and
the distinction matters: knowing a mechanism exists is not knowing it fired.

**The reload test narrowed it.** Paul reloaded and got the app, not a sign-in
wall, with all five duplicates present and the counts matching exactly: three
originals plus five copies, nothing extra and nothing lost. So the writes always
landed and only the view was stale, and whatever served the non-JSON body was
not a persistently expired session. A transient re-auth during a single request
window is still consistent with the evidence; a durably expired session is not.

That is a narrowing, not an answer, so the question stays open and the error
message keeps its hedge. Writing "session expired" as fact on this much would be
the same mistake in a smaller font.

What is already true regardless: the next occurrence shows an error rather than
nothing, and that error names the likely cause and tells the reader to check
whether the change saved before repeating it, which is the specific mistake that
produced five duplicate rows.

### The ambiguity backstop is untuned, and deliberately so

Paul's ruling after the first live extraction, recorded late because it was
made in conversation and never written here.

The backstop marks an item ambiguous whenever the owner or the deadline is
missing, whatever the model claimed. Whether that threshold is right is
unknown. The one real transcript tested against it was an interview-shaped
call that produced a single action item, and a call type that produces one
item cannot show whether the rule floods a busy call with flags.

So it stays as built. Tuning it against a call that cannot exercise it would
be fitting the rule to the wrong data. It waits for a task-heavy client call
transcript, and the tuning happens then or not at all.

DRI Paul, to supply the transcript. No code changes until one exists.

### pkill does not work here, and it cost a debugging cycle

`pkill -f "vite dev"` silently does nothing on this machine. It exits cleanly,
matches nothing, and kills nothing.

The consequence was not theoretical. Three dev servers ended up running at once,
on 5173, 5174 and 5175. The oldest predated the R2 binding, requests went to it,
and `c.env.FILES` came back undefined. That read as a broken R2 integration for
one debugging cycle when the integration was fine and the server was stale.

Two things follow, both already implied by the one-dev-server note and now made
concrete:

- Stopping a dev server is a PowerShell job: find the listener with
  `Get-NetTCPConnection -LocalPort <port> -State Listen` and `Stop-Process` its
  owning PID. Verify the port is free afterwards rather than assuming.
- Start dev with `--strictPort` so a port collision fails loudly instead of
  quietly moving to the next port and leaving two servers disagreeing about
  which bindings exist.

### Favicon: a gold square on navy, matching the sidebar mark

The design says plainly that no logo exists and that a mark must not be
invented. The favicon is therefore not a new mark: it is the gold square already
in the sidebar, on the navy the sidebar already uses. Nothing was designed, only
relocated. The Svelte logo it replaces was scaffold residue and was never ours.

### One dev server at a time

Following the spirit of D31. When the wrangler target changed, a stopped dev
server left its child process holding port 5173 while a new one came up on 5174,
so two servers were live against the same local D1. That is the same class of
problem D31 records: two things disagreeing about which local database is real.
One dev server, and if a port is held, find the process and kill it rather than
letting Vite silently pick the next port.

### workingDayStartUtc is the reference implementation for the digest work

The Cron digests are UTC only and have to convert Mountain Time and survive DST.
That conversion is already solved and already tested in `src/lib/server/dates.ts`.
Do not re-derive it when building the digests.

`workingDayStartUtc(day)` returns the UTC instant at which a Mountain calendar
day begins. It checks both candidate offsets and keeps the one that formats back
to 00:00 on that date in the zone, which is what makes it correct on the two DST
changeover days. An earlier version read the offset at midday and was an hour
wrong on exactly those two days.

The boundary tests that matter, and that any digest work should reproduce
against its own schedule:

| Date | Expected | Why |
| --- | --- | --- |
| 2026-08-28 | 06:00Z | MDT, UTC-6 |
| 2026-01-15 | 07:00Z | MST, UTC-7 |
| 2026-03-08 | 07:00Z | Spring forward day. Midnight is still MST |
| 2026-11-01 | 06:00Z | Fall back day. Midnight is still MDT |

Verified through the API as well as in isolation: an item completed at 05:59Z on
2026-08-28 counts as zero done today, and one completed at 06:01Z counts as one.

### Projects ships three of the design's panels short

`ProjectDetailScreen.jsx` shows a phase checklist and panels for Meetings, Time
and Invoices. None are built:

- The checklist has no data model. Adding one is a table and a module of its own,
  not part of "five phases, status, next milestone".
- Meetings, Time entries and Invoices are later stages. Per D27 they are neither
  built nor referenced.

`ProjectsScreen.jsx` also shows a client column. `client_id` exists on the row
and stays unconstrained per the Stage 1 foreign key pattern, but nothing can set
it until Clients exists, so the column would read "no client" on every row. It is
omitted rather than shipped empty. Tracked as T-clients-0.

### Money is stored as integer cents, and aging is never stored

Two deviations from the field names in architecture section E, both in migration
0004.

`amount` and `amount_paid` become `amount_cents` and `amount_paid_cents`, stored
as INTEGER. Binary floating point cannot represent most decimal money values
exactly, so summing invoice totals in REAL drifts, and an aging report that does
not add up is worse than no aging report. The name carries the unit so nobody
has to guess. Hours stay REAL, because billing is done in quarter-hour
increments, which are exactly representable, and hours are summed for display
rather than for money.

`aging_bucket` is listed in section E as a derived field and is treated as
exactly that: computed at read time, never stored. A stored bucket is wrong the
morning after it is written. The same reasoning removes "overdue" from the
invoice status enum: an invoice is overdue when it is unpaid and its due date
has passed, which is a question about today, not about the row. Status stays
draft, sent, partial or paid, and overdue is derived alongside the bucket.

The band totals on the Invoicing screen are computed by grouping the same
derivation the rows use, in one query, so the bands and the list cannot
disagree. Verified by recomputing every band from the rows and comparing.

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

### R7: digest deliverability is unverified, OPEN

The live send worked and the email arrived. Where it arrived is not recorded:
inbox, spam or promotions was left unfilled when the result was reported.

This matters more than it looks. `onboarding@resend.dev` is a shared sender used
by every Resend account without a verified domain, which is exactly the profile
mail providers filter hardest. A digest that lands in spam does not fail loudly.
It fails by being absent, on a screen nobody is looking at, which is the failure
mode this whole product exists to prevent.

Mitigation available, not yet taken: verify kabuhayan.app in Resend and move
`DIGEST_FROM` to an address on it. A verified domain with SPF and DKIM is the
single biggest lever on placement.

**Day one, 2026-08-29.** Both digests delivered cleanly, morning and evening.
Placement is not a useful signal on this account: Paul runs his own Gmail label
automation, so where a message lands reflects his rules rather than the
provider's spam judgement. What the day does establish is delivery, twice,
from `digest@kabuhayan.app` on a domain verified with DKIM and SPF.

That changes what this risk can ever close on. The original fear was a digest
silently landing in spam, and label automation means the inbox is not evidence
against that. The honest remaining test is absence: a digest that fails to
arrive at all, or arrives late enough to be useless, over several days. One
clean day is one data point toward that and not a closure.

Closes when Paul confirms delivery over several days, not after one. Record each
day here.

### R8: log evidence for a cron incident was unreachable, AMBER, MITIGATED

Found while preparing the 13:00Z evidence pull, roughly three hours before the
firing rather than minutes after it. Workers Logs cannot be read with this
session's credentials: the wrangler OAuth token has no observability scope and
the telemetry endpoint returns 403, isolated from expiry by a control call on
the same token in the same minute.

Severity is Amber rather than Red because the window is 3 days, not minutes, and
because two paths exist. Mitigated by D61: Paul reads the dashboard tonight, and
a scoped Workers Observability Read token goes on the books so the next incident
does not meet the same wall.

Worth recording as a near miss rather than a defect. Nothing was broken. The
finding is that the tooling to close an incident was never checked until an
incident needed it, which is the same shape as the cron path that had never run.

Closes when the scoped token is in place and a log read has been done with it.

### R9: Asana link ambiguity. CLOSED 2026-08-29, superseded

The risk was that the task visible in Asana might or might not be the one the
app created, leaving D55's permalink question unanswerable. Dissolved by the
evidence: there is no app-created task, because there has been no push.

Superseded by T-asana-first. A fresh run produces the gid, the permalink answer
and the row closure together, and needs no reconstruction of what happened
before.

### R10: seeding production for volume testing would have contaminated the digest evidence. AVERTED

Logged so that nobody helpfully does it later.

The natural way to test how the screens look under load is to put load into the
database. Doing that on production, on 2026-08-29, would have put fabricated
overdue items and past-due invoices into the 13:00Z digest, in the one firing
the entire day had been arranged to observe, and the resulting email would have
been indistinguishable from a real one reporting real fires.

Averted by ruling before acting, not by catching it afterwards. Volume testing
is local only until the digest evidence is pulled. See D62.

The general shape is worth keeping: when a test needs realistic data and a
scheduled job reads the same store, the test and the evidence are in direct
conflict, and the job wins.

### R11: freeze violated by a branch level push. CLOSED 2026-08-29

The cron wiring was held off `main` as its own commit and pushed anyway, because
the ledger commit landed on top of it and `git push` with no refspec sends the
whole branch. The earlier push had used `git push origin <sha>:main` correctly;
this one did not.

Live for 78 seconds, 09:53:32Z to 09:54:50Z. No firing ran against the wrong
expression: 09:00Z had passed 53 minutes earlier and 10:00Z had not arrived. The
deployed cron was confirmed back to `0 0,13,14,23 * * *` by API, with 183
minutes of margin to the firing.

Acknowledged and closed as contained in the PM ledger at the time of report,
which did not reach this session until later. See the relay note in the
interpretation notes.

The lesson is mechanical, not attentional. A hold enforced at commit level and
released at branch level is not a hold. Either the held work stays out of the
branch entirely, or the push is always explicit about what it sends. Reverted by
`e5c373a`, which keeps `ab5c786` in history so re-applying it is a revert of the
revert rather than a rebuild.

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

### O3: the partner time baseline has not been captured, DRI Paul

The v2 partner-hours-saved dashboard cannot be built honestly until this exists.
D52 explains why: the architecture's own method starts by time-auditing the
partners' pre-handoff minutes per task type in 15-minute increments, and a
headline "hours reclaimed" computed against an invented baseline looks like
evidence while being a guess.

Paul owns this and is starting it the week of 2026-08-31 as a running
15-minute-increment note. It accrues in the background; nothing in v1 waits on
it.

What the dashboard will need when the time comes: per-task-type baseline
minutes, the volume handled, the time spent briefing and reviewing, and a
separate slips-caught register with a conservative rework-hours-avoided figure
against each entry. Those are the `TimeSavedLog` and `SlipsCaught` tables in
section E, and neither is created until there is real data to put in them.

## Stage gates

### Stage 1: CLOSED 2026-08-29, re-closed 2026-08-29 on corrected evidence

The threshold from the build plan was: Paul can log in by emailed PIN and create,
read and update action items that persist in D1. That is met.

| Requirement | Evidence |
| --- | --- |
| Scaffold, Hono API, D1, KV | Worker version f6d05619 deployed with `env.DB`, `env.SESSIONS`, `env.ASSETS` all resolving from wrangler.toml |
| Custom domain | work.kabuhayan.app attached and serving |
| Access OTP | Incognito hits the Access wall, the One-Time PIN option is offered, a code is delivered to pacardopaul18@gmail.com, accepted, session lands on Action items. Re-verified 2026-08-29 after the IdP correction below |
| Action Items end to end | Create, read, edit, mark done, reopen and delete, all persisting. Exercised by hand in the browser as well as by API |
| Schema through migrations only | `0001_init_action_items.sql`, applied local and remote. No hand editing of any live database at any point |

#### Correction to the first closure, and the IdP history

The first closure of this gate recorded the criterion as met on the strength of a
successful Access login. That was not good enough. The criterion in the build
plan is specifically "log in by **emailed PIN**", and at that moment the login
that succeeded was not the One-Time PIN flow.

What actually happened: Zero Trust onboarding auto-added the **Cloudflare SSO**
identity provider, which displaced One-Time PIN as the default. The first
verified login went through Cloudflare SSO. The wall was real and the policy was
real, so R6 was genuinely closed, but the specific Stage 1 criterion was not the
one that had been demonstrated.

Fixed by adding One-Time PIN at the team level. Both providers are now active and
both are gated by the same single Paul-only email policy. Re-verified from a
fresh incognito session on 2026-08-29: the PIN option was offered, the code
arrived at pacardopaul18@gmail.com, the code was accepted, and the session landed
on Action items.

Worth stating because it changes where the security actually lives: the identity
provider list decides *how* somebody can attempt to log in, and the Access policy
decides *who* gets through. Two providers are active, not one, which was not in
the locked decisions. That is acceptable precisely because neither provider
grants anything on its own; the email policy is the gate. Adding a third provider
would still be safe for the same reason, and would still need a note here.

The lesson recorded: "the login worked" is not evidence for "the login worked by
the method the gate names". Verify the mechanism, not just the outcome.

#### Scope notes

Two things carried out of Stage 1 that were not in its scope. The design system
was ported (D19 to D28), which was pulled forward because restyling later would
have meant redoing the module. And the deploy target moved from Pages to Workers
(D29), which was forced by how the project got created.

Two things deliberately left undone. R2 is deferred to the v1 gate (D15,
T-v1-0). No auth UI exists and none will (D25).

Next is the MVP stage: Today cockpit, Projects with the five PMI phases, SOP
library with version history, Invoicing with aging, and the start-of-day and
end-of-day digests via Cron and Resend.

### MVP: CLOSED 2026-08-29

The build plan defines the MVP as the Today cockpit, Projects on the five PMI
phases, the SOP library with version history, Invoicing with aging, and the
start-of-day and end-of-day digests via Cron and Resend.

| Requirement | Evidence |
| --- | --- |
| Today cockpit | `/` renders overdue, due today, and what will slip, each band seeded and checked separately. Ordering verified: ambiguous, blocked, stalled, due soon |
| Projects, five PMI phases | Grouped list with per-phase counts, phase rail, advance-to-next, status control. Verified create, advance planning to executing, set at risk to on track, edit milestone |
| SOP library with version history | A SOP edited twice shows three versions with correct change notes, measured from the rendered page: v1 three steps, v2 four, v3 five. Restoring v1 produced v4 matching v1 exactly. Immutability and forward-only enforced by triggers and verified by attempting the forbidden write |
| Invoicing with aging | Period with four entries, 14.25 billable of 16.25 hours, walked open to reconciled to invoiced. All four aging bands populated, every band total recomputed from the rows and matched. Boundary exact: 30 days lands in 0 to 30, 31 days lands in 31 to 60 |
| Digests via Cron and Resend | Live deployment reports `Handlers: fetch, scheduled` and `Secrets: RESEND_API_KEY`. Live send returned sent, subject "Command Center start of day: nothing overdue", email delivered. DST simulated across four windows: every Mountain day gets exactly one morning and one evening |
| Schema through migrations only | Migrations 0001 to 0004, applied local then remote as one batch behind a snapshot. No hand editing of any live database at any point |

#### The half of the threshold that is not mine to declare

The architecture doc's threshold is "you're using it daily and receiving
digests." The second half is evidenced above. The first half is not, and cannot
be after one day. It is Paul's to confirm over the coming weeks, and if daily use
does not happen the honest response is to find out why rather than to treat this
gate as settled.

#### Scope record

Pulled forward, not in the MVP list:

- **Clients**, shipped thin but complete in the Invoicing pass. Invoicing needs a
  real clients table, and a table with no screens is a phantom. D37.
- **The design system port**, D19 to D28, done during Stage 1 because restyling
  afterwards would have meant redoing the module.
- **Global quick add and the N shortcut**, built with the cockpit because the
  architecture lists quick add as part of it, and because it made a brand-voice
  string true that had been blocked. D27.

Deferred, each with its revisit point:

- **Today's meetings and invoice alert cockpit cards.** The design's cockpit has
  four cards; two read from Meetings and Invoicing as modules that did not exist
  when it was built. The invoice card is now buildable and is v1 work; the
  meetings card waits for Meetings. D27.
- **The project phase checklist** and the Meetings, Time and Invoices panels on
  the project detail screen. No checklist data model exists, and adding one is a
  module of its own.
- **Markdown rendering** for SOP bodies. Deferred to v1 so one renderer and one
  sanitiser decision covers SOP bodies, meeting summaries and AI-drafted content
  together. D36.
- **R2**, to the v1 gate, T-v1-0. Nothing before v1 writes files, and a payment
  method already exists so the task is dashboard clicks plus restoring a binding.
- **The client column on the projects list**, omitted rather than shipped reading
  "no client" on every row. Now unblocked, since Clients exists.

Carried as owed work:

- **T-meetings-0**, rebuilding `action_items` with a real `meeting_id` foreign
  key when Meetings lands, following the D38 stash-rebuild-restore-verify
  standard.
- **R7**, digest deliverability, open until placement is confirmed over several
  days.

Next is v1: Meetings with transcript import, AI summary and action item
extraction; Templates with AI drafting; Reports with PDF export; and the one-way
Asana push.

### v1: PENDING, five verifications outstanding with Paul

The build plan defines v1 as Meetings with transcript import, AI summary and
action-item extraction; Templates with AI drafting; Clients; Reports with PDF
export; and the one-way Asana push. Clients shipped early in the Invoicing pass
under D37, so it is carried below as already evidenced rather than rebuilt.

This gate is written out in full before it can be closed, so the five items
Paul is verifying are visible as gaps rather than as blanks nobody counted.

| Requirement | Evidence | State |
| --- | --- | --- |
| Meetings, transcript import | Transcript stored in R2 and referenced from D1, verified by a round trip. `action_items` rebuilt with a real `meeting_id` foreign key under the full D38 standard, migration 0005, rows byte-for-byte identical and bogus ids rejected | EVIDENCED |
| Meetings, AI summary | Live run on a real 12,236 character client call. Summary produced and reviewed. Two defects found and fixed: F1, two employers merged into one, guarded in the prompt; F2, an em dash in the output, fixed by enforcement in code rather than a louder prompt, D48 | EVIDENCED |
| Meetings, action item extraction | Same live run. 1 proposal, correct for the call type. Zero hallucinated commitments. Evidence quote verified verbatim and to the right span, so the confabulation check passed. Accepted unresolved and routed to ambiguous as designed, D45 and D46 | EVIDENCED |
| Templates with AI drafting | Module live, drafting endpoint returns and stores nothing, D49. House style enforced on every AI output path from the start rather than patched in | PENDING, Paul retesting the voice register with a real exemplar |
| Clients | Shipped in the Invoicing pass, D37. Client created through the UI, project assigned, foreign key verified to reject a bogus id on both INSERT and UPDATE | EVIDENCED |
| Reports with PDF export | Four of the five in section D. Aging cross-checked against the Invoicing screen: identical in all four buckets, totals reconciling four ways. Screen and print verified to render identical figures across all four reports. Partner time saved deliberately absent, D52 | PENDING, Paul checking the live screens |
| One-way Asana push | Built per D4 and D55. Explicit per item, 409 on a second push, and verified to write nothing on failure: with an invalid token the item kept its title, status, deadline and null gid and could still be marked done and reopened. Live 401 from Asana mapped legibly | **EVIDENCED 2026-08-29.** Post-fix push succeeded: the task is visible in Asana My Tasks, assignee Paul Pacardo, due Monday. D-asana-1 confirmed fixed by the same run. One datum still owed for D55, whether the returned link was Asana's permalink or built from the gid |
| Markdown rendering, D36 | One renderer across SOPs, meeting summaries and drafts. Safe by construction rather than by filtering, D44. No `{@html}` anywhere in the app | EVIDENCED |
| Schema through migrations only | Remote at 7 of 7, `0007_templates.sql`. One incident where code shipped ahead of its migration, root-caused and fixed by an ordering rule plus a drift detector, D50 | EVIDENCED |
| Digests actually arriving | Cron trigger registered and correct. Observability enabled. Handler awaits its send and logs every firing. Cron path exercised across all four hour cases and the failure case | PENDING, the 13:00Z firing is the first eligible one in the app's history |
| Digest deliverability, R7 | `DIGEST_FROM` moved to `digest@kabuhayan.app`, a domain verified in Resend with DKIM and SPF. The one message ever sent, from the shared `onboarding@resend.dev`, landed in the inbox rather than spam, confirmed 2026-08-29 | PENDING. That message closes the search task but not R7: it was a different sender and a single day. Placement from `digest@kabuhayan.app` over several days is still owed |

#### The threshold, and the half that is not mine to declare

The architecture doc's v1 threshold is that meeting-to-action-item time drops
noticeably. Nothing above evidences that. The pipeline works and one real
transcript went through it end to end, but a single run is not a trend, and the
claim belongs to Paul after he has taken several meetings through it.

Recorded here so that the gate cannot be closed on build evidence alone, which
is the same reservation entered against the MVP gate and for the same reason.

#### What this gate is explicitly not claiming

- That extraction quality holds on a task-heavy call. The one live test was an
  interview-shaped call that produced a single action item, which cannot
  exercise flag flooding. The ambiguity backstop is untuned and stays untuned
  until a task-heavy transcript exists to tune it against.
- That the digest lands in an inbox. See R7.
- That daily use has happened. See above.

### D123: a screen nobody opened under the condition it was built for

CR-1's guarantee tests were written before the redesign and run against the old
views first, as a regression harness rather than a description of new code. Three
passed, two failed, and the failure was not cosmetic: the thread detail page
never passed the account through. Page load, body fetch and all five writes
threw as soon as a second account existed.

E1 shipped multi-account. That screen was never once opened with two accounts
connected, and with one account `resolveAccount` defaults, so everything looked
correct for as long as the condition the feature exists for was absent.

The rule is not "write more tests". It is that a foundation change has to be
exercised on every surface that consumes it, under the condition it introduces.
E1's own suite passed throughout, because it tested the routes and this was a
caller. Segregation tests at the API layer do not protect the views.

### D124: the archive count, and two ways to describe the wrong set

The redesign asked the list endpoint a question nobody had asked before: how
many threads are archived. It answered with the inbox total.

`counts` is pinned to non-archived rows, which is correct for what it feeds, the
severity chips. Requesting it with `archived=true` therefore returned inbox
numbers, and summing them looked exactly like an answer, because both are just
numbers with no unit attached. The same fault ran the other way too: while the
reader was looking at the archive, the chips were counting the inbox.

Both fixed at the source. Counts follow the toggle, and the archive total is its
own query, because it is its own question and cannot be read off a block that
describes whichever side is on screen.

The general point is D85 again in a different costume. A number that is
plausible is not a number that is verified, and the way to tell them apart is a
fixture where the two candidate answers cannot coincide. Three inbox and two
archived, deliberately unequal, is the whole test design.

### D125: the parser test and the page test are different guarantees

The renderer withholds remote image sources until the reader asks, because a
remote image in mail is a tracking pixel as often as a picture. That was built,
with the right copy, and had one test: which sources survive parsing.

That is a different question. It governs what is kept in the tree, not whether
the browser is ever pointed at it. Between the two sits a template, and the
template is where the guard actually lives. So the guarantee was asserted at the
layer that can violate it: a real HTML body seeded into R2, a listener on
outbound requests, and a check that the host is never called before the reader
asks and is called once they do.

Mutation checked both ways, which matters more than usual here. Removing the
hold fails it, and so would silently dropping images altogether, which is the
way this test would otherwise have passed for the wrong reason.

### D126: a label is not worth a schema change

The prototype labels a draft by how it was written, from the thread or from
Paul's own words. The drafts table has no column for that.

The label is held for the visit and falls back to plain "Draft" on reload,
rather than adding a column, a migration and a remote apply so a caption can
survive a refresh. On reload the app does not know, and says the thing it does
know instead of asserting an origin it cannot support.

### D127: a segregation guarantee covers page loaders, not only routes

From F1. E1 shipped a 13-case segregation suite and it passed throughout, while
the thread detail page never passed the account through at all. The suite tested
API routes. The defect was in the caller.

A correctly scoped route reached by a page that never passes the scope is still
a broken surface, and in the general case a leak: the route can only enforce
what it is told. So the rule is that segregation guarantees are asserted at the
layer the reader actually meets, page loaders and server load functions
included, and never only at the routes beneath them.

What makes this class hard to see is that a single connected account masks it
completely. `resolveAccount` returns the only account when none is named, so
every unscoped caller looks correct until the second account exists, which is
the exact condition the feature was built for.

Two more loaders are in this class today, found while recording this rule and
deliberately not fixed, because nothing further was authorized before the reset:
`src/routes/meetings/+page.ts` and `src/routes/settings/+page.ts` both fetch
account-scoped data without naming an account. Neither leaks and neither
crashes: `resolveAccount` refuses rather than guessing when more than one
account is connected, and both loaders treat a non-ok response as null. They go
silently blank instead. Settings is the worst place for that, because settings
is where the calendar list and the mail ingest progress live, and where somebody
would go to work out why the rest of the app had stopped showing them.

Production has one account, so there is no exposure today. Logged, not fixed.

### D128: rendered verification is mandatory on every UI epic

D124 and D125 were both found by rendering the screens and looking at them.
Neither was visible in the code: the archived count read as a plausible number,
and the image hold read as correct because the guard was there, just tested one
layer away from where it lives.

So a UI epic is not complete on a green suite and a clean typecheck. Both
screens get rendered, at the desktop width and at 412px, and looked at against
the design. That check has now earned its place twice in one epic.

It is also cheap, which is the argument for making it a rule rather than a
practice. A scripted render with a synthetic fixture, at both widths, with a
horizontal-overflow assertion and a page-error listener, is a few minutes and it
caught a fault that would have shown wrong numbers on every archive view.

#### AMENDED 2026-09-01: the widths are 1920 and 412, never 1440 alone

The original entry said "the desktop width", which is not a width. Twelve pages
were then rendered at 1440 and 412 and shipped centred inside a 1200px cap,
because at 1440 that cap leaves 120px each side and reads as padding. At 1920 it
leaves 248px each side and is unmissable.

This is the second time the same defect reached Paul by the same route; D129 had
already named 1440 as the width where a cap hides, and the entry that mandates
rendering did not carry the number.

So the number is in the rule now. **A fidelity pass renders at 1920 and at 412.**
1440 is specifically excluded, because it is close enough to the cap to make a
capped page look deliberate.

The general form: a rule that says "look at it" must say what to look at it on,
or the person following it will pick the setting where the fault is invisible.

### D129: full width is a route-level opt-in, never a change to the cap

From CR1-F4, which Paul raised by looking at the screen at his own width.

The app shell caps every page at 1200px and centres it. That is right for a
single column of prose and tables, and wrong for Mail, which is a wide left
column beside a fixed 380px rail: the cap pushed both into the middle and left
the rail floating away from the edge it belongs against. The build was centred
where the design is full width.

The rule is about the fix, not the defect. Raising `--content-max` would have
reflowed Dashboard, Projects, Invoicing and Reports to correct one screen, and
every one of those would have needed re-checking. So a page opts out of the cap,
the route decides rather than the page, and the change is proved by measuring
both sides: Mail reaches the right edge, Action items is still exactly 1200.

Worth naming why it survived the CR-1 fidelity pass. That pass rendered at
1440px, where a 1200px cap leaves margins narrow enough to read as padding. The
defect was only obvious at Paul's width. D128 says render and look; this adds
that the width you look at is part of the test, and a cap is invisible at any
width close to it.

### D130: the ledger books in USD, and says so per row

The firm is US-based and books in USD. Paul works from the Philippines, which is
where the temptation to default to PHP comes from, and it is the wrong reason: a
location is not a ledger. USD is the default on the entry form.

Recorded because it was chosen rather than assumed, and because a default that
nobody wrote down reads later as an accident. Per-client currency override is
E2/E3 scope and deliberately not now.

The currency is still carried on every row and required by the API, which is the
part that matters. A default decides what is convenient; the column decides what
is possible. Nothing else in the schema has a currency column, so the first row
in a second currency is the moment every total that ignored it silently became
wrong, and the ledger is built so that cannot happen: totals group by currency
and the response has no combined figure to misread.

### D131: four guards on the ledger, each against a plausible number

Recorded together because they share a shape. None of these prevent a crash.
Each prevents a number that looks finished and is wrong.

Amounts are positive and the category's kind carries the sign. A stored -40
expense would subtract twice once the kind is applied, and the result is money
with a minus in front of it, which reads as correct.

A transaction naming a client and a project must name the project's own client,
refused by a trigger rather than by the route. The route is not the only writer:
an import, the E2 posting job, or a hand-fix all bypass it, and a row whose
client and project disagree cannot be explained by any report that groups by
either one.

`source_invoice_id` carries a unique partial index before anything posts to it,
so a retried payment post cannot double count. Built ahead of the code that
needs it, because the failure it prevents is silent revenue.

Neither table carries a `connection_id`. Every table added since multi-account
has carried one and the habit is the risk: these are Paul's books, not
per-mailbox records. A test asserts the absence, because a habit is not stopped
by intending to stop it.

### D132: an idempotency guard is keyed on the event it guards

P3-E1 put a unique partial index on `ledger_transactions(source_invoice_id)` to
stop a retried post from double counting. Self-caught in the E2 pre-audit,
before anything posted, with no production rows affected.

The guard was keyed on the invoice. The event it guards is a payment. One
invoice can receive several, so the index did not make a retry safe: it made the
second partial payment impossible to post. 110 of 900 seeded invoices are part
paid, so the case it forbade is the ordinary one.

The reason it happened is the part worth keeping. When E1 was written there was
no payment record at all, only a cumulative `amount_paid_cents` on the invoice.
A guard was designed for an event the schema could not name, so it attached
itself to the nearest thing that had an id. The rule: the event has to exist as
a record before a guard against repeating it can be designed, and if there is
nothing to key it to, that absence is the finding rather than an inconvenience
to work around.

E2 fixes it properly. `invoice_payments` holds one row per payment with its own
date and amount, the index moves to `source_payment_id`, and the invoice-level
uniqueness is dropped because it now encodes the wrong invariant.

### D133: a derived figure is derived in the database

`invoices.amount_paid_cents` was set directly by a PATCH that trusted its
caller. It is now recomputed by trigger from `invoice_payments` on every insert,
update and delete, and the route that set it absolutely refuses with a pointer
to the route that replaces it.

In the database rather than in the route, because the route is not the only
writer: an import, a correction by hand, or a future posting job all bypass it,
and a paid total that has drifted from the payments behind it is wrong in a way
no screen shows. The delete case is included deliberately, since a removed
payment that left its money on the invoice would be revenue nothing supports.

Recording a payment as an event rather than a new total also restores something
cash basis needs and the old shape destroyed: the date the money arrived. A
ledger entry dated when someone happened to edit an invoice is not a cash-basis
record.

### D134: changing a route's contract requires a caller audit, exercised in a browser

P3-E2 retired the PATCH that set `amount_paid_cents` directly, correctly: the
figure is derived now. The invoices screen was calling it. Retiring the route
without rewiring the screen would have shipped a Record payment button that
failed on every press, and the API tests would all have passed, because they
call the new route.

So: before a route's contract changes, every caller of it is found and updated
in the same change, and the caller's path is exercised through the browser
rather than only through the API. The API test proves the new route works. It
cannot prove the button still does.

Cheap to do and it has now caught one: `grep` for the route and for the field
name, then click the thing. The field in this case still said "Total paid to
date", which was also the old shape written into the label, so the audit
returned both the broken call and the wrong words at once.

Related to D123, which is the same failure from the other end: there, a screen
was never opened under the condition the feature introduced; here, a screen was
never opened after the contract beneath it moved.

### D135: one recorder, and an unknown model priced as the dearest

The spend meter read zero while the app had summarised 583 threads. Two causes.
The drafting route recorded nothing at all, and it is the most expensive call
the app makes. The recorder that did exist omitted `connection_id`, while a
second recorder in `context.ts` set it, which is how two writers to one table
came to disagree about what a row contains.

One recorder now, in `ai-usage.ts`, used by every path, with every field. A
failed write is caught and returned rather than thrown: losing the meter must
not lose Paul the answer he already paid for.

Cost is computed beside the recorder from the tokens the API reported, and an
unknown model is priced as the dearest known one. A model nobody has priced
would otherwise read as free, and free is the direction that flatters.

Pillar 4 is a cost decision before it is anything else, and a ceiling nobody can
read is not a ceiling.

### D136: the rules decide the bill, not the prompts

Measured on the real mailbox rather than estimated. Of 865 messages, Gmail had
already filed 201 as Promotions and 537 as Updates, and Paul had written in 19
threads out of 775. Applying the rules to the live corpus: 88 messages are
correspondence and 355 are bulk by Gmail's own labels or a no-reply sender.

About one message in ten needs a model, decided by data the app already stores
and pays nothing for. That single fact is worth more than any prompt tuning.

Two deliberate asymmetries. Anyone Paul has written to is correspondence
whatever Gmail thinks, because filing a client's invoice as a newsletter loses
an obligation and saves a fraction of a cent. And Updates get their own class,
embedded so they can be found but never summarised: a receipt does not need a
paragraph written about it, it needs to be findable when somebody asks what was
paid.

### D137: a refusal is not a quiet success

The pilot could not run: the Anthropic account had reached its usage limit. The
route reported that as `ok: true` with every count at zero, which reads as
"there was nothing to do" and is the opposite of what happened.

The stop reason is now carried in the outcome and says which of the two it is: a
usage limit that will not clear until it resets, or a brief unavailability that
will resume by itself. The distinction matters because one is worth waiting for
and the other is worth telling somebody about.

Same class as D113 and D124: a real condition reported with the vocabulary of
nothing having happened. It keeps recurring in this app because the honest
report and the empty one look identical at the call site, and only the caller
can tell them apart.

### D138: success with all-zero counts must say why it is zero

The third appearance of one class, so it becomes a review item rather than a
lesson learned again. D113 reported an empty precondition with the vocabulary of
a broken system. D124 reported the inbox total as the archive total. D137
reported a hard refusal as a successful run with nothing to do.

The rule, stated once for every job written from here:

A refusal, an outage, and a genuinely empty result are three different answers
and must be distinguishable at every call site. Any path that returns success
with all counts at zero states why they are zero.

The reason this keeps happening is worth naming, because intending not to do it
has now failed three times. At the point where the counters are returned, all
three cases look identical: a loop ran and incremented nothing. The information
that separates them exists only where the loop stopped, and it is thrown away by
returning a bare number. So the fix is structural rather than careful: the
outcome type carries the reason, and a caller that wants to report "nothing to
do" has to have been told that is what happened.

Added to the review checklist for every new job: if this can return zeros, can
the caller tell which zero it is.

### D139: an INSERT-only guard is complete only until something can UPDATE

0019 enforced the ledger's category rules with BEFORE INSERT triggers: one level
of nesting, and a child matching its parent's kind. That was complete, because
nothing could edit a category once written.

The category editor made editing possible, and an UPDATE walks straight past an
INSERT trigger. Without noticing it, the editor would have allowed a category to
be re-parented two levels deep, or income to be filed under an expense, with the
rules still sitting in the schema looking enforced.

The review item, for every trigger-guarded table: when a table becomes editable,
its guards cover UPDATE as well, and each one is proved by attempting the
violation rather than by reading the SQL. Four were added here and all four were
attempted: nesting depth, kind match, self-parenting, and nesting a category that
has children of its own.

Two guards exist only in the UPDATE direction, which is the tell that this is a
real class rather than a copy-paste. A row cannot be its own parent, and a parent
cannot become a child while it still has children; neither is expressible at
INSERT because the row does not exist yet. A guard set derived by mirroring the
INSERT triggers would have missed both.

### D140: the volume seed is reloadable, because the rehearsal starts by reloading it

Found by accident, and it was a rehearsal blocker.

The seed is date anchored and expires nightly, so the rehearsal's first step is a
reload. That reload did not work. The generated SQL had no DELETE statements and
plain INSERTs, so applying it over yesterday's rows aborted on the first UNIQUE
violation, left the stale data in place, and printed a log file path rather than
a failure anyone would notice. Every later step would have run against yesterday.

Making it idempotent surfaced three guards doing their jobs, each of which had to
be worked with rather than around:

- `sop_versions` refuses UPDATE and DELETE by trigger, D33, so those rows are
  inserted once and left alone on a reload. That is what immutable means.
- `OR REPLACE` deletes the existing row before inserting. `sop_versions.author_id`
  is ON DELETE SET NULL, so replacing a user updated an immutable row and was
  refused. Users are static fixtures and are now inserted once.
- `sops.current_version_id` moves forward only by trigger, and on a reload the
  SOP already points at the version being set, so an unguarded UPDATE re-set it
  to itself and was refused. The statement is now a no-op when nothing changes.

None of those triggers were wrong. The seed was written for an empty database and
never asked to run twice.

The lesson generalises past this file: anything the process depends on running
repeatedly gets run twice in testing, once against nothing and once against its
own output. The second run is the one that finds this.

### D141: I pushed on a red suite, and the gate was a shell operator

Reported because the outcome was harmless and the process failure was not.

The calendar views commit was chained as `npm test; git commit; git push` with
semicolons, so the push happened regardless of the test result. The suite was
red. The failure turned out to be the stale seed above, environmental and
unrelated to the three calendar files in the commit, so nothing bad reached
production. That is luck, not method.

The rule: the suite result gates the push, and the gate is `&&` or a read of the
exit code, never a chain that runs the next thing anyway. A green suite reported
after a push is not evidence, it is a coincidence that has not failed yet.

### D142: the gate is a hook, not a habit

D141 said the suite result gates the push. This is that rule made structural,
because a rule that depends on typing `&&` correctly is a rule that gets broken
again, and I8 is the proof that it does.

A committed `pre-push` hook runs the suite and refuses on non-zero. It is wired
through `npm prepare`, which sets `core.hooksPath`, so a fresh clone gets it from
`npm install` rather than from anyone remembering. `npm run ship` is the
sanctioned path: typecheck, suite, push, gated at every step.

Bypass is git's own `--no-verify`. Deliberately not a project flag or an
environment variable: those get set once and left set, which is how a gate
becomes decoration. `--no-verify` has to be typed each time and is visible in
what was typed, which is the difference between an exception and an accident.

Proved by breaking a test on purpose and attempting a push. Refused. The refusal
names the most likely cause, an overnight seed expiry, and the command that fixes
it, because a gate that blocks without saying why teaches people to bypass it.

### D143: a load that cannot fail loudly will fail quietly

The seed reload's failure mode was silence. A UNIQUE violation aborted it, the
old rows stayed, and the terminal printed a log file path. It read as success,
and every date-relative figure was a day stale.

So the load verifies itself and says which of the three it is: the rows are
right, the rows are wrong, or the rows are yesterday's. It compares the database
against the expectations the generator wrote at the same moment it wrote the SQL,
including the anchor date and the overdue count that actually caught this.

That is layer 1's argument applied to the loader: two sources that were never
derived from each other cannot make the same mistake by accident. The counts
alone would not have caught it, because the counts were right. Only the anchor
was wrong.

This is the same family as D138. A step that reports nothing when it did nothing
is indistinguishable from a step that succeeded, and the person reading the
terminal is the one who pays for the difference.

### D144: invoicing is client first, and every figure on it is computed over every invoice

The old screen listed billing periods, then every invoice in the firm, paginated.
That answers one question, "what is outstanding", and the screen is opened to ask
a different one: what does this client owe, what have they paid, what is late,
and what goes out next. Those are questions about a client, and a list of nine
hundred invoices is the wrong shape for all four.

So the rail picks a client and everything to the right is that client. The
selected client lives in the URL, which makes it linkable and makes the back
button work, the same reasoning the pager and the report windows already use.

The four headline figures are computed over every invoice rather than over the
rows on screen. A total that only counts what is visible is a different number
wearing the same label, which is the mistake the aging bands were built to avoid
and the reason they were never computed from a page.

Invoicing no longer paginates, and the e2e test that asserted it does now asserts
the opposite: every client appears in the rail. A client missing from the rail is
a client whose money is invisible, which is a worse failure than a long list.

### D145: a total is the sum of its lines, computed by one function both sides import

Line items arrived with migration 0024, and with them the first chance for this
app to hold two different numbers for the same invoice: one previewed in the form
while the user types, one stored by the server on save.

`invoiceTotals` in src/lib/types.ts is the only implementation. The form imports
it to preview, the API imports it to write, and there is no second place where
the order of operations could drift. The order is fixed and stated: subtotal,
then discount off the subtotal, then tax on what is left.

Rounding happens once per line, at write, and the rounded figure is stored on the
line. The alternative is rounding on read, where two readers that round
differently produce two totals for one invoice. Three lines of 0.333 hours at
100.00 are 9,990 cents when each line is rounded and 10,000 when the sum is,
which is a cent in the firm's favour on every invoice, in the direction nobody
checks.

The API also ignores `amount_cents` when line items are given, rather than
comparing the two and complaining. A caller cannot store a total its own
breakdown disagrees with, because it never gets to state one.

### D146: kind and voided_at, not more invoice statuses

The redesign asks for estimates, credit notes and voids beside sent and paid. All
three arrived as something other than a status, for two reasons.

The first is meaning. `status` tracks how much of an invoice has been paid, and it
is derived from the payments by trigger. A voided invoice is not a payment state,
and an estimate has no payments to have a state about. Putting them in the same
column would mean one column answering two unrelated questions, which is how a
column ends up with a comment explaining which values are real.

The second is that neither is a receivable. An estimate has not been agreed and a
credit note is money owed the other way. Every balance, band and total filters on
`kind = 'invoice' AND voided_at IS NULL`, so counting either as an invoice would
overstate what the firm is owed, silently, in the direction that feels good.

There is a mechanical reason too, recorded because it looks like an oversight
otherwise. SQLite cannot add a CHECK to an existing table without a rebuild, and
`invoices` is depended on by three triggers and a ledger foreign key. `kind` ships
without a CHECK and is validated in the API against a constant the page shares.
The constraint is real, it just lives in code and is named where it lives.

### D147: automation stops exactly where the send surface stops

The mock's automation tab has four switches: recurring invoices, email reminders
on a cadence, copy me on every send, and CC. Three of them describe this app
sending mail to a client, which it cannot do. Not "does not yet": it holds no
scope that could and registers no route that could try, asserted by
tests/layer2-no-send-surface.test.ts rather than promised.

Shipping the switches anyway would have been the worst option available. A toggle
that is on and does nothing is indistinguishable from one that is working, and
the person who finds out is the client who was never chased.

So each became the honest version of itself:

- Recurring invoices raise a **draft**, from the last invoice, on the schedule.
  Real, and wired into the 07:00 Mountain cron firing before the digest is built,
  so a draft raised this morning appears in this morning's email. One
  implementation in src/lib/server/recurring.ts, called by both the button and
  the cron, because a screen and a scheduled job that each decide what is due
  will eventually bill a client twice.
- Email reminders became a flag that sorts a client to the top of the start of
  day digest and marks the line. A prompt to Paul, which is the only kind of
  reminder this app can send.
- Copy me on every send was dropped. It described a send that does not exist.
- CC stayed, because it prefills the Gmail compose window the screen builds, and
  that window is a link rather than a send.

The same rule reshaped the row actions. Send became Mark as sent, which records
what Paul did. Send reminder became Log a reminder, which records a chase that
happened in Gmail. Recording what was done outside the app is the other half of
the boundary: the alternative is a screen that knows nothing about the chasing
that actually gets invoices paid.

### D148: New invite becomes Draft invite, and the invite is a link

The Calendar prototype draws a New invite dialog. Its own footnote says writes
go through the Google Calendar API, and its primary button says Send invite.
Neither is available. The token holds `calendar.readonly` and `gmail.readonly`,
and D70 is the reason it always will: a scope never granted cannot be used by a
later bug, which is a stronger guarantee than any amount of careful code.

So the button keeps its job and loses its verb. Draft invite opens Google's own
event form with the title, day, start, duration, guests, location and
description already filled in, and the person presses Save there. The same
boundary as the Gmail compose link, built the same way, in
`src/lib/calendar-draft.ts` beside `src/lib/gmail-compose.ts`.

Three controls the prototype draws are absent rather than present and inert:
reminder, repeat and the Add Google Meet toggle. Google's event form takes none
of them through a URL. A reminder field the reader fills and Google ignores is
worse than no field, D27, so the dialog says in one line where those three are
set instead.

The URL is built in the browser, never on the server, for the reason
gmail-compose gives: a meeting title and a guest list travelling through a
request could land in a log, and D89 says calendar and mail content is counted,
not recorded.

### D149: Follow and Leave change what this app shows, never Google's list

The prototype's Follow and Leave subscribe and unsubscribe a calendar, which
writes to the user's CalendarList. Same problem as D148 and the same shape of
answer: the buttons keep their names, and what they change is a table in this
app.

`followed_calendars`, migration 0026, per connection. Per connection is not
incidental. A followed address is somebody one account works with, and a single
global list would put a client's contacts in front of another client's screen,
which is D110 in a new table. The guarantee test asserts it in both directions:
a follow made on one account is invisible to the other, and unfollowing another
account's row is refused rather than quietly doing nothing, D108.

What following buys is a free and busy read against that address. Google
answers with busy blocks and nothing else, and only when the person has shared
their free and busy. No event title, no guest list, no location can arrive
through that path even if a later change asks for one.

### D150: RSVP is dropped rather than faked

The prototype's event detail offers Yes, Maybe and No. Accepting an invitation
is a write to somebody else's event, and it has no honest local translation:
recording "Paul said yes" in this app while Google still shows him as not
responded is worse than not asking, because the organiser is looking at Google.

Nothing replaces it. The event detail still shows the response Google reports,
because that is a read. A button that looks like an RSVP and is not is the exact
failure D27 names, and the right number of those on this screen is zero.

Join meeting stays. It is an outbound link to Meet, which is a link like any
other.

### D151: Find a time reads free and busy live, and says who it could not read

The slot matcher could have run over the cached `calendar_events` table, which
would need no network and no token. It does not, because the point of asking is
the people this app does not sync: a followed colleague whose events it has
never read and never will. Their busy blocks come from Google's freeBusy
endpoint, which `calendar.readonly` permits and which is a read despite being a
POST: the body is the question.

Two properties matter more than the feature does.

Every address that could not be read is named in the answer and on the screen.
Google returns the same empty busy list for "this person is free" and for "you
may not look", and collapsing those draws somebody who has shared nothing as
wide open all week. That is a confident wrong answer, and a meeting gets booked
on top of it.

The arithmetic is a pure function, `src/lib/free-slots.ts`, tested without a
network. Four real bugs were caught there before the feature was wired to
anything: a zero-length gap invented between two back-to-back meetings, a slot
offered that ended after the working day, a half hour ending exactly at the
close wrongly refused, and a 23:30 start that passed the end-of-day check
because its end wrapped to midnight and read as "0 minutes past". Every one of
those looks like a working feature on screen.

Working hours are applied on the clock the reader is on, passed in from the
browser, because the page has a firm-time toggle and nine to five has to mean
nine to five wherever the page currently is.

### D152: the scheduling assistant becomes a clash notice, and Join becomes a link

The Meetings prototype puts a scheduling assistant beside Coming up. It reads
the fortnight, spots that two calls overlap, offers a time everyone is free, and
ends with a button: "Move demo to Tue, 1:00 PM". Moving an event is a write to
Google. Same wall as D148 and the same shape of answer, except that here the
useful half survives on its own.

The clash detection is local arithmetic over events already cached, so it stays.
What it produces is a notice naming both calls and the day, with one line saying
that moving a call happens in Google and this app only reads calendars, and a
link to the later call in Google Calendar where it can actually be moved. The
suggestion of a better time is dropped from this screen because it already
exists on Calendar as Find a time, which reads live free and busy, D151. Two
answers to the same question computed two different ways is worse than one.

Join becomes Open in Google Calendar, and the reason is D27 rather than D70. A
Meet link is a real thing an event can have, and this app does not store it:
`calendar_events` has no conference column and no ALTER may be made to an
existing table before Thursday. So the row links to the event in Google, one
press from the Join button that actually exists, rather than to a URL guessed
out of the location field.

New meeting needed no translation. It creates a record in this app and pushes
nothing, which is what it already did and what the prototype's own footnote
says.

### D153: a meeting's state is what is left to do, not what it is missing

The three tabs are computed from `summary` and `summary_reviewed_at`, never
stored. The first version asked about the transcript first, on the reasoning
that a meeting with no transcript cannot have been summarised, and it filed four
hundred and fifty records under "needs a transcript" because a summary can be
written by hand and had been. The order is now reviewed, then drafted-not-read,
then everything else, and the third bucket's chip says "No transcript" or "Not
summarised" depending on which is true, because the bucket is honest and the
label has to be too.

The counting is asserted rather than eyeballed: the three tabs must add up to
the whole log, which is the property that catches a fourth state appearing or
one row falling between two conditions.

The link itself uses `calendar_events.meeting_id`, which has existed since 0011
with a comment saying nothing sets it automatically because guessing which
calendar entry became which record would be wrong often enough to be worse than
not guessing. A side table was written first and thrown away: the column is the
right shape, and the sync's upsert lists its columns explicitly and never
touches this one, so a person's filing survives every refresh. That last
property is asserted by replaying the upsert in a test rather than trusted to
stay true.

### D154: contracts are filed, never authored

The Clients prototype puts an upload box beside the contracts card and settles
the design question in its own copy: "Upload signed files as they are, several
at once. Nothing is authored in here." That line is the decision and it is the
right one.

Authoring a contract in this app would mean a template engine, a version
history, and eventually somebody relying in a dispute on a document this app
generated. Filing the signed PDF where the client's other facts live costs a
table and answers the question that actually gets asked, which is "what did we
agree". Migration 0027, `contract_files`, same shape as `expense_receipts` from
0020 because two tables that hold a file in R2 and a row in D1 should look the
same.

Files hang off the client, not off a `contracts` row. A signed PDF usually
arrives before anybody records terms, and requiring a contract row first would
mean either refusing the upload or inventing a row to hang it on. `contract_id`
is nullable so a file can be attached to specific terms later.

One request per file, not one request carrying five. A single multipart body
fails as one thing, and the reader is told the upload failed with no way to know
that four were fine and the fifth was a shell script.

The property the guarantee test exists for is the read, not the write: the row
is checked against the client in the path before R2 is touched. A route that
looked a file up by id alone would serve one client's signed agreement from
another client's URL and look completely normal doing it.

### D155: the client activity feed is derived, never logged

Recent activity merges invoices raised, payments taken, meetings held, projects
started and contracts filed, in SQL, sorted and cut in SQLite rather than in the
Worker. Nothing writes to it.

An activity table would be a second place every one of those facts lives, and
the two would drift the first time something was created without remembering to
write the log line. A derived feed cannot be stale and cannot be missing an
entry somebody forgot. It also cannot record anything the records do not already
say, which is the constraint that makes it trustworthy.

The client list's open balance is filtered by the same `kind = 'invoice'` and
not-voided rule Invoicing uses, so the one screen a person scans for who to
chase cannot disagree with the invoice screen about what is owed. D144 again, in
a second place.

Three fields the prototype draws are absent: website, industry and source. They
are columns on `clients` and no ALTER may touch an existing table before
Thursday. Client since is drawn, because `created_at` already answers it. The
three land on Thursday with the `action_items` columns already queued.

### D156: a ledger line can be corrected, unless this app wrote it

The Ledger redesign draws a pencil and a bin on every row and there was neither
route. The reasoning for their absence had been written down in a test comment:
money that has been recorded is not something the app offers to erase. That is
wrong, and it is the kind of wrong that hides: a ledger nobody can correct is a
ledger people stop entering things into, and the books then quietly stop being
the books.

So both routes exist, and both refuse the same class of row. `provenance` is the
whole mechanism.

A line with provenance `invoice` was written when a payment was recorded against
an invoice. It is the ledger's copy of a fact that lives on the invoice, and
editing it here would make the two disagree about money that has already
arrived, invisibly from either screen. The refusal names the invoice and says
where the change belongs.

A line with provenance `import` is a record of what a statement said, and a
statement that has been edited is not evidence of anything. The refusal points
at a correcting line instead, which is what double entry would have made you do.

Deleting takes the receipts with it, objects as well as rows: `expense_receipts`
cascades, so removing only the transaction would strand every attached file
under a key no row names.

On screen the controls appear only on lines that accept them, D27. A pencil that
always refuses is worse than no pencil, and the row says what it is instead.

### D157: the seed counts what it wrote, not what is in the table

Adding a ledger stream to the volume fixture broke the loader's own check, and
the failure was instructive: it reported 667 rows where 666 were expected, on a
load that had gone perfectly. The extra row belongs to the dev seed, which
writes one ledger line this fixture does not own and must not clear.

Every row the volume generator writes carries the `v-` prefix, and every DELETE
at the top of the generated SQL removes by it. So the question the loader can
actually answer is "are all of my rows here", and it now asks that. Counting
whole tables asked a different question and got away with it only while no table
was shared.

That no unprefixed row exists is a separate assertion in layer 1, and keeping
the two apart matters: a test leak reads as a leak rather than as a miscount.

The ledger fixture's income half is not invented. Each line is the same payment
id, client, date and figure as the `invoice_payments` row it came from, under
the category the posting route uses, with `provenance = 'invoice'`. The books
and the invoices therefore agree by construction, so a guard comparing them is
testing the application rather than two independently generated lists that
happen to match.

### D158: a template's fields come out of the template, and a use is recorded without its output

Two decisions on the Templates redesign, and both are about not storing things.

The per-template input fields are read out of the placeholders already in the
body. Storing a field list would mean a schema, a form to maintain it, and a
second copy of the truth that drifts the first time somebody edits the body and
forgets the list. Reading them costs no schema and cannot drift, because there
is nothing to drift from.

The syntax was not chosen, it was found. Every template already written uses
`[like this]`, and the AI drafting prompt already promises that anything it does
not know comes back "as a bracketed placeholder". A second spelling would have
meant every existing template asking for nothing and every generated draft
producing placeholders the form could not see. The one rule that keeps prose out
is that a placeholder starts with a letter, so `[1]` stays a footnote and
`[2026-08-31]` stays a date.

An unanswered placeholder is left visible rather than blanked. A half-filled
template still showing `[number]` is obviously unfinished; one with a gap where
the number should be looks finished and goes out that way.

`template_uses`, migration 0028, records that a template was used and what for.
It does not record what was produced. A generated draft is client-facing writing
nobody has read yet, and keeping every one would make this table a silent
archive of unreviewed text in Paul's voice. The length of the result is kept,
because it says whether generation worked; the text is not. The test asserts the
absence by column name, so adding one is a deliberate act.

Copying counts as a use. Without it the Most used tile answers a narrower
question than it appears to, "most drafted by the model", on a library whose
common action is to copy the text and edit it by hand.

The count is a subquery on every read rather than a column. A counter maintained
by hand eventually disagrees with reality and cannot be recomputed to check.

The seven category tabs the prototype draws are not built. A category is a
column on `templates` and no ALTER may touch an existing table before Thursday,
so the tabs are the two output types that exist. Seven tabs that all filter on
nothing would be worse than three that work, D27, and the categories land on
Thursday with the other queued columns.

### D159: a link between two tickets is one row read from both ends

A row saying A blocks B is the same fact as B is blocked by A. Writing both
would mean two rows that can be deleted separately and disagree, and there is no
way to tell from either screen which one is stale.

So it is stored once per ordered pair and the read looks the other way as well,
inverting the kind. The ticket at the other end shows "is blocked by" without a
second row existing, and unlinking works from either end because the reader has
no idea which row is the stored one.

The property is worth a test of its own because getting it backwards produces
two screens that both look right: the blocked ticket reads as the one doing the
blocking, and nothing on either page contradicts it.

A second link between the same two tickets is refused in both directions, by
name. The unique index covers one ordered pair; the check covers the other. Two
tickets that both block and relate to each other is a contradiction, not extra
information.

### D160: effort against a ticket is minutes, and is not billable time

`time_entries` already exists and answers "what do we bill": time against a
client and a billing period, feeding an invoice. `ticket_time` answers a
different question for a different reader: what did this actually take.

They are not merged, and the reason is the friction merging would add. Every
logged hour would need a client and a rate before anybody could record that a
bug took an afternoon, and the effect of that friction is that nobody records
it. The ticket page shows both, labelled, so the difference is on screen rather
than in a comment.

Stored in minutes. Hours as a float means 0.1 + 0.2 + 0.3 totalling
0.6000000000000001, and rounding for display hides the drift rather than
removing it. The same argument money makes for cents, and the test logs exactly
those three values.

### D161: progress is counted, and nothing to count is not nought per cent

A percentage column on a project is a number maintained by hand that drifts the
first time somebody closes a milestone without remembering to update it. It is
counted on every read instead, so it is wrong only if the underlying rows are
wrong, which is the same thing as the project being wrong.

Milestones win over action items when a project has them: a plan somebody wrote
is a better measure than a count of tasks that includes everything anyone ever
jotted down. Items are the fallback.

A project with neither reports null, and the table says "Not tracked". Drawing
an empty bar would say the work has not started, which is a different and
usually false claim. D27 in a small place, and the kind of small place where a
dashboard quietly starts lying.

The same reasoning applies to `next_milestone`: the typed column stays because
every existing project has one, but a real milestone row beats it, so the fact
has one answer even though two places hold it.

### D162: the SOP library gets a hierarchy, and two of the tables it was scoped for are not built

Shelves hold books, books hold chapters, chapters hold pages. Four tables in
migration 0030, where the audit sketched six. The two that are missing are
missing on purpose and both absences are asserted by name in the guarantee test,
so adding one is a deliberate act with the reasoning in view.

**There is no access or roles table.** The prototype draws role-based access
inherited from the shelf. This is a single-user application behind Cloudflare
Access: a roles table would enforce nothing and would exist only to make the
screen look like it enforced something, which is the exact failure D27 names at
the size of a module. Ownership is a name on a shelf and a book, and the page
says out loud that it is a record of who looks after this, not a permission
system. When there are several users this becomes a real table, and until then
the screen is honest rather than aspirational.

**There is no activity table.** Book activity is edits, reviews and rollbacks
across a book, all of which are already rows in `sop_versions` with an author
and a change note. A second table would be a second home for facts that already
exist and would drift the first time a version was written without remembering
to log it. It is a join. D155 in a second module.

Where a page lives is a side table, because `sops` takes no ALTER before
Thursday. The consequence is real and is handled rather than glossed: a
placement can go missing in a way a NOT NULL column cannot, so a page with no
chapter is a state the reads expect. They list it as unfiled rather than hiding
it, which is also the right behaviour for a page whose chapter was deleted, and
is the state all one hundred and eleven existing procedures were in the moment
the shelves arrived. A library that only showed filed pages would have lost
them all on day one.

One placement per page, by unique constraint. A procedure appearing in two books
is two procedures that will drift.

The next review date is computed from the cycle and the last reading rather than
stored. Changing a cycle from quarterly to monthly then moves every book at
once, instead of needing every row rewritten. A book with no cycle has no next
date, which the screen shows as "no cycle" rather than as an overdue review.

### D163: a report exports one table, named, and every other one is reachable

Every report answers with several arrays and a CSV is one table. The route picks
a primary section per report, and that is a judgement rather than a
technicality: the primary section is the list a person opened the report to
read, and the summaries beside it are context they can already see.

The others are reachable by name, so nothing is hidden, and asking for a section
that does not exist is answered with the list of ones that do. An empty file
with headers and no rows is the failure to avoid: it reads as "none" and a
reader cannot tell it from a section name typed wrong.

Headers come from the first row and every later row is read against them.
Taking each row's own keys would let a row with an extra column shift every
field after it, which is the CSV failure nobody notices until a spreadsheet sums
the wrong column. The guarantee test asserts every row is the header's width, in
every report, so a report added later cannot ship an export that silently
misaligns.

One function runs a report for both the screen and the export. Two copies of
that chain is how a file ends up a version behind the page it was taken from.

Quoting and formula-prefixing follow the ledger export, D156's file: every field
quoted because a note is where a comma turns up, and a leading =, +, - or @
prefixed so a spreadsheet reads it as text.

### D164: every setting is read by something, and what is not built says why

The Settings prototype draws about thirty controls. Roughly half describe
behaviour this app does not have, and building them as switches that store a
value nothing reads would be the worst version of D27: a toggle tells the reader
they have changed something, and the app carries on exactly as before. That is
harder to discover than a missing control, because the reader has no reason to
doubt it.

So the rule is that every setting in the store is read by something else, and it
is asserted rather than promised. The guarantee test walks every `.ts` and
`.svelte` file under `src`, excludes the settings module and the screen that
edits it, and requires each key to appear somewhere. A setting added later with
no reader fails, by name, with the reason in the message.

Eleven settings are built and each reaches something: the workspace name and the
start page reach the shell; density and zebra rows are classes on it that every
table inherits; the week start reaches the "this week" queries; the two digest
switches are read by the scheduled handler before it sends; the invoice prefix
reaches the next-number route; the payment terms and tax rate are offered to the
invoice form; the default deadline reaches Quick add.

Six groups are named as not built, on the page, with the reason for each.
Timezone, because the whole app is anchored to Mountain time and the cron
depends on it: that is a change to the anchor, not a setting. Currency, because
nothing converts. Date format, because dates are formatted in about two hundred
places and a module-level default would be shared across requests on the server.
Quiet hours, because nothing is pushed to a phone. Session length and sign out
everywhere, because sessions belong to Cloudflare Access and a copy of the
control here would change nothing. And four project and action-item toggles that
each need wiring into a module they do not yet touch: worth building, not built,
which is a different thing from a switch wired to nothing.

Sign out is real and is a link to Access's own logout endpoint. The section says
where session length lives rather than drawing a picker for it.

Two smaller rulings inside this. Nothing saves on its own: a settings screen that
wrote on every keystroke would make a mistyped tax rate a live figure on the next
invoice before the reader finished typing it. And the invoice prefix is settable
while EST and CN are not, because a firm has a house style for invoice numbers
and every one already issued carries it, whereas EST and CN are this app's own
labels for two documents that are not invoices and letting them drift would mean
a credit note that could be mistaken for one.

Settings live in KV as one key holding one object, written whole. Not D1: these
are preferences, not records, nothing joins to them, and a table would mean a
migration every time one is added. `readSettings` narrows on the way in and on
the way out, so a value written by an older version or by hand cannot hand the
code a shape it does not expect.

### D165: the spend stop, and the two allowances that must not mix

There was no spend stop. `costCents` had been written, tested and exported, and
had no caller outside its own test. The only dollar figure in the running app
was `ceiling_usd_per_month: 30`, a display constant the meter returned, which
nothing read to decide anything. Exposure on the day was twenty-nine cents. The
problem was never the money: it was that a control everybody believed existed
did not, and belief in a control is what stops people looking.

**Two allowances, and the separation is the design.** The monthly ceiling is 30
USD hard and covers the ongoing cost of the app running. A backfill run gets its
own allowance, 50 USD by default, keyed to a name. Usage attributed to a run is
excluded from the monthly figure.

Both directions of that exclusion matter. Without it a corpus pass would consume
the month and every ordinary call afterwards would be refused, which is a stop
firing on exactly the wrong thing. And the month would silently absorb a pass
that was never separately accountable, so nobody could say afterwards what the
backfill had cost.

Attribution, not a time window. A run defined as "everything between these two
timestamps" would sweep up every ordinary call made while a backfill happened to
be running, which is the mixing this exists to prevent. Each usage row is
attributed explicitly at the moment it is recorded, or to nothing, and the
primary key on the attribution table is the usage row, so a call cannot belong
to two runs.

**One source for both the control and the display.** `src/lib/ai-budget.ts`
holds the ceilings; the check reads it and the meter route reads it. Two numbers
that come from different places are two numbers, and they disagree the first
time one is edited. That is precisely how the old ceiling became decorative.

**Refusals carry the reason, never zeros.** The cron path returns through the
`stopped` field the triage outcome already had; the context pass returns through
`stopped_early`; the four routes return 402 with both figures in a sentence. A
run refused on budget and a run with nothing to do both return zeros, and only
the reason separates them. D138.

**The gate is first in every route.** Not after the resource lookup: a reader
who hits a downstream 404, fixes it, and only then meets the ceiling has been
told the wrong thing twice.

Two holes were found while building it, and both were the same shape as the
original finding.

`context.ts` counted its own tokens into its outcome and wrote nothing to
`ai_usage`. The most expensive pass in the app was invisible to the meter and
therefore to any ceiling reading it. A cost the meter cannot see is a cost the
stop cannot stop.

`UsageKind` named six kinds; migration 0015 constrains the column to three. The
three extra names had no caller, so nothing had ever hit the constraint, and
`recordUsage` swallows a failed write on purpose. The first code to use one
would have had its insert refused and its spend gone unrecorded. The union is
narrowed to the truth rather than the table rebuilt tonight; `profile`, `digest`
and `voice` join the Thursday ALTER queue.

Both are asserted now: the guarantee test walks every file that calls a function
in `ai.ts` and requires it to call the stop and to record what it spent.

### D166: a path that spends money must be structurally unable to spend unrecorded

The rule the spend stop is worth more than the stop itself.

D165 built a ceiling. A ceiling reads a meter, so a ceiling is only as complete
as the meter beneath it, and the meter had two holes: `context.ts` counted its
own tokens and wrote nothing, and three of the six names in `UsageKind` would
have been refused by the column's CHECK while `recordUsage` swallowed the
failure by design. Neither was visible. Both would have spent real money with
the meter reading zero and the stop declining to fire, and the app would have
looked exactly as it does when nothing is happening.

Careful is not a control. Both holes were made by people who intended to meter
everything, which is the same intention that produced `costCents` with no
caller. So the rule is structural:

**Any file that calls a function which spends money must call the budget check
and must record what it spent, and a guarantee test asserts both by walking the
source.**

The test scans `src/lib/server` for callers of the functions in `ai.ts`,
excluding `ai.ts` itself and the budget module, and fails by filename if a
caller does not reference `checkAiBudget` and `recordUsage`. It also asserts the
scan found at least five files, because a loop over an empty result passes every
case it contains and a broken pattern would otherwise read as universal
compliance.

This is deliberately a source scan rather than a runtime assertion. The failure
being prevented is a call site added later by somebody who did not read this
entry, and a runtime check only fires if a test happens to exercise that path
with a live key. A scan fires on the next `npm test` after the file is saved.

The general form, for anything that follows: when the cost of forgetting is
invisible, the check belongs in the suite and keys on the shape of the code, not
on the behaviour of a run.

### D167: the width default is inverted, because the opt-in was the thing forgotten

D129 made full width a route-level opt-in. Twelve pages then shipped centred
inside the 1200px cap on designs that are full width, and Paul found it the same
way he found CR1-F4: by looking at his own screen.

The cause is identical to the one D129 already named. The fidelity pass rendered
at 1440 and 412. At 1440 a 1200 cap leaves 120px each side, which reads as
padding. At 1920 it leaves 248px each side and is unmissable. D129 said the
width you look at is part of the test; I looked at the width where the defect is
invisible, twelve times.

D129's principle stands and is untouched: the route decides, never the page, and
the change is proved by measuring both kinds. What is superseded is the
direction of the default.

**The opt-in list was the failure mode.** Joining a list is something the author
of the next page has to remember, and forgetting it produces a page that looks
plausible and is wrong. Almost every screen in this app is a table or a
two-column board; the ones that are prose are nameable and few. So the default
is full width, and `NARROW_ROUTES` names the exceptions with the reason.

Today that list holds one route: a single SOP page, which is markdown read start
to finish. Prose measured at 1700px is bad typography whatever the screen
allows, and a table crammed into 1200px on a 1920px screen is wasted space. Both
are layout defects; they just point opposite ways.

The guard is an e2e test at **1920px**, not 1440, and it measures both kinds:
every navigable route must reach the right edge, and the procedure page must
still be capped. A test that only checked the wide ones would pass just as
happily if the cap were deleted everywhere. It was proved by reintroducing the
defect on one route and watching it fail before being restored.

The general rule, which is the part worth keeping: **when a defect is invisible
at the width you develop at, the test picks the width, not the developer.**

### D168: the mirror is a copy, kept apart from the app's own model

Asana and Dropbox are the source of truth. The app mirrors them, read only in
this phase.

The mirrored rows live in their own tables, `asana_*` and `dropbox_*`, keyed on
the source system's own identifier and stamped with when they were pulled. They
are not `projects` and `tickets` under another name, and they do not replace
them. The link between the two sides is a side table, so a re-pull rebuilds the
mirror without touching a row Paul has written and without an ALTER on anything
that existed before.

The property that matters is that the whole mirror can be thrown away and
pulled again. That is what makes Thursday's schema work free, and it is why
nothing in the app edits a mirrored row. A row corrected by hand is a correction
the next sync silently reverts, and afterwards nobody can say which of the two
was right. A test asserts that only the puller and the client filing write these
tables, and that the filing changes nothing but which client a row belongs to.

### D169: the mirror resumes by gid, and never by a timestamp

Every phase records the identifier it last finished, and a resumed pull carries
on from there.

A timestamp cursor was the obvious alternative and is wrong twice over. It
re-syncs the whole workspace the first time somebody bulk edits anything,
because every `modified_at` moves at once. And it ties: two tasks written in the
same second cannot be ordered, so a cursor sitting between them either repeats
one or skips one, and skipping is silent.

A gid survives renames, moves and re-pulls, which is exactly the set of things
that happen to a task between one sync and the next.

The same reasoning produced a smaller rule with the same shape: a phase advances
its cursor past a project only when that project's last page has come back. An
unconditional advance marks a half-read project finished and loses the rest of
its tasks with no error anywhere, which looks like success.

### D170: a mirrored row carries where it came from, and attachments carry no bytes

Every mirrored table is keyed on the source identifier and carries `synced_at`.
A row has to be able to say when it was last true; a mirror where that is
implicit is a mirror nobody can date.

Attachments are metadata only: name, size, kind, when it was created. No bytes,
and deliberately no download URL. Pulling the contents would mean this app
holding copies of client files it was never asked to hold, and Asana's download
URL is short lived by design, so storing one produces a link that looks like a
link and is not.

The same rule governs Dropbox, where it matters more: 11,150 files and 415 GB.
The app holds a map of where the client work is. It does not hold the client
work.

### D171: the section is recorded as Asana spells it, and translated by nobody

A task's section is stored verbatim, in `asana_tasks.section_name`.

Mapping it onto the app's own status vocabulary during the pull was available
and was refused. Thursday's status-model reconciliation exists to ask what
MacGray's real statuses are; a mapping written now would be this session
guessing the answer, and the guess would then be sitting in a column looking
like evidence for it.

Two hundred and eighty-one sections came back across sixty-six projects. That
list is the input to the reconciliation, and it is worth more unedited.

### D172: archived projects are pulled, because an archived project is not an absent one

The pull asks Asana for archived projects as well as live ones.

Missing them was one of the two systemic misses recorded in the MacGray handoff,
and it is now a permanent refresh check rather than a thing to remember. Of
sixty-six projects in the workspace, twenty-four are archived. A live-only pull
would have shown forty-two and looked complete, and every question about
finished work would have been answered as if it had never happened.

### D173: the crosswalk is data loaded into a table, and its grain is the row

The client crosswalk is a file Paul edits. It is loaded into a table, and
editing the file is the override path. Encoding fifty-five name mappings as code
would have made every correction a deploy and hidden the mapping from the person
who owns it.

The first version keyed the table on `canonical_name`, on the reasoning that the
file is organised around it. The file disagreed: fifty-five rows, forty-five
distinct names. One client carries nine program workstreams, each a separate
line with its own Asana gid. The load wrote fifty-five rows into forty-five
slots and the last one won, so ten Asana gids went in and did not come out, and
ten real projects were filed as unassigned.

The grain was always the row. A client legitimately has several Asana projects,
and `canonical_name` is which client a row belongs to, not what the row is.

The gid is unique where it is present, because a gid identifies one project and
a project belongs to one client. Two rows claiming the same gid is a
contradiction in the file, and it should fail the load rather than resolve
itself by whichever row was written last.

### D174: a load reports what the table holds, not only what the loader did

The crosswalk load reported `rows_written: 55` while the table held 45. Both
numbers were true. Only one of them was the answer to the question anybody was
asking, and the wrong one was on the screen.

So a load now reads the table back and reports that too, alongside the count of
identifiers that went in and did not survive, which should always be zero. This
is D138 in a new place: a count has to say what it is a count of, and a number
that describes the attempt rather than the outcome will be believed as the
outcome.

The same reasoning covers the load record itself. It is a row in a table, not a
log line, because "is the crosswalk in this database the whole file" gets asked
weeks later when the terminal has long since scrolled.

### D175: matching precedence is ordered, and the fourth answer is a real answer

A mirrored project or folder is filed against a client by, in order: an exact
Asana gid, which is authoritative and never overridden by a name; an exact
Dropbox folder name; a normalised name, ignoring case, punctuation and the legal
suffix; and then the unassigned bucket.

The fourth is not a failure. A project filed under the wrong client is worse than
one filed under none, because the wrong filing is invisible and gets believed,
while an unassigned project is a question on a screen that somebody answers
once. `client_match` records which rule fired, so a name match can never be
mistaken for a gid match when somebody asks why a project is filed where it is.

The normalised pass is deliberately conservative and sits below two exact ones.
An over-eager normaliser is the failure that matters here: it collapses two real
clients onto one key and files the work of one under the other, silently. A test
asserts that six deliberately similar names produce six distinct keys.

### D176: Dropbox activity is file level, and a folder's own date is never read

Paul ruled this a hard rule rather than a preference, and it is asserted rather
than trusted.

A synced Dropbox touches folder modification times when it syncs. A folder date
therefore says when the sync client last thought about the folder, not when
anybody last did work in it, and reading one made dormant clients look active.

So: the scan never stats a directory, for its date or for anything else, because
a value that is not fetched cannot be sent by accident. Folder entries carry no
time. The ingest drops a folder modification time loudly if one ever arrives,
since the OAuth connector is a different source and could supply one. The
`dropbox_folders` table has no column to hold one. A folder's `last_activity` is
derived from the newest file beneath it, recursively, because "when did anything
happen for this client" is answered wrongly by an answer that stops at the first
level when all the work sits one folder deeper.

Four tests cover those four places. Any one of them alone would be a rule
somebody could route around without noticing.

### D177: the two local environments are separated by the path, and the footer reads the data

There are two local databases: the synthetic fixture the suite runs against, and
the real mirror. They are separate miniflare state directories.

The path needs its `v3` suffix and it is load bearing. Wrangler's CLI appends
`v3` to whatever `--persist-to` is given; miniflare, driven through the vite
plugin, takes an explicit path exactly as written. Naming the directory without
it produced two databases at two paths, migrations applied to one and the dev
server reading the other, and a health check reporting an empty schema on a
database that had thirty-two migrations in it.

The footer says which environment is loaded, and it decides by looking for the
fixture's own marker row rather than by reading the environment variable that
was used to start the server. A label that reads the same flag as the thing it
describes cannot contradict it, and a label that cannot contradict its subject
is not a check.

### D178: a request with no deadline is not slow, it is stuck

Every Asana request carries a thirty second timeout.

Without one, a single hung connection stopped a pull that continued to look
alive: the process was running, no error was logged, and the only symptom was a
row count that stopped going up. Fifteen minutes went into finding that.

Two things follow from the same incident. The pager retries the failures that
are about timing rather than about the request, twice, backing off: a rate
limit, a timeout, a bad gateway. It does not retry a 401 or a 404, because
retrying those only delays finding out.

And an error is unwrapped before it is recorded. `fetch failed` on its own is a
sentence with no information in it; the cause chain underneath it said
`ECONNRESET`, which named the layer and made the fix obvious. An error that
reaches a person stripped of its cause costs an hour, which is the same
complaint as D138 wearing different clothes.

### D179: a transient fault keeps its place in the queue

When a step fails, the phase and cursor stay where they were and the error is
recorded beside them.

The first version set the phase to `failed`, and a resumed run treated that as
"start again", re-reading every project and every section to get back to where
it already was. A dropped connection is not a reason to redo an hour of work.

The driver follows the same principle from the other side: it rides out a
refused connection and a failing step, and gives up only after several in a row.
It quit on the first one, which meant an hour of no progress on a server that
was working, because a dev server restarts itself whenever a source file
changes.

Related, and found the same way: `localhost` resolves to two addresses on this
machine, Node picks one per request without falling back, and the dev server
binds only one of them. Roughly half the calls were refused with a bare
`fetch failed`. Both sides are pinned to one loopback address now. A name that
resolves to something unbound half the time is not a convenience.

### D180: a safety test that depends on an absent credential is asserting the absence

The test claiming a seeded `v-` row could not be pushed to a real Asana
workspace was passing because there was no Asana token locally. Every push
stopped at the missing-token check, so the guard the test named had never once
run. Configuring a token to build the mirror made it fail, which is the only
reason anybody found out.

The rule, and it applies to every safety test in this repo: **write it so it
fails when the credential is present and the guard is removed.** A test that
green-lights on "the thing could not have happened anyway" is asserting the
state of the environment, not the behaviour of the code, and the environment is
exactly what changes.

Concretely that means three things. Assert the reason, not just that something
went wrong: a 503 for a missing token and a 403 for a synthetic row are
different facts and only one of them is the guard. Put the guard before the
checks that could shadow it, so its refusal does not depend on which other
things happen to be unconfigured. And when a safety property is claimed, check
that the claim can fail.

Same class as D80. Zero impact here, because no workspace had been chosen
either. That is not mitigation, it is a second accident.

### D181: the manual override is its own table, and ranks below a gid

Paul's answer to an unassigned row is recorded in `client_overrides`, keyed on
the Asana gid or the Dropbox path it answers about.

Not written into `client_crosswalk`, although that is where the instruction
pointed. The crosswalk is a faithful copy of a file and every load rewrites it
from what the file says; a manual row has no line in the file to be rewritten
from, so the next load would delete exactly the corrections that cost the most
to make. An override has to outlive a re-load or it is not an override. The
provenance the instruction asked for is still recorded and still visible:
`client_match` reads `manual` on the row it decided.

The full order, as ruled:

1. `asana_gid` exact
2. manual override
3. `dropbox_name` exact
4. normalised name
5. unassigned

A manual override outranks name matching because a name match is a guess that
happened to be good. It does not outrank a gid, because the gid is the
authoritative identity of a project and a person choosing from a list is
answering a harder question with less information; where the two disagree the
gid is right and the override was made against a stale screen.

The first version skipped rows already marked `manual` instead of ranking them,
which left the precedence half in the matcher and half in whichever rows
happened to be left alone, and meant a gid could never overtake a stale
override. The order now lives in one chain of conditions, and a test asserts the
branches are in it.

An override can be removed. A judgement that cannot be revised without editing
the database by hand is the thing this whole design exists to avoid.

### D182: the roster is a status overlay and never files anything

`macgray_client_roster.csv` is a second file on a different shape: 36 rows of
name, status, shared mount, last activity, and the evidence behind the call. It
loads into its own table through its own route.

It is not a matching authority. The crosswalk decides which client a project
belongs to; the roster says what state that client is in. A single loader that
accepted either file and worked out which it had would eventually load one as
the other, so the crosswalk loader refuses a roster by name, which is what it
did the first time it was handed one.

The status is stored as the file writes it and is not folded into
`clients.status`, which allows only `active` and `archived`. Three of the
roster's five values are Paul saying "this needs a second look", which neither
of the app's two states can express, and collapsing it would destroy the only
thing the row was written to say. Same reasoning as storing Asana's sections
verbatim: a translation written now is a guess that afterwards looks like a
fact.

`evidence` is free text and is kept whole. It is the sentence that justifies the
status, and a status without its reason is an opinion.

### D183: a page that throws while hydrating is a page that half works

The unassigned screen bound a select to a key that did not exist yet. Svelte
threw `props_invalid_value`, hydration stopped where it was, and what came out
was a page the server had rendered correctly with one element quietly missing
from it: sixteen archived chips server-side, fifteen on screen.

Nothing said anything had failed. No request errored, the layout was right, the
counts were right, and every assertion anybody had written still passed. The
only trace was one line in the browser console, and D128 caught it only because
rendered verification means actually looking.

Two things follow.

The suite now reads the console. Every route in the width guard is loaded and
asserted to throw nothing while hydrating. Cheap, and it covers the class rather
than the instance.

And the select no longer binds. Seeding the keys would have fixed this one
occurrence; not binding removes the hazard, because a select is a control whose
value can simply be read when it changes. This is the third time
`props_invalid_value` has cost real time in this repo, after QuickAdd and
Templates, and the pattern in all three was `bind:` into a record that did not
have the key yet.

### D184: the one-way push is off until somebody switches it on

`asana_settings.push_enabled` is false by default and false for every settings
blob written before the field existed. Nothing creates a task in Asana until it
is true.

Found by applying D180 to the rest of the code rather than to the one test that
had failed. The one-way push is a v1 feature and it stays; during the mirror
phase Asana is the source of truth and the app only reads it. But the only
thing standing between an action item and MacGray's live workspace was that no
workspace had been chosen. That is not a decision, it is an accident of
configuration, and choosing a workspace to make the mirror settings coherent
would have armed it silently. The exact shape of the finding this rule came
from.

Three details, and each is the same rule in a different place. The switch is
checked before the token and the workspace, so its refusal never depends on
which other things happen to be unconfigured. Only the literal `true` enables
it, so a settings write that forgot to mention the push cannot turn it on by
omission. And `ready` now means ready to push, which is a narrower question than
ready to read: the mirror needs a token and a workspace, a push needs both of
those and somebody to have decided.

### D185: a limit that stops work has to say it stopped

The mirror driver capped itself at 800 steps and, on reaching the cap, simply
fell out of its loop. It printed nothing. The run looked exactly like a run that
had finished, and the pull was 253 tasks short; the only way to know was to read
the phase out of the database.

It now says so and exits non-zero. Any bound that ends work early belongs in the
same category as D138: the number of things done and the reason for stopping are
two different facts, and reporting only the first lets an incomplete run be read
as a complete one.

### D186: the write-capable path audit, and what it found

Every outbound call this app makes, enumerated, and for each the question the
Asana push failed: is it off by decision, or only by missing configuration?

Six external hosts appear in the server code. `app.asana.com`,
`api.resend.com`, `accounts.google.com`, `oauth2.googleapis.com`,
`gmail.googleapis.com`, `www.googleapis.com`, plus the Anthropic SDK.

**Asana, `createTask`.** The only call that creates anything in Asana. Off by
decision as of D184, and that switch is checked before the token and the
workspace. This is the path the audit was ordered because of.

**Google, everything.** No write path exists. The two POSTs are an OAuth token
exchange and a free/busy query, which Google models as a POST and which reads.
The scopes are read-only, and a test pins them by name against an allowlist plus
a count, so adding a write scope fails the suite rather than shipping. Off by
decision, and the decision is structural: the capability was never granted.
D70.

**Anthropic.** Spends money rather than mutating anything. Every one of the five
call sites checks the budget first, and a refusal carries its reason rather than
returning success with zeros. Off by decision, and the decision is the ceiling.
D165, D166.

**Dropbox.** No write surface exists at all, and four tests assert that the
route names no upload, delete, move, share or download. Nothing to switch off,
which is the strongest form of the answer.

**Resend, the digests.** The one that needs stating carefully, because it sends
real mail to a real person.

The cron path is gated by `morning_digest` and `evening_digest`, which are read,
and a skip is logged rather than silent. Those default to **on**, which is
unlike the Asana push and is correct: a start-of-day and end-of-day email to
Paul's own inbox is the ruled MVP feature, and setting `RESEND_API_KEY` is a
deliberate act that turns on a thing that was asked for. On by design is not the
same as armed by omission, and the distinction is worth keeping sharp, because
treating every default-on feature as a finding would make the rule useless.

Two things about it are still worth writing down.

`POST /api/digests/run` calls the sender directly and does not read the
preference the cron reads. Defensible, since sending now on purpose is a
different act from a schedule, but the settings screen says digests are off
while that route will still send one.

`DIGEST_TO` falls back to a hard-coded address. If the variable were ever unset
on production while the key was set, mail would go to a compiled-in destination
rather than the send failing loudly. The impact is nil today, because the
address is Paul's own, but the shape is the one D108 and D111 are about: a
destination that survives a configuration mistake by defaulting is a destination
nobody chose.

**Result: one path was armed by omission, it is closed, and no others are.**
Neither of the two Resend observations was changed, because tonight's
authorisation was the audit and the report.

### D187: a send has no fallback destination, and an override says it overrode

Two changes from the D186 audit, both ruled.

**`DIGEST_TO` refuses rather than defaulting.** The sender used to fall back to
a hard-coded address when the variable was unset. The address was Paul's own, so
the behaviour was right, and that was luck rather than design.

The correction to my own report: the variable is set in `wrangler.toml`, so the
fallback was latent rather than active and would only have fired if somebody
deleted the var. That is milder than I first described it and still worth
removing, because the failure it produced would be mail going somewhere on the
strength of a line in the source instead of a deployment failing loudly. A
destination that survives a configuration mistake is a destination nobody chose.
Same family as D108.

Refusing is safe here in a way it would not be for a read. A digest that does
not go out is a missing email; a digest that goes to a compiled-in address is a
delivery nobody can explain. The refusal is a named outcome,
`skipped_no_recipient`, rather than a bare failure.

`DIGEST_FROM` still falls back, deliberately. `onboarding@resend.dev` is
Resend's sandbox sender and only delivers to the account owner, so an unset
sender narrows where mail can go rather than widening it. That is the opposite
case, and treating it the same way would be applying the rule without its
reason.

**`POST /api/digests/run` reads the preference the cron reads.** It still sends
when the schedule preference is off, because asking for a digest now is a
different act from a daily one and is not undone by having turned the daily one
off. But the result carries `scheduled_digest_enabled`, and when the two
disagree it says so in a sentence.

The point is not to stop the send. It is that the Settings screen must not be
able to say digests are off while a path sends one and reports nothing. D164's
other half: a setting has to be visible where it is being overridden, not only
where it is obeyed.

### D188: read the whole message, then confirm the branch

A push was rejected by the pre-push suite. The hook's message named two
possible causes: the volume fixture expiring overnight, or a dev server holding
the build directory open. The first was read, the fixture was regenerated and
reloaded, and the push failed again on the cause that had been sitting in the
second half of the same sentence.

The gate was right both times. The mistake was diagnostic: acting on the first
branch of a two-branch message without confirming which branch had occurred. A
diagnosis that fits is not a diagnosis that was verified, and confirming costs
one command where guessing wrong costs an hour.

It is a habit rather than a defect, so it lives on the review checklist rather
than in a test. Item 8.

Recorded alongside it, because it came out of the same exchange: a finding
revised downward on evidence is the same discipline as one revised upward, and
is the easier of the two to skip, because nobody is harmed by an overstatement
and it makes the work look more valuable. The `DIGEST_TO` fallback was reported
as a live misdirection risk and was latent, because the variable is set in
`wrangler.toml`. The fix was still worth making and the severity was still
wrong. Both were said, and a rule applied without its reason is not the rule,
which is why `DIGEST_FROM` keeps its fallback.

### D189: the projection, and why the mirror alone was not the job

The mirror held 66 projects, 2,585 tasks, 281 sections and 11,150 files, and
`/projects` showed nothing. The mirror is a side model on purpose, so a re-pull
after Thursday's schema work costs nothing, and nothing was ever built to read
it onto the screens.

A derivation, not a copy by hand. Every projected row is found again by its
Asana gid through `asana_project_links` and `asana_task_links`, the tables 0032
created for exactly this. Pull again, project again, and the app converges: two
runs produced identical totals, which is the property, not a coincidence.

Nothing in the pass reads the app's own rows to decide what to write, because
that would make the result depend on how many times it had run. It reads them
afterwards to report, which D174 requires. The test draws the line at the
reporting helper rather than banning both, since banning both would have forced
the reporting to be dropped.

Derivations that are guesses are stated as guesses. A project's phase and status
come from `archived` alone, because Asana has no PMI phase and no project
health, and the columns are NOT NULL so something goes in them. A ticket's
status is only complete or not, because the real vocabulary is the section name
and there are 103 of them; the verbatim section is shown on the ticket beside
the app's own status, so the guess sits next to the fact. Both are in the run's
`dropped_fields` with the reason, along with tags, custom fields, followers and
assignee identity, which have no home at all and stay in the mirror.

### D190: stories are an activity trail, and files are read rather than copied

Two things the projection deliberately does not do.

10,062 Asana stories are not projected into `action_items`. They are comments
and system events, not commitments, and ten thousand of them would bury the one
screen that says what Paul owes people. They are shown on the ticket, read
straight from the mirror, so a re-pull updates the trail with nothing to
reconcile. `action_items` stays empty, and its empty state now says which kind
of empty it is: "no action items exist yet", with what would fill it, rather
than "nothing here", which reads as "you owe nobody anything".

11,150 files are rendered by query rather than copied into `project_files`. A
copy would be a second set of rows to keep converging with the first, for no
gain: the app authors nothing about them. The Files screen, the client page and
the per-client filters all read `dropbox_files` through the folder that carries
the client. Files under a folder nobody has matched are counted and named on
screen, 694 of them, rather than quietly omitted.

### D191: the suite must check which database is answering, not which flag is set

A dev server backed by the real mirror was found answering on the suite's own
base URL, left over from earlier in the session on the IPv6 loopback while the
fixture server had been stopped.

The guarantee test that exists for this asserts `CC_DATA !== 'real'` in the
vitest process. That says nothing about the server the tests talk to, and layer
2 creates rows and deletes them again. Nothing was written to the real mirror,
because the pre-flight seed count refused to start on finding zero action items.
That was luck, not a control: the check that saved it was looking for a
different problem.

Both now assert the thing itself. The pre-flight reads `/api/health` and refuses
when `data_environment` is not `seed`, naming what it found. The layer 2 test
does the same over HTTP rather than over `process.env`.

This is D180 in a third place. A safety property held by a flag in the wrong
process is not held.

### D192: a bare alias in HAVING beside a real column of the same name

The projects list gained an archived filter written as `HAVING archived = 0`
against a `COALESCE(ap.archived, 0) AS archived` in the SELECT.

SQLite binds the bare name to `asana_projects.archived`, not to the alias, and
that column is NULL for any project with no Asana link. `NULL = 0` is NULL, so
the filter returned nothing.

It worked perfectly on the real data, where every project has a link, and
emptied the screen on the fixture, where none do. That asymmetry is the reason
the suite runs against a synthetic fixture at all: a defect that only appears
when the join misses is invisible on a dataset where it never does. Fixed by
writing the expression rather than the alias.

### D193: the wrong-scope guarantee is a family, and this is its fourth member

D191 is not a one-off, and naming the family is the point of this entry.

Four instances now, each a property that was believed because something was
checked, where the something was not the thing:

1. **D80.** A guard whose test could not fail, because the dangerous path was
   unreachable for an unrelated reason.
2. **D180.** A safety test that passed because the credential was absent, so the
   guard it named had never once executed.
3. **D184.** A capability held back only by an unchosen setting, which the next
   obvious click would have armed.
4. **D191.** A guarantee asserted in the process that asks rather than about the
   system that answers.

The shared shape: something true was observed, and a different thing was
concluded from it. The correction is always the same move, which is to assert
the property about the thing that would do the damage. `/api/health` is asked
which database is behind it, because the environment variable only reports what
somebody typed when a server started, possibly hours earlier and possibly for a
different server entirely.

Recorded plainly: no write reached the real mirror. That was luck. The
pre-flight that stopped the run was looking for a stale fixture, not for the
wrong database, and a check that saves you while looking for something else has
not been tested. Checklist item 9.

### D194: the synthetic fixture is coverage, not convenience

Formalising what D192 demonstrated, because the fixture costs real time to
maintain and the reason to keep it should be written down rather than assumed.

Real data is one shape. Every mirrored project has an Asana link, so a query
joining through that link never misses, and a defect on the null-join path
cannot appear. The fixture has no mirror at all, so every one of those joins
misses. Between them they cover both halves; either alone covers one.

The demonstration: `HAVING archived = 0` against a
`COALESCE(ap.archived, 0) AS archived`. SQLite binds the bare name to the real
column rather than to the alias, that column is NULL where there is no link, and
`NULL = 0` is NULL. Perfect against 66 real projects, empty against 220 fixture
ones.

So: a feature verified only against real data is half verified, and a difference
between the two datasets is the finding rather than an inconvenience to be
worked around.

### D195: two right numbers under two wrong headings

The Projects list showed a column headed "Open" against open action items, and
immediately beside it a column headed "Tickets" against open tickets. A project
reading 0 and 2 was read as "no open tickets, two tickets" while its own page
said 2 open and 13 closed.

**Nothing was miscounted.** That is worth stating plainly, because the obvious
diagnosis was two queries disagreeing and the obvious diagnosis was wrong. Both
numbers were correct and the pair of headings was unreadable. Item 8 of the
review checklist, applied to a screen rather than to an error message: the
diagnosis that fits is not the diagnosis that was verified.

Three changes. The headings say what they count. The column shows "2 of 15"
rather than "2", because a bare number invites the reader to supply the missing
half. And the definition of an open ticket, which was spelled out in ten places
across five files, now lives in one, with a test that fails if the literal
reappears. All ten copies agreed; the tenth was written by copying the ninth,
and the first one somebody edits without finding the others is the day two
screens really do disagree.

### D196: a synced ticket arrives complete

The standard, now that the ALTER freeze is lifted: everything Asana holds about
a task has somewhere to go.

Columns for what belongs to one ticket and the app might itself author, side
tables for sets and for anything whose shape belongs to the workspace. So
`asana_section`, `asana_assignee_gid`, `asana_modified_at` and `asana_url` are
columns; tags, followers and custom values are tables. A tags column would mean
parsing a delimited string, and a column per custom field would mean a migration
every time somebody edits a dropdown in Asana.

Custom values are keyed on the field's gid, not its name, because a field can be
renamed at any time and keying on the label would orphan every value the first
time somebody tidied one.

Carried on the re-run: 2,958 followers, 309 custom values, 1 tag. What remains
in `dropped_fields` is now only what is deliberately not carried, and the report
shrank accordingly. A report that overstates the loss is as wrong as one that
hides it, so the test asserting those fields were dropped was rewritten to
assert that they are not.

Still not carried, each a decision: stories, because they are an activity trail
and not commitments; app user rows for Asana people, because six assignees are
not six members of this app, though the gid is now carried so identity works;
and fine-grained status, because the real vocabulary is 103 section names and
that is Thursday's reconciliation.

### D197: derived from the work, and a person's override survives the derivation

Every project read "Executing / Not tracked" because phase and status were
derived from `archived` alone, and progress looked only at milestones and action
items, of which the mirrored projects have none.

Both now read the work. Phase: archived is closing, no tickets is initiating, no
open tickets is closing, anything else is executing. Deliberately not a
completion ratio, because the PMI phases are not a progress bar and reading
"monitoring" off 50% done would invent a meaning the word does not have. Status:
done when the work is finished, at risk when anything is overdue, on track
otherwise; `blocked` is left for a person, because being blocked is something
somebody knows and no count can show. Progress counts milestones, then tickets,
then action items, and the screen says which measure it used, since 87% of
milestones and 87% of tickets are different claims.

The real spread that replaced "everything executing": 2 initiating, 35
executing, 29 closing; 15 on track, 22 at risk, 29 done.

The signals are computed from the mirror rather than from the projected tickets,
because the tickets do not exist yet when the projects are written, and two
derivations from two sources is how two screens start disagreeing.

`phase_is_manual` and `status_is_manual` mean a person's decision is not
re-derived away on the next projection. Overwriting it would revert their
judgement with nothing to say why, which is the worst kind of silent write.

### D198: an empty card is an invitation, and an empty screen says which empty it is

The ticket's Description card disappeared when there was nothing in it, so a
ticket with no description offered no way to write one: the only route in was
the Edit form and nothing on the page said so. It always renders now, with an
Add control and in-place editing.

The same rule, twice more. Every client showed "No contacts yet", which reads as
a sync that found nothing, and reading it on every client reads as a sync that
failed. Nothing failed: no source of client contacts exists. Asana holds ten
people, all MacGray staff, with no email addresses at all. The empty state says
that, because a screen that implies a failure sends somebody looking for a bug
that is not there.

And effort logging: the form asked for hours and a note and had no date, so it
could only ever mean "now". People log time days late, and a form that can only
say now makes them either misstate the day or not log it at all. The API had
always accepted `logged_on`; the form simply never sent one.

### D199: cards do not touch, measured rather than judged

Four screens rendered with cards flush against each other at zero pixels.

The Card component carries no outer margin, on the reasoning that spacing
belongs to whatever arranges the cards. Most pages wrap them in a container that
supplies it; the pages that placed two cards as plain siblings got nothing.

Fixed in the shell with a sibling rule rather than on the component, because a
margin on Card would fight every page that already arranges its own spacing with
a grid gap. A sibling rule only fires where nothing else has.

Found and confirmed by measuring in a browser at 1920 and 412, not by looking
and judging. The first measurement listed the gaps and the second proved they
had gone. Two of the apparent faults turned out to be side-by-side columns,
which a bottom-to-top comparison across a grid reports as negative space and
which are not a defect at all: measuring found the real one and stopped three
imaginary ones being fixed.

### D200: there is no real mail in either local environment

Pillar 4 was ordered as the context pass against real mail. It has not run,
because the mail is not here.

The evidence, gathered before spending anything. The real-data environment has
zero connections and zero threads: it was created for the Asana and Dropbox
mirror and no mailbox has ever been connected to it. The fixture environment has
two connections and 21 threads, and both accounts are on `.invalid` domains,
which is the reserved TLD for exactly this purpose. They are synthetic.

The 775-thread corpus that the earlier post-reset diagnosis measured is on
production, which Stage C holds.

An earlier check for a `v-` prefix on the thread ids found none and I nearly
concluded the mail was real on the strength of it. The prefix is the volume
seed's convention and the mail fixture does not use it, so the absence of a
prefix said nothing. The account domain settled it. Checklist item 8: the
diagnosis that fits is not the diagnosis that was verified.

Running the pass over 19 synthetic threads would have produced counts, a spend
line and a report that all looked like Pillar 4 and were about nothing. So it
did not run, and no money was spent.

Two ways forward, both Paul's to choose. Connect a mailbox to the real-data
environment, which needs his Google account and is an outward-facing act. Or
lift Stage C and run against production, which is the ruling that is already
waiting on the partner conversation.

### D201: the cost is projected before the run, not reported after it

`POST /api/email/context/build` now refuses to start when the projection exceeds
the allowance, and returns the projection with the outcome when it proceeds.

A stop that only fires part way through has already spent the money it was
protecting. The existing budget check was exactly that: correct, and evaluated
per call, so a run that would cost four times the allowance began, spent the
allowance, and stopped. That is a smaller loss than no stop at all and it is not
the same as not starting.

The estimate counts from the same predicates the pass uses, so it projects the
work that would actually happen rather than the size of the mailbox. Automated,
newsletter and notification mail never reach the context AI, and an estimate
that counted them would overstate the bill and then look broken when the real
run came in under it.

The per-thread token figures are averages from the 2026-09-01 measurement, and
are labelled as averages. A forty-message thread costs more than a two-message
one, and an estimate that pretended otherwise would be precise and wrong. What
it has to do is answer "does this fit in fifty dollars", and it does that.

The pass also takes a run name now and draws on the backfill allowance rather
than the month, which is what a corpus pass is for. D165.

### D202: a commitment becomes a proposal, and a person makes it work

The Action items screen is empty because nothing generates them, and the obvious
fix is to write extracted commitments into it. That is the move this design
exists to prevent.

A commitment is a model's reading of a sentence in an email. Some readings are
wrong. Action items are the one screen that says what Paul owes people, and
filling it with things he may not owe anybody would make it stop being believed
within a week; once that happens no amount of later accuracy brings it back.

So the chain is commitment, proposal, person, action item. `mail_action_proposals`
takes the shape `meeting_action_proposals` already proved: evidence attached, a
pending state, and a CHECK that refuses an accepted proposal pointing at
nothing. That CHECK fired during test teardown, which deleted the action item
first and left a proposal claiming it became work that no longer existed. The
constraint was right and the teardown was wrong.

Four refusals, each counted rather than silent. A commitment `owed_by: 'them'`
is somebody else's promise and belongs on a waiting-on view, not in Paul's list.
A commitment with no evidence is not offered at all, because a reviewer cannot
judge a claim they cannot check. A client is matched only on an exact domain,
never a free mail domain, since one gmail.com contact would file every personal
correspondent under that client. A project is chosen only where the client has
exactly one live one, because choosing between two is a guess and an unfiled
proposal is a question answered in a second.

No AI in the generator. The model did its reading when it extracted the
commitment; a second call to judge the first would be paying twice for the same
guess.

`commitments` gained an `evidence` column in 0040. Its `source_message_id` was
described as the provenance and it is, but provenance says where a claim came
from and evidence is the thing somebody reads to decide whether it is true. A
reviewer holding a four-paragraph email and a one-line claim was being asked to
find the sentence themselves.

### D203: a check that would have passed either way is not a check

The near-miss behind D200, recorded because the reasoning generalises and the
instance does not.

The question was whether 21 threads in the local database were real mail. The
check made was for the `v-` prefix that marks seeded rows, and none of the
threads carried it. That looked conclusive and proved nothing: the `v-` prefix
is the volume seed's convention, the mail fixture never used it, and the
observation was evidence about a different fixture. Real mail and fixture mail
both lack a `v-` prefix, so the check could not have come out any other way.

What settled it was the account domain. Both connected mailboxes were on
`.invalid`, the TLD reserved for exactly this purpose.

The rule, and it is a question to ask rather than a thing to remember: **what
would this observation look like if the answer were the other one?** If both
answers produce the same result, the check is decoration. It is the same family
as D180, where a safety test passed because the credential was absent, and D191,
where a guarantee was asserted in the process that asks rather than about the
system that answers. Each is a true observation supporting a conclusion it does
not reach.

Checklist item 8 now carries it as a worked example, because that item is about
confirming which branch occurred and this is the case where the confirming step
itself was the wrong instrument.

### D204: connecting Paul's own mailbox locally is not Stage C

Ruled, and worth separating clearly, because the two look similar and are not.

Stage C is firm data on a hosted database: MacGray's client names, project data
and file paths leaving this machine. That is the partner conversation, and it
stays held.

Connecting Paul's own Google account to the local real-data environment is his
own mail, on his own machine, under read-only scopes already granted and already
exercised on production. Nothing leaves anywhere. It is the corpus Pillar 4
needs and it carries none of the question Stage C carries.

The 775 threads already on production are also his, but reaching them means
lifting Stage C, so they stay out of reach for a different reason than the one
that applies to the mailbox.

### D205: a partner's calendar stores when they are busy and nothing else

Paul subscribes to his partners' calendars, and scheduling against them is
meaningless without them. Avoiding a meeting needs its start and its end. It
does not need the title, the description, the location, the attendees or the
link, and this app has no business holding any of it: those meetings belong to
people who never agreed to have them stored here.

So a calendar Paul does not own stores free and busy only. Times, the busy flag,
and which calendar it came from.

DECIDED FROM GOOGLE'S OWN `accessRole`, recorded on the calendar when the list
is read and already present before this ruling, so nothing had to be inferred.
Inferring ownership from the calendar's name would have been a guess, and a
calendar named after a person is not evidence about who owns it: Paul's own
calendars are named after him too.

ENFORCED AT THE WRITE, not at the read. Nothing about somebody else's meeting
reaches the database at all. A read-side filter would hold the data and depend
on every future query remembering to exclude it, which is the weak form of every
rule in this file: it survives exactly as long as everybody remembers.

The sync also clears anything a previous run stored, every time. A calendar
synced before this rule existed, or one whose access role changed after a share
was narrowed, would otherwise keep detail the rule forbids, and the property
would be true of the code and false of the database.

### D206: a privacy boundary must not look like a data failure

The calendar views rendered a missing title as "(no title)". Against a partner's
block that describes a deliberate decision as a bug, and somebody would
eventually go looking for it, find nothing, and either give up or "fix" it by
storing the titles.

A free/busy block now reads `Busy · <calendar name>`, which answers the only
question the screen can honestly answer: whose busy this is. An owned event with
no title still reads "(no title)", because on Paul's own calendar that is a real
absence and saying so is accurate.

One function, shared by every calendar view, because the interesting case is the
one that is easy to get right in some views and forget in others. It also
refuses to render a title even if one somehow reached the row, which is belt as
well as braces: the write path is the guard, and the screen is made incapable of
displaying what it should never have been given.

The flag the screen reads is derived from the access role in the query, not
stored on the event. A copy on every row would be a second answer that goes
stale the moment a share is narrowed.

No scope widened to make any of this possible. Still `calendar.readonly` and
`gmail.readonly`, and a test asserts it alongside the rest.

### D207: a table with three readers and no writer

`ai_budget_runs` was created in migration 0031. `openRun` read it, `checkAiBudget`
consulted it, `recordUsage` attributed to it. Nothing anywhere inserted into it.

So passing `run=pillar4-macgray-2026-09-02` to the context pass found no run,
fell through to the monthly ceiling, and returned `"run": "pillar4-..."` in the
response. Nothing errored. The parameter was accepted, echoed back, and inert,
and the report read as though the backfill allowance were in effect while the
month was being charged. That is exactly the mixing D165 exists to prevent, and
D165's own machinery was what failed to prevent it.

It cost sixteen cents to find. On the 775-thread corpus it would have consumed
the monthly ceiling and every ordinary call for the rest of the month would have
been refused, with the run reporting all the while that it was drawing on the
backfill allowance.

`openOrCreateRun` now starts a run when one is named, reopens by name rather
than starting a second so a resumed pass draws on the allowance it has already
been spending, and throws rather than continuing if the row cannot be read back:
carrying on would charge the month while claiming otherwise.

The response now returns the run that exists rather than the name that was
asked for. An id means the spend was attributed; a null means the month paid.
`run: runName` was true about the request and false about what happened.

**The sixteen cents from the first pass stay on the monthly ceiling and are not
re-attributed.** Retro-attribution would rewrite the record of what actually
occurred, and the record is that the run did not exist when the money was spent.

The generalisation for the checklist: **a table that is read in three places and
written in none is always empty, and every reader of an always-empty table
silently takes its fallback.** No test failed, because every individual piece
behaved correctly on the input it was given.

#### F-EMPTY-WRITER, named as its own family

Distinct from the two reasoning-error entries already in the read-first list,
and worth separating rather than filing under either.

- **D193** is a property asserted in the wrong place: the guarantee was checked
  in the process that asks rather than about the system that answers.
- **D203** is an observation that cannot discriminate: the check would have come
  out the same whichever way the answer went.
- **This** is a control whose state was never created. Every reader was in the
  right place and every observation discriminated correctly. The absence itself
  was the failure, and an absence reads as a default.

The rule, in three parts:

1. **Any table that gates a control must have its writer exercised by the same
   test that exercises its readers.** A test that only reads passes against an
   empty table for ever.
2. **A control asked about a named entity that does not exist must refuse rather
   than fall through to a default.** Falling through is how a missing thing
   becomes a silent substitution, which is D108 arriving from a new direction.
3. **A response must not name something it did not use.** `run: runName` was
   true about the request and false about what happened. That echo is part of
   the defect rather than incidental to it: without it somebody reading the
   report would have seen no run and asked why.

Checklist item 10.

### D208: what the first real-mail pass proved, and what it could not

Run `pillar4-macgray-2026-09-02` against the MacGray work mailbox. Every store
written, nothing skipped, nothing failed.

Proved: the chain runs end to end on real firm mail. Contact seeding from
headers with no AI. The projection reported before spending, and matching what
was spent closely enough to trust. The two-tier routing sending digests and
commitments to Haiku and profiles and voice to Sonnet. Extraction producing
commitments, and commitments becoming proposals with evidence rather than action
items. Exclusion holding: sixteen of seventeen threads were automated or
notification and never reached the context AI.

Not proved, and worth saying so plainly before a thin result is read as a broken
pass: nothing about accuracy at volume, nothing about how the passes behave over
hundreds of threads, and nothing about the voice profile's real quality. The
mailbox holds two days of mail because it was provisioned two days ago.

The voice profile did build, from two sent messages. I had predicted the
short-input refusal would fire and it did not: the guard rejects samples under
100 characters and refuses only when every sample is too short, which two real
messages passed. That is the guard behaving as written rather than as I
described it, and a profile drawn from two messages should be treated as a
placeholder. Worth revisiting once the corpus is real; not worth changing on a
sample of two.

Ongoing context building on this account runs on the firings within the monthly
ceiling, ruled and needing no further decision. The corpus builds as Paul works.

### D209: the accuracy audit, and the finding it actually produced

P4 asked whether the numbers can be trusted, with Asana as the tiebreaker. A
read-only audit compares three sides for a sample spread across size bands:
what Asana returns live, what the mirror holds, and what the app's own tickets
say. It corrects nothing, deliberately, because an audit that repaired as it
went would leave nobody able to say how wrong things had been.

Twelve projects, 953 live tasks. Ten agreed exactly on every field checked. Two
disagreed, both in the same direction: Asana had tasks the mirror did not.

**The projection is faithful.** In every one of the twelve, the app's ticket
count equalled the mirror's task count and the app's open count equalled the
mirror's open count, including in the two that disagreed with Asana. Not one
field-level discrepancy exists between mirror and app across 942 tasks. Whatever
is wrong, the projection is not it.

**The pull was accurate when it ran.** All eleven missing tasks were created
after the pull finished at `2026-09-01T16:23:10Z`, and none pre-dated it. The
single field disagreement is a task completed since. That check is the point:
"the mirror is missing tasks" looks identical whether the pull is lossy or the
tasks are new, so the observation could not discriminate until `created_at` was
compared against the pull's finish time. D203.

**So the real finding is that nothing re-pulls.** The mirror is a one-time
snapshot and the app is as stale as the time since it was taken, which after two
days is eleven tasks and one status across twelve projects. That is not a
correctness defect and it is not nothing: a project screen that is two days
behind will be wrong about anything decided in those two days, and it gives no
sign of it.

Three things follow, none of them done here because the ruling was to report
first.

1. An incremental re-pull on the cron firings, keyed on gid as the full pull is.
2. The staleness shown on screen. A number with no date is a number the reader
   assumes is current, and this one is not.
3. The audit kept as an instrument. It found the answer in one run and it will
   answer the same question after any future change to either hop.

### D210: the mirror catches up, and says how far behind it is

P4b, closing what the audit found. Two halves, and the second is the one that
would have been easy to skip.

**It asks Asana what changed.** `modified_since`, per project, live and archived
alike, on the cron firings. That is a query filter and not a cursor, and the
distinction is D169's entire point: identity and upsert stay on the gid, and
nothing uses a timestamp to decide where a walk resumes. A bulk edit returning
every task is then the right answer rather than a fault, because every task did
change.

The guarantee test that banned the string `modified_since` outright has been
narrowed rather than deleted. It now asserts what D169 actually meant, that no
cursor is a timestamp, and the reasoning is written next to it so the next
person does not have to reconstruct why a rule was relaxed.

The window overlaps the watermark by ten minutes. `modified_since` is exclusive
and two writes can land in the same second, so a watermark set exactly at a
finish time can skip a task modified during the run that produced it.
Overlapping is free because every write is an upsert keyed on the gid: re-reading
an unchanged row wastes bytes, missing one puts a wrong number on a screen.

The watermark moves only when a sweep completes, and it records when the sweep
*started* rather than when it ended. A watermark moved early opens a hole
exactly the size of whatever failed; one stamped at the end skips anything
modified while the sweep ran.

**It is a passenger, behind mail.** D107 was about a dispatcher starving the
work it exists for, and the answer is the same shape: digests and backups first,
mail second, this third, forty-five calls of a firing rather than all of it.
A full sweep needs sixty-eight, so one firing does not finish one, and that is
deliberate: an unfinished sweep leaves the watermark alone and covers the same
window again. It cannot throw, because a refresh that failed must not take a
digest with it.

**And staleness is shown.** Every screen fed by the mirror carries how old the
data is, in words rather than minutes, with a Sync now button. That was half the
original finding and the half with no numbers in it: the app was two days behind
and nothing anywhere said so. A number with no date is read as current. Gold
rather than red, because old data is worth noticing and is not an error, and D20
keeps red for overdue.

Measured on the real workspace: 68 calls, 24 changed tasks, and a re-audit of
twelve projects went from ten agreeing to **twelve of twelve, zero gaps**.

**One thing this does not cover.** Dropbox cannot be re-walked from a Worker,
which has no filesystem, so the daily re-walk is `scripts/dropbox-scan.mjs` run
on a schedule on this machine until the OAuth connector exists. Saying so rather
than implying the same mechanism covers both.

### D211: the dashboard counted a different kind of project

P8. The dashboard said 37 active projects. The Projects page, one click away,
said 42 live. Both numbers were right.

The dashboard counted projects whose status was not `done`; the page counted
projects Asana has not archived. Five projects are live in Asana with every
ticket finished, so the projection derives their status as done and they are
active by one definition and not by the other.

F15 in a second place, so the same fix: one expression in `project-state.ts`,
imported by both, with a test that fails if either spelling reappears anywhere
in the server code. Active means not archived, because archived is a decision
somebody made in Asana while status is derived from ticket completion and is a
health signal. A project whose work is finished and which nobody has archived is
still a live engagement, and calling it inactive would hide it from the one
screen that exists to show what is going on.

A cross-check test now compares the dashboard's active count, at-risk count and
open-ticket count against what the Projects page reports for the same things, so
the two cannot drift apart again without the suite saying so.

### D212: a zero with nothing behind it is not a zero

The other half of P8, and the half with no wrong number in it.

On the real data the dashboard showed 0 overdue items, 0 due today, 0 awaiting a
decision and no money past due. Every one of those was accurate and every one
was misleading: those stores are empty because nothing has ever been loaded into
them, while the project and ticket tiles beside them were reporting real work.
Same screen, two meanings of zero, no way to tell them apart.

"0 overdue" is good news. "0 overdue because no action item exists" is a gap. A
tile that says the same thing for both tells the reader the good news either
way, which is the failure D138 describes wearing a different hat: the number was
true and the claim it made was not.

So the cockpit now reports which stores hold anything, and a tile with no source
shows an em dash and "no data yet" rather than a number it cannot stand behind.
It is drawn quieter and it is not hidden: it still names what it would measure
and still links to the page that would fill it, because hiding it answers "why
is this missing" with silence, which is the same failure one step further along.
And a tile with no source never raises an alarm, since an alarm on a number that
does not exist is the loudest possible way to report nothing.

Four of the six tiles are currently unsourced on the real data. That is the true
picture, and it is the first time the screen has said so.

### D213: the weaker half of a ruling is labelled, not smoothed over

The staleness signal was ruled for every screen fed by a mirror, and the two
mirrors are not equally served. Asana refreshes itself on the cron firings.
Dropbox cannot: a Worker has no filesystem, so the re-walk is a local script
until the OAuth connector exists.

Both screens carry the age. Only the Asana one carries a Sync now button, and
the Dropbox one says what actually works instead. Rendering a button there would
be an affordance that does nothing, and D27 matters most on a control whose
whole purpose is to fix the thing it names.

The component takes the refresh path as a prop and draws no button when it is
null. That is the small version of a rule worth keeping: where two halves of a
ruling are not equally done, the screen says which half it is looking at rather
than presenting both as finished.

### D214: no-data is not zero, and it never alarms

The rule the dashboard finding produced, stated on its own because it applies
to every figure on every screen and not only to the six tiles that revealed it.

**A figure with no source renders as no-data, never as zero, and never raises an
alarm.** Zero means measured and none. No-data means never loaded. A screen that
spells them the same way is lying quietly in the one place people look first.

The alarm half is the part that would have been easy to leave: an alarm on a
number that does not exist is the loudest possible way to report nothing, and it
trains the reader to distrust every alarm on the screen.

The tile is still drawn, quieter, still naming what it would measure and still
linking to the page that would fill it. Hiding it answers "why is this missing"
with silence, which is the same failure one step further along.

Checklist item 11.

### D215: one review queue, on the page the reviewing is for

P3. Two extraction paths produce proposals, mail from correspondence and
meetings from transcripts, and each was reviewable only on the screen that made
it. So the review loop was invisible from the one page that exists to say what
Paul owes people, and a queue nobody passes is a queue nobody empties.

A union, not a third table. Both sides already carry a title, evidence, a
pending state and a link to whatever they became, and a shared table would mean
making the provenance columns nullable on both, losing the NOT NULL that makes
provenance real on each. D202.

One accept-and-reject route that dispatches on the source, because the reviewer
is doing one thing and should not have to know which extraction produced the row
in front of them. A future third source changes that file and not the page.

**Evidence is shown at the point of decision, not behind a click.** Somebody
deciding whether Paul really promised something needs the sentence in front of
them; making them open something first is how a queue gets cleared by accepting
everything. Where the message gave words rather than a date, the words are shown
as words: "said Wednesday, no date given". An inferred deadline becomes a fact
the moment somebody accepts.

**The two paths now refuse the same things.** The mail path had always declined
a proposal with no evidence; the meeting path stored a null and offered it
anyway, so the two queues asked different things of the same reader. It now
declines too, and reports how many it dropped, because a run that extracted
eight and offered six must be able to say so rather than looking like a model
that found less.

Found on the way, and worth its own line: `/proposals` was declared after
`/:id`, and Hono matches in definition order, so the literal path was
unreachable and answered "Action item not found" for a route that existed and
was correct. Nothing failed at build time and the handler was simply never
called. Asserted now rather than remembered.

### D216: the titles were not missing, the rule was applied in half the places

P5's first half. Declared and upcoming meetings rendered without titles, which
looked like data failing to load and was not.

Every event in the current window is on a calendar Paul does not own, so every
one of them carries no title by rule. The calendar views already routed through
the shared label and showed them correctly as busy. The meetings page and the
meeting detail did not: they rendered the raw summary, so the same events read
there as "Untitled call" and "(no title)".

One rule applied in two of four places is a rule that looks broken wherever it
was missed, and it looked broken everywhere because on this data every event is
non-owned. All four now go through `label()`, and the test that checked two
files checks all four.

The general form is worth keeping: when a rule has a single shared
implementation, the test should assert every call site uses it, not that the
implementation exists. The implementation was never the part at risk.

### D217: a week against the clock, and the packing proved separately

P5's second half. The upcoming list answers "what is coming up" and cannot
answer "where is there an hour on Thursday": five blocks in a list say nothing
about the gaps between them, and the gaps are the whole question when somebody
is placing a call.

So a grid. Seven columns, hours down the side, blocks positioned and sized by
their real times, an all-day row of its own because placing all-day events at
midnight would claim they occupy the small hours. Colour by calendar. Non-owned
blocks drawn with a hatch and quieter, because they carry less information by
rule and looking identical to a titled event invites the reader to wonder what
happened to the title.

The hour range is not a fixed nine to five. It covers the working day and then
stretches to whatever the week actually contains, because an event outside a
fixed window would be invisible on the one screen meant to show everything.

The grid scrolls inside its own box at 412px. Seven columns cannot fit a phone
and squeezing them produces columns too narrow to read; what matters is that the
page never scrolls sideways. D22.

**The overlap packing is a pure module with its own tests, and that is the
point.** A real week often has no overlaps, so live data does not exercise it:
the packing could be wrong for weeks and fail only on the day two calls actually
clash, which is the day it matters. Nine cases, including the ones live data
will never produce — a zero-length event, an event ending before it starts, and
two events starting in the same minute, which must not swap places between
renders.

A block drawn over another hides it, and a hidden meeting is worse than no
calendar: the reader believes the slot is free and books over it.

### D218: extraction on two real transcripts

Run on the 09-02 onboarding meeting and the 09-02 workflow automation meeting,
under the monthly ceiling.

| | onboarding | workflow automation |
|---|---|---|
| transcript | 40,129 chars | 21,704 chars |
| extracted | 14 | 10 |
| offered for review | 14 | 10 |
| skipped for want of evidence | 0 | 0 |
| carrying a stated deadline | 4 | 1 |
| flagged ambiguous | 11 | 10 |
| naming an owner | 12 | 9 |

Both on Sonnet. Nothing was skipped, which says the model produced a supporting
sentence for every item it proposed rather than that the refusal is inert: the
refusal is asserted separately in the suite.

Five of twenty-four carry a real date and nineteen do not, which is the
behaviour the design wants. A transcript is full of "next week" and "before the
board meeting", and turning those into dates would fabricate deadlines that
become facts the moment somebody accepts.

**Neither meeting was attributed to a client or a project, and neither should
have been.** They were created with no client link and nothing infers one from a
transcript. An unattributed meeting is a question Paul answers in a second; a
meeting filed against the wrong client is invisible and gets believed. D175 in
another place.

The unified queue now holds 27 pending, 24 from meetings and 3 from mail, every
one carrying its evidence. Month-to-date AI spend is $0.48 of the $30 ceiling.

### D219: the join link, and what P6 actually found

P6 asked for attendees, organizer, location, description and a conferencing link
on owned events, on the report that attendees were missing.

**Attendees were not missing.** The detail route already returned them and the
panel already rendered them: the one owned event in the window carried three,
with organizer and response status, and they displayed. Eleven of the twelve
events in view were on calendars Paul does not own, which by rule have no
attendees at all, so the panel he opened had none to show. Same shape as the
title finding an hour earlier, and the same reason: on this data almost
everything is non-owned, so a correct absence reads as a failure.

Organizer, description and the meeting link were also already there. Location
was shown on the row but not in the detail, which is now fixed.

**The real gap was the join link, and it had never been read at all.** Google
carries it as `hangoutLink` for Meet and inside `conferenceData.entryPoints` for
Zoom, Teams and the rest. Neither was requested or stored. It is the one thing
anybody actually clicks on a calendar entry with two minutes to go, and a screen
showing every other detail of a call except the way into it is a screen somebody
leaves for Google Calendar.

Video entry points are preferred over the first available, because a dial-in
number is not what somebody means when they say "the link".

**It went behind the privacy boundary at the moment it was introduced.** A
partner's join link is a door into a room, and the furthest thing from free and
busy there is. The sync writes null for any calendar Paul does not own, the
retroactive clear covers it, and the boundary test gained the field in the same
change rather than later. Re-verified on the live data after a full calendar
refresh: 360 events, 5 owned and all 5 carrying a link, 355 non-owned and not
one carrying any of the seven forbidden fields.

The general form went to the checklist as item 6b: when a rule has one shared
implementation, test that every call site uses it. The implementation was never
the part at risk.

### D220: a correct absence reads as a failure, and the fix is the label

Named because it happened three times in one evening, on three different fields,
from one cause.

Almost every calendar event in view belongs to a calendar Paul does not own. By
rule those carry no title, no attendees, no location and no link. So: titles
looked missing, then attendees looked missing, then the detail looked thin.
Every report was reasonable and none of them was a defect.

**Where a privacy or scoping rule empties most of a view, the correct state is
indistinguishable from a failure to anyone who does not know the rule.** And the
remedy is always the label, never relaxing the rule. `Busy · calendar name`
rather than `(no title)`. An empty state that names why it is empty rather than
one that implies a sync failed. A figure with no source that says no-data rather
than zero.

The question to ask before shipping a rule that hides things: **what will this
screen look like to somebody who does not know the rule?** If the answer is
"broken", the labelling is not finished, and the rule will come back as a bug
report every time somebody new looks at it.

The tell is a run of missing-data reports about different fields on the same
screen. One rule is emptying all of them.

Checklist item 6c.

### D221: the Quick Add audit, and the one thing it found

P1, reported before building as ruled.

**One defect.** Quick Add's Meeting form has a Notes textarea. The value is
posted as `notes`, `/api/meetings` does not accept it, and the meetings table
has no column for it. The request returns 200 with the meeting, and the note is
gone. Verified empirically rather than by reading: a probe row created through
the API came back with the field absent from every text column, and the probe
was removed afterwards. A field that takes input and silently discards it is
worse than a field that is missing, because the person believes they wrote
something down.

**Coverage gaps, where the page offers a field and Quick Add does not.**

| Kind | Missing against its destination |
|---|---|
| Ticket | `start_date`, `estimate_hours`, `status`, `reporter` |
| Project | `owner_id`, `start_date` |
| Meeting | `recording_url`, and Notes goes nowhere |
| Action item | `meeting_id` |
| Client, Ledger, SOP, Template, Invoice | none found |

**Two things checked and found not to be defects**, recorded because both looked
like one on first inspection. The Client form's `rate` field is converted to
`default_rate_cents` rather than dropped, and its contact fields are handled by
`invoicing-clients.ts`, which creates a contact row. The Template form's fields
are sent; an earlier reading that said otherwise was an artifact of splitting the
file on a key that also appears nested inside `fields`, which shifted every save
block by one kind. Parsing by object boundary fixed it, and the empirical check
is what settled the rest.

That misparse is worth its own line: a source-reading audit can be wrong in a way
that produces a confident, plausible, entirely fictional table. Two of the three
"findings" it produced were artifacts.

### D222: a guard proven only by passing is a family, and this is its third member

D116 said it about tests written after the code. D80 said it about a guard whose
dangerous path was unreachable for an unrelated reason. Naming the family now,
because a third instance means the rule generalises past the case that produced
it.

The three:

1. **D80.** A matcher that named the index rather than the column. It could not
   have failed, because what it looked for was never present.
2. **D116.** Guarantee tests written after the code, passing on their first run.
   Mutation checked afterwards as the honest substitute for writing them first.
3. **This one.** The static check that Quick Add sends every field it renders
   passed on its first run, and passed again with a deliberately unwired field
   injected into the form. The escaping had collapsed one level, so the regex
   was matching a backspace character rather than a word boundary. Rewritten
   without escapes, it failed on the injected field and passed when the field
   was removed.

The shared shape: a green run was read as evidence that a guard works, when it
is only evidence that the guard did not object. Those are different claims, and
the second is also what a broken guard produces.

The rule, which is now general:

**A new guard has demonstrated nothing until it has been seen to fail. Break the
thing it guards, watch the failure, restore.** Writing the test before the code
gets this for free, which is why it remains the better order. Where that did not
happen, the deliberate break is the substitute, and skipping it leaves a green
line standing in for a property nobody has examined.

Worth saying plainly: the injected field was found by trying, not by reading.
Re-reading the test would not have shown it. The escaping looked correct in
every rendering of the source except the one the regex engine saw.

### D223: one rich-text editor, stored as two columns

P2. Ticket descriptions, project and client notes, meeting notes and SOP bodies
were plain textareas. A description pasted out of Asana arrived as a wall of
run-together sentences with its lists and emphasis stripped, and the structure
was how the writer had said what mattered.

**One component, not one per screen.** `RichTextEditor.svelte` is the only
editor and `RichText.svelte` is the only reader. The interesting case is the one
that is easy to get right in some places and forget in others, and a second
editor written later would arrive with its own paste handling, its own idea of
what is allowed, and its own bugs. The ticket page had two boxes for the same
description, one in the inline edit form and one in its own card; the inline one
is gone, because two boxes for one field is how the two get different content and
which one wins depends on which the reader happened to open.

**Two columns, not a changed one.** The HTML goes in `<field>_html` and the
plain-text projection stays in the original column. Search, the digests, the AI
prompts, the CSV exports and every screen that reads those fields today keep
working untouched, and none of them had to learn about markup. The projection is
derived from the HTML on write by one function, so the pair cannot drift. A row
with a NULL html column is one nobody has edited since this shipped, and it
renders as the plain text it always was.

**Parsed and rebuilt, never filtered.** The same approach as `email-html.ts` and
the markdown renderer, and it is stronger than sanitising. Nothing filters a
hostile string and hopes it caught every vector. The input is parsed into a
validated tree and the stored string is built back up from that tree with every
piece of text escaped, so the output can only contain constructs `rich-text.ts`
knows how to emit. `{@html}` appears nowhere in the feature: the renderer walks
the tree emitting real Svelte elements.

**The server is the boundary.** The editor sanitises too, but that is a courtesy
to the writer so that what they see is what will be stored. The value that
reaches the database is the one the route built out of a parsed tree, because a
request can be posted by anything and a guard that lives only in the page is a
guard an attacker skips. The tests post hostile HTML straight at the route with
no browser involved, and one of them reads the sqlite file directly, because the
question is what is at rest and not what a query happens to return.

**The allow list is Asana's**, so a description round-trips. `h1` and `h2` are
stored as themselves rather than demoted, because the stored value has to match
what the workspace holds; the renderer maps them down to `h3` and `h4` at draw
time so a page keeps its single `h1`. GOLDEN RULE unchanged: nothing is written
back to Asana.

Two things the tests found, both by being written first:

- **A paragraph boundary is a blank line, a line break is one newline.** The
  first projection collapsed both to a single newline, so converting text to
  HTML and back lost a paragraph boundary on every pass. A note saved three
  times would have arrived as one block.
- **Idempotence is a property worth asserting.** A sanitiser that rewrites its
  own output changes the stored value on every save, which moves `updated_at`
  and makes every comparison against the mirror report a difference that is
  really the sanitiser's fault.

And one from the break exercise, which is the interesting one:

**Each defence held when the other was removed.** Deleting the discard set alone
did not let a script through, because the tag was then not in the accept map.
Making the accept map pass unknown tags through alone did not either, because
the discard set had already thrown the script away. Only breaking both at once
produced a failure. That is defence in depth working rather than a vacuous test,
but it is worth writing down: a single-guard break that does not fail may mean
the guard is dead, or may mean a second guard caught it, and those look
identical from the outside. Break to the point of failure, then restore.

### D224: the house SOP shape, and a log that makes compliance a number

P7, and the last of the eight. SOP-001 was written against a real recorded
session and reviewed for shape rather than for content. What survived that
review is now `src/lib/sop-template.ts`, and every new SOP starts from it.

**Why a template and not a convention.** A procedure written from a blank box
gets the parts its author was thinking about and misses the parts that only
matter when something has gone wrong. Each section earns its place:

- **Roles with a deputy.** A procedure that names one person is a procedure that
  stops when that person is away. SOP-001 is the case: the Filer has steps 2
  through 8 against them, and the deputy is deliberately left as `[TO BE NAMED]`
  because inventing one would have been the easiest thing in the document to get
  wrong.
- **Timing on every step.** "Then file it" is not a schedule. Without a deadline
  per step, work that is merely late is indistinguishable from work that was
  skipped. Same day for Generate, because an ungenerated recording does not fail,
  it waits, and waiting is invisible. Next business morning for the rest, because
  same-day filing would be better and is not realistic, and a deadline nobody
  holds is worse than none.
- **A check on every step.** A step with no check cannot be verified, so nobody
  can say whether it happened.
- **Failure modes keyed on the symptom**, because the symptom is what the reader
  has when they come looking.
- **Propose, review, push** wherever something produces work for a person.
  SOP-001's steps 6 and 7 are written that way now, so the Command Center taking
  the extraction over later is a change of tooling and not a change of policy.
  Nothing reaches Asana that a person has not reviewed.

**The verification log is a table in the app, not a section in the document.**
Migration 0045. One row per check: who, when, which step, what was being looked
at, and pass or fault. Two things fall out of the same rows, which is the point:
whether the procedure was followed, and how often it fails. The fault rate for
the Plaud automation was anecdotal, and "it gets it wrong sometimes" is not a
number anybody can take to the person who built it. This closes SOP-001's first
open question.

Three properties, each of which had a reason:

- **Append only.** No route edits or deletes an entry. A compliance log that can
  be tidied up afterwards is not evidence of anything, so a mistaken entry is
  corrected by logging the right one and both stay visible.
- **A fault requires a note.** Checked at the route so the reader gets a
  sentence, and again as a CHECK constraint so the rule is true of the data.
  Those are two guards, not one: removing the route check turns a 400 into a 500,
  which is how they were told apart. D223's rule applied.
- **No fault rate until something has been verified.** Null, never zero. A rate
  of 0% reads as "this never fails" and "nobody has checked" is the opposite
  claim. D220, in a fourth place.

**SOP-001 is authored in the repo and installed by a script**, not by a
migration. It is real firm procedure and belongs in the real database; a
migration would put it into the fixture too, where layer 1 asserts the exact set
of SOPs and would fail on a row the generator never made.

**It is a DRAFT and nothing here can approve it.** Approval is Dustin's act. The
status is in the title, in the body and in the installer, and the tests assert
that none of them says otherwise. A document that arrives already looking
approved is how an unapproved procedure gets followed.

Two findings from building it:

- **An entity the decoder did not know was corrupted on the first save.** The
  template used `&mdash;`, which was not in the table, so it passed through as
  literal text and was escaped into a visible `&amp;mdash;`. Not recoverable
  afterwards. The table now decodes the punctuation pasted content actually
  carries, faithfully rather than to an approximation: this content is stored and
  read back, so a character that goes in has to come out. (The template itself no
  longer uses one, per the house style rule.)
- **The installer compared the wrong two things.** It checked its generated HTML
  against the stored HTML to decide whether to write a new version. Those are
  never equal, because the route parses and rebuilds every value: the stored form
  is canonical and the generated form is not. Every re-run therefore added an
  identical version, and on an append-only table that cannot be undone. SOP-001
  carries versions 2 through 4 as a result, and they stay, because deleting them
  is exactly what the trigger exists to prevent. It now fingerprints the source
  it sent and carries the hash in the change note, so "unchanged file, no new
  version" means what it says.

### D225: the uncommitted source, and the shape of an honest skip

SOP-001's authored source stays out of version control. `docs/data/` is already
ignored because it holds real client data, and the SOP names clients, staff and
a confidentiality exception. Putting it in a remote repository is the same
one-way step that rule exists to prevent.

That leaves a real problem: the test asserting SOP-001's content cannot run on a
checkout without the file. Two wrong answers were available and both were
rejected.

**Committing the file** would fix the test by breaking the rule, which is the
wrong direction: the rule is about client data and the test is about
convenience.

**Failing hard when the file is absent** was the first attempt, and it is wrong
for a different reason. A bare checkout cannot then run the suite at all, and
"the suite does not run here" quickly becomes "the suite is not run".

The answer is a skip that announces itself, plus a named check that bites:

- The suite **skips the SOP-001 content tests with a stated reason** when the
  file is absent, and prints `SOP source not present, install unverified`. The
  run is green and visibly incomplete, and vitest counts them as skipped rather
  than passed. A skip that says nothing is the silent-pass failure mode this
  project keeps finding; a skip that names what it did not check is not.
- **`npm run verify:sop`** is the half that bites. It checks the installed
  record against the authored source and fails, with exit 1, when they disagree,
  when the SOP is missing, or when either the document or the record has stopped
  saying DRAFT. It exits 0 and says so plainly when the source is absent, so
  "not checked" is never dressed up as "checked and fine".

Proven by breaking it: an edited source that was not reinstalled, a deputy
filled in without Dustin naming one, and DRAFT removed from the status line all
produce exit 1 with the reason named. All four exit paths were checked, because
a check that reports a failure and exits 0 is the same silent pass wearing a
different coat.

**Fingerprint the source, not the output.** The general form, from the installer
bug in D224: an idempotent installer must key on what it sent, not on what came
back. Anything that parses and rebuilds a value makes the stored form canonical
and the generated form not, so those two are never equal and the comparison
always says "changed". Both the installer and the verifier now hash the markdown
file, which also means the verifier does not carry a second copy of the
markdown-to-HTML converter that would have to be kept in step with the first.

The three noise versions on SOP-001 stay. They are history, the immutability
trigger exists to prevent exactly the tidying that would remove them, and
deleting them to make the record look clean is the thing the rule forbids.

### D226: the second writer, found by reading the row back

Ordered as an exercise, not as an investigation: the run allowance attribution
path had never been observed, so run one real metered call inside a named run
and read the row back out of `ai_run_usage` rather than trusting a 200. It sits
on a money path, so D166 applies.

The exercise found a defect the code review would not have.

**What was wrong.** `context.ts` carried a private `record()` that inserted into
`ai_usage` directly, with no run attribution, alongside the `spend()` that calls
the shared `recordUsage()`. Both fired for every AI call the context pass made.
At lines 569 and 570 they sat on consecutive lines.

Almost certainly a leftover. `record()` predates the metering work of D165, and
`spend()` was added beside it rather than in place of it. Every test passed
throughout, because no test had ever counted the rows a single call produced.

**What it cost, in three ways.**

1. **The meter double counted.** One model call, two `ai_usage` rows, identical
   tokens, one second apart. Six such phantom rows exist in the real database,
   overstating spend by $0.0749.
2. **The two allowances mixed.** The attributed twin charged the run; the
   unattributed twin charged the month. So naming a backfill run did not keep
   its spend off the monthly ceiling, which is the one thing D165 says the two
   allowances must never do. The mechanism looked correct at every call site and
   was defeated by a second call site nobody was looking at.
3. **The ceiling fired early**, at roughly twice the true rate for context
   passes. That errs safe, and a stop that is wrong in the safe direction is
   still wrong.

**How it was found, and this is the part worth keeping.** The instruction was to
read the row back rather than trust the response. The response was correct:
`calls: 1`, one call's worth of tokens, a named run echoed back. The database
had two rows. Nothing in the API's answer could have revealed it, and nothing in
the source review did either: both writers are individually correct, and the
defect exists only in their sum.

The first attempt to localise it was wrong in an instructive way. The probe
placed in `recordUsage` logged **once** while two rows appeared, which was read
as "one call, two inserts" and sent the search towards retries and
double-dispatch. The probe was in the wrong writer. Only `grep "INSERT INTO
ai_usage"` across `src/lib/server` settled it, and that search took ten seconds.
**When an instrumented path disagrees with the data, consider that the data came
from somewhere the instrument is not.**

**The fix.** `record()` and its four call sites are gone. `spend()` did
everything it did, plus attribution.

**The guarantee.** A source scan in the shape of D166: exactly one file under
`src/lib/server` may contain `INSERT INTO ai_usage`, and it must be
`ai-usage.ts`. Asserted as exactly one rather than at most one, so that a scan
finding nothing fails instead of passing. Proved both ways: reintroducing a
second writer fails it, and renaming the only writer's table fails it too.

The first break of the second kind was ineffective and is worth recording,
because it is the same trap as the `<u` matching `<ul>`: renaming the table to
`ai_usage_renamed` still matched `/INSERT\s+INTO\s+ai_usage/`, so the test passed
and briefly looked vacuous. It was the break that was wrong, not the test. **A
break that does not fail has to be checked for being a real break before it is
read as a dead guard.** That is the third distinct way a member of the D222
family has appeared, after D222's own case and D223's layered-guard ambiguity.

**The phantom rows stay.** Six of them, $0.0749 overstated, all in the local real
database. A spend ledger should not be edited by the thing that got it wrong,
and the error is in the direction of stopping sooner. They are recorded here so
the next person reading the meter knows why the figure is high rather than
concluding the fix did not work.

**Verified after the fix**, on real data: one forced call, exactly one `ai_usage`
row, attributed to the run, and `month_to_date_usd` did not move.

### D227: sections become status by decision, and the survey is why that matters

Pillar 2, under the ruling that the 281 verbatim sections map to coarse status
through an editable crosswalk with provenance on every row, never through
inferred logic, and that an unmapped section renders as unmapped and never falls
into a default bucket.

**The survey came first, and it changed what the feature is for.** MacGray's
sections are not workflow status. Across 103 distinct names:

| What they are | Examples | Tasks |
|---|---|---|
| Business function | Sales, Finance, Operations, Marketing | 1,362 |
| Engagement phase | "Phase 2 - Weeks 1-3 - Instacart Next Steps", 39 names | ~150 |
| Ad-hoc grouping | Costco Launch, 2500 Can Trial, Sprouts Demo Event 1/22 | rest |
| Asana's default | "Untitled section", across 60 projects | 203 |

A status-vocabulary match found three names and **all three were false
positives**: the word "Review" inside a phase title. So on this data essentially
no section carries a status, and the crosswalk starts fully unmapped and will
stay mostly unmapped.

That does not weaken the ruling, it is the argument for its hardest part. A
feature built on the assumption that sections mostly are statuses would have
made "unmapped" a rare edge case and rendered it as a gap. Here it is the normal
state, and it has to read as a question nobody has answered rather than as
something broken.

**`not_a_status` is a mapping, not an absence.** The addition, and it is the
load-bearing one. "Sales is a business function and carries no status" is a
decision somebody made. "Nobody has looked at Sales" is not. Both produce no
status for the task, and collapsing them would leave no way to mark a section as
considered, which makes the reconciliation impossible to finish: the screen would
show 103 outstanding items forever. Fourth appearance of the D214 and D220
shape.

**The answer does not go in `tickets.status`.** That column is NOT NULL with a
CHECK, so writing a section-derived status into it would force every unmapped
section to pick one, and `open` would become exactly the default bucket the
ruling forbids: 2,400 tasks claiming a status nobody assigned, on a screen that
then looks finished. Migration 0047 gives it its own nullable column with
`section_status_via` beside it, and the app's own status keeps meaning what it
has always meant.

**Precedence in one place**, the same chain as the client crosswalk in D181:
section gid, then verbatim name, then unmapped. Exact match including case,
because Asana treats "sales" and "Sales" as two sections and so must this.

**Provenance is required and is not defaulted.** `mapped_by` has no server-side
fallback. A field the server fills in says nothing, and the point of the record
is that a year from now somebody can tell a decision from an inference. The
`source` column admits only `manual` and is a column rather than a constant, so
adding an inferred mapping later is a schema change somebody has to justify.

**Refusals proved by breaking them.** Defaulting unmapped to `open` fails five
tests; case-insensitive matching fails two; collapsing `not_a_status` into
unmapped fails two; accepting a status outside the vocabulary and defaulting
`mapped_by` each fail one.

The precedence break is worth recording as a D223 case. Flipping the `??` alone
changed nothing, because a short-circuit in the name lookup already enforced the
order. Only removing both guards fails the test. Two guards, one property, and
the single break was ambiguous exactly as D223 says.

**Deleting a mapping is allowed**, unlike a SOP verification. A mapping is a
working judgement about somebody else's vocabulary, not a record that something
happened, and being wrong about it should be correctable rather than only
overwritable.

**Nothing was decided on Paul's behalf.** The write path was exercised against
the real database and every test row removed. `section_status_map` on the real
data holds zero rows, and all 103 names are undecided with 2,185 tasks under
them. Those rulings are Paul's, and a crosswalk seeded with this session's
guesses would be the inference the whole design refuses, wearing a person's name.

### D228: the conflicted case was ruled, and then found unreachable

Ruled: where a ticket resolves to more than one mapped section status,
`section_status` reads `conflicted`, never a pick, and conflicted is visible and
countable. The reasoning was right and the case does not exist here.

**The hypothesis, and its disproof.** The concern was that 2,185 counts section
memberships rather than tasks, so a task in two projects carries two, and two
mapped sections could then disagree. Checked against the mirror rather than
argued:

```
asana_tasks rows                     2597   all distinct gids, no duplicates
  top-level                          2183
  subtasks                            414
tasks carrying a section             2185
  top-level, sectioned               2183
  top-level, no section                 0
  subtask, sectioned                    2
  subtask, no section                 412
tasks with more than one section        0
task gids appearing twice               0
tasks in more than one project          0
```

2,185 is distinct tasks. It exceeds 2,183 because **two subtasks carry a
section**, which Asana permits. The figure and the mirror do not disagree; the
comparison used top-level tasks as the denominator and the count is of sectioned
tasks, which spans both populations.

**Why nothing was built.** `asana_tasks.gid` is the PRIMARY KEY and `section_gid`
is one column on that row, so one task is one row is one section. The conflicted
branch is not rare, it is unreachable, and a branch that cannot execute carries a
test that cannot fail. That is the D222 family in the form that looks most like
diligence: dead code with a green test beside it.

**What was built instead.** Three assertions that the case stays unreachable, so
the day it becomes reachable is the day the suite says so:

- the schema declares one section column, counted by line
- neither database holds a task with two sections, or a gid twice
- no task sits in more than one project

The third is the real one. Asana genuinely allows a task in several projects and
`asana_task_projects` exists to hold that; the mirror records the one project and
section it was pulled under, which is a lossy flattening nobody had written down.
If a future pull carries full membership, a task gains two sections, that test
fails, and the conflicted rule has to be built then. The ruling stands, held
against the condition that makes it necessary.

Proved by breaking it: a second section column in the migration fails the schema
assertion.

### D229: a name-keyed ruling reaches every project that uses the name

Produced by "Untitled section", which appears in **60 projects** and means
nothing in any of them.

Keying the crosswalk on the verbatim name is right for the firm's own words:
"Finance" is one function and one ruling should cover its 26 projects. It is
wrong for Asana's defaults and for generic words, where a "To Do" in one
engagement and a "To Do" in another are two agreements that share four
characters. The per-section key already existed for that case and **nothing on
the screen said when to reach for it**.

The spread, measured rather than assumed: **22 of 103 names appear in more than
one project.**

| Name | Projects |
|---|---|
| Untitled section | 60 |
| Finance | 26 |
| Sales | 19 |
| Operations | 19 |
| Marketing | 14 |
| Hours | 11 |

So the screen shows the project count on every row, and where it is greater than
one the ruling cannot be recorded until the reach is acknowledged. The
acknowledgement sits beside the count rather than in a dialog, because the
number is the reason for the question.

**Byte-identity confirmed rather than assumed.** Exact matching means a trailing
space or a non-breaking space would render as permanently unmapped with no
explanation. All 103 names were checked for leading and trailing whitespace,
non-breaking spaces, tabs, newlines, doubled spaces and invisible format
characters: **zero need attention**. So exact match stays, and no normalisation
was added, because a normaliser nothing needs is a fuzzy match waiting for a
future name to reach it.

### D230: a figure known to be wrong says so where it is read

Asked for, not delivered, and reported here as such: the correction shipped a
day after the finding, and in the interval the meter rendered a number known to
be high as though it were right.

D226 found the double-write, quantified it at six rows and $0.0749, and ruled
that the rows stay because a spend ledger should not be edited by the thing that
got it wrong. All of that was correct. It put the correction **in the decision
log only**, which is not where anybody reading the meter looks. Being right in a
document does not fix a screen, and D214 is precisely about a figure that cannot
be told apart from a correct one.

**What ships.** `src/lib/server/spend-delta.ts` detects the duplicate pairs and
renders a sentence beside the figures on Settings:

> These figures are high. 6 of the calls counted here happened once and were
> recorded twice, by a second writer that has since been removed, which adds
> $0.0749 and 6 calls that never happened. The last one was on 2026-09-03 and no
> more can be added; the rows are kept rather than deleted, because a spend
> ledger should not be edited by the thing that got it wrong.

In words, with the date it stopped, because a known error with no end reads as
an ongoing one.

**Derived, never written down.** The count, the amount and the date are computed
from the rows on every read, and a test asserts the module contains no hardcoded
figure. Writing "6" and "$0.0749" into the correction would have reproduced
F-VERIFIED-FIGURE-UNVERIFIED-LABEL inside its own remedy: a caption from memory
beside a number from storage. Checklist item 15.

**Two scopes, one detector.** The monthly figure excludes run-attributed rows,
so its delta must too, or the correction is wrong in the other direction. The
Settings meter counts every row, so its delta counts every duplicate. Same
function, a scope flag, because two detectors would disagree about the same rows
one day. The month sees four of the six; the meter sees all six.

**Bounded at the fix.** The detector stops at `DOUBLE_WRITE_FIXED_AT`. Without
an upper bound it would report any future coincidence as a known error, turning
a closed correction into a permanent alarm and training the reader to ignore it.

**Silent when there is nothing to say.** The fixture has no duplicates and shows
no banner. A standing "no known errors" notice is noise, and noise is what makes
a real notice invisible.

Proved by breaking it: a detector that always returns null fails two tests, a
hardcoded amount fails two, and removing the upper bound fails one. The
duplicate it detects in the fixture is one this test wrote, so the detector has
been seen to find something that was not there before.

### D231: gaps from the mirror, and the three ways it could be quietly wrong

W3. "Find a time" already existed and asks Google live, which is right when the
answer must be current. This is the other one: it reads the calendar already in
the database, so it needs no network, no per-person email, and cannot fail per
calendar. The use case is the SOP scheduling work.

**The privacy rule did not move, and it cost this feature nothing.** Six of the
seven calendars store free and busy only, per D205: start, end, and nothing
else. That is exactly and only what a gap search needs, so the boundary and the
feature want the same shape of data. The query reads `starts_at`, `ends_at` and
`all_day` and nothing more, and a test names each forbidden column. An earlier
draft selected the calendar's own name for no reason; it is gone, because a busy
block that arrives carrying whose it is has brought more than the computation
needs, and the wrong instruction to leave behind is worse than the row.

If this feature ever needs to know what a meeting is in order to place something
around it, the answer is no and it does without.

**The zone is computed, never written down.** Paul works US hours from GMT+8
against calendars in Mountain, so the clock the answer depends on is the one
nobody involved is sitting in. Mountain is minus six in summer and minus seven
in winter, and the first draft hardcoded minus six, which is right for half the
year and confidently wrong for the other half. Wrong here means a suggested time
somebody has already filled.

So the offset is derived from `America/Denver` at the window's start, taken from
the shared working-zone constant so this route cannot drift from the rest of the
app, **returned in the answer**, and rendered on screen beside the hours. A test
asserts the offset is not a literal.

**A window that straddles the clock change is reported, not silently picked.**
`findSlots` takes one offset for the whole window, so a fortnight across the end
of daylight saving is an hour out for part of it. Detected by comparing the
offset at both ends, and said on screen.

**An unloaded window is no-data, never all-free.** D214 applies harder here than
anywhere else in the app, because the output is an invitation to book something.
A window with no events returns `slots: null` with a reason, not an empty list:
searched-and-found-none and never-loaded are different claims and only one of
them means the week is clear. Freshness travels with the answer, in words, and
the real mirror is currently 23 hours old.

**All-day entries are set aside and named.** Five of 360 rows. An all-day entry
is a marker far more often than a wall, and twenty-four hours of busy erases the
day; but some are real leave, and that is exactly the day not to book. So they
are excluded, counted, and their dates listed on screen for the reader to check.
The tool does not guess, and does not hide the guess it declined to make.

**Coverage is stated, because partial coverage is the real hazard.** A gap
computed from some calendars offers times the others have filled, with the same
confidence as a correct answer. Confirmed by query rather than assumed: **seven
calendars known, six synced, one reader switched off and contributing nothing.**
The route reports known against synced and the screen says when they differ.
That one calendar is a fact for Paul, not a defect: its busy time is invisible
to this feature and to the calendar screen, and only he can say whether that is
intended.

Proved by breaking it: hardcoding the offset, selecting the event summary,
counting all-day rows as busy, and answering from an empty window each fail a
test that names the reason.

### D232: the one word naming the privacy boundary was wrong about six rows in seven

W5a, and it went first because it sits on the boundary rather than because it
was large. Under an hour.

**What it said.** The calendar page printed `yours, primary` or `yours` against
every row in the calendar list, with **no ownership check at all**. Live, that
is one owner and six read-only shares:

| Calendar | access_role | Was labelled |
|---|---|---|
| paul@macgrayconsulting.com | owner | yours, primary |
| dustinfinkel@, john@, mallory@, meredith@, rock@ | reader | **yours** |
| Holidays in Philippines | reader | **yours** |

**Why it matters more than a wording slip.** That line is the only place on the
screen that names who a calendar belongs to. Paul is the person who would have
to tell Dustin what this app holds about his diary, and the screen was telling
him five partners' calendars were his own.

**The rule existed and was applied in one place of two.** `CalendarList.svelte`
had split correctly on `access_role === 'owner'` since it was written. The
calendar page never asked. That is the D216 shape again, and this instance is
worse than the original: a rule half applied usually looks broken where it was
missed, and here the missed half looked confident.

**The fix says what is stored, not only who owns it.** A non-owned calendar
reads `shared with you, busy times only`, because "shared with you" answers the
ownership question and leaves the one Dustin would actually ask. D205 stores
start and end and nothing else for these calendars, and the label now says so.

One function in `calendar-label.ts` beside the event label, so the next screen
that lists calendars cannot get a third answer. Absent `access_role` means owner,
matching the default the sync and both event queries already use, so a calendar
read before roles were recorded does not silently become somebody else's on the
screen while staying Paul's in the database.

Verified on the running app: one `yours`, six `shared with you, busy times only`.
Proved by breaking it both ways, in the module and at the call site.

### D233: a page is ordered by what the reader came to do

W5b. The Action items page opened with five summary tiles reading zero and a
filter row reading zero. Twenty-seven decisions waited below them, each in a
card taking about a quarter of the viewport. The first screen of a page about
pending decisions carried no content at all, and the headline number on it was a
column of noughts.

**The interface was the thing delaying the verdicts.** They were never blocked
on Paul's attention. Twenty-seven decisions at that size is a scrolling
exercise, and the queue is the decaying item in the whole programme: the
transcripts fade and the verdicts are the requirements document for extraction.
That makes this a build item, and it was found by looking at the running app
rather than by reading reports about it.

**The queue moved above the tiles**, and the ordering is now asserted in the
browser suite. A summary that reads zero never outranks a queue beneath it.

**The card became a row.** Title and context share a line, the quote sits under
them, and both verdicts are on the row. Measured on the real mirror at 1920:

| | Before | After |
|---|---|---|
| row height | 132px | **88px** |
| the 27 verdicts | 3.7 screens | **2.6 screens** |
| at 412px | 8.9 screens | **6.0 screens** |

Two spacing findings behind that. `--space-1` is 16px, because the scale starts
at 16, so the "tight" padding was the same as the loose padding; a queue row is
the one place in this app that wants tighter than the scale and now uses explicit
pixels. And a global `blockquote` margin was adding 12px of prose spacing to a
one-line quote, beaten with a more specific selector rather than by removing the
global rule that is right everywhere else.

**The quote stays visible, and that is not a compromise.** The instruction was
to move it to expansion. The code carried an older ruling that the sentence must
be in front of the reader, because deciding whether Paul really promised
something needs it and making him open something first is how a queue gets
cleared by accepting everything. Both are satisfied by clamping it to one line
with the rest on expansion. A test asserts the quote is never gated on the row
being open, and it was proved by gating it and watching the test fail.

**Keyboard verdicts, on the buttons rather than the row.** A list item is not an
interactive element, and giving it a tab stop and key handlers is the wrong shape
for a screen reader. Tab already lands on Accept, so `A` and `R` act from there
and Enter still does the obvious thing.

**At 412px the context drops and the decision inputs never do.** Where it came
from and what it is about are context; who owes it and when are what the verdict
turns on. Those two are never hidden at any width.

Two existing guards asserted the old markup exactly and broke on the layout
change. They were testing the right property in a form that could not survive the
page being rearranged, and are now written as properties: the quote renders
whenever there is one, and is never gated on expansion. Both still bite.
