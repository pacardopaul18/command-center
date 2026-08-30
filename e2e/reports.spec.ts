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

	test('wide tables scroll inside their own box, the page never scrolls sideways', async ({ page }) => {
		await page.setViewportSize({ width: 412, height: 900 });
		await page.goto('/reports/slipping');
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(1);
	});
});
