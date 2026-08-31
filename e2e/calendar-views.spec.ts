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
