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
    for i in range(0, len(rows), batch):
        chunk = rows[i:i + batch]
        w(f'INSERT INTO "{table}" ({cols}) VALUES')
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
batched_insert("invoices", ["id","client_id","billing_period_id","invoice_number","issue_date",
                            "due_date","amount_cents","amount_paid_cents","status",
                            "created_at","updated_at"], invoices)

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
    w(f"UPDATE sops SET current_version_id = {q(v)} WHERE id = {q(sid)};")
w()

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
