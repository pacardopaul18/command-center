import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Layer 3: the reports, rendered.
 *
 * Every report is opened, its headline figures are read out of the DOM and
 * compared to `expected.json`, and the print view is screenshotted. Reading the
 * rendered number rather than the API's is deliberate: the API is checked in
 * layer 2, and what this layer is for is the gap between a correct response and
 * a correct page.
 */

const expected = JSON.parse(readFileSync('seed/expected.json', 'utf8'));

/** A tile's number, found by the label underneath it. */
async function tile(page: import('@playwright/test').Page, label: string) {
	const value = page
		.locator('.tile', { has: page.locator('.tile-label', { hasText: new RegExp(`^${label}$`, 'i') }) })
		.locator('.tile-value');
	await expect(value).toBeVisible();
	return (await value.innerText()).trim();
}

const num = (s: string) => Number(s.replace(/[^0-9.-]/g, ''));

/** Interaction needs the client to have taken over. See the note in flows.spec. */
async function ready(page: import('@playwright/test').Page) {
	await page.waitForLoadState('networkidle');
}

/**
 * Section headings, scoped to the report.
 *
 * A bare `h2` locator also picks up the quick add dialog's title, which is in
 * every page's DOM whether the dialog is open or not.
 */
function sections(page: import('@playwright/test').Page) {
	return page.locator('.report h2');
}

test.describe('reports render at volume with the right numbers', () => {
	test('what is slipping', async ({ page }) => {
		await page.goto('/reports/slipping');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('What is slipping');

		expect(num(await tile(page, 'Overdue actions'))).toBe(expected.action_bands.overdue);
		expect(num(await tile(page, 'Undecided proposals'))).toBe(expected.totals.proposals_pending);
		expect(num(await tile(page, 'Overdue invoices'))).toBe(expected.totals.overdue_invoices);

		// The page must not be a wall of empty tables at this volume.
		expect(await page.locator('tbody tr').count()).toBeGreaterThan(100);
	});

	test('billing and aging', async ({ page }) => {
		await page.goto('/reports/billing');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Billing and aging');

		const outstanding = num(await tile(page, 'Outstanding'));
		expect(Math.round(outstanding * 100)).toBe(expected.totals.outstanding_cents);
		expect(num(await tile(page, 'Unpaid invoices'))).toBe(expected.totals.unpaid_invoices);

		// All four bands are always rendered, even at zero.
		for (const band of ['0 to 30', '31 to 60', '61 to 90', '90 plus']) {
			await expect(page.getByRole('cell', { name: band, exact: true })).toBeVisible();
		}
	});

	test('project roll-up', async ({ page }) => {
		await page.goto('/reports/projects');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Project roll-up');
		expect(num(await tile(page, 'Projects'))).toBe(expected.counts.projects);
	});

	test('action item completion', async ({ page }) => {
		await page.goto('/reports/actions');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Action item completion');
		expect(num(await tile(page, 'Still open'))).toBe(expected.totals.action_items_open);
	});
});

test.describe('summary cards filter the list below', () => {
	test('clicking a card narrows to its section, clicking again restores', async ({ page }) => {
		await page.goto('/reports/slipping');
		await ready(page);
		const headings = () => sections(page);
		const before = await headings().count();
		expect(before).toBeGreaterThan(1);

		await page.getByRole('button', { name: /Overdue invoices/ }).click();
		await expect(page.getByRole('heading', { name: 'Overdue invoices' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Overdue action items' })).toHaveCount(0);
		await expect(headings()).toHaveCount(1);

		await page.getByRole('button', { name: /Overdue invoices/ }).click();
		await expect(headings()).toHaveCount(before);
	});

	test('the selected card is announced, not just tinted', async ({ page }) => {
		await page.goto('/reports/slipping');
		await ready(page);
		const card = page.getByRole('button', { name: /Projects at risk/ });
		await card.click();
		await expect(card).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByRole('status')).toContainText('Showing one section');
	});

	test('show everything clears the filter', async ({ page }) => {
		await page.goto('/reports/slipping');
		await ready(page);
		const before = await sections(page).count();
		await page.getByRole('button', { name: /Overdue actions/ }).click();
		await page.getByRole('button', { name: 'Show everything' }).click();
		await expect(sections(page)).toHaveCount(before);
	});

	test('the print view is never filtered, because a filtered document is a lie', async ({ page }) => {
		await page.goto('/reports/slipping/print');
		expect(await sections(page).count()).toBeGreaterThan(1);
		await expect(page.getByRole('button', { name: /Overdue invoices/ })).toHaveCount(0);
	});
});

test.describe('the date range follows you', () => {
	test('a window set on one report survives a trip to another', async ({ page }) => {
		await page.goto('/reports/billing?from=2026-07-01&to=2026-07-31');
		await ready(page);
		await expect(page.getByText(/Covering .* to /)).toBeVisible();

		await page.getByRole('link', { name: 'Action item completion' }).click();
		await page.waitForURL(/from=2026-07-01/);
		await expect(page).toHaveURL(/to=2026-07-31/);
		await expect(page.getByText(/Covering .* to /)).toBeVisible();
	});

	test('the index carries a window onto every report link', async ({ page }) => {
		await page.goto('/reports?from=2026-07-01&to=2026-07-31');
		await ready(page);
		await page.getByRole('link', { name: /Billing and aging/ }).click();
		await page.waitForURL(/from=2026-07-01/);
	});

	test('the print link keeps the window', async ({ page }) => {
		await page.goto('/reports/billing?from=2026-07-01&to=2026-07-31');
		await ready(page);
		const href = await page.getByRole('link', { name: /Print or save as PDF/ }).getAttribute('href');
		expect(href).toContain('from=2026-07-01');
		expect(href).toContain('to=2026-07-31');
	});

	test('running a reversed range corrects it rather than erroring', async ({ page }) => {
		await page.goto('/reports/billing');
		await ready(page);
		const form = page.locator('form.window');
		await form.locator('input[name="from"]').fill('2026-08-20');
		await form.locator('input[name="to"]').fill('2026-08-01');
		await form.getByRole('button', { name: 'Run' }).click();
		await page.waitForURL(/from=2026-08-01/);
		await expect(page).toHaveURL(/to=2026-08-20/);
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	});
});

test.describe('print views', () => {
	for (const type of ['slipping', 'billing', 'projects', 'actions']) {
		test(`${type} print view is a document, not a screen`, async ({ page }) => {
			await page.goto(`/reports/${type}/print`);

			// The app shell must not be there.
			await expect(page.locator('nav[aria-label="Main"]')).toHaveCount(0);
			await expect(page.getByRole('button', { name: /quick add/i })).toHaveCount(0);

			// Provenance must be, or a printed page is undateable.
            await expect(page.getByText('Command Center', { exact: true })).toBeVisible();
			await expect(page.getByText(/Generated/).first()).toBeVisible();
			await expect(page.getByText(/As of/).first()).toBeVisible();

			await page.emulateMedia({ media: 'print' });
			// Screen-only controls disappear under print media.
			await expect(page.getByRole('button', { name: /print or save as pdf/i })).toBeHidden();

			await page.screenshot({
				path: `test-results/print-${type}.png`,
				fullPage: true
			});
		});
	}
});

test.describe('accessibility basics survive volume', () => {
	for (const path of ['/', '/actions?view=all', '/reports/slipping', '/reports/billing/print']) {
		test(`${path} has one h1 and no skipped heading levels`, async ({ page }) => {
			await page.goto(path);
			const levels = await page
				.locator('h1, h2, h3, h4, h5, h6')
				.evaluateAll((els) => els.map((e) => Number(e.tagName.slice(1))));

			expect(levels.filter((l) => l === 1)).toHaveLength(1);
			for (let i = 0; i < levels.length - 1; i++) {
				expect(levels[i + 1] - levels[i], `skip at index ${i}: ${levels.join(',')}`).toBeLessThan(2);
			}
		});
	}

	test('table headers are distinguishable from the rows under them', async ({ page }) => {
		await page.goto('/reports/slipping');
		const th = page.locator('thead th').first();
		const td = page.locator('tbody td').first();
		const weight = (l: ReturnType<typeof page.locator>) =>
			l.evaluate((e) => Number(getComputedStyle(e).fontWeight));
		expect(await weight(th)).toBeGreaterThan(await weight(td));
		expect(await th.evaluate((e) => getComputedStyle(e).borderBottomWidth)).toBe('2px');
	});

	for (const path of [
		'/',
		'/actions?view=all',
		'/invoices',
		'/clients',
		'/clients/unassigned',
		'/tickets',
		'/projects/sections',
		'/files',
		'/projects?archived=all',
		'/meetings',
		'/calendar',
		'/reports/slipping'
	]) {
		test(`${path} never scrolls sideways at 412px`, async ({ page }) => {
			await page.setViewportSize({ width: 412, height: 900 });
			await page.goto(path);
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
			expect(overflow, 'horizontal overflow at 412px').toBeLessThanOrEqual(1);
		});
	}

	test('titles wrap rather than truncate on a phone', async ({ page }) => {
		await page.setViewportSize({ width: 412, height: 900 });
		await page.goto('/');
		const title = page.locator('.title').first();
		expect(await title.evaluate((e) => getComputedStyle(e).whiteSpace)).not.toBe('nowrap');
	});

	test('wide tables scroll inside their own box, the page never scrolls sideways', async ({ page }) => {
		await page.setViewportSize({ width: 412, height: 900 });
		await page.goto('/reports/slipping');
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(1);
	});
});

/**
 * The width the page is actually read at.
 *
 * D129 came from Paul looking at his own screen and finding Mail centred inside
 * a 1200px cap. The rule was written, and then twelve pages shipped centred
 * anyway, because the fidelity pass rendered at 1440 where a 1200 cap leaves
 * margins narrow enough to read as padding. The same defect, the same cause,
 * the same discovery route: Paul's eyes.
 *
 * So the width is asserted rather than looked at, at a width where a cap is
 * unmissable. 1920 leaves 496px of dead space if a page is capped, which no
 * amount of squinting turns into padding.
 *
 * Both kinds are measured, which is what D129 asks for: a page that should be
 * wide reaches the edge, and a page that should be capped still is. A test that
 * only checked the wide ones would pass just as happily if the cap were deleted
 * everywhere, and prose at 1700px is its own defect.
 */
test.describe('pages use the width they are read at', () => {
	const WIDE = [
		'/',
		'/actions',
		'/projects',
		'/meetings',
		'/calendar',
		'/sops',
		'/templates',
		'/clients',
		'/clients/unassigned',
		'/tickets',
		'/projects/sections',
		'/files',
		'/mail',
		'/invoices',
		'/ledger',
		'/reports',
		'/settings'
	];

	/*
	 * A page that throws while hydrating is a page that half works.
	 *
	 * Found on the unassigned screen: a `bind:value` on a key that did not exist
	 * yet threw `props_invalid_value`, hydration stopped where it was, and the
	 * result was a page the server had rendered correctly with one element
	 * quietly missing from it. Nothing on screen said anything had failed, no
	 * request errored, and every assertion anybody had written still passed.
	 *
	 * The console is the only place that failure is visible, so the suite reads
	 * it. Cheap, and it covers the whole class rather than the one instance.
	 */
	for (const path of WIDE) {
		test(`${path} hydrates without throwing`, async ({ page }) => {
			const thrown: string[] = [];
			page.on('pageerror', (error) => thrown.push(error.message));

			await page.goto(path);
			await page.waitForLoadState('networkidle');
			// Hydration errors surface just after the page settles, not during
			// the navigation itself.
			await page.waitForTimeout(300);

			expect(thrown, `${path} threw while hydrating`).toEqual([]);
		});
	}

	for (const path of WIDE) {
		test(`${path} reaches the right edge at 1920px`, async ({ page }) => {
			await page.setViewportSize({ width: 1920, height: 1000 });
			await page.goto(path);
			await page.waitForLoadState('networkidle');

			const gap = await page.evaluate(() => {
				const el = document.querySelector('.content');
				if (!el) throw new Error('No .content element on this page.');
				return Math.round(window.innerWidth - el.getBoundingClientRect().right);
			});

			// The shell's own padding is inside .content, so the box itself should
			// end at the viewport edge.
			expect(gap, `${path} is centred inside a cap at 1920px`).toBeLessThanOrEqual(1);
		});
	}

	/**
	 * The detail routes, which inherit the default and were not measured.
	 *
	 * Added before anybody looked at them rather than after somebody found one
	 * wrong. The navigable routes above were the ones checked when the default
	 * was inverted, and a detail page is exactly the kind of screen that gets
	 * the new behaviour without anybody having rendered it.
	 *
	 * Ids are discovered from the API rather than written in. A hardcoded
	 * `v-cl-1` passes until the fixture changes and then fails as a layout
	 * defect, which is a test lying about what broke.
	 */
	const DETAIL_ROUTES: { name: string; find: (request: APIRequestContext) => Promise<string> }[] = [
		{
			name: '/clients/[id]',
			find: async (request) => {
				const body = await (await request.get('/api/clients?status=active')).json();
				return `/clients/${body.clients[0].id}`;
			}
		},
		{
			name: '/projects/[id]',
			find: async (request) => {
				const body = await (await request.get('/api/projects')).json();
				return `/projects/${body.projects[0].id}`;
			}
		},
		{
			name: '/meetings/[id]',
			find: async (request) => {
				const body = await (await request.get('/api/meetings')).json();
				return `/meetings/${body.meetings[0].id}`;
			}
		},
		{
			name: '/tickets/[id]',
			find: async (request) => {
				const body = await (await request.get('/api/tickets?status=all')).json();
				return `/tickets/${body.tickets[0].id}`;
			}
		},
		{
			name: '/sops/books/[id]',
			find: async (request) => {
				const shelves = await (await request.get('/api/sops/shelves')).json();
				const shelf = await (
					await request.get(`/api/sops/shelves/${shelves.shelves[0].id}`)
				).json();
				return `/sops/books/${shelf.books[0].id}`;
			}
		}
	];

	for (const route of DETAIL_ROUTES) {
		test(`${route.name} reaches the right edge at 1920px`, async ({ page, request }) => {
			const path = await route.find(request);

			await page.setViewportSize({ width: 1920, height: 1000 });
			await page.goto(path);
			await page.waitForLoadState('networkidle');

			const gap = await page.evaluate(() => {
				const el = document.querySelector('.content');
				if (!el) throw new Error('No .content element on this page.');
				return Math.round(window.innerWidth - el.getBoundingClientRect().right);
			});

			expect(gap, `${route.name} is centred inside a cap at 1920px`).toBeLessThanOrEqual(1);
		});
	}

	test('a procedure page stays capped, because prose is not a table', async ({ page, request }) => {
		const list = await (await request.get('/api/sops?status=active')).json();
		const id = list.sops[0].id;

		await page.setViewportSize({ width: 1920, height: 1000 });
		await page.goto(`/sops/${id}`);
		await page.waitForLoadState('networkidle');

		const width = await page.evaluate(() =>
			Math.round(document.querySelector('.content')!.getBoundingClientRect().width)
		);

		// Capped and centred on purpose. If this ever reaches the edge, the
		// narrow list has been emptied and every SOP is being read at 1700px.
		expect(width, 'a procedure page is no longer capped for reading').toBeLessThan(1400);
	});
});


test.describe('the review queue is dense enough to work through', () => {
	/*
	 * W5b. Twenty-seven verdicts at a quarter of a viewport each is a scrolling
	 * exercise, and the cost of the interface was what was delaying the
	 * decisions rather than anything about the decisions themselves.
	 *
	 * Asserted as a row height rather than a screen count, because the fixture
	 * holds a different number of proposals than the real mirror and the
	 * property that matters is the same either way: one decision, one row.
	 */
	test('a proposal row stays under 100px at 1920', async ({ page }) => {
		await page.setViewportSize({ width: 1920, height: 1080 });
		await page.goto('/actions');
		const rows = page.locator('ul[class*="queue"] > li');
		if ((await rows.count()) === 0) test.skip(true, 'no pending proposals in this fixture');

		const box = await rows.first().boundingBox();
		expect(box, 'the first proposal row has no box').toBeTruthy();
		expect(box!.height).toBeLessThan(100);
	});

	test('both verdicts are reachable without opening anything', async ({ page }) => {
		await page.setViewportSize({ width: 1920, height: 1080 });
		await page.goto('/actions');
		const rows = page.locator('ul[class*="queue"] > li');
		if ((await rows.count()) === 0) test.skip(true, 'no pending proposals in this fixture');

		const first = rows.first();
		await expect(first.locator('button[class*="accept"]')).toBeVisible();
		await expect(first.locator('button[class*="reject"]')).toBeVisible();
		// And the sentence that stops a queue being cleared by accepting
		// everything is on screen, not behind the expander.
		await expect(first.locator('blockquote')).toBeVisible();
	});

	test('the queue comes before the summary tiles', async ({ page }) => {
		/*
		 * A page is ordered by what the reader came to do. The decisions sat
		 * below five tiles reading zero, so the first screen of a page about
		 * pending decisions carried no content at all.
		 */
		await page.goto('/actions');
		const queue = page.locator('ul[class*="queue"]');
		if ((await queue.count()) === 0) test.skip(true, 'no pending proposals in this fixture');

		const queueY = (await queue.boundingBox())!.y;
		const tilesY = (await page.locator('[class*="tiles"]').first().boundingBox())!.y;
		expect(queueY).toBeLessThan(tilesY);
	});

	test('every verdict meets the tap floor at 412px', async ({ page }) => {
		// D22. A card costing a quarter of a desktop viewport costs a whole
		// phone screen, and these are the controls Paul actually presses.
		await page.setViewportSize({ width: 412, height: 915 });
		await page.goto('/actions');
		const buttons = page.locator('button[class*="verdict"]');
		if ((await buttons.count()) === 0) test.skip(true, 'no pending proposals in this fixture');

		const small = await buttons.evaluateAll((els) =>
			els.filter((e) => e.getBoundingClientRect().height < 44).length
		);
		expect(small).toBe(0);
	});
});


test.describe('a calendar event opens and says something', () => {
	/*
	 * W6b. Clicking an event did nothing in the month view, because the detail
	 * panel lived inside the day and agenda views only: the pip set state that no
	 * branch rendered. And when it did open, every field was null for a shared
	 * calendar, so it was an empty frame.
	 *
	 * A control that appears to do something and does not, and an empty modal is
	 * the same failure with a frame around it.
	 */
	test('clicking an event in the month grid opens a panel with content', async ({ page }) => {
		await page.setViewportSize({ width: 1920, height: 1080 });
		await page.goto('/calendar?view=month');
		const pips = page.locator('button[class*="pip"]');
		if ((await pips.count()) === 0) test.skip(true, 'no events in this fixture window');

		/*
		 * Waited for the page to settle, then clicked once.
		 *
		 * Two wrong versions before this one. Clicking as soon as the pip exists
		 * is before hydration, so the handler is not attached. Retrying the click
		 * until the panel appears is worse: opening is a toggle, so every retry
		 * closed what the previous one opened and it could never pass.
		 */
		await page.waitForLoadState('networkidle');
		await pips.first().click();
		const panel = page.locator('[class*="month-detail"]');
		await expect(panel, 'clicking a month event rendered nothing').toHaveCount(1);

		// Never an empty frame, whichever kind of event it is.
		const text = (await panel.innerText()).trim();
		expect(text.length, 'the panel opened empty').toBeGreaterThan(80);
	});

	test('a shared event explains what is held instead of showing blanks', async ({ page }) => {
		await page.goto('/calendar?view=month');
		const busy = page.locator('button[class*="pip"]').filter({ hasText: 'Busy' });
		if ((await busy.count()) === 0) test.skip(true, 'no shared-calendar events in this fixture');

		await page.waitForLoadState('networkidle');
		await busy.first().click();
		const panel = page.locator('[class*="month-detail"]');
		await expect(panel).toHaveCount(1);
		const text = await panel.innerText();
		// Says it is not his, says what is stored, and says why.
		expect(text).toContain('do not own');
		expect(text).toContain('start and end time');
	});
});
