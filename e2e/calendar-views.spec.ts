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

/**
 * The rail: the calendars this account owns and the people it follows.
 *
 * Rendered assertions, D128 and D127. The follow list is served by a scoped
 * route with its own guarantee test, and this is the other half of that: a
 * correctly scoped route reached by a page that never names the account is
 * still a broken surface, so the check is made where the reader meets it.
 */
test.describe('the calendar rail', () => {
	const PERSON = 'e2e-followed@calendar.test';

	test('following someone puts them in the rail, and leaving removes them', async ({ page }) => {
		await page.goto(URL);
		await page.waitForLoadState('networkidle');

		const rail = page.locator('.rail');
		await expect(rail.getByText('Calendars')).toBeVisible();

		await rail.getByLabel('Calendar address to follow').fill(PERSON);
		await rail.getByLabel('Their name').fill('E2E Followed Person');
		await rail.getByRole('button', { name: 'Follow' }).click();

		await expect(rail.getByText('E2E Followed Person')).toBeVisible();
		await expect(rail.getByText('followed, busy only')).toBeVisible();

		// Nothing this suite creates may outlive it.
		await rail.getByRole('button', { name: /Stop following/ }).click();
		await expect(rail.getByText('E2E Followed Person')).toHaveCount(0);
	});

	test('a followed person can be picked to match against', async ({ page }) => {
		await page.goto(URL);
		await page.waitForLoadState('networkidle');

		const rail = page.locator('.rail');
		await rail.getByLabel('Calendar address to follow').fill(PERSON);
		await rail.getByRole('button', { name: 'Follow' }).click();

		const tick = rail.getByLabel(`Match against ${PERSON}`);
		await expect(tick).not.toBeChecked();
		await tick.check();
		await expect(tick).toBeChecked();

		await rail.getByRole('button', { name: /Stop following/ }).click();
		await expect(tick).toHaveCount(0);
	});
});

/**
 * Draft invite is a link into Google's form.
 *
 * The point being pinned is that pressing it navigates to Google rather than
 * asking this app to create anything. A route that could create an event would
 * be a scope this app must never hold, so the control is checked to be an
 * anchor with an href, not a button with a handler.
 */
test.describe('drafting an invite', () => {
	test('fills Google\'s own form and never posts anywhere', async ({ page }) => {
		const writes: string[] = [];
		page.on('request', (r) => {
			if (r.method() !== 'GET' && r.url().includes('/api/')) writes.push(`${r.method()} ${r.url()}`);
		});

		await page.goto(URL);
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: 'Draft invite' }).click();

		const dialog = page.getByRole('dialog', { name: 'Draft invite' });
		await expect(dialog).toBeVisible();
		await dialog.getByLabel('Title').fill('E2E draft subject');
		await dialog.getByLabel('Guests').fill('e2e-guest@calendar.test');

		const link = dialog.getByRole('link', { name: 'Open in Google Calendar' });
		const href = await link.getAttribute('href');
		expect(href, 'the draft is not a link into Google').toContain(
			'calendar.google.com/calendar/u/0/r/eventedit'
		);
		expect(href).toContain('action=TEMPLATE');
		expect(href).toContain('E2E%20draft%20subject');
		expect(href).toContain(encodeURIComponent('e2e-guest@calendar.test'));

		// The date separator must reach Google raw, or the form opens with no
		// time in it and the reader fills it in again.
		expect(href, 'the window separator was encoded').toMatch(/dates=\d{8}T\d{6}Z\/\d{8}T\d{6}Z/);

		expect(writes, 'drafting an invite wrote to the API').toEqual([]);
	});

	test('a draft with no title cannot be opened', async ({ page }) => {
		await page.goto(URL);
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: 'Draft invite' }).click();

		const dialog = page.getByRole('dialog', { name: 'Draft invite' });
		// D27: the control is present and refuses, rather than producing a link
		// to an event called nothing.
		await expect(dialog.getByRole('button', { name: 'Open in Google Calendar' })).toBeDisabled();
	});

	test('the default start is a working hour, never the middle of the night', async ({ page }) => {
		await page.goto(URL);
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: 'Draft invite' }).click();

		const value = await page
			.getByRole('dialog', { name: 'Draft invite' })
			.getByLabel('Start')
			.inputValue();
		const hour = Number(value.slice(0, 2));
		expect(hour, `the dialog opened offering ${value}`).toBeGreaterThanOrEqual(9);
		expect(hour).toBeLessThan(17);
	});
});
