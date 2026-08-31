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
	provider_thread_id: string;
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

export const load: PageLoad = async ({ fetch, params, url }) => {
	/**
	 * The account travels with every request from this page.
	 *
	 * It did not before, and that was a real defect rather than an omission of
	 * style: with one account `resolveAccount` defaults and everything works,
	 * and the moment a second is connected the page load, the body fetch and
	 * all five writes throw. Multi-account shipped without this screen ever
	 * being opened against two accounts, and the guarantee tests caught it.
	 */
	const account = url.searchParams.get('account') ?? '';
	// The list view this was opened from, so Back returns to it rather than to
	// whatever the defaults happen to be.
	const back = url.searchParams.get('back') ?? '';
	const q = account ? `?account=${encodeURIComponent(account)}` : '';

	const res = await fetch(`/api/email/threads/${params.id}${q}`);

	if (res.status === 404) error(404, 'Thread not found.');
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the thread.');
	}

	const data = (await res.json()) as {
		thread: ThreadDetail;
		account_email: string | null;
		messages: ThreadMessage[];
		bodies: Record<string, { body: string; format: 'text' | 'html' | null }>;
		open_ids: string[];
		draft: Draft | null;
		attachments: Attachment[];
	};

	return { ...data, account, back };
};
