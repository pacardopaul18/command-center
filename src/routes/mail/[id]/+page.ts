import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

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
}

export const load: PageLoad = async ({ fetch, params }) => {
	const res = await fetch(`/api/email/threads/${params.id}`);

	if (res.status === 404) error(404, 'Thread not found.');
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? 'Could not load the thread.');
	}

	const data = (await res.json()) as {
		thread: {
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
		};
		messages: ThreadMessage[];
	};

	return data;
};
