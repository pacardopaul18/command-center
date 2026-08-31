#!/usr/bin/env python3
"""
Generates a large, realistic local dataset for hands-on testing at volume.

LOCAL ONLY. Never apply the output to the remote database. Every id carries a
`v-` prefix so seeded rows are identifiable, and the accompanying reset script
rebuilds the local database from migrations before loading it.

Dates that drive behaviour, deadlines, due dates, meeting dates, period
boundaries and completion times, are emitted as SQLite `date(...)` and
`datetime(...)` expressions relative to now, so the dataset stays meaningful
whenever it is loaded rather than going stale the day after it is generated.

    python seed/generate-volume.py > seed/volume-large.sql
"""

import io
import random
from datetime import UTC, date, datetime, timedelta

random.seed(20260830)

OUT = []
def w(line=""):
    OUT.append(line)

def q(v):
    """SQL literal. None becomes NULL, strings are escaped."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, Raw):
        return v.sql
    return "'" + str(v).replace("'", "''") + "'"

class Raw:
    """A SQL expression to emit verbatim rather than quote."""
    __slots__ = ("sql",)
    def __init__(self, sql):
        self.sql = sql

# --- Mountain Time anchoring -------------------------------------------------
#
# The app decides overdue, due today and aging against the Mountain calendar
# date, never UTC. Dates emitted as SQLite `date('now', ...)` are anchored to
# UTC instead, and for the seven hours each evening when the two dates differ,
# every band in the dataset means something different from what the app reports.
#
# That is not hypothetical. The suite caught it on its first run: 816 items were
# generated as overdue and the API returned 799, because 17 of them fell on the
# day that was still today in Denver and already yesterday in UTC.
#
# So the seed anchors to the Mountain day. The DST rule is implemented here
# rather than imported because this machine has no tzdata for zoneinfo, and
# because the rule for America/Denver is short and exact: MDT from the second
# Sunday in March to the first Sunday in November, MST otherwise.

def _nth_weekday(year, month, weekday, n):
    """The date of the nth given weekday in a month. Monday is 0."""
    d = date(year, month, 1)
    d += timedelta(days=(weekday - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)

def mt_utc_offset_hours(d):
    """Hours behind UTC for America/Denver on a given date. 6 in summer, 7 in winter."""
    dst_start = _nth_weekday(d.year, 3, 6, 2)   # second Sunday in March
    dst_end = _nth_weekday(d.year, 11, 6, 1)    # first Sunday in November
    return 6 if dst_start <= d < dst_end else 7

# Today, as the app would name it. Computed from the UTC clock and the offset,
# so the seed does not depend on the machine's own time zone either.
_now_utc = datetime.now(UTC)
TODAY_MT = (_now_utc - timedelta(hours=mt_utc_offset_hours(_now_utc.date()))).date()

def day(offset):
    """A Mountain calendar date, which is what every deadline and due date is."""
    return (TODAY_MT + timedelta(days=offset)).isoformat()

# Everything the test suite will assert against, computed here from the values
# used to build the rows rather than read back from the database or the app.
# That is the point: if the app and the database agree with each other but both
# disagree with what was generated, the suite has to notice.
EXPECT = {"counts": {}, "action_status": {}, "action_bands": {},
          "invoice_bands": {}, "invoice_status": {}, "project_status": {},
          "project_phase": {}, "totals": {}, "per_client_outstanding": {},
          "sop_version_counts": {}}

def bump(section, key, by=1):
    EXPECT[section][key] = EXPECT[section].get(key, 0) + by

def ts(offset_days, hour=9, minute=0):
    """
    A stored UTC instant corresponding to a Mountain wall clock time.

    The app stores timestamps in UTC and reasons about them in Mountain, so a
    seed that wrote Mountain wall times into a UTC column would put completions
    on the wrong side of a day boundary six or seven hours a day.
    """
    local_date = TODAY_MT + timedelta(days=offset_days)
    naive = datetime(local_date.year, local_date.month, local_date.day, hour, minute)
    return (naive + timedelta(hours=mt_utc_offset_hours(local_date))).strftime("%Y-%m-%dT%H:%M:%SZ")

def batched_insert(table, columns, rows, batch=120):
    """Multi row INSERTs, batched so no single statement grows unreasonable."""
    if not rows:
        return
    cols = ", ".join(f'"{c}"' for c in columns)

    # SOP versions are immutable by trigger, D33: they refuse both DELETE and
    # UPDATE, so OR REPLACE cannot touch them. On a reload the existing ones are
    # left exactly as they are, which is what immutable means.
    # OR REPLACE deletes the existing row before inserting, so any table a
    # protected row points at with ON DELETE SET NULL cannot use it: removing a
    # user would update sop_versions.author_id, and those rows are immutable by
    # trigger. Static fixtures are inserted once and left alone.
    verb = (
        "INSERT OR IGNORE"
        if table in ("sop_versions", "sops", "users")
        else "INSERT OR REPLACE"
    )

    for i in range(0, len(rows), batch):
        chunk = rows[i:i + batch]
        w(f'{verb} INTO "{table}" ({cols}) VALUES')
        for n, r in enumerate(chunk):
            values = ", ".join(q(v) for v in r)
            w(f"  ({values}){',' if n < len(chunk) - 1 else ';'}")
        w()

# --- vocabulary -------------------------------------------------------------

FIRST = ["Dana","Marcus","Priya","Ines","Tom","Rue","Sam","Alex","Nadia","Owen",
         "Beatriz","Kofi","Lena","Hugo","Mei","Ravi","Sofia","Ethan","Clara","Jonas",
         "Amara","Nils","Yuki","Tariq","Elena","Felix","Noor","Gabriel","Maya","Idris"]
LAST = ["Okafor","Lindqvist","Raman","Costa","Whitfield","Mbeki","Nakamura","Farrell",
        "Dubois","Ferreira","Haddad","Sorensen","Vega","Ahmed","Bianchi","Novak"]
OWNERS = ["Paul"] + [f"{f} {l}" for f, l in zip(FIRST, LAST * 2)][:18]

CLIENT_A = ["Halcyon","Beacon","Ridgeline","Tessellate","Orchard","Kestrel","Meridian",
            "Northgate","Lantern","Copperfield","Silverbirch","Aldgate","Fairwater",
            "Brightmoor","Castlereagh","Dunmore","Evershed","Foxglove","Greylock","Harrowgate",
            "Inverness","Junewell","Kingsmere","Larchmont","Marlowe","Netherby","Oakhaven",
            "Pemberton","Quarrymill","Rosslare","Stonebridge","Thornbury","Underwood","Vandenberg",
            "Westmoor","Yarrow","Ashcombe","Blackthorn","Cranleigh","Dovecote","Elmsworth",
            "Fenwick","Garrowby","Hartsmere","Ilkley","Jarrow","Kelmscott","Lyndhurst",
            "Middleham","Norbury","Ottery","Pickering","Quenington","Rothbury","Sandringham",
            "Tewkesbury","Uppingham","Verwood","Wentworth","Yealmpton"]
CLIENT_B = ["Group","Analytics","Capital","Studio","Health","Logistics","Partners",
            "Consulting","Systems","Works","Labs","Holdings","Advisory","Collective"]

PROJECT_KINDS = ["platform migration","quarterly review","data warehouse","dashboard refresh",
                 "diligence support","rebrand","site build","compliance audit","policy refresh",
                 "reporting pack","cost review","vendor consolidation","onboarding programme",
                 "risk register rebuild","market study","process mapping","training rollout",
                 "systems integration","contract renewal","capacity plan"]

ACTION_VERBS = ["Send","Chase","Confirm","Draft","Review","Escalate","Reconcile","Prepare",
                "Schedule","Collect","Update","Circulate","Approve","Investigate","Summarise",
                "Book","Validate","Publish","Archive","Rework"]
ACTION_OBJECTS = ["the cutover runbook","the vendor escalation","the audit evidence list",
                  "the revised timeline","the board pack","the risk register","the invoice batch",
                  "the migration plan","the stakeholder map","the test results","the scope note",
                  "the handover document","the training deck","the data export","the contract redline",
                  "the status report","the budget forecast","the meeting agenda","the closure note",
                  "the change request","the access list","the retention schedule","the QA checklist"]

MEETING_KINDS = ["weekly sync","phase review","kickoff","blocker review","steering committee",
                 "retrospective","planning session","audit checkpoint","status call",
                 "escalation call","handover","budget review","risk workshop","demo"]

SOP_TITLES = ["Client onboarding","Weekly billing run","Meeting transcript intake",
              "Invoice dispute handling","Project closeout","Vendor escalation",
              "Data retention review","Access provisioning","Incident triage",
              "Quarterly reporting","Contract renewal","Expense approval",
              "New starter setup","Backup verification","Change control",
              "Risk assessment","Stakeholder mapping","Document versioning",
              "Timesheet reconciliation","Client offboarding"]
SOP_CATEGORIES = ["Delivery","Finance","Operations","Compliance","People"]

TEMPLATE_KINDS = [
    ("Status update, weekly","Sent every Friday to an active client","Hi [name], quick update on where things stand this week. [progress] Next week we are focused on [next]. Shout if anything here looks off.","email"),
    ("Chasing an overdue invoice","First reminder, friendly","Hi [name], hope things are well. Invoice [number] went out on [date] and is now [days] days past due. Could you let me know where it sits in your process?","email"),
    ("Meeting follow up","After a client call","Hi [name], thanks for the time today. Here is what I took away. [decisions] I have got [actions] on my side.","email"),
    ("Scope change acknowledgement","When a client asks for more","Hi [name], noted on [request]. That sits outside what we scoped, so let me come back with what it means for timeline and cost.","email"),
    ("Project closeout note","At the end of an engagement","Hi [name], that is us wrapped on [project]. Everything is handed over and the final invoice follows.","email"),
    ("Kickoff agenda","Before a first workshop","Kickoff agenda for [project]. Objectives. Scope and boundaries. Roles. Timeline and milestones. Risks. Next steps.","doc"),
    ("Escalation summary","When something needs a partner","Summary of [issue]. What happened. What it affects. What I have tried. What I need decided.","doc"),
]

PHASES = ["initiating","planning","executing","monitoring","closing"]
PROJECT_STATUSES = ["on_track","on_track","on_track","at_risk","blocked","done"]

w("-- Command Center volume dataset. LOCAL ONLY.")
w("-- Generated by seed/generate-volume.py. Do not apply to the remote database.")
w(f"-- Generated {datetime.now(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')}")
w()
w("PRAGMA foreign_keys = ON;")
w()

# --- clear what this seed owns, so it can be reloaded -----------------------
#
# The seed used to assume an empty database. Reloading it over yesterday's
# rows aborted on the first UNIQUE violation (users.email), left the old data
# in place, and reported a log file path rather than an obvious failure. The
# rehearsal's first step is a seed reload, so that silence mattered.
#
# Children before parents, since foreign keys are on. Only rows this generator
# owns are removed: every id it writes is prefixed `v-`, so anything created by
# hand or by the app survives a reload.
w("-- Reloadable. Rows this generator owns are cleared first, and every insert")
w("-- is OR REPLACE, so a reload over yesterday's data replaces it rather than")
w("-- aborting on the first collision. sops and sop_versions are not cleared:")
w("-- a trigger makes versions immutable by design, D33, so they are rewritten.")
for table in [
    "meeting_action_proposals",
    # The ledger goes first: transactions reference categories, and both carry
    # the v- prefix, so neither is reached by any other DELETE in this list.
    "ledger_transactions",
    "ledger_categories",
    # Tickets are ON DELETE RESTRICT from projects, so they have to go before
    # the projects they hang off or the project DELETE is refused. Their events,
    # links and time cascade from here and need no line of their own.
    "tickets",
    "action_items",
    "time_entries",
    "invoices",
    "billing_periods",
    "templates",
    "meetings",
    "projects",
    "clients",
    # Users are not cleared. sop_versions.author_id is ON DELETE SET NULL, so
    # removing a user is an UPDATE of an immutable row and the D33 trigger
    # refuses it, correctly. Users are rewritten in place by OR REPLACE.
]:
    w(f"DELETE FROM \"{table}\" WHERE id LIKE 'v-%';")
w()

# --- users ------------------------------------------------------------------
users = [("v-u-1", "pacardopaul18@gmail.com", "Paul Pacardo", "owner"),
         ("v-u-seed", "seed-fingerprint@local", "pending", "seed-metadata")]
for n in range(2, 7):
    f, l = FIRST[n], LAST[n % len(LAST)]
    users.append((f"v-u-{n}", f"{f.lower()}.{l.lower()}@example.com", f"{f} {l}", "member"))
EXPECT["counts"]["users"] = len(users)
batched_insert("users", ["id","email","display_name","role"], users)

# --- clients ----------------------------------------------------------------
N_CLIENTS = 60
clients = []
names = set()
for i in range(1, N_CLIENTS + 1):
    while True:
        nm = f"{CLIENT_A[(i * 7) % len(CLIENT_A)]} {CLIENT_B[i % len(CLIENT_B)]}"
        if nm not in names:
            names.add(nm)
            break
        CLIENT_A.append(CLIENT_A[i % len(CLIENT_A)] + "field")
    status = "archived" if i % 11 == 0 else "active"
    terms = random.choice(["Net 15","Net 30","Net 30","Net 45","Net 60"])
    bump("counts", "clients")
    clients.append((f"v-cl-{i}", nm, terms, status,
                    random.choice(["Retainer","Project work","Slow payer, watch aging",
                                   "Compliance heavy","Referred by a partner", None]),
                    ts(-random.randint(200, 700))))
batched_insert("clients", ["id","name","billing_terms","status","notes","created_at"], clients)

# --- contacts ---------------------------------------------------------------
#
# Its own random stream, so adding people to the fixture leaves every value
# generated above byte identical. Same property the invoice detail stream holds
# and for the same reason: a fixture that reshuffles the whole database when one
# table is added makes every expected figure change at once, and nobody can tell
# which change was the intended one.
#
# No DELETE line at the top of the file. `contacts.client_id` is ON DELETE
# CASCADE from clients, which is already cleared, so a reload takes these with
# it. Stated because its absence from that list otherwise reads as an oversight.
people = random.Random(20260902)

ROLES = ["Managing director", "Finance lead", "Operations manager",
         "Programme director", "Head of delivery", "Chief of staff",
         "Financial controller", "Partner"]

contacts = []
n_contact = 0
for cid, nm, *_ in clients:
    # A domain built from the client's own name, so an address on screen is
    # recognisably that client's rather than a random string.
    domain = "".join(ch for ch in nm.lower() if ch.isalnum()) + ".example"

    # One to three people, and exactly one of them primary. The partial unique
    # index enforces that; generating two would abort the load, which is the
    # constraint doing its job and not something to work around here.
    for pos in range(people.randint(1, 3)):
        n_contact += 1
        first = FIRST[people.randrange(len(FIRST))]
        last = LAST[people.randrange(len(LAST))]
        contacts.append((
            f"v-ct-{n_contact}",
            cid,
            f"{first} {last}",
            f"{first.lower()}.{last.lower()}@{domain}",
            f"+1 555 {people.randint(1000, 9999)}",
            ROLES[people.randrange(len(ROLES))],
            1 if pos == 0 else 0,
            None,
        ))
        bump("counts", "contacts")

batched_insert("contacts",
               ["id","client_id","name","email","phone","role","is_primary","notes"],
               contacts)

# --- projects ---------------------------------------------------------------
N_PROJECTS = 220
projects = []
for i in range(1, N_PROJECTS + 1):
    ci = random.randint(1, N_CLIENTS)
    phase = random.choice(PHASES)
    status = random.choice(PROJECT_STATUSES)
    start = -random.randint(30, 400)
    target = start + random.randint(60, 300)
    bump("counts", "projects")
    bump("project_status", status)
    bump("project_phase", phase)
    projects.append((
        f"v-pr-{i}",
        f"v-cl-{ci}" if i % 9 else None,
        f"{CLIENT_A[(ci * 7) % len(CLIENT_A)]} {random.choice(PROJECT_KINDS)}",
        phase, status, "v-u-1",
        day(start), day(target),
        random.choice(["Cutover rehearsal","Sign off the scope","Unblock the data export",
                       "Board approval","Evidence pack complete","Agree the metric list",
                       "Vendor decision","Final report", None]),
        None, ts(start), ts(start + 5),
    ))
batched_insert("projects", ["id","client_id","name","phase","status","owner_id","start_date",
                            "target_close","next_milestone","description","created_at","updated_at"], projects)

# --- meetings ---------------------------------------------------------------
N_MEETINGS = 450
meetings = []
for i in range(1, N_MEETINGS + 1):
    pi = random.randint(1, N_PROJECTS)
    ci = random.randint(1, N_CLIENTS)
    # A handful land on today so the cockpit card has something to show.
    offset = 0 if i <= 6 else -random.randint(1, 360)
    has_summary = i % 3 != 0
    reviewed = has_summary and i % 5 != 0
    bump("counts", "meetings")
    if offset == 0:
        bump("totals", "meetings_today")
    meetings.append((
        f"v-mt-{i}", f"v-cl-{ci}", f"v-pr-{pi}" if i % 4 else None,
        f"{CLIENT_A[(ci * 7) % len(CLIENT_A)]} {random.choice(MEETING_KINDS)}",
        day(offset),
        ", ".join(random.sample(OWNERS, random.randint(2, 5))),
        ("## What was decided\n\n" + random.choice([
            "Cutover rehearsal moved to the following week.",
            "Vendor escalation agreed and owned by the client.",
            "Scope confirmed with two open questions carried forward.",
            "Budget increase approved subject to a written estimate.",
            "Evidence pack is on track, no blockers raised.",
        ]) + "\n\n## What is still open\n\n" + random.choice([
            "Timeline for the second phase.",
            "Who signs off the risk register.",
            "Whether the retainer covers the extra scope.",
        ])) if has_summary else None,
        ts(offset, 17) if reviewed else None,
        ts(offset, 10), ts(offset, 10),
    ))
batched_insert("meetings", ["id","client_id","project_id","title","meeting_date","attendees",
                            "summary","summary_reviewed_at","created_at","updated_at"], meetings)

# --- action items -----------------------------------------------------------
N_ACTIONS = 3000
actions = []
for i in range(1, N_ACTIONS + 1):
    pi = random.randint(1, N_PROJECTS)
    mi = random.randint(1, N_MEETINGS)
    roll = random.random()
    if roll < 0.16:
        status, dl = "done", -random.randint(1, 120)
    elif roll < 0.24:
        status, dl = "waiting", random.randint(-40, 60)
    elif roll < 0.30:
        status, dl = "blocked", random.randint(-30, 45)
    elif roll < 0.36:
        status, dl = "ambiguous", None
    else:
        status, dl = "open", random.randint(-45, 90)

    created = (dl if dl is not None else -random.randint(5, 200)) - random.randint(3, 60)
    completed = None
    if status == "done":
        # Some on time, some late, so the completion report has a real rate.
        completed = ts(dl + (random.randint(-6, -1) if random.random() < 0.62 else random.randint(1, 20)), 16)

    bump("counts", "action_items")
    bump("action_status", status)
    if status == "done":
        bump("action_bands", "done")
    elif dl is None:
        bump("action_bands", "no_deadline")
    elif dl < 0:
        bump("action_bands", "overdue")
    elif dl == 0:
        bump("action_bands", "due_today")
    else:
        bump("action_bands", "future")

    src = random.choice(["meeting","meeting","manual","manual","email"])
    actions.append((
        f"v-ai-{i}",
        f"{random.choice(ACTION_VERBS)} {random.choice(ACTION_OBJECTS)} for {CLIENT_A[(pi * 3) % len(CLIENT_A)]}",
        random.choice(["Raised on the call.","Carried over from last week.","Client asked directly.",
                       "Blocking the next milestone.","Follow up from the audit.", None]),
        None if status == "ambiguous" else random.choice(OWNERS),
        None, day(dl) if dl is not None else None,
        status, src,
        f"v-mt-{mi}" if src == "meeting" else None,
        f"v-pr-{pi}" if i % 6 else None,
        None, ts(created), ts(created + 1), completed,
    ))
batched_insert("action_items", ["id","title","context","owner","owner_id","deadline","status",
                                "source","meeting_id","project_id","asana_task_gid",
                                "created_at","updated_at","completed_at"], actions)

# --- meeting action proposals ----------------------------------------------
N_PROPOSALS = 700
proposals = []
for i in range(1, N_PROPOSALS + 1):
    mi = random.randint(1, N_MEETINGS)
    roll = random.random()
    # accepted rows must carry an action_item_id, per the table CHECK.
    if roll < 0.45:
        status, linked = "pending", None
    elif roll < 0.75:
        status, linked = "accepted", f"v-ai-{random.randint(1, N_ACTIONS)}"
    else:
        status, linked = "rejected", None
    owner = "" if random.random() < 0.3 else random.choice(OWNERS)
    dl = None if random.random() < 0.4 else day(random.randint(-10, 40))
    ambiguous = 1 if (not owner or dl is None) else 0
    bump("counts", "meeting_action_proposals")
    bump("totals", "proposals_" + status)
    proposals.append((
        f"v-mp-{i}", f"v-mt-{mi}",
        f"{random.choice(ACTION_VERBS)} {random.choice(ACTION_OBJECTS)}",
        random.choice(["From the review.","Raised near the end.","Agreed in principle.", None]),
        owner, dl, ambiguous,
        ", ".join([x for x in [None if owner else "no owner named",
                               None if dl else "no deadline stated"] if x]) or "",
        random.choice(["we should get that confirmed","I will write that up",
                       "let us circle back on it","that needs to go out this week"]),
        status, linked, "claude-sonnet-5", ts(-random.randint(1, 200), 11),
    ))
batched_insert("meeting_action_proposals", ["id","meeting_id","title","context","owner","deadline",
                                            "ambiguous","ambiguity_note","evidence","status",
                                            "action_item_id","model","created_at"], proposals)

# --- billing periods --------------------------------------------------------
N_PERIODS = 320
periods = []
for i in range(1, N_PERIODS + 1):
    ci = random.randint(1, N_CLIENTS)
    end = -random.randint(0, 330)
    start = end - random.choice([6, 13, 14, 29])
    status = random.choice(["open","open","reconciled","invoiced","invoiced","paid"])
    bump("counts", "billing_periods")
    if status in ("open", "reconciled") and end < 0:
        bump("totals", "unbilled_closed_periods")
    periods.append((f"v-bp-{i}", f"v-cl-{ci}", day(start), day(end), status,
                    random.choice(["Fortnightly","Monthly","Ad hoc", None]),
                    ts(end), ts(end + 2)))
batched_insert("billing_periods", ["id","client_id","period_start","period_end","status",
                                   "note","created_at","updated_at"], periods)

# --- time entries -----------------------------------------------------------
N_ENTRIES = 3200
entries = []
for i in range(1, N_ENTRIES + 1):
    bp = random.randint(1, N_PERIODS)
    ci = random.randint(1, N_CLIENTS)
    bump("counts", "time_entries")
    entries.append((
        f"v-te-{i}", f"v-cl-{ci}", f"v-pr-{random.randint(1, N_PROJECTS)}" if i % 5 else None,
        f"v-bp-{bp}", day(-random.randint(0, 330)),
        round(random.uniform(0.25, 9.0), 2),
        random.choice(["Client call","Drafting","Review","Workshop","Analysis","Coordination",
                       "Reporting","Internal admin","Travel","Preparation"]),
        0 if i % 7 == 0 else 1,
        random.choice(["manual","manual","clockify"]),
        ts(-random.randint(0, 330), 18),
    ))
batched_insert("time_entries", ["id","client_id","project_id","billing_period_id","entry_date",
                                "hours","description","billable","source","created_at"], entries)

# --- invoices ---------------------------------------------------------------
N_INVOICES = 900
invoices = []
# What each invoice is made of, filled in after the loop. Held rather than
# generated inline so the detail below can draw from its own random stream and
# leave every existing value in this file byte for byte where it was.
inv_plan = []
for i in range(1, N_INVOICES + 1):
    ci = random.randint(1, N_CLIENTS)
    issue = -random.randint(0, 340)
    due = issue + random.choice([15, 30, 30, 45, 60])
    amount = random.randint(45, 2600) * 1000
    roll = random.random()
    if roll < 0.34:
        paid, status = amount, "paid"
    elif roll < 0.48:
        paid, status = int(amount * random.uniform(0.1, 0.8)), "partial"
    elif roll < 0.55:
        paid, status = 0, "draft"
    else:
        paid, status = 0, "sent"
    bump("counts", "invoices")
    bump("invoice_status", status)
    outstanding = amount - paid
    if outstanding > 0:
        # days_overdue is -due, because due = date('now', due days). The band
        # boundaries mirror the expression used in invoicing.ts and reports.ts.
        overdue_days = -due
        band = ("b0_30" if overdue_days <= 30 else
                "b31_60" if overdue_days <= 60 else
                "b61_90" if overdue_days <= 90 else "b90_plus")
        bump("invoice_bands", band)
        bump("invoice_bands", band + "_cents", outstanding)
        bump("totals", "outstanding_cents", outstanding)
        bump("totals", "unpaid_invoices")
        bump("per_client_outstanding", f"v-cl-{ci}", outstanding)
        if overdue_days > 0:
            bump("totals", "overdue_invoices")
    invoices.append((
        f"v-in-{i}", f"v-cl-{ci}", f"v-bp-{random.randint(1, N_PERIODS)}" if i % 3 else None,
        f"V-{2000 + i}", day(issue), day(due), amount, paid, status,
        ts(issue), ts(issue + 1),
    ))
    inv_plan.append((f"v-in-{i}", f"v-cl-{ci}", issue, due, amount, paid, status))
batched_insert("invoices", ["id","client_id","billing_period_id","invoice_number","issue_date",
                            "due_date","amount_cents","amount_paid_cents","status",
                            "created_at","updated_at"], invoices)

# --- what each invoice is made of, migration 0024 ---------------------------
#
# Line items, payments and the trail. Added when the invoicing screen was
# rebuilt around the client: the redesign shows what an invoice is for, when it
# was paid and what happened to it, and none of the three existed as rows.
#
# Its own random stream, seeded separately. Drawing from the global one would
# shift every value generated after this point, and the whole dataset would
# churn to add three tables to it.
#
# No DELETE line for these tables at the top of the file. All three are
# ON DELETE CASCADE from invoices, which is already cleared, so a reload takes
# them with it. Stated because their absence from that list otherwise reads as
# an oversight.
detail = random.Random(20260901)

# Every payment, as the ledger line the app would have written when it was
# recorded. Filled in by the loop below and emitted after the invoices exist.
posted_payments = []

# One rate, one hundred dollars, so a line's quantity times its rate lands on an
# exact number of cents and the line items sum to the invoice total that was
# already generated above. A seed that produced a breakdown disagreeing with the
# total it belongs to would be a fixture teaching the app a lie.
SEED_RATE_CENTS = 10000

WORK = [
    ("Consulting", ["Contract renewal", "Policy drafting", "Diligence support",
                    "Vendor consolidation"], "Consulting hours"),
    ("Operations", ["Monthly retainer", "Internal admin", "Onboarding programme"],
     "Operations retainer"),
    ("Advisory", ["Quarterly review", "Board pack", "Partner workshop"],
     "Advisory session"),
]

line_items, payments, events, invoice_detail_updates = [], [], [], []

for (inv_id, client, issue, due, amount, paid, status) in inv_plan:
    category, subs, service = detail.choice(WORK)
    subcategory = detail.choice(subs)

    # Quantity in tenths of an hour. amount is always a multiple of 1000 cents,
    # so amount / 10000 has one decimal place and multiplies back exactly.
    qty = amount / SEED_RATE_CENTS
    if qty >= 8 and detail.random() < 0.45:
        first = round(qty * detail.choice([0.4, 0.5, 0.6]), 1)
        parts = [(service, subcategory, first),
                 ("Review", "Second pass on the same work", round(qty - first, 1))]
    else:
        parts = [(service, subcategory, qty)]

    for pos, (svc, desc, line_qty) in enumerate(parts, start=1):
        cents = round(line_qty * SEED_RATE_CENTS)
        line_items.append((f"{inv_id}-li-{pos}", inv_id, pos, svc, desc, line_qty,
                           SEED_RATE_CENTS, cents, ts(issue), ts(issue)))
        bump("counts", "invoice_line_items")

    invoice_detail_updates.append((inv_id, category, subcategory, amount))

    events.append((f"{inv_id}-ev-1", inv_id, ts(issue), "created",
                   f"Raised for {len(parts)} line item{'' if len(parts) == 1 else 's'}, "
                   f"{qty:.2f} hours at $100.00.", ts(issue)))
    bump("counts", "invoice_events")
    if status != "draft":
        events.append((f"{inv_id}-ev-2", inv_id, ts(issue + 1), "issued",
                       "Marked as sent to the billing contact.", ts(issue + 1)))
        bump("counts", "invoice_events")

    if paid <= 0:
        continue

    # When the money arrived. After the invoice was issued, never in the future,
    # and usually near the due date. Under cash basis this date is the whole
    # point: it is the date the ledger entry would carry.
    lo, hi = issue + 2, min(0, due + 15)
    if hi < lo:
        hi = lo if lo <= 0 else 0
    slices = [paid] if (status != "paid" or detail.random() < 0.7) else None
    if slices is None:
        first = round(paid * detail.uniform(0.3, 0.6) / 1000) * 1000
        slices = [first, paid - first] if 0 < first < paid else [paid]

    for n, part in enumerate(slices, start=1):
        when = day(detail.randint(lo, hi)) if hi >= lo else day(hi)
        method = detail.choice(["Wire transfer", "ACH", "Check", "Card"])
        payments.append((f"{inv_id}-pay-{n}", inv_id, when, part, method, None, None,
                         ts(issue + 2), ts(issue + 2)))
        bump("counts", "invoice_payments")
        # The ledger line this payment posts, recorded here rather than
        # regenerated later, so the books and the invoices carry the same date
        # and the same figure by construction rather than by coincidence.
        posted_payments.append((f"{inv_id}-pay-{n}", inv_id, client, when, part, method))
        bump("totals", "payments_cents", part)
        events.append((f"{inv_id}-ev-p{n}", inv_id, when + "T17:00:00Z", "payment",
                       f"Payment recorded, {method.lower()}.", when + "T17:00:00Z"))
        bump("counts", "invoice_events")

batched_insert("invoice_line_items", ["id","invoice_id","position","service","description",
                                      "quantity","unit_rate_cents","amount_cents",
                                      "created_at","updated_at"], line_items)

# Category, subcategory and subtotal, set by UPDATE rather than carried in the
# INSERT above so the invoice tuple keeps the exact column list it has always
# had. The subtotal equals the total because these invoices carry no discount
# and no tax, which is a fact about the fixture, not a shortcut.
for inv_id, category, subcategory, amount in invoice_detail_updates:
    w(f'UPDATE "invoices" SET "category" = {q(category)}, "subcategory" = {q(subcategory)}, '
      f'"subtotal_cents" = {amount} WHERE id = {q(inv_id)};')
w()

# Payments go in after the invoices they belong to. The triggers from migration
# 0020 recompute amount_paid_cents and status from these rows, and they arrive at
# the same figures the invoice was generated with, which is the check worth
# knowing: if the two ever disagree, one of them is wrong and the suite says so.
batched_insert("invoice_payments", ["id","invoice_id","paid_on","amount_cents","method",
                                    "reference","notes","created_at","updated_at"], payments)
batched_insert("invoice_events", ["id","invoice_id","occurred_at","kind","detail",
                                  "created_at"], events)

# --- the ledger -------------------------------------------------------------
#
# Every payment above, posted as the income line the app writes when a payment
# is recorded, plus a stream of costs a firm this size actually has. Without it
# the Ledger screen shows one row and neither the month view nor the by-category
# panel can be judged against anything.
#
# The income half is not invented. It is the same payment id, the same client,
# the same date and the same figure, under the same category the posting route
# uses, with provenance 'invoice' and source_payment_id set. That means the
# books and the invoices agree by construction, and the guard that checks they
# do is testing the app rather than testing two independently generated lists
# that happen to match.
#
# The cost half is invented, in its own random stream, so adding it leaves every
# value above byte identical.
books = random.Random(20260903)

LEDGER_CATEGORIES = [
    # (id, name, kind, parent)
    ("v-lc-sub", "Subcontractors", "expense", None),
    ("v-lc-travel", "Travel and meals", "expense", None),
    ("v-lc-software", "Software subscriptions", "overhead", None),
    ("v-lc-bank", "Banking and fees", "overhead", None),
    ("v-lc-office", "Office and equipment", "overhead", None),
    ("v-lc-prof", "Professional services", "overhead", None),
]

# Created a year back, so a category is never newer than the lines filed under
# it. Both timestamps are written explicitly: the columns are NOT NULL with no
# default, and relying on a default that is not there fails the load rather than
# quietly writing a null.
CATEGORY_CREATED = ts(-400)

ledger_categories = []
for cid, name, kind, parent in LEDGER_CATEGORIES:
    ledger_categories.append((cid, name, kind, parent, None, CATEGORY_CREATED, CATEGORY_CREATED))
    bump("counts", "ledger_categories")

batched_insert("ledger_categories",
               ["id","name","kind","parent_id","archived_at","created_at","updated_at"],
               ledger_categories)

# What each cost category looks like: how often it turns up in a month, and the
# range a single line falls in, in whole dollars.
COST_SHAPE = [
    ("v-lc-sub",      (0, 2),  (60000, 400000),
     ["Research assistant", "Contract designer", "Editing support"]),
    ("v-lc-travel",   (0, 3),  (4000, 90000),
     ["Site visit, rail and hotel", "Client lunch", "Conference travel"]),
    ("v-lc-software", (2, 5),  (900, 24000),
     ["Notion, annual seat", "Cloudflare and hosting", "Figma seat", "Adobe seat"]),
    ("v-lc-bank",     (1, 3),  (400, 4500),
     ["Incoming wire fee", "Card processing", "FX spread"]),
    ("v-lc-office",   (0, 2),  (3000, 120000),
     ["Desk chair", "Monitor", "Stationery and print"]),
    ("v-lc-prof",     (0, 1),  (25000, 180000),
     ["Accountant, quarterly", "Legal review", "Insurance"]),
]

ledger_txns = []
n_txn = 0

# Income, from the payments that were actually recorded.
for pay_id, inv_id, client, when, part, method in posted_payments:
    n_txn += 1
    ledger_txns.append((
        f"v-lt-{n_txn}",
        "ledger-cat-client-payments",
        client,
        None,
        when,
        part,
        "USD",
        "invoice",
        inv_id,
        pay_id,
        f"Payment received, {method.lower()}.",
        when + "T17:00:00Z",
        when + "T17:00:00Z",
    ))
    bump("counts", "ledger_transactions")
    bump("totals", "ledger_income_cents", part)

# Costs, month by month across the same window the rest of the fixture covers.
for months_back in range(0, 13):
    # The first of the month, `months_back` months before this one.
    anchor_year = TODAY_MT.year
    anchor_month = TODAY_MT.month - months_back
    while anchor_month <= 0:
        anchor_month += 12
        anchor_year -= 1
    days_in_month = (date(anchor_year + (1 if anchor_month == 12 else 0),
                          1 if anchor_month == 12 else anchor_month + 1, 1)
                     - date(anchor_year, anchor_month, 1)).days

    for cat_id, (lo_n, hi_n), (lo_amt, hi_amt), notes in COST_SHAPE:
        for _ in range(books.randint(lo_n, hi_n)):
            day_of_month = books.randint(1, days_in_month)
            when = date(anchor_year, anchor_month, day_of_month)
            # Never in the future: a cost dated next week is not a cost.
            if when > TODAY_MT:
                continue
            n_txn += 1
            amount = books.randrange(lo_amt, hi_amt, 100)
            ledger_txns.append((
                f"v-lt-{n_txn}",
                cat_id,
                None,
                None,
                when.isoformat(),
                amount,
                "USD",
                "manual",
                None,
                None,
                books.choice(notes),
                when.isoformat() + "T17:00:00Z",
                when.isoformat() + "T17:00:00Z",
            ))
            bump("counts", "ledger_transactions")
            bump("totals", "ledger_cost_cents", amount)

batched_insert("ledger_transactions",
               ["id","category_id","client_id","project_id","txn_date","amount_cents",
                "currency","provenance","source_invoice_id","source_payment_id","notes",
                "created_at","updated_at"],
               ledger_txns)

# --- SOPs and versions ------------------------------------------------------
# sops.current_version_id references sop_versions, and sop_versions.sop_id
# references sops, so the rows go in with a null pointer and it is set after.
N_SOPS = 120
sops, versions, pointer_updates = [], [], []
vid = 0
for i in range(1, N_SOPS + 1):
    title = f"{SOP_TITLES[i % len(SOP_TITLES)]} {(i - 1) // len(SOP_TITLES) + 1}"
    created = -random.randint(40, 500)
    sops.append((f"v-sop-{i}", title, random.choice(SOP_CATEGORIES), None, "v-u-1",
                 day(random.randint(-30, 200)) if i % 6 else None,
                 "archived" if i % 13 == 0 else "active", ts(created), ts(created)))
    bump("counts", "sops")
    n_versions = random.randint(1, 5)
    EXPECT["sop_version_counts"][f"v-sop-{i}"] = n_versions
    bump("counts", "sop_versions", n_versions)
    last = None
    for v in range(1, n_versions + 1):
        vid += 1
        last = f"v-sv-{vid}"
        body = ("## Purpose\n\nWhy this exists.\n\n## Steps\n\n"
                + "\n".join(f"{n}. Step {n} of the procedure." for n in range(1, 3 + v)))
        versions.append((last, f"v-sop-{i}", v, body,
                         None if v == 1 else random.choice(["Clarified step 2.","Added the review gate.",
                                                            "Removed the deprecated tool.","Tightened wording."]),
                         "v-u-1", ts(created + v * 7)))
    pointer_updates.append((f"v-sop-{i}", last))

batched_insert("sops", ["id","title","category","current_version_id","owner_id","review_due",
                        "status","created_at","updated_at"], sops)
batched_insert("sop_versions", ["id","sop_id","version_number","body","change_note",
                                "author_id","created_at"], versions)
w("-- Point each SOP at its latest version. Null to a version passes the")
w("-- forward-only trigger, which only guards moves between two real versions.")
for sid, v in pointer_updates:
    # Guarded so a reload is a no-op. current_version_id moves forward only by
    # trigger, and on a reload the SOP already points here, so an unguarded
    # UPDATE re-sets it to itself and the trigger refuses.
    w(
        f"UPDATE sops SET current_version_id = {q(v)} "
        f"WHERE id = {q(sid)} AND IFNULL(current_version_id, '') <> {q(v)};"
    )
w()

# --- tickets, and what happened on them -------------------------------------
#
# Its own random stream, so adding it leaves every value above byte identical.
#
# Tickets had no seeded rows at all, which made the Tickets column on the
# projects table a column of zeroes and left the comment, link and time features
# with nothing to show. The guard that assumed none exist is rewritten rather
# than deleted: what mattered was never the zero, it was that no row exists the
# fixture did not write, and that survives as a prefix check. D157 again.
#
# No DELETE line at the top of the file. ticket_events, ticket_links and
# ticket_time are all ON DELETE CASCADE from tickets, and tickets are ON DELETE
# RESTRICT from projects, which is why tickets ARE listed there: a project
# cannot be cleared while a ticket points at it.
work = random.Random(20260905)

TICKET_TITLES = [
    "Client portal login fails", "Evidence pack export drops a column",
    "Vendor list needs a second review", "Timeline slipped after the data export",
    "Reconcile the hours against the estimate", "Access request for the shared drive",
    "Rework the summary tab", "Chase the signed change request",
    "Migration dry run threw a warning", "Board pack numbers do not tie out",
]

TICKET_STATUSES_SEED = ["open", "open", "in_progress", "in_progress", "blocked",
                        "in_review", "done", "done", "cancelled"]
TICKET_PRIORITIES = ["low", "normal", "normal", "normal", "high", "urgent"]

COMMENTS = [
    "Waiting on the client to come back with the export.",
    "Reproduced on my side. It is the summary tab only.",
    "Pushed the due date, the sponsor is out this week.",
    "Picked this up, should land tomorrow.",
    "Closing this, the vendor confirmed in writing.",
]

tickets_rows = []
ticket_events_rows = []
ticket_links_rows = []
ticket_time_rows = []
n_ticket = 0
n_tev = 0
n_tlink = 0
n_ttime = 0

for (pid, client_id, pname, phase, status, owner, start, target, milestone, desc,
     created, updated) in projects:
    # Most projects carry a ticket or two, a few carry a handful, and plenty
    # carry none. A flat two per project would make every row on the table look
    # the same, which is the same as the column saying nothing.
    for _ in range(work.choice([0, 0, 1, 1, 2, 2, 3, 5])):
        n_ticket += 1
        tid = f"v-tk-{n_ticket}"
        st = work.choice(TICKET_STATUSES_SEED)
        opened = work.randint(-90, -1)
        due = opened + work.randint(3, 45)
        finished = ts(min(0, opened + work.randint(1, 30))) if st in ("done", "cancelled") else None
        assignee = f"{FIRST[work.randrange(len(FIRST))]} {LAST[work.randrange(len(LAST))]}"

        tickets_rows.append((
            tid, pid,
            f"{TICKET_TITLES[work.randrange(len(TICKET_TITLES))]} for {pname.split()[0]}",
            work.choice([None, "Reported on the call. Needs a look before the next review."]),
            day(opened), day(due),
            work.choice([None, 1.0, 2.0, 3.0, 5.0, 8.0]),
            st,
            TICKET_PRIORITIES[work.randrange(len(TICKET_PRIORITIES))],
            assignee, None, "Paul", None,
            finished, None,
            ts(opened), ts(opened),
        ))
        bump("counts", "tickets")

        n_tev += 1
        ticket_events_rows.append((f"v-te-{n_tev}", tid, "created",
                                   "Ticket opened.", None, ts(opened)))
        bump("counts", "ticket_events")

        for _ in range(work.randint(0, 3)):
            n_tev += 1
            when = work.randint(opened, 0)
            ticket_events_rows.append((
                f"v-te-{n_tev}", tid, "comment",
                COMMENTS[work.randrange(len(COMMENTS))],
                assignee, ts(when, hour=work.randint(9, 17)),
            ))
            bump("counts", "ticket_events")

        # Time against the ticket, in minutes, which is what the table stores.
        for _ in range(work.randint(0, 3)):
            n_ttime += 1
            ticket_time_rows.append((
                f"v-tt-{n_ttime}", tid,
                work.choice([15, 30, 45, 60, 90, 120, 180, 240]),
                day(work.randint(opened, 0)), assignee,
                work.choice([None, "Investigation", "Pairing session", "Write up"]),
                ts(opened),
            ))
            bump("counts", "ticket_time")

# A few links between tickets on the same project, stored once per pair.
by_project = {}
for row in tickets_rows:
    by_project.setdefault(row[1], []).append(row[0])

for pid, ids in by_project.items():
    if len(ids) < 2:
        continue
    for _ in range(work.randint(0, 1)):
        a, b = work.sample(ids, 2)
        # One link per ordered pair, and the unique index covers only that, so a
        # duplicate here would abort the load rather than being ignored.
        if any(r[1] == a and r[2] == b for r in ticket_links_rows):
            continue
        n_tlink += 1
        ticket_links_rows.append((
            f"v-tl-{n_tlink}", a, b,
            work.choice(["blocks", "relates", "duplicates"]),
            ts(-work.randint(1, 60)),
        ))
        bump("counts", "ticket_links")

batched_insert("tickets",
               ["id","project_id","title","description","start_date","due_date",
                "estimate_hours","status","priority","assignee","assignee_id",
                "reporter","reporter_id","completed_at","converted_from_action_item_id",
                "created_at","updated_at"], tickets_rows)
batched_insert("ticket_events",
               ["id","ticket_id","kind","detail","author","created_at"], ticket_events_rows)
batched_insert("ticket_links",
               ["id","from_ticket_id","to_ticket_id","kind","created_at"], ticket_links_rows)
batched_insert("ticket_time",
               ["id","ticket_id","minutes","logged_on","who","note","created_at"], ticket_time_rows)

# --- shelves, books, chapters and where each page lives ----------------------
#
# Its own random stream, so adding it leaves every value above byte identical.
#
# The hierarchy is derived from the category each SOP already has rather than
# invented beside it. A shelf per category, two books per shelf, two chapters
# per book, and every active page filed into one of them. That means the
# fixture agrees with itself: a page on the Finance shelf is a page whose
# category is Finance, which is the property the reads assume and the only one
# worth seeding.
#
# A few pages are deliberately left unfiled, because that is the state every
# real SOP is in the moment the shelves arrive, and a library that only ever
# showed filed pages would have lost them.
#
# No DELETE line at the top of the file: books cascade from shelves, chapters
# from books, and placements from both chapters and sops, all of which are
# already cleared.
library = random.Random(20260906)

BOOK_TITLES = ["Running it", "Reviewing it"]
CHAPTER_TITLES = ["Doing the work", "Checking the work"]

shelves = []
books = []
chapters = []
placements = []

# The category list, in a fixed order, so the ids are stable across runs.
shelf_names = sorted(set(SOP_CATEGORIES))
chapters_by_shelf = {}

for si, name in enumerate(shelf_names, start=1):
    shelf_id = f"v-sh-{si}"
    shelves.append((shelf_id, name,
                    f"Everything about {name.lower()}, written down.",
                    library.choice(["Paul", "Sofia Okafor", "Rue Mbeki", "Mei Bianchi"]),
                    si, ts(-500), ts(-500)))
    bump("counts", "sop_shelves")

    shelf_chapters = []
    for bi, btitle in enumerate(BOOK_TITLES, start=1):
        book_id = f"v-bk-{si}-{bi}"
        books.append((
            book_id, shelf_id, f"{name}: {btitle}",
            f"{btitle} for {name.lower()}.",
            None,
            library.choice([30, 90, 180, None]),
            ts(-library.randint(10, 200)),
            "published" if bi == 1 else "draft",
            bi, ts(-400), ts(-400),
        ))
        bump("counts", "sop_books")

        for ci, ctitle in enumerate(CHAPTER_TITLES, start=1):
            chapter_id = f"v-ch-{si}-{bi}-{ci}"
            chapters.append((chapter_id, book_id, ctitle, ci, ts(-400), ts(-400)))
            bump("counts", "sop_chapters")
            shelf_chapters.append(chapter_id)

    chapters_by_shelf[name] = shelf_chapters

n_place = 0
for (sop_id, title, category, _cv, _owner, _review, status, _c, _u) in sops:
    if status != "active":
        continue
    # One in nine stays unfiled, which is the state a page is in before anybody
    # has put it on a shelf.
    if library.random() < 0.11:
        continue
    targets = chapters_by_shelf.get(category)
    if not targets:
        continue
    n_place += 1
    placements.append((
        f"v-pl-{n_place}", sop_id,
        targets[library.randrange(len(targets))],
        n_place, ts(-300),
    ))
    bump("counts", "sop_placements")

batched_insert("sop_shelves",
               ["id","name","description","owner","position","created_at","updated_at"], shelves)
batched_insert("sop_books",
               ["id","shelf_id","title","description","owner","review_cycle_days",
                "last_reviewed_at","status","position","created_at","updated_at"], books)
batched_insert("sop_chapters",
               ["id","book_id","title","position","created_at","updated_at"], chapters)
batched_insert("sop_placements",
               ["id","sop_id","chapter_id","position","created_at"], placements)

# --- templates --------------------------------------------------------------
templates = []
for i in range(1, 91):
    base = TEMPLATE_KINDS[i % len(TEMPLATE_KINDS)]
    created = -random.randint(10, 400)
    bump("counts", "templates")
    bump("totals", "templates_" + ("archived" if i % 12 == 0 else "active"))
    templates.append((f"v-tp-{i}", f"{base[0]} {(i - 1) // len(TEMPLATE_KINDS) + 1}",
                      base[1], base[2], base[3],
                      "archived" if i % 12 == 0 else "active", ts(created), ts(created)))
batched_insert("templates", ["id","name","scenario","body","type","status",
                             "created_at","updated_at"], templates)

# --- what each template has been used for -----------------------------------
#
# Its own random stream, so adding it leaves every value above byte identical.
#
# Without these the Most used tile has nothing to name and the library sorts by
# a column of zeroes, which is a redesign that cannot be judged. Nothing here
# stores a draft: the row records that a use happened and roughly how long the
# result was, which is the whole of what migration 0028 keeps. D158.
#
# No DELETE line at the top of the file: template_uses is ON DELETE CASCADE from
# templates, which is already cleared, so a reload takes these with it.
uses = random.Random(20260904)

USE_CONTEXTS = [
    "Weekly run for the active engagements",
    "Partner asked for a summary",
    "Month end pack",
    "Client requested an update",
    "Escalation on the migration",
    "Quarterly review preparation",
    "Ahead of the steering committee",
    None,
]

template_uses = []
n_use = 0
for tid, name, scenario, body, kind, status, created, _updated in templates:
    if status == "archived":
        continue
    # A long tail: most templates are used a handful of times and one or two
    # carry the library. A flat distribution would make the Most used tile
    # arbitrary, which is the same as it being wrong.
    weight = uses.random()
    n = int(1 + (weight ** 3) * 60)
    for _ in range(n):
        n_use += 1
        when = uses.randint(-120, 0)
        model = "claude-sonnet-5" if uses.random() < 0.65 else None
        template_uses.append((
            f"v-tu-{n_use}",
            tid,
            uses.choice(USE_CONTEXTS),
            uses.randint(400, 4000) if model else None,
            model,
            ts(when, hour=uses.randint(8, 18)),
        ))
        bump("counts", "template_uses")

batched_insert("template_uses",
               ["id","template_id","context","drafted_chars","model","created_at"],
               template_uses)

# Derived rollups the suite asserts on, so a mistake in one table shows up
# against a number computed from a different table's generation.
EXPECT["totals"]["action_items_open"] = (
    EXPECT["counts"]["action_items"] - EXPECT["action_status"].get("done", 0)
)
EXPECT["totals"]["projects_needing_attention"] = (
    EXPECT["project_status"].get("at_risk", 0) + EXPECT["project_status"].get("blocked", 0)
)

import hashlib
import json

# A fingerprint of everything the suite asserts. If the generator changes what
# it produces, this changes, and a database loaded from an older run stops
# matching. That failure is the point: a stale fixture otherwise shows up as a
# scattering of off-by-small-numbers that read like application defects, which
# is exactly what it did on the suite's first run.
EXPECT["today_mt"] = TODAY_MT.isoformat()
FINGERPRINT = hashlib.sha256(
    json.dumps(EXPECT, sort_keys=True).encode("utf-8")
).hexdigest()[:16]
EXPECT["fingerprint"] = FINGERPRINT

w(f"UPDATE users SET display_name = '{FINGERPRINT}' WHERE id = 'v-u-seed';")
w()

with io.open("seed/expected.json", "w", encoding="utf-8", newline="\n") as fh:
    json.dump(EXPECT, fh, indent=1, sort_keys=True)
    fh.write("\n")

w("-- end")
print("\n".join(OUT))
