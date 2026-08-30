import { test, expect } from '@playwright/test';
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

	for (const path of ['/', '/actions?view=all', '/invoices', '/reports/slipping']) {
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
