# Stage C evidence pack

**Nothing in this document has been applied. Both gates are closed.**

W4, assembled as fill so the Stage C ruling is cheap to execute on the day it
arrives. Every command below is written out to be run in order by a person who
has decided to run it. None has been run against remote.

The two gates, unchanged:

1. **Whether firm client data may sit on a hosted database at all.** Dustin's
   clearance covers the local read-only mailbox connection and this question was
   never asked. Paul's.
2. **The D50 evidence pattern, per migration.** This document.

**The merge is inside gate 2.** `main` auto-deploys through Workers Builds, one
deployment 12 to 15 minutes after each merge, verified in `HANDOFF_04` section
12.3. Merging `realdata/stage-a` therefore ships the code, and the code expects
every migration below. The merge is not a separate decision anybody can take on
its own.

---

## 1. Sixteen, not fourteen

The count was fourteen when it was last reported, covering `0032` through
`0045`. `0046_section_status_map` and `0047_ticket_section_status` were added
afterwards by Pillar 2. **Sixteen are pending.**

Confirmed live and read-only at the time of writing, with:

    npx wrangler d1 migrations list command-center-db --remote

Remote is at `0031_ai_budget.sql`. Re-run that before applying anything: this
document is evidence about a state, and the state can move.

---

## 2. The batch is additive, verified rather than asserted

D50's ordering rule holds for additive migrations and **explicitly does not hold
for a migration that drops or renames something the deployed code still reads.**
So the condition is checked rather than assumed.

Method: a scratch SQLite database built by applying `0001` through `0031`, which
is the remote baseline; a second built by applying `0001` through `0047`; the
two schemas compared object by object.

| | |
|---|---|
| objects at baseline | 175 |
| objects after the batch | 241 |
| **objects removed** | **0** |
| tables altered | 7, all by adding columns |

The seven altered tables gained columns only. None lost, none retyped:

| Table | Columns gained |
|---|---|
| `calendar_events` | `conference_url` |
| `clients` | `notes_html` |
| `commitments` | `evidence` |
| `meetings` | `notes`, `notes_html` |
| `projects` | `asana_url`, `phase_is_manual`, `status_is_manual`, `description_html` |
| `sop_versions` | `body_html` |
| `tickets` | `asana_section`, `asana_assignee_gid`, `asana_modified_at`, `asana_url`, `description_html`, `section_status`, `section_status_via` |

### The one destructive statement, and why the batch is still additive

`0035_crosswalk_row_key` contains `DROP TABLE client_crosswalk`. That is exactly
the case D50 warns about, so it was checked rather than waved through.

**It is self-contained.** `client_crosswalk` is created by `0033` and dropped and
recreated by `0035`, both inside this batch. Remote has never held the table, no
deployed code reads it, and the object diff above confirms the net effect against
the baseline is a table added, not removed.

Stated plainly, because the next person will grep for `DROP` and should find the
answer beside it: **the batch as a whole is additive with respect to the deployed
schema, and the drop touches only a table the same batch created.**

---

## 3. Per migration

Each verified by applying it to the scratch baseline in sequence and diffing the
schema after every step.

| Migration | Creates | Against deployed schema |
|---|---|---|
| `0032_asana_mirror` | 17 tables, 10 indexes | additive |
| `0033_client_crosswalk` | 2 tables, 3 indexes | additive |
| `0034_dropbox_mirror` | 3 tables, 6 indexes | additive |
| `0035_crosswalk_row_key` | 1 index, 2 columns | additive, see section 2 |
| `0036_roster_and_overrides` | 3 tables, 3 indexes | additive |
| `0037_projection` | 2 tables, 1 index | additive |
| `0038_asana_fidelity` | 3 tables, 4 indexes, 7 columns | additive |
| `0039_mail_action_proposals` | 1 table, 2 indexes | additive |
| `0040_commitment_evidence` | 1 column | additive |
| `0041_mirror_refresh` | 2 columns | additive |
| `0042_conference_link` | 1 column | additive |
| `0043_quick_add_parity` | 1 column | additive |
| `0044_rich_text` | 5 columns | additive |
| `0045_sop_verifications` | 1 table, 1 index | additive |
| `0046_section_status_map` | 1 table, 2 indexes | additive |
| `0047_ticket_section_status` | 2 columns | additive |

---

## 4. The snapshot, D39, unconditional

Taken immediately before the apply, every time, with no exceptions. The rule is
written to survive the argument against it: "nothing is at risk" and "the tables
are empty" are exactly the conditions under which the habit gets skipped.

D39 also rules that remote migrations are **batched rather than applied one at a
time**, so a verified local sequence lands as a single remote change with a
single snapshot in front of it. Sixteen migrations, one snapshot, one apply.

    npx wrangler d1 export command-center-db --remote --output snapshots/snapshot-2026-09-03-pre-0032-0047.sql

Use the date of the day it is actually run, not the one written here.

Snapshots are gitignored: an export of the live database can contain real client
data and the repository is not the place for it.

**Read the snapshot before continuing.** A snapshot nobody opened is a habit, not
a safeguard. It is also the reading that caught a wrong assumption once already,
per D39.

    grep -c "CREATE TABLE" snapshots/snapshot-2026-09-03-pre-0032-0047.sql
    grep -c "INSERT INTO" snapshots/snapshot-2026-09-03-pre-0032-0047.sql

Expect **54** `CREATE TABLE` statements, and none of the nine tables listed in
section 6 among them, because remote has never held any of them.

That 54 is read off the scratch baseline, not remembered. The first draft of this
document said "roughly 40", which was a caption written from memory sitting
beside figures taken from a database, and is the exact failure checklist item 15
describes. It was caught by checking it.

---

## 5. The order, D50

**Migrate remote first, then merge.** The reverse is what took `/templates` down
on 2026-08-29, at sixteen times the size.

    # 1. Confirm what is actually pending. Evidence about a state, so re-read it.
    npx wrangler d1 migrations list command-center-db --remote

    # 2. Snapshot. D39, unconditional. Section 4.
    npx wrangler d1 export command-center-db --remote --output snapshots/<name>.sql

    # 3. Apply. One batch, sixteen migrations.
    npx wrangler d1 migrations apply command-center-db --remote

    # 4. Verify against the live database, not against this document. Section 6.

    # 5. Only then merge realdata/stage-a into main, which deploys the code
    #    12 to 15 minutes later with nobody pressing anything.

---

## 6. Verification, after applying and before merging

Read from the live database. What a command printed while it ran is not the same
as what is there afterwards.

    npx wrangler d1 execute command-center-db --remote --command "SELECT COUNT(*) AS applied, MAX(name) AS latest FROM d1_migrations"

Expect **47** and `0047_ticket_section_status.sql`.

    npx wrangler d1 execute command-center-db --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('asana_tasks','asana_sections','dropbox_files','client_crosswalk','client_roster','section_status_map','sop_verifications','mail_action_proposals','projection_runs') ORDER BY name"

Expect nine rows. All nine are confirmed absent from the baseline and present
after the batch, on the scratch database.

    npx wrangler d1 execute command-center-db --remote --command "SELECT COUNT(*) AS n FROM pragma_table_info('tickets') WHERE name IN ('section_status','section_status_via','description_html','asana_section')"

Expect **4**. A missing column is a 500 on the first page that reads it.

    npx wrangler d1 execute command-center-db --remote --command "SELECT (SELECT COUNT(*) FROM action_items) AS action_items, (SELECT COUNT(*) FROM clients) AS clients, (SELECT COUNT(*) FROM sops) AS sops"

Compare against the same counts in the snapshot. Additive migrations must not
move them.

    npm run schema:check

And `/api/health`, which returns 503 on drift in either direction and names the
direction.

---

## 7. If it goes wrong

D1 Time Travel is always on, with a 7 day restore window on the Workers Free
plan. The snapshot from section 4 is ours, is not governed by that window, and
can be read without performing a restore.

Every migration in this batch is additive, so **the deployed code at the time of
applying reads none of the new objects**, because `main` has not been merged. A
half-applied batch therefore leaves production running exactly as it was. That
property is the whole reason applying before merging is the safe order.

If the apply stops partway, read `d1_migrations` to find where rather than
inferring it from the output, then re-run: wrangler applies only what is still
pending.

---

## 8. What this pack does not cover

- **Gate 1.** Whether firm client data may sit on a hosted database. Not a
  technical question and not answered here.
- **Data.** These migrations create schema and move no rows. The Asana mirror,
  the Dropbox mirror, the crosswalk, the roster and the section rulings all live
  in the local databases. Getting any of them to remote is a separate decision
  with its own privacy question, and gate 1 is that question.
- **The 103 section rulings and the 27 proposals.** Paul's, and unaffected by
  anything here.

*Assembled 2026-09-03 as fill work under W4. Nothing applied. Re-read section 1
before acting on any of it.*
