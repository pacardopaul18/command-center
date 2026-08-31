import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCOPES } from '../src/lib/server/google';
import { buildComposeUrl, composeFits, MAX_COMPOSE_URL } from '../src/lib/gmail-compose';

/**
 * The app cannot send mail, asserted rather than promised.
 *
 * CR-1 adds "Send via Gmail", which opens Gmail's compose window with the
 * message prefilled. That is a link, not a send: the text is built in the
 * browser from what is already on the page, Gmail does the sending, and the
 * user presses the button. Nothing about the boundary moves.
 *
 * But it is now a screen with a button labelled Send, which is exactly when a
 * later change adds a convenient endpoint behind it. So the boundary is pinned
 * from two directions that cannot both be edited by accident: the OAuth scopes
 * the token is granted, and the routes the API registers.
 *
 * The scope check is the one that matters. Every other guard is code that could
 * be changed; a token issued without `gmail.send` cannot send mail no matter
 * what the code asks for.
 */

const API_DIR = 'src/lib/server/api';

describe('the app has no way to send mail', () => {
	it('no granted scope permits sending', () => {
		expect(SCOPES).not.toEqual([]);

		// `openid` and `email` identify who signed in and grant no access to
		// their data, so the rule applies to the data scopes: every Google API
		// scope must be a read-only one.
		const dataScopes = SCOPES.filter((s) => s.startsWith('https://www.googleapis.com/auth/'));
		expect(dataScopes.length, 'no Google data scope is requested at all').toBeGreaterThan(0);
		for (const scope of dataScopes) {
			expect(scope, `${scope} is not a read-only scope`).toMatch(/\.readonly$/);
		}
		expect(SCOPES.join(' ')).not.toContain('gmail.send');
		expect(SCOPES.join(' ')).not.toContain('gmail.modify');
		expect(SCOPES.join(' ')).not.toContain('gmail.compose');
	});

	it('no registered route sends, drafts to Gmail, or modifies a mailbox', () => {
		/**
		 * Route registrations across the whole API, not only mail. A send route
		 * added to the wrong file is still a send route.
		 */
		const files = readdirSync(API_DIR).filter((f) => f.endsWith('.ts'));
		expect(files.length).toBeGreaterThan(0);

		const forbidden =
			/\.(post|put|patch|delete)\(\s*'[^']*(send|reply|forward|compose)[^']*'/i;

		for (const file of files) {
			const source = readFileSync(join(API_DIR, file), 'utf8');
			const hit = source.match(forbidden);
			expect(hit?.[0], `${file} registers a route that looks like a send surface`).toBeUndefined();
		}
	});

	it('nothing calls the Gmail send or draft endpoints', () => {
		const google = readFileSync('src/lib/server/google.ts', 'utf8');
		expect(google).not.toMatch(/messages\/send/);
		expect(google).not.toMatch(/users\/me\/drafts/);
	});

	/**
	 * The compose URL is built in the browser, from data the page already holds.
	 *
	 * If it were ever built on the server, the message body would leave the
	 * browser and land in a request log, which is the one way this feature could
	 * quietly become a place mail content is recorded. D89.
	 */
	it('the compose URL is built in the browser, never on the server', () => {
		// Asserted by building one, rather than by scanning the source for a
		// string. A source scan passes on a file that merely mentions the right
		// words and fails on one that assembles them correctly, which is what it
		// did on the first run of this test.
		const url = buildComposeUrl({
			authuser: 'someone@example.invalid',
			to: 'other@example.invalid',
			cc: 'third@example.invalid',
			subject: 'Re: a subject',
			body: 'a body'
		});
		expect(url.startsWith('https://mail.google.com/mail/')).toBe(true);
		expect(url).toContain('view=cm');
		expect(url).toContain('authuser=someone%40example.invalid');
		expect(url).toContain('to=other%40example.invalid');
		expect(url).toContain('su=Re%3A%20a%20subject');

		// A space must survive as a space. URLSearchParams would write `+` here,
		// which Gmail may render literally in the body.
		expect(url).not.toContain('+');

		const serverFiles = readdirSync(API_DIR)
			.filter((f) => f.endsWith('.ts'))
			.map((f) => readFileSync(join(API_DIR, f), 'utf8'))
			.join('\n');
		expect(serverFiles, 'the server builds a compose URL').not.toContain('view=cm');
		expect(serverFiles, 'the server references Gmail compose').not.toMatch(
			/mail\.google\.com\/mail/
		);
	});

	/**
	 * The length fallback, pinned.
	 *
	 * Gmail truncates a long compose URL instead of refusing it, so this
	 * threshold is the only thing standing between a long reply and one that
	 * silently loses its ending.
	 */
	it('a body too long for the URL is refused rather than truncated', () => {
		expect(MAX_COMPOSE_URL).toBeLessThanOrEqual(1800);

		const short = {
			authuser: 'someone@example.invalid',
			to: 'other@example.invalid',
			subject: 'Re: short',
			body: 'brief'
		};
		expect(composeFits(short)).toBe(true);
		expect(composeFits({ ...short, body: 'x'.repeat(MAX_COMPOSE_URL) })).toBe(false);
	});
});
