/**
 * A Gmail compose window, opened with the message already in it.
 *
 * This is the send path, and it is deliberately not a send. The app holds no
 * scope that could send mail and registers no route that could try. What it can
 * do is hand Gmail a prefilled compose window and let the person press Send
 * there, which is the same boundary as before with the copying done for them.
 *
 * Everything here runs in the browser, from data already on the page. If the
 * URL were built on the server the body would travel through a request and
 * could land in a log, which is the one way this feature could quietly become a
 * place mail content is recorded. D89.
 */

export interface ComposeFields {
	/** The mailbox to compose from. Pins the account, as Open in Gmail does. */
	authuser: string | null;
	to: string;
	cc?: string;
	subject: string;
	body: string;
}

/**
 * The point above which the URL is not trusted.
 *
 * Gmail truncates a long compose URL rather than refusing it, so the failure is
 * a reply that silently loses its ending. That is the worst outcome available
 * here, worse than making the person paste, so the threshold is deliberately
 * conservative rather than the largest value that usually works.
 */
export const MAX_COMPOSE_URL = 1800;

export function buildComposeUrl(fields: ComposeFields): string {
	/**
	 * Percent encoding, deliberately not URLSearchParams.
	 *
	 * URLSearchParams writes a space as `+`, which is correct for form encoding
	 * and ambiguous here. If Gmail reads the body as a plain URI component
	 * instead, every space in the message arrives as a literal plus sign, and a
	 * reply full of `+` is the kind of corruption nobody checks for because the
	 * link visibly worked. `%20` means a space under both readings.
	 */
	const pairs: [string, string][] = [
		// `cm` is compose, `fs=1` makes it a full compose window rather than a
		// reply docked into whatever thread Gmail happens to have open.
		['view', 'cm'],
		['fs', '1']
	];
	if (fields.to) pairs.push(['to', fields.to]);
	if (fields.cc) pairs.push(['cc', fields.cc]);
	if (fields.subject) pairs.push(['su', fields.subject]);
	if (fields.body) pairs.push(['body', fields.body]);

	const query = pairs
		.map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
		.join('&');

	const base = fields.authuser
		? `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(fields.authuser)}&`
		: 'https://mail.google.com/mail/u/0/?';

	return `${base}${query}`;
}

/** Whether the URL is short enough to trust Gmail with. */
export function composeFits(fields: ComposeFields): boolean {
	return buildComposeUrl(fields).length <= MAX_COMPOSE_URL;
}

/**
 * The message as text, for the clipboard.
 *
 * The fallback when the URL is too long, and the same content either way, so
 * the person is never choosing between two different messages.
 */
export function composeAsText(fields: ComposeFields): string {
	const lines = [`To: ${fields.to}`];
	if (fields.cc) lines.push(`Cc: ${fields.cc}`);
	lines.push(`Subject: ${fields.subject}`, '', fields.body);
	return lines.join('\n');
}
