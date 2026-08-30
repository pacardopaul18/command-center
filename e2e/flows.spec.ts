import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Layer 3: the core flows a person actually performs.
 *
 * Each test cleans up what it creates, so the counts layer 1 asserts stay
 * intact and the suite can be run repeatedly.
 */

const expected = JSON.parse(readFileSync('seed/expected.json', 'utf8'));

/**
 * Waits for the client to take over before typing into it.
 *
 * Server rendered markup is interactive-looking well before Svelte hydrates the
 * bindings behind it. A value set in that window lands in the DOM and never
 * reaches component state, so the form submits empty and the screen says
 * nothing. The suite hit exactly that: the same fill failed on first load and
 * passed after a reload.
 *
 * Worth knowing beyond the tests. A fast typist on a cold load is in the same
 * race, and the honest fix for that is the app disabling its own controls until
 * it can honour them rather than every caller learning to wait.
 */
async function ready(page: import('@playwright/test').Page) {
	await page.waitForLoadState('networkidle');
}

/** The capture form, told apart from the quick add dialog by its submit button. */
function captureForm(page: import('@playwright/test').Page) {
	return page.locator('form').filter({ has: page.getByRole('button', { name: 'Add item' }) });
}

async function deleteItem(request: import('@playwright/test').APIRequestContext, title: string) {
	const res = await request.get(`/api/action-items?view=all&q=${encodeURIComponent(title)}`);
	const body = await res.json();
	for (const item of body.items) {
		if (item.title === title) await request.delete(`/api/action-items/${item.id}`);
	}
}

test.describe('capture and track', () => {
	const TITLE = 'E2E capture form probe';

	test.afterEach(async ({ request }) => deleteItem(request, TITLE));

	test('the capture form creates an item and the list reflects it', async ({ page }) => {
		await page.goto('/actions?view=all');
		await ready(page);
		const form = captureForm(page);

		const before = Number(
			(await page.getByRole('link', { name: /^All/ }).innerText()).replace(/\D/g, '')
		);

		await form.getByLabel('Title').pressSequentially(TITLE);
		await form.getByRole('button', { name: 'Add item' }).click();

		await expect(page.getByRole('status')).toContainText('Action item added.');
		await expect(page.getByText(TITLE).first()).toBeVisible();

		const after = Number(
			(await page.getByRole('link', { name: /^All/ }).innerText()).replace(/\D/g, '')
		);
		expect(after).toBe(before + 1);
	});

	test('a rejected save shows an error and keeps what was typed', async ({ page }) => {
		await page.goto('/actions?view=all');
		await ready(page);
		const form = captureForm(page);

		// The exact failure D66 was written for: 2xx with a body that is not JSON.
		await page.route('**/api/action-items', async (route) => {
			if (route.request().method() !== 'POST') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'text/html',
				body: '<!doctype html><h1>Sign in</h1>'
			});
		});

		await form.getByLabel('Title').pressSequentially(TITLE);
		await form.getByRole('button', { name: 'Add item' }).click();

		await expect(page.getByRole('alert')).toBeVisible();
		await expect(page.getByRole('alert')).toContainText(/session/i);
		// The typed text must survive, or the user loses their work silently.
		await expect(form.getByLabel('Title')).toHaveValue(TITLE);
	});
});

test.describe('quick add', () => {
	const TITLE = 'E2E quick add probe';

	test.afterEach(async ({ request }) => deleteItem(request, TITLE));

	test('the N shortcut opens it and it saves', async ({ page }) => {
		await page.goto('/actions?view=all');
		await ready(page);
		await page.getByRole('heading', { level: 1 }).click();
		await page.keyboard.press('n');

		const dialog = page.getByRole('dialog', { name: 'Quick add' });
		await expect(dialog).toBeVisible();

		await dialog.getByLabel('Title').pressSequentially(TITLE);
		await dialog.getByRole('button', { name: 'Add item' }).click();

		await expect(dialog).toBeHidden();
		await expect(page.getByText(TITLE).first()).toBeVisible();
	});

	test('a failed save keeps the dialog open with the error', async ({ page }) => {
		await page.goto('/actions?view=all');
		await ready(page);
		await page.route('**/api/action-items', async (route) => {
			if (route.request().method() !== 'POST') return route.fallback();
			await route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Sign in</h1>' });
		});

		await page.getByRole('heading', { level: 1 }).click();
		await page.keyboard.press('n');
		const dialog = page.getByRole('dialog', { name: 'Quick add' });
		await expect(dialog).toBeVisible();
		await dialog.getByLabel('Title').pressSequentially(TITLE);
		await dialog.getByRole('button', { name: 'Add item' }).click();

		// Closing on failure is what hid the unsaved item. It must stay open.
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('alert')).toContainText(/session/i);
	});
});

test.describe('navigation and filters at volume', () => {
	test('every module answers from the sidebar', async ({ page }) => {
		await page.goto('/');
		for (const name of ['Action items', 'Projects', 'Meetings', 'SOPs', 'Templates', 'Clients', 'Invoicing', 'Reports', 'Settings']) {
			await page.getByRole('link', { name, exact: true }).click();
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		}
	});

	test('the sidebar stays reachable after scrolling a long page', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 800 });
		await page.goto('/actions?view=all');
		await page.mouse.wheel(0, 6000);
		await page.waitForTimeout(200);
		// Sticky means it is still in the viewport, not scrolled off the top.
		await expect(page.getByRole('link', { name: 'Reports', exact: true })).toBeInViewport();
	});

	test('the overdue filter shows the generated overdue count', async ({ page }) => {
		await page.goto('/actions?view=overdue');
		const rows = await page.locator('tbody tr').count();
		expect(rows).toBe(expected.action_bands.overdue);
	});

	test('search narrows the list', async ({ page }) => {
		await page.goto('/actions?view=all');
		await ready(page);
		const filters = page.locator('form.filters');
		await filters.getByLabel('Search').pressSequentially('invoice');
		await filters.getByRole('button', { name: 'Apply' }).click();
		await page.waitForURL(/q=invoice/);
		const rows = await page.locator('tbody tr').count();
		expect(rows).toBeGreaterThan(0);
		expect(rows).toBeLessThan(expected.counts.action_items);
	});
});

test.describe('the cockpit', () => {
	test('shows all four cards with real data', async ({ page }) => {
		await page.goto('/');
		for (const title of ['Overdue and due today', 'What will slip', "Today's meetings", 'Invoice alerts']) {
			await expect(page.getByRole('heading', { name: title })).toBeVisible();
		}
		// The design mocks meeting times and agendas. Neither is in the schema.
		await expect(page.getByText('agenda drafted')).toHaveCount(0);
	});

	test('the Asana push is visibly unavailable, never silently broken', async ({ page }) => {
		await page.goto('/actions?view=open');
		const push = page.getByRole('button', { name: /^Push/ }).first();
		await expect(push).toBeDisabled();
	});
});
