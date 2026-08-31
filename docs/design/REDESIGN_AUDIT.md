# Redesign programme: inventory and audit

Written 2026-08-31, before any of the twelve builds. Dual estimates per the
standing rule. Mail and Invoicing are already built and are listed for
completeness only.

## Inventory

Every bundle found in `C:\Users\admin\Downloads`, committed byte for byte beside
its extracted template. `.gitattributes` marks them `-text` so they round trip
unchanged; the md5 below is of the file as Paul exported it.

| Bundle | Target | Folder | md5 (12) | Template |
| --- | --- | --- | --- | --- |
| Action Items Redesign.html | `/actions` | `actions-redesign` | 9170e1d8bbf9 | 34kb |
| Calendar Redesign.html | `/calendar` | `calendar-redesign` | 2a5ccef01c87 | 45kb |
| Clients Redesign.html | `/clients` and `/clients/[id]` | `clients-redesign` | b33d873d28a6 | 42kb |
| Dashboard Redesign.html | `/` | `dashboard-redesign` | cab360140b84 | 28kb |
| Ledger Redesign.html | `/ledger` | `ledger-redesign` | 366ce75082a1 | 29kb |
| Meetings Redesign.html | `/meetings` and `/meetings/[id]` | `meetings-redesign` | 46da8d96c2f1 | 45kb |
| Projects Redesign.html | `/projects`, `/projects/[id]`, `/tickets/[id]` | `projects-redesign` | 4b9e0fadcd2d | 82kb |
| Quick Add Redesign.html | shell, `QuickAdd.svelte` | `quick-add-redesign` | ae93ffe1c6d3 | 15kb |
| Reports Redesign.html | `/reports` | `reports-redesign` | 130e97354bb9 | 27kb |
| SOPs Redesign.html | `/sops` | `sops-redesign` | 93589808e47a | 52kb |
| Settings Redesign.html | `/settings` | `settings-redesign` | 98f21a0178e2 | 45kb |
| Templates Redesign.html | `/templates` | `templates-redesign` | 07ffafd3c42a | 32kb |

No target was ambiguous. Each bundle names its screen in the H1 and in the
sidebar item it marks active, and each matches exactly one existing route. Two
bundles cover more than one route because the prototype carries the list and the
detail in one file, which is how Mail and Invoicing were shipped too.

Not in the set, and therefore not redesigned: `/mail` and `/invoices`, already
built, and `/tickets/[id]`, which the Projects bundle absorbs.

## The constraint that shapes the order

**No ALTER on any existing table before Thursday.** The dress rehearsal is
Tuesday 2026-09-01 and the freeze protects the tables it exercises. New tables
are permitted, so every schema need below is met with a new table or a side
table rather than a column, and that is a design choice with consequences worth
naming: a placement recorded in a side table can go missing in a way a NOT NULL
column cannot. Where that matters the audit says so.

Migration 0024 ALTERed `invoices` and `clients` and was applied to remote under
an explicit ruling before this freeze reading was in force. Nothing else follows
it until Thursday.

## Standing rules, and where each redesign meets one

Four collisions are real and need the Invoicing translation pattern. The rest of
the pages are clean.

**Calendar is the serious one.** The prototype states in its own copy that
"writes go through the Google Calendar API" and offers Send invite, RSVP,
Follow and Leave. The app holds `calendar.readonly` and `gmail.readonly` and
nothing else, by D70, asserted by `tests/layer2-no-send-surface.test.ts`. A
scope never granted cannot be used by a later bug. So:

- New invite becomes **Draft invite**, which builds a prefilled Google Calendar
  event URL the user submits in Google. A link, not a write. Same boundary as
  the Gmail compose link.
- Follow and Leave become a local followed-calendars list in a new table. It
  changes what this app shows. It never touches the user's CalendarList.
- RSVP is dropped. Accepting an invitation is a write with no honest local
  translation, and a button that looks like an RSVP and is not is worse than no
  button.
- Join meeting stays. It is an outbound link to Meet.
- Find a time reads free and busy, which `calendar.readonly` permits.

**Settings** offers "Sign out everywhere else". Sessions are Cloudflare Access,
not ours; this becomes a link to the Access session page with a sentence saying
where the control lives.

**Dashboard and Calendar and Meetings** read account-scoped data. Guarantee
tests land before the UI on each, D127 scope carried through the page loader,
D111 attribution on any row from a unified view, D109 identity only on rosters.

**Every page**: prototype sample content is layout reference. Never seeded,
never printed (D89). Reporting on these builds stays on counts and aggregates.

## Per page

Rework means the screen exists and is being redrawn. New means it does not
exist at all.

### 1. Dashboard, `/`

Now: six cards and four headline tiles, 538 lines.
Redesign: eight cards. Projects, Needs you now, Open tickets, The week ahead,
Today's meetings, Money, Mail needing you, What will slip. Inline mark done.

Rework: the six existing cards and the tiles. New: Projects, Open tickets and
Mail needing you cards. Backend: `/api/today` gains three aggregates. No schema.
Collision: the mail card is account scoped, so the guarantee test lands first.

| | Lean | Full |
| --- | --- | --- |
| | **4 to 6h** | **1.5 days** |
| Cards | Eight cards, real counts, mark done inline | Plus per card empty states and a reorder Paul can save |

### 2. Action items, `/actions`

Now: 1,061 lines. Capture, edit, ticket creation, four views, paging.
Redesign: tabs, search, project and owner filters, a sort control, per page,
row expansion, bulk selection, one modal for create and edit.

Rework: nearly all of it. New: bulk selection and the actions behind it, owner
filter, sort control. Backend: `/api/action-items` gains sort, owner and a bulk
PATCH. No schema. D134 applies: the bulk route changes a contract, so callers
are audited and exercised in a browser.

| | Lean | Full |
| --- | --- | --- |
| | **5 to 7h** | **1.5 days** |
| Bulk | Select, then done or reassign | Plus undo, and a keyboard range select |

### 3. Quick add, shell

Now: `QuickAdd.svelte`, one kind, N to open.
Redesign: a kind switcher, per kind fields, Save and add another, and a session
log of what was added.

Rework: all of it, and it is small. New: the per kind field sets. Backend: the
routes each kind needs already exist. No schema.

| | Lean | Full |
| --- | --- | --- |
| | **3 to 4h** | **6 to 8h** |
| Kinds | Action item, ticket, time entry | Plus meeting, ledger line and SOP page |

### 4. Calendar, `/calendar`

Now: 859 lines. Week, day and month views, calendar list, meeting click through,
a needs-auth state.
Redesign: agenda and week, followed calendars shown as busy blocks, Find a time
across selected calendars, an event detail with guests, attachments and the Meet
link, and an invite composer.

Rework: the views, the list, the detail. New: Find a time, followed calendars,
the invite composer as a draft. Backend: a free and busy read, one new table for
follows. No ALTER.

Collisions: the four translations above. Account scoped throughout, so the
guarantee test lands first and every row carries its account.

| | Lean | Full |
| --- | --- | --- |
| | **8 to 10h** | **3 days** |
| Find a time | Free and busy across the account's own calendars | Plus followed people, ranked slots, and a working-hours window |

### 5. Meetings, `/meetings`

Now: list 349, detail 584. Transcript import, AI summary, action item proposals.
Redesign: the log plus Coming up, a review queue, summary and transcript and
action item panels, details, attendees, recording.

Rework: most of it. New: Coming up from the calendar, the review queue,
attendees panel, recording link. Backend: a side table linking a meeting to a
calendar event, because the column that would say so is frozen.

| | Lean | Full |
| --- | --- | --- |
| | **6 to 8h** | **2 days** |
| Coming up | Next seven days from the connected calendar | Plus one click to open a meeting record against an event |

### 6. Projects, `/projects`

Now: list 353, detail 641, ticket detail 641. The largest prototype at 82kb.
Redesign: a project table with progress and open counts, a detail with Details,
Milestones, Files, Action items and Tickets, and a ticket detail with
description, linked tickets, linked action items, an activity feed with
comments, people and dates, time tracking and attachments.

Rework: the list and the detail shell. New: milestones, files, comments, ticket
links, per ticket time logging. Backend: four new tables and R2 for files. All
new tables, so no freeze conflict.

| | Lean | Full |
| --- | --- | --- |
| | **12 to 16h** | **4 days** |
| Files | Attach, list, download, delete, 10MB cap | Plus previews, versioning and drag to reorder |
| Activity | Comments, and system lines for status changes | Plus mentions and per field change history |

### 7. Clients, `/clients`

Now: list 351, detail 669. Contacts, contracts, projects, invoices already
render.
Redesign: list with active and archived tabs, detail with Details, Contacts,
Contracts, Projects, Recent activity, Invoices. Edit in place, add contact,
upload contracts.

Rework: most, and much of it is already there. New: contract file upload,
recent activity. Backend: one new table for contract files, R2 for the bytes.
The billing profile arrived with 0024 and needs no further schema.

| | Lean | Full |
| --- | --- | --- |
| | **5 to 7h** | **1.5 days** |
| Activity | Invoices, meetings and projects, merged by date | Plus mail and tickets, filterable |

### 8. Ledger, `/ledger`

Now: 643 lines. Lines, categories, totals, receipts.
Redesign: a month switcher, Lines, By category and Categories views, add a line
with a receipt, a kind filter, search, Export CSV.

Rework: most. New: the by-category view, month navigation, CSV export. Backend:
one export route. No schema.

| | Lean | Full |
| --- | --- | --- |
| | **4 to 6h** | **1 day** |
| Export | One CSV of the month on screen | Plus a date range, and a categories-only export |

### 9. Templates, `/templates`

Now: 532 lines, list, edit, AI draft endpoint.
Redesign: tabs by type, search, per template input fields that feed generation,
results kept per template, a new template modal, archive.

Rework: most. New: declared inputs per template. Those are read out of the
placeholders already in the body rather than stored, which needs no schema at
all and cannot drift from the text it belongs to.

| | Lean | Full |
| --- | --- | --- |
| | **4 to 6h** | **1 day** |
| Inputs | Parsed from placeholders in the body | Plus typed fields, defaults and validation, stored |

### 10. SOPs, `/sops`

Now: 379 lines. Flat SOPs with version history.
Redesign: shelves hold books, books hold chapters, chapters hold pages. Owners,
review cycles, access roles, book activity, rollback, and a checkbox working
copy that deliberately does not change the SOP.

Rework: the page and version views. New: the whole hierarchy, review dates,
access roles, activity. Backend: five new tables plus a placement side table,
because `sops` cannot take a column before Thursday.

Access roles need a ruling in the build: this is a single user app behind Access,
so roles are metadata about who owns what, not enforcement. The screen will say
that rather than implying a permission system that does not exist.

| | Lean | Full |
| --- | --- | --- |
| | **10 to 14h** | **3.5 days** |
| Hierarchy | Shelf, book, chapter, page, with move | Plus drag to reorder and cross-book links |
| Roles | Named owners, stated as metadata | Real per book access, which needs multi user first |

### 11. Reports, `/reports`

Now: index 119 lines, four reports, print routes.
Redesign: an index with a period selector, Run again, Export CSV, Download PDF.

Rework: the index chrome. New: CSV per report. Print already exists per D53.

| | Lean | Full |
| --- | --- | --- |
| | **3 to 5h** | **1 day** |
| Export | CSV of the rows on screen | Plus scheduled monthly export to R2 |

### 12. Settings, `/settings`

Now: 1,060 lines. Connections, Asana, Mail, Calendars, AI spend.
Redesign: a sectioned nav adding General, Notifications, Appearance, Security,
Invoicing, Projects and Action items, about thirteen toggles, exports, clear
cache.

Rework: the existing sections. New: a settings store, which is KV per the
architecture, and the toggles that read it. Security translates as above.

| | Lean | Full |
| --- | --- | --- |
| | **6 to 8h** | **2 days** |
| Toggles | Stored in KV, each one wired to something real | Plus per section reset and an audit line per change |

## Totals

Lean, 70 to 97 hours. Full, 21 to 24 days. Nothing here shares a migration
window, because nothing here needs a migration on an existing table.

## Build order, by how often Paul opens the page

1. **Dashboard**, opened first every morning, small, no collisions.
2. **Action items**, the daily work surface.
3. **Quick add**, used many times a day and shared by every screen.
4. **Calendar**, daily, and the translations are best decided early.
5. **Meetings**, daily during an engagement.
6. **Clients**, weekly, and mostly already built.
7. **Ledger**, weekly.
8. **Templates**, weekly.
9. **Projects**, weekly, and the largest build.
10. **SOPs**, weekly, and the largest schema change.
11. **Reports**, weekly to monthly.
12. **Settings**, rarely opened, cheap to finish with.

Projects and SOPs sit later than their size suggests on purpose: they are the
two that can absorb a day each, and putting them after the daily surfaces means
a bad estimate costs the least used screens rather than the most used ones.
