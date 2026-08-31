import { test, expect } from '@playwright/test';

/**
 * The calendar's clock.
 *
 * It rendered in UTC, which is a zone nobody in this firm lives on: a 9am
 * meeting showed as 9am to no one and looked correct. These run from Manila,
 * where local and Mountain are far enough apart that a wrong zone cannot pass
 * by coincidence.
 */

test.use({ timezoneId: 'Asia/Manila' });

const ACCOUNT = 'preview-personal';
const URL = `/calendar?account=${ACCOUNT}&day=2026-08-31`;

test.describe('calendar times', () => {
	test('shows local time by default and names the zone', async ({ page }) => {
		await page.goto(URL);
		await page.waitForLoadState('networkidle');

		await expect(page.locator('.sub')).toContainText('Manila');
		// UTC must never reach the screen.
		const body = await page.locator('body').innerText();
		expect(body, 'a time was rendered in UTC').not.toMatch(/\bUTC\b/);
	});

	test('the firm-time toggle moves every time on the page', async ({ page }) => {
		await page.goto(URL);
		await page.waitForLoadState('networkidle');

		const before = await page.locator('.row .when').allInnerTexts();
		expect(before.length, 'no events to compare').toBeGreaterThan(0);

		await page.getByRole('switch').click();
		await expect(page.locator('.sub')).toContainText('Denver');

		const after = await page.locator('.row .when').allInnerTexts();
		expect(after[0], 'the toggle did not change the times').not.toBe(before[0]);
	});
});

/**
 * The month grid is whole weeks.
 *
 * It came out at 43 cells first: the padding added a flat seven days to the end
 * of the month, which overshoots whenever a month does not end on a Sunday. The
 * last row was ragged and a day went missing off the end. Three months with
 * different shapes, including a February, because one month proves nothing.
 */
test.describe('month view', () => {
	for (const day of ['2026-08-31', '2026-02-15', '2026-11-01']) {
		test(`draws whole weeks for the month containing ${day}`, async ({ page }) => {
			await page.goto(`/calendar?account=preview-personal&day=${day}&view=month`);
			await page.waitForLoadState('networkidle');

			const cells = await page.locator('.cell').count();
			expect(cells, 'the grid is not a whole number of weeks').toBeGreaterThan(27);
			expect(cells % 7, `${cells} cells is a ragged grid`).toBe(0);
		});
	}

	test('a day in the grid opens that day', async ({ page }) => {
		await page.goto('/calendar?account=preview-personal&day=2026-08-31&view=month');
		await page.waitForLoadState('networkidle');
		await page.locator('.cell:not(.outside) .cell-day').first().click();
		await page.waitForURL(/view=day/, { timeout: 8000 });
	});
});
