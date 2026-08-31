/**
 * Whether an account needs reconnecting, and how it should be said.
 *
 * Shared because two places need the same answer and they must not drift: the
 * picker labels the option inline, and the page shows the full notice. Google's
 * Testing-mode clock runs per account, so two accounts connected on different
 * days expire on different days and one number for the app would be wrong for
 * at least one of them.
 */

export interface ReauthAccount {
	id: string;
	account_email: string | null;
	status?: string;
	reauth?: { days_left: number | null; expired: boolean } | null;
}

/** The short form, for an option label. Null when nothing is wrong. */
export function reauthLabel(account: ReauthAccount): string | null {
	if (account.status === 'needs_reauth') return 'needs reconnecting';
	if (!account.reauth) return null;
	if (account.reauth.expired) return 'expired';
	if (account.reauth.days_left !== null && account.reauth.days_left <= 2) {
		return `${account.reauth.days_left}d left`;
	}
	return null;
}

/** The full sentence, for a notice. Null when nothing is wrong. */
export function reauthNotice(account: ReauthAccount): string | null {
	if (!reauthLabel(account)) return null;
	const who = account.account_email ?? account.id;
	if (account.reauth?.expired || account.status === 'needs_reauth') {
		return (
			`${who} needs reconnecting. Google expires the token every seven days while ` +
			`the app is unpublished, which is expected rather than a fault.`
		);
	}
	const days = account.reauth?.days_left;
	return `${who} expires in ${days} day${days === 1 ? '' : 's'}.`;
}
