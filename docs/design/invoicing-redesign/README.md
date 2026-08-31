# Handoff: Invoicing page redesign (Command Center)

## Overview

A redesign of the Command Center Invoicing page, built 2026-08-31. The old screen
listed billing periods and then every invoice in the firm, which answers "what is
outstanding" and nothing else. The redesign asks the question actually being asked
at this screen: one client at a time, what have they been billed, what have they
paid, what is late, and what goes out next.

Shape: four headline figures across the top, a client rail on the left, and
everything to the right belonging to the selected client. Three tabs under the
client: Invoices, Time and periods, Automation.

## About the design file

`Invoicing Redesign.dc.html` is the **design reference**, a prototype in HTML
showing intended look and behaviour. It carries the full template markup with
inline styles and a logic class showing the intended state model. It is not
production code; the implementation recreates it in SvelteKit using the app's own
tokens and components.

Fidelity is high. Colours, type, spacing, radii and hover states follow the
Command Center Design System and were reproduced with the app's token variables
rather than by copying hex values.

## What was built

| Design element | Where it lives |
| --- | --- |
| Four headline tiles | `GET /api/invoicing/overview`, computed over every invoice |
| Client rail with search, status chip, open balance | same endpoint, `clients[]` |
| Client profile, editable in place | `PATCH /api/invoicing/clients/:id/billing` |
| Four client stats, notes that save as you stop typing | `GET /api/invoicing/clients/:id` |
| Money bar, filter chips, document search | client side, over the client's documents |
| Document table with category, subcategory, qty, rate | migration 0024 columns and line items |
| Expanded row: actions, line items, totals, trail | `invoice_line_items`, `invoice_events` |
| Invoice form with lines, discount, tax, message | `POST /api/invoicing/invoices`, `PATCH .../document` |
| Estimates, credit notes, recurring invoices | `invoices.kind`, `recurring_frequency` |
| Record payment | the existing payments route, now also writing a trail entry |
| Statement of account | inline panel plus `/invoices/print?client=<id>` |
| Print or save as PDF | `/invoices/print`, the browser's own print to PDF, D53 |
| New client | `POST /api/invoicing/clients`, client and primary contact in one request |

## Where the implementation departs from the mock, and why

Five deliberate deviations. Each is a place the design asked for something the app
cannot honestly do, or the codebase already answered differently.

**1. Nothing sends mail.** The mock has Send, Send reminder, email reminders on a
schedule, and "copy me on every send". This app holds no scope that could send
mail and registers no route that could try, asserted by
`tests/layer2-no-send-surface.test.ts`. So:

- Send became **Mark as sent**, a status change recorded on the trail.
- Send reminder became **Log a reminder**, which records a chase that happened in
  Gmail. The screen builds a prefilled Gmail compose link beside it, the same
  boundary the Mail screen uses.
- Email reminders became **Flag overdue invoices in the daily digest**, which
  sorts that client to the top of the start of day email and marks the line. A
  prompt to Paul, not a message to the client.
- Copy me on every send was dropped. It described a send that does not exist. The
  CC field stayed, because it prefills the compose window.

**2. Recurring invoices raise drafts, never sent documents.** The toggle is real
and wired: `src/lib/server/recurring.ts` is called by the button on the screen and
by the 07:00 Mountain cron firing, before the digest is built so a draft raised
this morning appears in this morning's email.

**3. Void is a date, not a status.** The mock lists Void beside Open, Sent and
Paid. Status tracks how much has been paid, and a voided invoice is not a payment
state. `voided_at` keeps the number and the trail and takes the document out of
every total. Adding a status would also have meant rebuilding a table three
triggers depend on.

**4. Estimates and credit notes are a kind, not a status.** Same reason, plus the
one that matters more: neither is a receivable, so every balance filters on
`kind = 'invoice'`. Counting them would inflate what the firm is owed.

**5. A third tab, Time and periods.** The mock has two tabs and no billing
periods. Billing periods and time entries are the input to an invoice and already
worked, so they moved into the client rather than being deleted. Deleting working
software to match a mock is not a redesign.

Two smaller ones: the invoice list does not paginate, because a client has about
fifteen documents rather than nine hundred; and the status select offers Draft and
Sent only, because part paid and paid follow the payments and are not something to
assert by hand.

## Schema

Migration `0024_invoice_detail.sql`. New tables `invoice_line_items` and
`invoice_events`; new columns on `invoices` for kind, category, subcategory,
message, discount, tax, subtotal, void, recurrence and source; new columns on
`clients` for billing address, schedule, automation and CC.

Contact name, email and phone deliberately did **not** move onto `clients`.
`contacts` already holds them with one primary per client, and copying them would
have created two places for one fact.

The 900 seeded invoices predate line items. `subtotal_cents` is null on them and
the expanded row says so rather than inventing a breakdown; the quantity and rate
columns fall back to the billable hours of the billing period the invoice was
raised from, which is the number it was raised against.

## Data

The seed generator now writes line items, payments and a trail
(`seed/generate-volume.py`), so the screen has something to show at volume: 1,316
line items, 542 payments, 2,264 events. The payments matter beyond decoration.
Collected this month and average days to pay are computed from payment dates, and
before this they had no source at all.

The generator draws them from its own random stream, so every value it produced
before this change is unchanged.

## Layout and responsive

- Desktop first, content capped at 1200px, 300px client rail from 1100px up.
- Below 1100px the rail stacks above the client, scrolling in its own box.
- Below 960px the document table becomes cards, per D22. Verified at 412px: the
  page never scrolls sideways, and the e2e suite asserts it.

## Files

- `Invoicing Redesign.dc.html`, the design reference.
- `src/routes/invoices/+page.svelte` and `+page.ts`, the screen.
- `src/routes/invoices/print/`, the printable document and statement.
- `src/lib/server/api/invoicing-clients.ts`, money views.
- `src/lib/server/api/invoicing.ts`, document writes, trail, copy, void.
- `src/lib/server/recurring.ts`, recurring drafts, shared with the cron.
- `migrations/0024_invoice_detail.sql`.
- `tests/layer2-invoice-documents.test.ts`, `e2e/flows.spec.ts`.
