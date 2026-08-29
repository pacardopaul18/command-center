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
| T-mvp | MVP stage gate | CLOSED 2026-08-29. Build criteria evidenced; the daily-use half of the threshold is Paul's to confirm over time |
| T-clients-0 | Rebuild `projects` with a real `client_id` foreign key | DONE, migration 0003. Verified: rows survive byte-for-byte, action item links survive, a bogus client_id is rejected on INSERT and UPDATE |
| T-meetings-0 | Rebuild `action_items` with a real `meeting_id` foreign key when Meetings lands | OWED. Same pattern as T-clients-0, and subject to D38 |

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

The sender stays on Resend's shared address because it needs no domain
verification and therefore cannot fail silently the way an unverified custom
domain does. Moving to an address on kabuhayan.app requires that domain verified
in Resend first, and is a one line change to `DIGEST_FROM` in wrangler.toml plus
a deploy. See R7 for the reason that move may be worth making anyway.

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

## Interpretation notes

Not decisions. Judgment calls made inside an existing decision, recorded so the
reasoning is not lost and so nobody relitigates them as if they were open.

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

Closes when Paul confirms where the digests actually land after several days,
not after one. Record the answer here.

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
