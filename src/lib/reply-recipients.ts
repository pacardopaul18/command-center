/**
 * Who a reply goes to.
 *
 * Reply-all-minus-me: the last person who wrote goes in To, everyone else who
 * was on the thread goes in Cc, and Paul's own address appears in neither.
 *
 * The rule is here rather than in the component because it is the part that
 * fails silently. A dropped Cc is invisible at the moment it happens and
 * discovered later by the person who was not told, so it is worth a function
 * with tests rather than an expression inside markup.
 *
 * Every field stays editable on the composer. That is the point of a default
 * rather than a rule: removing somebody becomes a visible act.
 */

export interface RecipientMessage {
	from_email: string | null;
	to_emails: string | null;
	cc_emails: string | null;
	sent_at: string;
}

export interface Recipients {
	to: string[];
	cc: string[];
}

/** Splits a header field. Gmail stores these comma separated. */
function addresses(field: string | null): string[] {
	if (!field) return [];
	return field
		.split(',')
		.map((a) => a.trim())
		.filter(Boolean);
}

/**
 * The address inside a display form.
 *
 * `Rina Dela Cruz <rina@example.com>` and `rina@example.com` are the same
 * person, and comparing the raw strings would put both on the reply.
 */
export function bareAddress(value: string): string {
	const angled = value.match(/<([^>]+)>/);
	return (angled ? angled[1] : value).trim().toLowerCase();
}

/**
 * Reply recipients for a thread.
 *
 * `mine` is the connected mailbox, removed from both lists. `onlyTo` names one
 * specific sender for To, which is what the per-message reply icon does: the
 * rest of the thread still lands in Cc.
 */
export function replyRecipients(
	messages: RecipientMessage[],
	mine: string | null,
	onlyTo?: string | null
): Recipients {
	const me = mine ? bareAddress(mine) : null;
	const ordered = [...messages].sort((a, b) => a.sent_at.localeCompare(b.sent_at));

	// The last message not written by the account holder. Replying to your own
	// last message should still address the person you were talking to.
	const lastFromOther = [...ordered]
		.reverse()
		.find((m) => m.from_email && bareAddress(m.from_email) !== me);

	const primary = onlyTo
		? bareAddress(onlyTo)
		: lastFromOther?.from_email
			? bareAddress(lastFromOther.from_email)
			: null;

	const everyone = new Set<string>();
	for (const m of ordered) {
		for (const a of [m.from_email ?? '', ...addresses(m.to_emails), ...addresses(m.cc_emails)]) {
			const bare = bareAddress(a);
			if (bare && bare !== me) everyone.add(bare);
		}
	}

	if (primary) everyone.delete(primary);

	return {
		to: primary ? [primary] : [],
		cc: [...everyone].sort()
	};
}

/** The quoted block a forward carries, since the message itself cannot travel. */
export function forwardHeader(
	from: string | null,
	sentAt: string,
	subject: string | null,
	to: string | null
): string {
	const lines = ['---------- Forwarded message ----------', `From: ${from ?? 'unknown'}`];
	lines.push(`Date: ${sentAt}`);
	if (subject) lines.push(`Subject: ${subject}`);
	if (to) lines.push(`To: ${to}`);
	lines.push('');
	return lines.join('\n');
}
