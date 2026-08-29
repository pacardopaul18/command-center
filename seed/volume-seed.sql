-- Volume seed. LOCAL ONLY. Never apply this to the remote database.
--
-- Every screen in this app looks fine with three rows. The question is what it
-- looks like with thirty, which is the only volume that shows whether the
-- spacing, the density and the sidebar hold up.
--
-- This must never reach production. If it did, the digest would report the fake
-- overdue items and the fake past-due invoices as real fires, which would
-- contaminate exactly the evidence the digest incident is waiting on. See the
-- risk logged alongside it.
--
--   npx wrangler d1 execute command-center-db --local --file=./seed/volume-seed.sql
--
-- Everything here uses a v- prefix on ids so it can be found and removed.

-- Clients ---------------------------------------------------------------------
INSERT INTO clients (id, name, billing_terms, status, notes, created_at, updated_at) VALUES
 ('v-cl-1','Halcyon Group','Net 30','active','Retainer, quarterly reviews','2026-05-01T09:00:00Z','2026-05-01T09:00:00Z'),
 ('v-cl-2','Beacon Analytics','Net 15','active','Data platform build','2026-05-04T09:00:00Z','2026-05-04T09:00:00Z'),
 ('v-cl-3','Ridgeline Capital','Net 45','active','Slow payer, watch aging','2026-05-08T09:00:00Z','2026-05-08T09:00:00Z'),
 ('v-cl-4','Tessellate Studio','Net 30','active','Brand and web','2026-05-12T09:00:00Z','2026-05-12T09:00:00Z'),
 ('v-cl-5','Orchard Health','Net 30','active','Compliance heavy','2026-05-18T09:00:00Z','2026-05-18T09:00:00Z'),
 ('v-cl-6','Kestrel Logistics','Net 60','archived','Dormant since June','2026-04-02T09:00:00Z','2026-06-30T09:00:00Z');

-- Projects, spread across all five PMI phases and all four statuses -----------
INSERT INTO projects (id, client_id, name, phase, status, owner_id, start_date, target_close, next_milestone, description, created_at, updated_at) VALUES
 ('v-pr-1','v-cl-1','Halcyon platform migration','executing','at_risk',NULL,'2026-06-01','2026-09-15','Cutover rehearsal','Lift and shift of the reporting stack','2026-06-01T09:00:00Z','2026-08-20T09:00:00Z'),
 ('v-pr-2','v-cl-1','Halcyon quarterly review','closing','on_track',NULL,'2026-07-01','2026-09-05','Final report sign off','Q3 review pack','2026-07-01T09:00:00Z','2026-08-22T09:00:00Z'),
 ('v-pr-3','v-cl-2','Beacon data warehouse','executing','blocked',NULL,'2026-05-15','2026-08-20','Unblock the data export','Warehouse and dashboards','2026-05-15T09:00:00Z','2026-08-10T09:00:00Z'),
 ('v-pr-4','v-cl-2','Beacon dashboard refresh','planning','on_track',NULL,'2026-08-01','2026-10-30','Agree the metric list','Second phase','2026-08-01T09:00:00Z','2026-08-25T09:00:00Z'),
 ('v-pr-5','v-cl-3','Ridgeline diligence support','monitoring','at_risk',NULL,'2026-04-01','2026-09-01','Close the open questions','Deal support','2026-04-01T09:00:00Z','2026-08-18T09:00:00Z'),
 ('v-pr-6','v-cl-4','Tessellate rebrand','initiating','on_track',NULL,'2026-08-20','2026-12-01','Kickoff workshop','Full identity refresh','2026-08-20T09:00:00Z','2026-08-26T09:00:00Z'),
 ('v-pr-7','v-cl-4','Tessellate site build','planning','on_track',NULL,'2026-08-25','2026-11-15','Sitemap approval','Marketing site','2026-08-25T09:00:00Z','2026-08-27T09:00:00Z'),
 ('v-pr-8','v-cl-5','Orchard compliance audit','executing','on_track',NULL,'2026-07-10','2026-09-30','Evidence pack complete','Annual audit prep','2026-07-10T09:00:00Z','2026-08-24T09:00:00Z'),
 ('v-pr-9','v-cl-5','Orchard policy refresh','monitoring','on_track',NULL,'2026-06-15','2026-08-31','Board approval','Policy set rewrite','2026-06-15T09:00:00Z','2026-08-21T09:00:00Z'),
 ('v-pr-10','v-cl-3','Ridgeline reporting pack','closing','done',NULL,'2026-03-01','2026-07-31','Delivered','Monthly pack automation','2026-03-01T09:00:00Z','2026-07-31T09:00:00Z');

-- Meetings, including three dated today for the cockpit card ------------------
INSERT INTO meetings (id, client_id, project_id, title, meeting_date, attendees, summary, summary_reviewed_at, created_at, updated_at) VALUES
 ('v-mt-1','v-cl-1','v-pr-1','Halcyon cutover planning',date('now'),'Paul, Dana, Marcus','## What was decided. Cutover rehearsal moved to the 8th.',NULL,'2026-08-29T08:00:00Z','2026-08-29T08:00:00Z'),
 ('v-mt-2','v-cl-2','v-pr-3','Beacon blocker review',date('now'),'Paul, Priya','## What was decided. Vendor escalation agreed.',NULL,'2026-08-29T08:10:00Z','2026-08-29T08:10:00Z'),
 ('v-mt-3','v-cl-5','v-pr-8','Orchard audit checkpoint',date('now'),'Paul, Ines, Tom','## What was decided. Evidence pack on track.','2026-08-29T09:00:00Z','2026-08-29T08:20:00Z','2026-08-29T08:20:00Z'),
 ('v-mt-4','v-cl-3','v-pr-5','Ridgeline diligence sync',date('now','-3 day'),'Paul, Alex',NULL,NULL,'2026-08-26T08:00:00Z','2026-08-26T08:00:00Z'),
 ('v-mt-5','v-cl-4','v-pr-6','Tessellate kickoff',date('now','-6 day'),'Paul, Rue, Sam','## What was decided. Scope agreed.',NULL,'2026-08-23T08:00:00Z','2026-08-23T08:00:00Z');

-- Action items: 34 rows across every status and deadline band ----------------
INSERT INTO action_items (id, title, context, owner, deadline, status, source, meeting_id, project_id, created_at, updated_at, completed_at) VALUES
 ('v-ai-1','Send the Halcyon cutover runbook to Dana','Agreed at the planning call','Paul',date('now','-14 day'),'open','meeting','v-mt-1','v-pr-1','2026-08-10T09:00:00Z','2026-08-10T09:00:00Z',NULL),
 ('v-ai-2','Chase Beacon on the blocked data export','Vendor has not replied in two weeks','Paul',date('now','-11 day'),'blocked','meeting','v-mt-2','v-pr-3','2026-08-12T09:00:00Z','2026-08-12T09:00:00Z',NULL),
 ('v-ai-3','Confirm Ridgeline diligence scope','Open since the April kickoff','Paul',date('now','-9 day'),'open','manual',NULL,'v-pr-5','2026-08-14T09:00:00Z','2026-08-14T09:00:00Z',NULL),
 ('v-ai-4','Rewrite the Orchard incident policy','Board wants it before September','Paul',date('now','-7 day'),'open','manual',NULL,'v-pr-9','2026-08-16T09:00:00Z','2026-08-16T09:00:00Z',NULL),
 ('v-ai-5','Get Tessellate brand assets from Rue','Blocking the sitemap','Rue',date('now','-6 day'),'waiting','meeting','v-mt-5','v-pr-6','2026-08-17T09:00:00Z','2026-08-17T09:00:00Z',NULL),
 ('v-ai-6','Reconcile the July Halcyon hours','Period closed, not invoiced','Paul',date('now','-5 day'),'open','manual',NULL,'v-pr-2','2026-08-18T09:00:00Z','2026-08-18T09:00:00Z',NULL),
 ('v-ai-7','Escalate the Beacon vendor delay','Second escalation','Paul',date('now','-4 day'),'open','meeting','v-mt-2','v-pr-3','2026-08-19T09:00:00Z','2026-08-19T09:00:00Z',NULL),
 ('v-ai-8','Draft the Ridgeline close out note','Project delivered in July','Paul',date('now','-3 day'),'open','manual',NULL,'v-pr-10','2026-08-20T09:00:00Z','2026-08-20T09:00:00Z',NULL),
 ('v-ai-9','Confirm Orchard audit evidence list','Ines to supply','Ines',date('now','-2 day'),'waiting','meeting','v-mt-3','v-pr-8','2026-08-21T09:00:00Z','2026-08-21T09:00:00Z',NULL),
 ('v-ai-10','Approve the Tessellate sitemap','Waiting on Sam','Sam',date('now','-1 day'),'waiting','manual',NULL,'v-pr-7','2026-08-22T09:00:00Z','2026-08-22T09:00:00Z',NULL),
 ('v-ai-11','Book the Halcyon rehearsal room','For the 8th','Paul',date('now'),'open','meeting','v-mt-1','v-pr-1','2026-08-25T09:00:00Z','2026-08-25T09:00:00Z',NULL),
 ('v-ai-12','Send Beacon the revised timeline','Due today','Paul',date('now'),'open','meeting','v-mt-2','v-pr-4','2026-08-25T09:00:00Z','2026-08-25T09:00:00Z',NULL),
 ('v-ai-13','Review the Orchard evidence pack','Due today','Paul',date('now'),'open','meeting','v-mt-3','v-pr-8','2026-08-26T09:00:00Z','2026-08-26T09:00:00Z',NULL),
 ('v-ai-14','Prepare the Halcyon Q3 review pack','Due in two days','Paul',date('now','+2 day'),'open','manual',NULL,'v-pr-2','2026-08-26T09:00:00Z','2026-08-26T09:00:00Z',NULL),
 ('v-ai-15','Draft the Tessellate workshop agenda','Kickoff next week','Paul',date('now','+3 day'),'open','meeting','v-mt-5','v-pr-6','2026-08-26T09:00:00Z','2026-08-26T09:00:00Z',NULL),
 ('v-ai-16','Send Ridgeline the final invoice','After close out','Paul',date('now','+4 day'),'open','manual',NULL,'v-pr-10','2026-08-27T09:00:00Z','2026-08-27T09:00:00Z',NULL),
 ('v-ai-17','Collect Orchard policy sign offs','Board pack','Paul',date('now','+5 day'),'open','manual',NULL,'v-pr-9','2026-08-27T09:00:00Z','2026-08-27T09:00:00Z',NULL),
 ('v-ai-18','Agree the Beacon metric list','Planning phase','Priya',date('now','+6 day'),'waiting','manual',NULL,'v-pr-4','2026-08-27T09:00:00Z','2026-08-27T09:00:00Z',NULL),
 ('v-ai-19','Schedule the Halcyon cutover','Depends on the rehearsal','Paul',date('now','+9 day'),'open','manual',NULL,'v-pr-1','2026-08-28T09:00:00Z','2026-08-28T09:00:00Z',NULL),
 ('v-ai-20','Write the Tessellate content brief','Not urgent','Paul',date('now','+14 day'),'open','manual',NULL,'v-pr-7','2026-08-28T09:00:00Z','2026-08-28T09:00:00Z',NULL),
 ('v-ai-21','Something about the reporting change',NULL,NULL,NULL,'ambiguous','meeting','v-mt-4','v-pr-5','2026-08-26T09:00:00Z','2026-08-26T09:00:00Z',NULL),
 ('v-ai-22','Follow up on the pricing question','Unclear who owns this',NULL,NULL,'ambiguous','meeting','v-mt-4',NULL,'2026-08-26T09:00:00Z','2026-08-26T09:00:00Z',NULL),
 ('v-ai-23','Look into the Kestrel dormancy','No date agreed',NULL,NULL,'ambiguous','manual',NULL,NULL,'2026-08-20T09:00:00Z','2026-08-20T09:00:00Z',NULL),
 ('v-ai-24','Waiting on Halcyon legal review','No movement in weeks','Marcus',date('now','+20 day'),'waiting','manual',NULL,'v-pr-1','2026-08-01T09:00:00Z','2026-08-05T09:00:00Z',NULL),
 ('v-ai-25','Waiting on Beacon procurement','Stalled','Priya',date('now','+25 day'),'waiting','manual',NULL,'v-pr-3','2026-08-02T09:00:00Z','2026-08-06T09:00:00Z',NULL),
 ('v-ai-26','Blocked on the Ridgeline data room','No access yet','Alex',date('now','+12 day'),'blocked','manual',NULL,'v-pr-5','2026-08-08T09:00:00Z','2026-08-09T09:00:00Z',NULL),
 ('v-ai-27','Send the Halcyon rehearsal notes','Done on time','Paul',date('now','-8 day'),'done','meeting','v-mt-1','v-pr-1','2026-08-12T09:00:00Z','2026-08-21T09:00:00Z','2026-08-21T16:00:00Z'),
 ('v-ai-28','Issue the Beacon August invoice','Done on time','Paul',date('now','-6 day'),'done','manual',NULL,'v-pr-3','2026-08-14T09:00:00Z','2026-08-23T09:00:00Z','2026-08-23T16:00:00Z'),
 ('v-ai-29','Update the Orchard risk register','Done late','Paul',date('now','-10 day'),'done','manual',NULL,'v-pr-8','2026-08-10T09:00:00Z','2026-08-24T09:00:00Z','2026-08-24T16:00:00Z'),
 ('v-ai-30','Send Tessellate the proposal','Done late','Paul',date('now','-12 day'),'done','manual',NULL,'v-pr-6','2026-08-05T09:00:00Z','2026-08-25T09:00:00Z','2026-08-25T16:00:00Z'),
 ('v-ai-31','File the Ridgeline monthly pack','No deadline set','Paul',NULL,'done','manual',NULL,'v-pr-10','2026-08-15T09:00:00Z','2026-08-26T09:00:00Z','2026-08-26T16:00:00Z'),
 ('v-ai-32','Archive the Kestrel folder','Housekeeping','Paul',date('now','-2 day'),'done','manual',NULL,NULL,'2026-08-20T09:00:00Z','2026-08-27T09:00:00Z','2026-08-27T16:00:00Z'),
 ('v-ai-33','Confirm the Halcyon invoice address','Small thing','Paul',date('now','-1 day'),'done','manual',NULL,'v-pr-2','2026-08-24T09:00:00Z','2026-08-28T09:00:00Z','2026-08-28T16:00:00Z'),
 ('v-ai-34','Send Orchard the audit timeline','Closed today','Paul',date('now'),'done','meeting','v-mt-3','v-pr-8','2026-08-26T09:00:00Z','2026-08-29T09:00:00Z','2026-08-29T09:30:00Z');

-- Pending proposals, so the cockpit meeting card shows a decision backlog -----
INSERT INTO meeting_action_proposals (id, meeting_id, title, context, owner, deadline, ambiguous, ambiguity_note, evidence, status, model, created_at) VALUES
 ('v-mp-1','v-mt-1','Confirm the rehearsal date with the vendor','Raised near the end','',NULL,1,'no owner named','we should get that confirmed','pending','claude-sonnet-5','2026-08-29T08:30:00Z'),
 ('v-mp-2','v-mt-1','Share the rollback plan','Discussed briefly','Paul',NULL,1,'no deadline stated','I will write up the rollback','pending','claude-sonnet-5','2026-08-29T08:30:00Z'),
 ('v-mp-3','v-mt-2','Draft the vendor escalation email','Agreed','Paul',date('now','+1 day'),0,'','I will draft that today','pending','claude-sonnet-5','2026-08-29T08:35:00Z'),
 ('v-mp-4','v-mt-4','Revisit the reporting cadence','Unclear','',NULL,1,'no owner named, no deadline stated','maybe we change the cadence','pending','claude-sonnet-5','2026-08-26T09:00:00Z');

-- Billing periods, several closed and uninvoiced ------------------------------
INSERT INTO billing_periods (id, client_id, period_start, period_end, status, note, created_at, updated_at) VALUES
 ('v-bp-1','v-cl-1',date('now','-60 day'),date('now','-46 day'),'invoiced','July first half','2026-07-01T09:00:00Z','2026-07-20T09:00:00Z'),
 ('v-bp-2','v-cl-1',date('now','-45 day'),date('now','-31 day'),'open','July second half, not invoiced','2026-07-16T09:00:00Z','2026-07-16T09:00:00Z'),
 ('v-bp-3','v-cl-2',date('now','-40 day'),date('now','-26 day'),'reconciled','August first half, not invoiced','2026-07-21T09:00:00Z','2026-08-01T09:00:00Z'),
 ('v-bp-4','v-cl-3',date('now','-30 day'),date('now','-16 day'),'invoiced','Diligence support','2026-07-31T09:00:00Z','2026-08-10T09:00:00Z'),
 ('v-bp-5','v-cl-5',date('now','-20 day'),date('now','-6 day'),'open','Audit prep, not invoiced','2026-08-10T09:00:00Z','2026-08-10T09:00:00Z'),
 ('v-bp-6','v-cl-4',date('now','-10 day'),date('now','+4 day'),'open','Current period, still running','2026-08-20T09:00:00Z','2026-08-20T09:00:00Z');

INSERT INTO time_entries (id, client_id, project_id, billing_period_id, entry_date, hours, description, billable, source, created_at) VALUES
 ('v-te-1','v-cl-1','v-pr-1','v-bp-2',date('now','-44 day'),6.5,'Migration planning',1,'manual','2026-07-17T09:00:00Z'),
 ('v-te-2','v-cl-1','v-pr-1','v-bp-2',date('now','-42 day'),4.25,'Runbook drafting',1,'manual','2026-07-19T09:00:00Z'),
 ('v-te-3','v-cl-1','v-pr-2','v-bp-2',date('now','-38 day'),3.0,'Review pack',1,'manual','2026-07-23T09:00:00Z'),
 ('v-te-4','v-cl-1','v-pr-1','v-bp-2',date('now','-35 day'),2.0,'Internal admin',0,'manual','2026-07-26T09:00:00Z'),
 ('v-te-5','v-cl-2','v-pr-3','v-bp-3',date('now','-39 day'),8.0,'Warehouse build',1,'manual','2026-07-22T09:00:00Z'),
 ('v-te-6','v-cl-2','v-pr-3','v-bp-3',date('now','-36 day'),5.5,'Vendor coordination',1,'manual','2026-07-25T09:00:00Z'),
 ('v-te-7','v-cl-2','v-pr-4','v-bp-3',date('now','-30 day'),4.0,'Metric workshop',1,'manual','2026-07-31T09:00:00Z'),
 ('v-te-8','v-cl-5','v-pr-8','v-bp-5',date('now','-18 day'),7.25,'Evidence gathering',1,'manual','2026-08-12T09:00:00Z'),
 ('v-te-9','v-cl-5','v-pr-8','v-bp-5',date('now','-14 day'),6.0,'Control testing',1,'manual','2026-08-16T09:00:00Z'),
 ('v-te-10','v-cl-5','v-pr-9','v-bp-5',date('now','-9 day'),3.75,'Policy drafting',1,'manual','2026-08-21T09:00:00Z'),
 ('v-te-11','v-cl-4','v-pr-6','v-bp-6',date('now','-8 day'),5.0,'Brand discovery',1,'manual','2026-08-22T09:00:00Z'),
 ('v-te-12','v-cl-4','v-pr-7','v-bp-6',date('now','-4 day'),4.5,'Sitemap',1,'manual','2026-08-26T09:00:00Z');

-- Invoices: every aging band populated, plus paid and not yet due ------------
INSERT INTO invoices (id, client_id, billing_period_id, invoice_number, issue_date, due_date, amount_cents, amount_paid_cents, status, created_at, updated_at) VALUES
 ('v-in-1','v-cl-3','v-bp-4','V-1001',date('now','-140 day'),date('now','-110 day'),1875000,0,'sent','2026-04-11T09:00:00Z','2026-04-11T09:00:00Z'),
 ('v-in-2','v-cl-3',NULL,'V-1002',date('now','-130 day'),date('now','-100 day'),920000,0,'sent','2026-04-21T09:00:00Z','2026-04-21T09:00:00Z'),
 ('v-in-3','v-cl-6',NULL,'V-1003',date('now','-125 day'),date('now','-95 day'),1440000,240000,'partial','2026-04-26T09:00:00Z','2026-05-20T09:00:00Z'),
 ('v-in-4','v-cl-1','v-bp-1','V-1010',date('now','-105 day'),date('now','-75 day'),2260000,0,'sent','2026-05-16T09:00:00Z','2026-05-16T09:00:00Z'),
 ('v-in-5','v-cl-2',NULL,'V-1011',date('now','-98 day'),date('now','-68 day'),1130000,300000,'partial','2026-05-23T09:00:00Z','2026-06-15T09:00:00Z'),
 ('v-in-6','v-cl-5',NULL,'V-1012',date('now','-95 day'),date('now','-62 day'),780000,0,'sent','2026-05-26T09:00:00Z','2026-05-26T09:00:00Z'),
 ('v-in-7','v-cl-1',NULL,'V-1020',date('now','-70 day'),date('now','-40 day'),1560000,0,'sent','2026-06-20T09:00:00Z','2026-06-20T09:00:00Z'),
 ('v-in-8','v-cl-4',NULL,'V-1021',date('now','-65 day'),date('now','-35 day'),640000,0,'sent','2026-06-25T09:00:00Z','2026-06-25T09:00:00Z'),
 ('v-in-9','v-cl-2',NULL,'V-1022',date('now','-62 day'),date('now','-32 day'),990000,150000,'partial','2026-06-28T09:00:00Z','2026-07-30T09:00:00Z'),
 ('v-in-10','v-cl-5',NULL,'V-1030',date('now','-45 day'),date('now','-20 day'),1320000,0,'sent','2026-07-15T09:00:00Z','2026-07-15T09:00:00Z'),
 ('v-in-11','v-cl-1',NULL,'V-1031',date('now','-40 day'),date('now','-12 day'),870000,0,'sent','2026-07-20T09:00:00Z','2026-07-20T09:00:00Z'),
 ('v-in-12','v-cl-4',NULL,'V-1032',date('now','-35 day'),date('now','-5 day'),450000,0,'sent','2026-07-25T09:00:00Z','2026-07-25T09:00:00Z'),
 ('v-in-13','v-cl-2',NULL,'V-1040',date('now','-25 day'),date('now','-1 day'),1180000,0,'sent','2026-08-04T09:00:00Z','2026-08-04T09:00:00Z'),
 ('v-in-14','v-cl-5',NULL,'V-1041',date('now','-20 day'),date('now','+6 day'),960000,0,'sent','2026-08-09T09:00:00Z','2026-08-09T09:00:00Z'),
 ('v-in-15','v-cl-4',NULL,'V-1042',date('now','-15 day'),date('now','+14 day'),720000,0,'sent','2026-08-14T09:00:00Z','2026-08-14T09:00:00Z'),
 ('v-in-16','v-cl-1','v-bp-1','V-1050',date('now','-55 day'),date('now','-25 day'),1990000,1990000,'paid','2026-07-05T09:00:00Z','2026-08-01T09:00:00Z'),
 ('v-in-17','v-cl-3','v-bp-4','V-1051',date('now','-50 day'),date('now','-20 day'),1420000,1420000,'paid','2026-07-10T09:00:00Z','2026-08-05T09:00:00Z'),
 ('v-in-18','v-cl-2',NULL,'V-1052',date('now','-28 day'),date('now','+2 day'),530000,530000,'paid','2026-08-01T09:00:00Z','2026-08-20T09:00:00Z');

-- SOPs and templates, so those lists are not three rows either ----------------
INSERT INTO sops (id, title, category, current_version_id, owner_id, review_due, status, created_at, updated_at) VALUES
 ('v-sop-1','Client onboarding','Delivery',NULL,NULL,date('now','+40 day'),'active','2026-06-01T09:00:00Z','2026-06-01T09:00:00Z'),
 ('v-sop-2','Weekly billing run','Finance',NULL,NULL,date('now','+15 day'),'active','2026-06-05T09:00:00Z','2026-06-05T09:00:00Z'),
 ('v-sop-3','Meeting transcript intake','Delivery',NULL,NULL,date('now','-5 day'),'active','2026-06-10T09:00:00Z','2026-06-10T09:00:00Z'),
 ('v-sop-4','Invoice dispute handling','Finance',NULL,NULL,date('now','+70 day'),'active','2026-06-15T09:00:00Z','2026-06-15T09:00:00Z'),
 ('v-sop-5','Project closeout','Delivery',NULL,NULL,date('now','+90 day'),'active','2026-06-20T09:00:00Z','2026-06-20T09:00:00Z'),
 ('v-sop-6','Vendor escalation','Operations',NULL,NULL,date('now','+30 day'),'active','2026-06-25T09:00:00Z','2026-06-25T09:00:00Z'),
 ('v-sop-7','Legacy filing process','Operations',NULL,NULL,NULL,'archived','2026-05-01T09:00:00Z','2026-07-01T09:00:00Z');

INSERT INTO templates (id, name, scenario, body, type, status, created_at, updated_at) VALUES
 ('v-tp-1','Status update, weekly','Sent every Friday to an active client','Hi [name], quick update on where things stand this week. [progress] Next week we are focused on [next]. Shout if anything here looks off.','email','active','2026-06-01T09:00:00Z','2026-06-01T09:00:00Z'),
 ('v-tp-2','Chasing an overdue invoice','First reminder, friendly','Hi [name], hope things are well. Invoice [number] went out on [date] and is now [days] days past due. Could you let me know where it sits in your process? Happy to resend if it helps.','email','active','2026-06-05T09:00:00Z','2026-06-05T09:00:00Z'),
 ('v-tp-3','Meeting follow up','After a client call','Hi [name], thanks for the time today. Here is what I took away. [decisions] I have got [actions] on my side. Let me know if I have missed anything.','email','active','2026-06-10T09:00:00Z','2026-06-10T09:00:00Z'),
 ('v-tp-4','Scope change acknowledgement','When a client asks for more','Hi [name], noted on [request]. That sits outside what we scoped, so let me come back with what it means for timeline and cost before we commit to it.','email','active','2026-06-15T09:00:00Z','2026-06-15T09:00:00Z'),
 ('v-tp-5','Project closeout note','At the end of an engagement','Hi [name], that is us wrapped on [project]. Everything is handed over and the final invoice follows. It has been good working with you.','email','active','2026-06-20T09:00:00Z','2026-06-20T09:00:00Z'),
 ('v-tp-6','Kickoff agenda','Before a first workshop','Kickoff agenda for [project]. Objectives. Scope and boundaries. Roles. Timeline and milestones. Risks. Next steps.','doc','active','2026-06-25T09:00:00Z','2026-06-25T09:00:00Z'),
 ('v-tp-7','Old retainer wording','Superseded','Legacy retainer language, no longer used.','doc','archived','2026-05-01T09:00:00Z','2026-07-01T09:00:00Z');
