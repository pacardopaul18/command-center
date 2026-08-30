// Shared shapes for the Action Items module.
// Mirrors migrations/0001_init_action_items.sql.

export const ACTION_STATUSES = ['open', 'waiting', 'blocked', 'done', 'ambiguous'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const ACTION_SOURCES = ['meeting', 'email', 'manual'] as const;
export type ActionSource = (typeof ACTION_SOURCES)[number];

export const STATUS_LABELS: Record<ActionStatus, string> = {
	open: 'Open',
	waiting: 'Waiting',
	blocked: 'Blocked',
	done: 'Done',
	ambiguous: 'Needs clarification'
};

export const SOURCE_LABELS: Record<ActionSource, string> = {
	meeting: 'Meeting',
	email: 'Email',
	manual: 'Manual'
};

export interface ActionItem {
	id: string;
	title: string;
	context: string | null;
	owner: string | null;
	owner_id: string | null;
	deadline: string | null;
	status: ActionStatus;
	source: ActionSource;
	meeting_id: string | null;
	project_id: string | null;
	asana_task_gid: string | null;
	/**
	 * How the Asana link stood at the last sync. Null means never reconciled.
	 * 'ambiguous' is D69: Asana no longer resolves the gid, and the item's own
	 * status and gid were deliberately left alone.
	 */
	asana_sync_state: 'ok' | 'ambiguous' | null;
	asana_sync_note: string | null;
	asana_synced_at: string | null;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
	// Joined for display, not stored on the row.
	project_name?: string | null;
}

// The PMI five-phase lifecycle, in order. Order matters: it drives the phase
// rail, the "advance to next" action, and the list grouping.
export const PROJECT_PHASES = [
	'initiating',
	'planning',
	'executing',
	'monitoring',
	'closing'
] as const;
export type ProjectPhase = (typeof PROJECT_PHASES)[number];

export const PHASE_LABELS: Record<ProjectPhase, string> = {
	initiating: 'Initiating',
	planning: 'Planning',
	executing: 'Executing',
	monitoring: 'Monitoring',
	closing: 'Closing'
};

export const PROJECT_STATUSES = ['on_track', 'at_risk', 'blocked', 'done'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
	on_track: 'On track',
	at_risk: 'At risk',
	blocked: 'Blocked',
	done: 'Done'
};

/** Maps a project status onto the design system's fixed chip vocabulary. */
export const PROJECT_STATUS_TONE: Record<ProjectStatus, 'ontrack' | 'atrisk' | 'blocked' | 'done'> =
	{
		on_track: 'ontrack',
		at_risk: 'atrisk',
		blocked: 'blocked',
		done: 'done'
	};

export interface Project {
	id: string;
	client_id: string | null;
	name: string;
	phase: ProjectPhase;
	status: ProjectStatus;
	owner_id: string | null;
	start_date: string | null;
	target_close: string | null;
	next_milestone: string | null;
	description: string | null;
	created_at: string;
	updated_at: string;
	// Joined or rolled up by the list and detail queries, not stored on the row.
	client_name?: string | null;
	open_action_items?: number;
	overdue_action_items?: number;
}

/** The next phase in the lifecycle, or null at Closing. */
export function nextPhase(phase: ProjectPhase): ProjectPhase | null {
	const i = PROJECT_PHASES.indexOf(phase);
	return i >= 0 && i < PROJECT_PHASES.length - 1 ? PROJECT_PHASES[i + 1] : null;
}

export const ACTION_VIEWS = ['all', 'open', 'overdue', 'today', 'waiting', 'done'] as const;
export type ActionView = (typeof ACTION_VIEWS)[number];

export const VIEW_LABELS: Record<ActionView, string> = {
	all: 'All',
	open: 'Open',
	overdue: 'Overdue',
	today: 'Due today',
	waiting: 'Waiting on',
	done: 'Done'
};

export interface ActionItemCounts {
	all: number;
	open: number;
	overdue: number;
	today: number;
	waiting: number;
	done: number;
}

// --- SOPs ---

export const SOP_STATUSES = ['active', 'archived'] as const;
export type SopStatus = (typeof SOP_STATUSES)[number];

export interface Sop {
	id: string;
	title: string;
	category: string | null;
	current_version_id: string | null;
	owner_id: string | null;
	review_due: string | null;
	status: SopStatus;
	created_at: string;
	updated_at: string;
	// Joined by the list and detail queries, not stored on the row.
	current_version_number?: number | null;
	current_version_created_at?: string | null;
	current_change_note?: string | null;
	version_count?: number;
}

export interface SopVersion {
	id: string;
	sop_id: string;
	version_number: number;
	body: string;
	change_note: string | null;
	author_id: string | null;
	created_at: string;
}

// --- Invoicing ---

export const PERIOD_STATUSES = ['open', 'reconciled', 'invoiced', 'paid'] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

export const PERIOD_STATUS_LABELS: Record<PeriodStatus, string> = {
	open: 'Open',
	reconciled: 'Reconciled',
	invoiced: 'Invoiced',
	paid: 'Paid'
};

export const PERIOD_STATUS_TONE: Record<PeriodStatus, 'open' | 'waiting' | 'atrisk' | 'done'> = {
	open: 'open',
	reconciled: 'waiting',
	invoiced: 'atrisk',
	paid: 'done'
};

/** The period lifecycle is linear: open, reconciled, invoiced, paid. */
export function nextPeriodStatus(status: PeriodStatus): PeriodStatus | null {
	const i = PERIOD_STATUSES.indexOf(status);
	return i >= 0 && i < PERIOD_STATUSES.length - 1 ? PERIOD_STATUSES[i + 1] : null;
}

export const INVOICE_STATUSES = ['draft', 'sent', 'partial', 'paid'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
	draft: 'Draft',
	sent: 'Sent',
	partial: 'Part paid',
	paid: 'Paid'
};

/**
 * Standard AR aging buckets. "Current" and 0 to 30 are one bucket, matching the
 * architecture doc: anything not yet due, or up to 30 days past due, sits here.
 */
export const AGING_BUCKETS = ['b0_30', 'b31_60', 'b61_90', 'b90_plus'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_LABELS: Record<AgingBucket, string> = {
	b0_30: '0 to 30',
	b31_60: '31 to 60',
	b61_90: '61 to 90',
	b90_plus: '90 plus'
};

export interface BillingPeriod {
	id: string;
	client_id: string;
	period_start: string;
	period_end: string;
	status: PeriodStatus;
	note: string | null;
	created_at: string;
	updated_at: string;
	client_name?: string;
	entry_count?: number;
	billable_hours?: number;
	total_hours?: number;
	invoice_id?: string | null;
	invoice_number?: string | null;
}

export interface TimeEntry {
	id: string;
	client_id: string;
	project_id: string | null;
	billing_period_id: string | null;
	entry_date: string;
	hours: number;
	description: string | null;
	billable: number;
	source: 'clockify' | 'manual';
	created_at: string;
	/** Added in migration 0008. Null on every entry recorded before rates existed. */
	ticket_id: string | null;
	rate_cents: number | null;
	project_name?: string | null;
}

export interface Invoice {
	id: string;
	client_id: string;
	billing_period_id: string | null;
	invoice_number: string;
	issue_date: string;
	due_date: string;
	amount_cents: number;
	amount_paid_cents: number;
	status: InvoiceStatus;
	created_at: string;
	updated_at: string;
	client_name?: string;
	// Derived at read time, never stored. See migration 0004.
	outstanding_cents?: number;
	days_overdue?: number;
	aging_bucket?: AgingBucket | null;
	is_overdue?: number;
}

/** Cents to a plain money string. No currency symbol is assumed. */
export function formatMoney(cents: number): string {
	const sign = cents < 0 ? '-' : '';
	const abs = Math.abs(Math.round(cents));
	const whole = Math.floor(abs / 100).toLocaleString('en-US');
	const part = String(abs % 100).padStart(2, '0');
	return `${sign}${whole}.${part}`;
}

/** Accepts "1234.56" or "1,234.56" and returns exact cents. */
export function parseMoneyToCents(input: string): number | null {
	const cleaned = input.replace(/[,\s]/g, '');
	if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
	const [whole, fraction = ''] = cleaned.split('.');
	return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

// --- Clients ---

export const CLIENT_STATUSES = ['active', 'archived'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export interface Client {
	id: string;
	name: string;
	billing_terms: string | null;
	/** Added in migration 0008. Offered when booking time, never imposed. */
	default_rate_cents?: number | null;
	status: ClientStatus;
	notes: string | null;
	created_at: string;
	updated_at: string;
	project_count?: number;
}

// --- Meetings ---

export interface Meeting {
	id: string;
	client_id: string | null;
	project_id: string | null;
	title: string;
	meeting_date: string;
	attendees: string | null;
	recording_url: string | null;
	transcript_ref: string | null;
	summary: string | null;
	summary_reviewed_at: string | null;
	created_at: string;
	updated_at: string;
	// Joined or derived by the list and detail queries.
	client_name?: string | null;
	project_name?: string | null;
	transcript_chars?: number;
	action_item_count?: number;
}

export const PROPOSAL_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/**
 * An AI-extracted suggestion. Not an action item, and never becomes one without
 * an explicit accept. See D45.
 */
export interface Proposal {
	id: string;
	meeting_id: string;
	title: string;
	context: string | null;
	owner: string | null;
	deadline: string | null;
	ambiguous: number;
	ambiguity_note: string | null;
	evidence: string | null;
	status: ProposalStatus;
	action_item_id: string | null;
	model: string | null;
	created_at: string;
	reviewed_at: string | null;
	action_item_status?: string | null;
}

// --- Templates ---

export const TEMPLATE_TYPES = ['email', 'doc'] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];

export const TEMPLATE_TYPE_LABELS: Record<TemplateType, string> = {
	email: 'Email reply',
	doc: 'Document'
};

export const TEMPLATE_STATUSES = ['active', 'archived'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export interface Template {
	id: string;
	name: string;
	scenario: string | null;
	body: string;
	type: TemplateType;
	status: TemplateStatus;
	created_at: string;
	updated_at: string;
}

// --- Reports ---

/**
 * The four reports built in v1.
 *
 * Architecture section D names five. Partner time saved is absent because it
 * needs the TimeSavedLog and SlipsCaught tables and a baseline time audit that
 * has not been run. It is v2 work. See D52.
 */
export const REPORT_TYPES = ['slipping', 'billing', 'projects', 'actions'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export interface ReportMeta {
	type: ReportType;
	title: string;
	/** What question the report answers. Shown on the index and under the title. */
	summary: string;
	/** False for reports that are a snapshot of now rather than of a window. */
	windowed: boolean;
}

export const REPORTS: ReportMeta[] = [
	{
		type: 'slipping',
		title: 'What is slipping',
		summary: 'Everything overdue, at risk, or waiting on a decision, in one list.',
		windowed: false
	},
	{
		type: 'billing',
		title: 'Billing and aging',
		summary: 'Outstanding by client and by aging bucket, with unbilled periods.',
		windowed: true
	},
	{
		type: 'projects',
		title: 'Project roll-up',
		summary: 'Every project by phase and status, with its next milestone.',
		windowed: false
	},
	{
		type: 'actions',
		title: 'Action item completion',
		summary: 'Completed against open, on-time rate, and average resolution time.',
		windowed: true
	}
];

export function reportMeta(type: ReportType): ReportMeta {
	const found = REPORTS.find((r) => r.type === type);
	if (!found) throw new Error(`Unknown report type: ${type}`);
	return found;
}

// --- Asana ---

/**
 * A link to an Asana task from its gid.
 *
 * D4 stores the gid on the action item, not a URL, so every link is built from
 * it. Asana resolves this form to the task whatever project it lives in, which
 * is why the leading segments are zeros rather than a real project id.
 *
 * The push response also carries a URL, which is Asana's own permalink when it
 * returned one. This function is what the stored gid renders as afterwards.
 */
export function asanaTaskUrl(gid: string): string {
	return `https://app.asana.com/0/0/${gid}`;
}

export interface AsanaSettings {
	workspace_gid: string | null;
	workspace_name: string | null;
	project_gid: string | null;
	project_name: string | null;
	assignee: string | null;
}

export interface AsanaRef {
	gid: string;
	name: string;
}

export interface AsanaStatus {
	token_present: boolean;
	settings: AsanaSettings;
	ready: boolean;
	blocked_because: string | null;
}

// --- Paging ---

/** What a paginated list endpoint returns alongside its rows. */
export interface Paging {
	page: number;
	page_size: number;
	total: number;
	page_count: number;
	sizes: readonly number[];
}

// --- Tickets ---

/**
 * The ticket lifecycle.
 *
 * Six states, not the four a project uses. A project is on track or it is not;
 * a ticket moves through work. `cancelled` exists because a ticket that will
 * never be done is a different fact from one that was finished, and collapsing
 * the two would make every completion metric wrong.
 */
export const TICKET_STATUSES = [
	'open',
	'in_progress',
	'blocked',
	'in_review',
	'done',
	'cancelled'
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
	open: 'Open',
	in_progress: 'In progress',
	blocked: 'Blocked',
	in_review: 'In review',
	done: 'Done',
	cancelled: 'Cancelled'
};

/** Chip tones, reusing the vocabulary the design system already fixes. */
export const TICKET_STATUS_TONE: Record<TicketStatus, 'open' | 'ontrack' | 'blocked' | 'waiting' | 'done'> = {
	open: 'open',
	in_progress: 'ontrack',
	blocked: 'blocked',
	in_review: 'waiting',
	done: 'done',
	cancelled: 'waiting'
};

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
	low: 'Low',
	normal: 'Normal',
	high: 'High',
	urgent: 'Urgent'
};

export interface Ticket {
	id: string;
	project_id: string;
	title: string;
	description: string | null;
	start_date: string | null;
	due_date: string | null;
	estimate_hours: number | null;
	status: TicketStatus;
	priority: TicketPriority;
	assignee: string | null;
	assignee_id: string | null;
	reporter: string | null;
	reporter_id: string | null;
	completed_at: string | null;
	converted_from_action_item_id: string | null;
	created_at: string;
	updated_at: string;
	/** Joined and computed, never stored. */
	project_name?: string;
	client_name?: string | null;
	actual_hours?: number;
	computed_value_cents?: number;
	entry_count?: number;
}

/**
 * Estimate against actual, as a sentence rather than a number.
 *
 * Returns null when there is no estimate, because a variance against nothing is
 * not a small variance, it is an absent one.
 */
export function estimateVariance(
	estimate: number | null | undefined,
	actual: number | null | undefined
): { over: boolean; hours: number; text: string } | null {
	if (!estimate || estimate <= 0) return null;
	const spent = actual ?? 0;
	const diff = Math.round((spent - estimate) * 10) / 10;
	if (diff === 0) return { over: false, hours: 0, text: 'exactly on estimate' };
	return diff > 0
		? { over: true, hours: diff, text: `${diff}h over estimate` }
		: { over: false, hours: -diff, text: `${-diff}h under estimate` };
}

/** One item the sync could not resolve, shown so a person can decide. */
export interface AmbiguousLink {
	id: string;
	title: string;
	asana_task_gid: string;
	asana_sync_note: string | null;
	asana_synced_at: string | null;
}

/** What `GET /api/asana/sync` reports without calling Asana. */
export interface AsanaSyncStatus {
	last_sync: string | null;
	stale_days: number;
	linked: number;
	ambiguous_count: number;
	never_synced: number;
	oldest_confirmation: string | null;
	ambiguous: AmbiguousLink[];
}

/** What one sync run did. Sentences, not just counts. */
export interface AsanaSyncOutcome {
	polled: number;
	matched: number;
	updated: number;
	ambiguous: number;
	swept: number;
	changes: string[];
	cursor: string;
}

export const CONTRACT_STATUSES = ['not_started', 'in_progress', 'fulfilled', 'cancelled'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
	not_started: 'Not started',
	in_progress: 'In progress',
	fulfilled: 'Fulfilled',
	cancelled: 'Cancelled'
};

/** Chip tones, from the set StatusChip already understands. */
export const CONTRACT_STATUS_TONE: Record<ContractStatus, 'waiting' | 'open' | 'done' | 'blocked'> =
	{
		not_started: 'waiting',
		in_progress: 'open',
		fulfilled: 'done',
		cancelled: 'blocked'
	};

/**
 * What a fulfillment status was derived from.
 *
 * Every row is 'manual' today. This exists so that computing fulfillment later
 * from invoices, hours or deliverables is a code change rather than a
 * migration, and so the two modes stay distinguishable after the fact instead
 * of one column quietly changing meaning on a date nobody recorded.
 */
export const CONTRACT_BASES = ['manual', 'invoiced', 'hours', 'deliverables'] as const;
export type ContractBasis = (typeof CONTRACT_BASES)[number];

export interface Contact {
	id: string;
	client_id: string;
	client_name?: string;
	name: string;
	email: string | null;
	phone: string | null;
	role: string | null;
	is_primary: number;
	notes: string | null;
	created_at: string;
	updated_at: string;
}

export interface Contract {
	id: string;
	client_id: string;
	client_name?: string;
	title: string;
	start_date: string | null;
	end_date: string | null;
	value_cents: number | null;
	fulfillment_status: ContractStatus;
	fulfillment_basis: ContractBasis;
	notes: string | null;
	created_at: string;
	updated_at: string;
}

export interface Connection {
	id: string;
	provider: 'google';
	account_email: string | null;
	granted_scopes: string | null;
	status: 'connected' | 'needs_reauth' | 'disconnected';
	status_note: string | null;
	connected_at: string | null;
	last_refresh_at: string | null;
	last_read_at: string | null;
}

/** What `GET /api/connections` reports. Never any part of a credential. */
export interface ConnectionStatus {
	connection: Connection | null;
	token_present: boolean;
	client_id_present: boolean;
	client_secret_present: boolean;
	scopes: readonly string[];
	granted_scopes: string | null;
	expires_at: string | null;
	writes_anything: boolean;
	testing_mode_note: string;
}

export interface CalendarEventRow {
	id: string;
	provider_event_id: string;
	summary: string | null;
	location: string | null;
	starts_at: string;
	ends_at: string | null;
	all_day: number;
	organizer: string | null;
	attendee_count: number | null;
	html_link: string | null;
	meeting_id: string | null;
	meeting_title: string | null;
}

/** The last segment of a Google scope URL, which is the part worth reading. */
export function scopeLabel(scope: string): string {
	return scope.split('/').pop() ?? scope;
}
