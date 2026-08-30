/**
 * Mail triage vocabulary, in one place so the list, the thread page and the
 * server all mean the same thing by the same word.
 */

export const SEVERITIES = ['urgent', 'important', 'routine', 'noise'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABELS: Record<Severity, string> = {
	urgent: 'Urgent',
	important: 'Important',
	routine: 'Routine',
	noise: 'Noise'
};

/**
 * What each level means, shown where Paul chooses one.
 *
 * Written as what HE must do, not how the sender sounded, because that is the
 * distinction the classifier is asked to make and a correction is worth more
 * when both sides are using the same rule.
 */
export const SEVERITY_HELP: Record<Severity, string> = {
	urgent: 'Someone is waiting on you now, or money or a deadline is at risk.',
	important: 'You must act or decide, but not today.',
	routine: 'Worth knowing. Nothing to do.',
	noise: 'Nothing is lost by never opening it.'
};

export const CATEGORIES = ['correspondence', 'automated', 'newsletter', 'notification'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
	correspondence: 'Correspondence',
	automated: 'Automated',
	newsletter: 'Newsletter',
	notification: 'Notification'
};

export interface ThreadRow {
	id: string;
	subject: string | null;
	message_count: number;
	actual_count: number;
	first_at: string | null;
	last_at: string | null;
	client_id: string | null;
	client_name: string | null;
	gist: string | null;
	summary: string | null;
	severity: Severity | null;
	category: Category | null;
	severity_override: Severity | null;
	category_override: Category | null;
	effective_severity: Severity | null;
	effective_category: Category | null;
	corrected_at: string | null;
	archived_at: string | null;
	read_at: string | null;
	/** Which account this thread belongs to. Rendered only in the unified view. */
	account_id?: string;
	account_email?: string | null;
	latest_from: string | null;
	latest_from_name: string | null;
	latest_snippet: string | null;
}
