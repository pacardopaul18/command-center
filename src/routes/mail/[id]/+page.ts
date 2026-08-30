import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { Category, Severity } from '$lib/types-mail';

export interface ThreadMessage {
	id: string;
	subject: string | null;
	from_email: string | null;
	from_name: string | null;
	to_emails: string | null;
	cc_emails: string | null;
	sent_at: string;
	snippet: string | null;
	is_unread: number;
	body_key: string | null;
	body_bytes: number | null;
	body_format: 'text' | 'html' | null;
}

export interface Draft {
	id: string;
	body: string;
	edited_body: string | null;
	edited_at: string | null;
	copied_at: string | null;
	model: string | null;
	based_on_last_at: string | null;
	created_at: string;
}

export interface Attachment {
	id: string;
	filename: string | null;
	mime_type: string | null;
	size_bytes: number | null;
	r2_key: string | null;
}

export interface ThreadDetail {
	id: string;
	subject: string | null;
	client_id: string | null;
	client_name: string | null;
	message_count: number;
	first_at: string | null;
	last_at: string | null;
	summary: string | null;
	summary_model: string | null;
	summary_at: string | null;
	gist: string | null;
	severity: Severity | null;
	category: Category | null;
	severity_override: Severity | null;
	category_override: Category | null;
	archived_at: string | null;
	read_at: string | null;
}

export const load: PageLoad = async ({ fetch, params }) => {
	const res = await fetch(`/api/email/threads/${params.id}`);

	if (res.status === 404) error(404, 'Thread not found.');
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the thread.');
	}

	return (await res.json()) as {
		thread: ThreadDetail;
		messages: ThreadMessage[];
		/** Bodies for the messages open on arrival, so nothing needs clicking. */
		bodies: Record<string, { body: string; format: 'text' | 'html' | null }>;
		open_ids: string[];
		draft: Draft | null;
		attachments: Attachment[];
	};
};
