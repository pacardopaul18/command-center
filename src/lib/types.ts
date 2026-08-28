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

export interface Project {
	id: string;
	client_id: string | null;
	name: string;
	phase: 'initiating' | 'planning' | 'executing' | 'monitoring' | 'closing';
	status: 'on_track' | 'at_risk' | 'blocked' | 'done';
	owner_id: string | null;
	start_date: string | null;
	target_close: string | null;
	next_milestone: string | null;
	description: string | null;
	created_at: string;
	updated_at: string;
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
