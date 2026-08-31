import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SCOPES } from '../src/lib/server/google';

/**
 * The safety property, asserted rather than trusted.
 *
 * D70 says a scope never granted cannot be reached by a later bug. That only
 * holds while the scope list stays what it is, and a list in a file is exactly
 * the kind of thing that grows quietly during an unrelated change. These tests
 * exist so that adding a write scope, anywhere, fails the suite rather than
 * shipping.
 *
 * They are deliberately blunt. A subtle test for this would be worse: the point
 * is that somebody adding `gmail.send` sees a failure whose message tells them
 * exactly which decision they are overturning.
 */

const WRITE_SCOPES = [
	'gmail.send',
	'gmail.modify',
	'gmail.compose',
	'gmail.insert',
	'gmail.labels',
	'mail.google.com',
	'calendar.events',
	'drive.file'
];

describe('layer 2: Google scopes are read only', () => {
	it('asks for exactly the four scopes that were ruled on', () => {
		expect([...SCOPES]).toEqual([
			'https://www.googleapis.com/auth/calendar.readonly',
			'https://www.googleapis.com/auth/gmail.readonly',
			'openid',
			'email'
		]);
	});

	it('requests no scope that can write, send or modify', () => {
		for (const scope of SCOPES) {
			for (const forbidden of WRITE_SCOPES) {
				expect(
					scope.includes(forbidden),
					`${scope} grants write access. Gmail is draft-and-read only by standing rule (D70): ` +
						`the send permission is never requested, so no bug can reach it. ` +
						`Adding this scope removes that guarantee.`
				).toBe(false);
			}
		}
	});

	it('every Gmail and Calendar scope ends in .readonly', () => {
		for (const scope of SCOPES) {
			if (scope.includes('gmail') || scope.includes('calendar')) {
				expect(scope.endsWith('.readonly'), `${scope} is not a readonly scope.`).toBe(true);
			}
		}
	});

	it('no source file calls a Google endpoint that writes', () => {
		// The scope list is the structural guarantee. This is the second lock: a
		// call that would need a write scope should not exist even as dead code,
		// because dead code is how a scope gets added later to "make it work".
		const sources = [
			readFileSync('src/lib/server/google.ts', 'utf8'),
			readFileSync('src/lib/server/api/connections.ts', 'utf8')
		].join('\n');

		for (const forbidden of ['gmail/v1/users/me/messages/send', 'gmail/v1/users/me/drafts', '/sendAs']) {
			expect(sources.includes(forbidden), `A write endpoint is referenced: ${forbidden}`).toBe(false);
		}

		/**
		 * Every Google call goes through `apiGet`, which is GET only, so a POST
		 * has to be written by hand and stands out. Each one is named here with
		 * the endpoint it targets, rather than counted.
		 *
		 * Counting was the earlier form of this check and it was the wrong
		 * shape. It failed the moment a legitimate second POST arrived, and the
		 * only way to make it pass is to raise the number, which is a change
		 * that reviews as a typo and removes the guarantee entirely. Naming them
		 * means a new POST fails the test with the endpoint in the message, and
		 * making it pass means writing down what that endpoint does.
		 */
		const googleSource = readFileSync('src/lib/server/google.ts', 'utf8');

		const ALLOWED_POSTS = [
			// OAuth token exchange and refresh. How OAuth works, and it writes
			// nothing to the user's account.
			'TOKEN_ENDPOINT',
			// Free and busy. A read whose request body is the question: it
			// returns busy blocks and changes no calendar. Permitted by
			// calendar.readonly. D151.
			'/freeBusy'
		];

		// The URL argument of every hand-written POST, taken from the fetch call
		// it sits in.
		const posts = [
			...googleSource.matchAll(/fetch\(([^,]+),[\s\S]{0,80}?method: 'POST'/g)
		].map((m) => m[1]);
		/**
		 * Both known POSTs must be found. A guard whose pattern stops matching
		 * passes on an empty list, which is the failure mode of every check
		 * written as a loop over what was found: the day the regex breaks is
		 * the day it stops guarding, silently.
		 */
		expect(posts.length, `the POST scan found ${posts.length} calls, not the two that exist`).toBe(2);

		for (const target of posts) {
			expect(
				ALLOWED_POSTS.some((allowed) => target.includes(allowed)),
				`google.ts POSTs to ${target}, which is not one of the reads this app is allowed ` +
					`to make. If it is a read, add it to ALLOWED_POSTS with the reason. If it writes ` +
					`to the user's account, it must not exist: D70.`
			).toBe(true);
		}

		expect(googleSource).toContain('TOKEN_ENDPOINT');
	});

	it('tokens are stored in KV, never in a D1 table the backup would dump', () => {
		// Migration 0011 keeps credentials out of D1 because the nightly backup
		// writes every D1 table to R2. If a token column ever appears in that
		// migration, this fails and the reasoning is one file away.
		const migration = readFileSync('migrations/0011_connections.sql', 'utf8');
		for (const column of ['refresh_token', 'access_token']) {
			expect(
				migration.includes(column + ' TEXT') || migration.includes(column + ' text'),
				`0011 defines a ${column} column. Credentials must not sit in D1: the nightly ` +
					`backup dumps every table to R2, which would spread a long-lived credential.`
			).toBe(false);
		}
		expect(readFileSync('src/lib/server/google.ts', 'utf8')).toContain("TOKEN_KEY = 'google:tokens'");
	});
});
