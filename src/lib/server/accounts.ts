import type { D1Database } from '@cloudflare/workers-types';
import { ApiError } from './api/validate';

/**
 * Which account a request is about.
 *
 * Every mail and calendar route goes through here, and that is the point: one
 * resolver means one place where scoping can be wrong, rather than twenty six
 * places where it can each be wrong differently.
 *
 * THE RULE THAT MATTERS: an account that was named and does not exist is
 * refused, never quietly replaced with whichever connection happens to be
 * first. Falling back on a bad name is how a scoping bug becomes a leak that
 * looks like it is working, because the caller gets a plausible answer about
 * somebody else's mailbox and nothing anywhere says so.
 */

export interface Account {
	id: string;
	provider: string;
	account_email: string | null;
	status: string;
}

/**
 * Resolves the account a request is scoped to.
 *
 * With no `account` parameter and exactly one connection, that connection is
 * used, because a single-account setup should not have to name itself. With no
 * parameter and several connections there is no sane default, so the caller has
 * to say which, and is told so rather than being given one at random.
 */
export async function resolveAccount(db: D1Database, named: string | undefined): Promise<Account> {
	if (named) {
		const found = await db
			.prepare('SELECT id, provider, account_email, status FROM connections WHERE id = ?')
			.bind(named)
			.first<Account>();
		if (!found) throw new ApiError(404, 'No connected account with that id.');
		return found;
	}

	const { results } = await db
		.prepare('SELECT id, provider, account_email, status FROM connections ORDER BY created_at')
		.all<Account>();
	const all = results ?? [];

	if (all.length === 0) throw new ApiError(400, 'No Google account is connected.');
	if (all.length === 1) return all[0];

	throw new ApiError(
		400,
		`More than one account is connected. Say which one, with ?account=<id>. ` +
			`Connected: ${all.map((a) => a.account_email ?? a.id).join(', ')}.`
	);
}

/** Every connected account, for pickers and for jobs that walk all of them. */
export async function listAccounts(db: D1Database): Promise<Account[]> {
	const { results } = await db
		.prepare('SELECT id, provider, account_email, status FROM connections ORDER BY created_at')
		.all<Account>();
	return results ?? [];
}

/**
 * Confirms a row belongs to the account in scope.
 *
 * For the routes where the account follows the row rather than a parameter: a
 * thread id, a message id, a calendar id. The check is deliberately a refusal
 * rather than a filter, because a caller asking for a specific row of somebody
 * else's is not a query that should return nothing, it is a request that should
 * be denied.
 *
 * 404 rather than 403, on purpose. Telling a caller that a row exists but
 * belongs to another account is itself a small leak; the honest answer to "give
 * me that thread" from the wrong account is that there is no such thread here.
 */
export async function assertOwned(
	db: D1Database,
	table: 'email_threads' | 'email_messages' | 'calendars' | 'calendar_events',
	id: string,
	accountId: string
): Promise<void> {
	const row = await db
		.prepare(`SELECT connection_id FROM ${table} WHERE id = ?`)
		.bind(id)
		.first<{ connection_id: string }>();

	if (!row || row.connection_id !== accountId) {
		throw new ApiError(404, 'Not found in this account.');
	}
}

/** The same check for a row reached through its thread. */
export async function assertThreadOwned(
	db: D1Database,
	threadId: string,
	accountId: string
): Promise<void> {
	await assertOwned(db, 'email_threads', threadId, accountId);
}

/**
 * What a request is scoped to: one account, or all of them on purpose.
 *
 * The unified inbox is the one place data crosses accounts, and it is not a
 * hole in the segregation guarantee because it is asked for by name and every
 * row it returns is attributed. The distinction that matters is between data
 * that crosses because somebody requested the union, and data that crosses
 * because a query forgot to filter. The first is a feature and is labelled.
 * The second is what D110 caught in the calendar list.
 *
 * `all` is therefore deliberately not the default. It has to be typed.
 */
export type Scope =
	| { kind: 'one'; account: Account; ids: string[] }
	| { kind: 'all'; accounts: Account[]; ids: string[] };

export const ALL = 'all';

export async function resolveScope(db: D1Database, named: string | undefined): Promise<Scope> {
	if (named === ALL) {
		const accounts = await listAccounts(db);
		if (accounts.length === 0) throw new ApiError(400, 'No Google account is connected.');
		return { kind: 'all', accounts, ids: accounts.map((a) => a.id) };
	}
	const account = await resolveAccount(db, named);
	return { kind: 'one', account, ids: [account.id] };
}

/** `IN (?, ?)` of the right width, so one query serves both scopes. */
export function scopePlaceholders(scope: Scope): string {
	return scope.ids.map(() => '?').join(', ');
}

/**
 * How long a Testing-mode refresh token has left.
 *
 * Google expires it seven days after consent while the app is unpublished, and
 * that clock runs per account rather than for the app: two accounts connected
 * on different days expire on different days. Surfacing it per account is the
 * difference between a reconnect Paul plans and one he discovers when a read
 * fails.
 */
export const TESTING_TOKEN_DAYS = 7;

export interface ReauthClock {
	connected_at: string | null;
	expires_at: string | null;
	days_left: number | null;
	expired: boolean;
}

export function reauthClock(connectedAt: string | null): ReauthClock {
	if (!connectedAt) {
		return { connected_at: null, expires_at: null, days_left: null, expired: false };
	}
	const expiresAt = new Date(Date.parse(connectedAt) + TESTING_TOKEN_DAYS * 86_400_000);
	const msLeft = expiresAt.getTime() - Date.now();
	return {
		connected_at: connectedAt,
		expires_at: expiresAt.toISOString(),
		// Rounded down, so "1 day left" never means "expires in ten minutes".
		days_left: Math.floor(msLeft / 86_400_000),
		expired: msLeft <= 0
	};
}
