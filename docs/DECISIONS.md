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
| T7 | Dashboard step 1, git-connected Pages project | OPEN, DRI Paul. Verified not yet created: `wrangler pages project list` shows only `kabuhayan-me`. Blocks T8 |
| T8 | Dashboard steps 3 and 4, custom domain then Access | OPEN, DRI Paul. Blocked by T7 |

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

`wrangler pages project create` produces a direct-upload project, and a
direct-upload project cannot be converted to git-connected afterwards. Creating
it from the CLI would burn the project name and force a delete and redo. The
project is therefore created through the dashboard Connect to Git flow, which is
the one part of the setup that cannot be scripted.

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

State of the code as of 8015ce8: only 960px is exercised. Action Items is the
only screen, and its form grid was written at 960px alongside the table and the
shell, so 720px is sanctioned but not yet used anywhere. Moving that form grid
to 720px is a one line change, deliberately not made here because it alters
layout and the build is on hold. Whichever way it goes, this entry gets updated
so the ledger never describes a breakpoint the code does not have.

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

## Risks

### R6: public pages.dev window, OPEN

From the moment the first Pages deploy succeeds until Cloudflare Access is live,
the app is publicly reachable and unauthenticated.

Mitigation: sample data only. No client names, no real action items, no real
project names. The remote D1 is empty at the time of writing, and the two seed
rows in [../seed/dev-seed.sql](../seed/dev-seed.sql) are deliberately generic.

AMENDED, and the amendment matters. The original entry said this closes when
Access is live on the custom domain. That is wrong, and it would have left the
app open while looking closed.

An Access application protects the hostnames it names. Gating
`work.kabuhayan.app` does nothing for `command-center.pages.dev`, which stays
publicly reachable and serves the same Worker against the same D1. Preview
deployments get their own `<hash>.command-center.pages.dev` hostnames on top of
that. The architecture doc flags this at line 12 as the known Pages rough edge.

R6 closes only when all three are gated:

1. `work.kabuhayan.app`
2. `command-center.pages.dev`
3. `*.command-center.pages.dev`

Record the closing evidence here when it lands, and verify it by fetching each
hostname signed out and confirming the Access login interstitial, not by
assuming the policy applied.

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
