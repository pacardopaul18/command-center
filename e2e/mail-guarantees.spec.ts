import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The two guarantees, asserted at the view layer.
 *
 * These exist because CR-1 rewrites both Mail screens. The API-level
 * segregation suite keeps passing throughout a view rewrite even if the new
 * markup quietly drops an account label or renders a row it should not, so a
 * guarantee that lives only in the API tests is not protected during exactly
 * the change most likely to break it.
 *
 * Written before the rewrite and run against the old views first, so they act
 * as a regression harness rather than a description of whatever gets built.
 *
 * D89: the fixture uses obviously synthetic content. Nothing from Paul's real
 * mail appears here, and nothing here is ever seeded beyond the test.
 */

const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const A = 'view-a';
const B = 'view-b';
const NOW = '2026-08-31T00:00:00Z';

function openDb(): DatabaseSync {
	const file = readdirSync(DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	if (!file) throw new Error('Local D1 not found.');
	return new DatabaseSync(join(DIR, file));
}

/** Strings that belong to account B and must never surface while scoped to A. */
const B_ONLY = ['ZULU SUBJECT BRAVO', 'ZULU GIST BRAVO', 'sender-bravo@viewtest.invalid'];

function seed(db: DatabaseSync) {
	wipe(db);
	for (const [id, email, tag] of [
		[A, 'alpha@viewtest.invalid', 'ALPHA'],
		[B, 'bravo@viewtest.invalid', 'BRAVO']
	]) {
		db.prepare(
			`INSERT INTO connections (id, provider, account_email, status, connected_at, created_at, updated_at)
       VALUES (?, 'google', ?, 'connected', ?, ?, ?)`
		).run(id, email, NOW, NOW, NOW);

		db.prepare(
			`INSERT INTO email_threads
         (id, connection_id, provider_thread_id, subject, message_count, first_at, last_at,
          category, severity, gist, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, 'correspondence', 'urgent', ?, ?, ?)`
		).run(
			`${id}-thread`,
			id,
			`${id}-pt`,
			`ZULU SUBJECT ${tag}`,
			NOW,
			NOW,
			`ZULU GIST ${tag}`,
			NOW,
			NOW
		);

		db.prepare(
			`INSERT INTO email_messages
         (id, connection_id, thread_id, provider_message_id, provider_thread_id,
          subject, from_email, sent_at, snippet, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).run(
			`${id}-msg`,
			id,
			`${id}-thread`,
			`${id}-pm`,
			`${id}-pt`,
			`ZULU SUBJECT ${tag}`,
			`sender-${tag.toLowerCase()}@viewtest.invalid`,
			NOW,
			`ZULU SNIPPET ${tag}`,
			NOW
		);
	}
}

/**
 * One message body, put where the Worker's R2 binding will find it.
 *
 * Bodies live in R2, so a body-level guarantee cannot be asserted from a D1
 * fixture alone. Miniflare keeps object metadata in its own SQLite file and the
 * bytes in a blob directory, so the fixture writes both.
 */
const R2_DIR = '.wrangler/state/v3/r2/miniflare-R2BucketObject';
const R2_BLOBS = '.wrangler/state/v3/r2/command-center-files/blobs';
const BODY_KEY = 'bodies/view-a-remote-image.html';

/** A remote image, exactly the shape of a tracking pixel. */
const REMOTE_IMAGE_HOST = 'tracker.viewtest.invalid';
const BODY_HTML =
	'<p>ZULU BODY ALPHA</p><p><img src="https://' +
	REMOTE_IMAGE_HOST +
	'/open.gif?id=zulu" alt="ZULU PIXEL" /></p>';

let blobId = '';

function openR2(): DatabaseSync {
	const file = readdirSync(R2_DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	if (!file) throw new Error('Local R2 not found.');
	return new DatabaseSync(join(R2_DIR, file));
}

function seedBody(db: DatabaseSync) {
	const r2 = openR2();
	try {
		blobId = randomBytes(40).toString('hex');
		writeFileSync(join(R2_BLOBS, blobId), BODY_HTML);
		r2.prepare('DELETE FROM _mf_objects WHERE key = ?').run(BODY_KEY);
		r2.prepare(
			`INSERT INTO _mf_objects (key, blob_id, version, size, etag, uploaded, checksums, http_metadata, custom_metadata)
       VALUES (?, ?, ?, ?, ?, ?, '{}', '{"contentType":"text/html; charset=utf-8"}', '{}')`
		).run(
			BODY_KEY,
			blobId,
			randomBytes(16).toString('hex'),
			Buffer.byteLength(BODY_HTML),
			createHash('md5').update(BODY_HTML).digest('hex'),
			Date.now()
		);
	} finally {
		r2.close();
	}

	db.prepare(
		'UPDATE email_messages SET body_key = ?, body_bytes = ?, body_format = ? WHERE id = ?'
	).run(BODY_KEY, Buffer.byteLength(BODY_HTML), 'html', `${A}-msg`);
}

function wipeBody() {
	const r2 = openR2();
	try {
		r2.prepare('DELETE FROM _mf_objects WHERE key = ?').run(BODY_KEY);
	} finally {
		r2.close();
	}
	if (blobId) rmSync(join(R2_BLOBS, blobId), { force: true });
}

function wipe(db: DatabaseSync) {
	for (const id of [A, B]) {
		db.prepare('DELETE FROM email_messages WHERE connection_id = ?').run(id);
		db.prepare('DELETE FROM email_threads WHERE connection_id = ?').run(id);
		db.prepare('DELETE FROM connections WHERE id = ?').run(id);
	}
}

let db: DatabaseSync;

test.beforeAll(() => {
	db = openDb();
	seed(db);
	seedBody(db);
});

test.afterAll(() => {
	wipeBody();
	wipe(db);
	db.close();
});

test.describe('mail views: account segregation survives the redesign', () => {
	test('the fixture built two accounts the views can tell apart', async ({ request }) => {
		// Asserting the setup before the assertions that depend on it. A
		// segregation test against one account proves nothing at all.
		const res = await request.get('/api/email/threads?account=all&severity=all');
		expect(res.ok()).toBe(true);
		const body = await res.text();
		expect(body).toContain('ZULU SUBJECT ALPHA');
		expect(body).toContain('ZULU SUBJECT BRAVO');
	});

	test('a mailbox scoped to one account shows nothing from the other', async ({ page }) => {
		await page.goto(`/mail?account=${A}&severity=all`);
		await page.waitForLoadState('networkidle');

		const rendered = await page.locator('body').innerText();
		expect(rendered).toContain('ZULU SUBJECT ALPHA');
		for (const marker of B_ONLY) {
			expect(rendered, `the scoped view rendered ${marker}`).not.toContain(marker);
		}
	});

	test('every row in All mailboxes names the account it came from', async ({ page }) => {
		// D111: crossing accounts on request is a feature, crossing them by
		// omission is the defect, and the union is only legitimate while every
		// row is attributed. This is the half a view rewrite silently drops.
		await page.goto('/mail?account=all&severity=all');
		await page.waitForLoadState('networkidle');

		const rendered = await page.locator('body').innerText();
		expect(rendered).toContain('ZULU SUBJECT ALPHA');
		expect(rendered).toContain('ZULU SUBJECT BRAVO');

		// Both account labels must appear, or the union is unattributed.
		expect(rendered, 'the union did not name account alpha').toContain('alpha@viewtest.invalid');
		expect(rendered, 'the union did not name account bravo').toContain('bravo@viewtest.invalid');
	});

	test('a thread belonging to the other account cannot be opened while scoped', async ({
		page
	}) => {
		const res = await page.goto(`/mail/${B}-thread?account=${A}`);
		const status = res?.status() ?? 0;

		if (status === 200) {
			const rendered = await page.locator('body').innerText();
			for (const marker of B_ONLY) {
				expect(rendered, `account B content was served while scoped to A: ${marker}`).not.toContain(
					marker
				);
			}
		} else {
			expect([403, 404]).toContain(status);
		}
	});

	test('the mail screens never offer a way to send', async ({ page }) => {
		// The redesign adds Reply and Forward buttons, which look exactly like a
		// send surface and are not one. This pins that: no control on either
		// screen may submit mail, and the no-send copy must be present.
		await page.goto(`/mail?account=${A}&severity=all`);
		await page.waitForLoadState('networkidle');

		const list = await page.locator('body').innerText();
		expect(list).toContain('does not touch Gmail');

		await page.goto(`/mail/${A}-thread?account=${A}`);
		await page.waitForLoadState('networkidle');

		const thread = await page.locator('body').innerText();
		expect(thread, 'the thread screen dropped the no-send statement').toMatch(
			/cannot send email|no permission to change it/i
		);
	});

	/**
	 * D127: every page loader that reads account-scoped data names an account.
	 *
	 * This is the enumeration asserted rather than performed. F1 was found by
	 * hand and the two siblings were found by grepping once, which protects
	 * nothing: the next loader added without a scope passes every existing test.
	 *
	 * So the list is checked here. A loader that fetches account-scoped data has
	 * to name the account, and the fixture guarantees two connected accounts,
	 * which is the condition that makes an unscoped read fail.
	 */
	test('every page reading account-scoped data says which account', async ({ page }) => {
		// Two accounts are connected by the fixture, so an unscoped read is
		// refused by resolveAccount and the page has nowhere to hide it.
		for (const path of ['/meetings', '/settings', `/mail?account=${A}`]) {
			const errors: string[] = [];
			page.on('pageerror', (e) => errors.push(String(e)));

			const response = await page.goto(path);
			await page.waitForLoadState('networkidle');

			expect(response?.status(), `${path} did not load`).toBeLessThan(400);
			expect(errors, `${path} threw while loading`).toEqual([]);

			// The refusal message is the tell. If it reaches the page, something
			// asked without naming an account.
			const text = await page.locator('body').innerText();
			expect(text, `${path} made an unscoped request`).not.toContain(
				'More than one account is connected'
			);
		}
	});

	/**
	 * A refused read and an empty one must not look the same.
	 *
	 * The silent blank is the actual defect D127 names on these two pages:
	 * neither crashed and neither leaked, they just stopped showing the
	 * calendar and the ingest progress with no explanation, on the page a
	 * reader would open to find out why.
	 */
	test('a failed scoped read is shown, not swallowed', async ({ page }) => {
		// A well-formed id that belongs to nobody. The route 404s it, which is
		// the failure the page has to report rather than absorb.
		await page.goto('/settings?account=view-does-not-exist');
		await page.waitForLoadState('networkidle');

		const settings = await page.locator('body').innerText();
		expect(settings, 'settings absorbed a failed read').toMatch(
			/No connected account with that id|Could not load/i
		);

		await page.goto('/meetings?account=view-does-not-exist');
		await page.waitForLoadState('networkidle');

		const meetings = await page.locator('body').innerText();
		expect(meetings, 'meetings absorbed a failed read').toMatch(
			/No connected account with that id|Could not load/i
		);
	});

	/**
	 * Opening mail must not tell the sender it was opened.
	 *
	 * A remote image in an email is a tracking pixel as often as a picture, so
	 * the renderer withholds the source until the reader asks. The parser has a
	 * unit test for which sources survive parsing, which is a different question:
	 * that one governs what is kept in the tree, this one governs whether the
	 * browser is ever pointed at it. Asserted on the rendered page, because the
	 * guard lives in the template and D80 says a guarantee is verified by
	 * causing the thing it forbids.
	 */
	test('a remote image is not fetched until the reader asks for it', async ({ page }) => {
		const requested: string[] = [];
		page.on('request', (r) => {
			if (r.url().includes(REMOTE_IMAGE_HOST)) requested.push(r.url());
		});

		await page.goto(`/mail/${A}-thread?account=${A}`);
		await page.waitForLoadState('networkidle');

		// The body has to have rendered, or this passes for the wrong reason.
		await expect(page.getByText('ZULU BODY ALPHA')).toBeVisible();

		expect(requested, 'the page called the sender host before being asked').toEqual([]);
		const srcs = await page.locator('img').evaluateAll((els) =>
			els.map((e) => (e as HTMLImageElement).getAttribute('src') ?? '')
		);
		expect(
			srcs.some((src) => src.includes(REMOTE_IMAGE_HOST)),
			'a held image still carried its source into the markup'
		).toBe(false);

		// And it loads once asked, or the hold is not a hold but a removal.
		await page.getByRole('button', { name: /show 1 image/i }).click();
		await expect
			.poll(() => requested.length, { timeout: 5000 })
			.toBeGreaterThan(0);
	});
});
