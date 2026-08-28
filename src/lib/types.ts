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
	// Rolled up by the list and detail queries, not stored on the row.
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
