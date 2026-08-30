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

test.describe('typing before the client is ready', () => {
	const TITLE = 'E2E pre-hydration probe';

	test.afterEach(async ({ request }) => deleteItem(request, TITLE));

	/**
	 * Types into the server rendered markup before Svelte has hydrated, by
	 * holding back the client entry module, then lets hydration finish and
	 * submits.
	 *
	 * This was written to reproduce a reported loss of pre-hydration input and
	 * does not reproduce it: the form submits correctly with the guard in Input
	 * removed as well as with it present. It stays because the behaviour it
	 * asserts is the behaviour anyone would want, and because a test that pins a
	 * property is worth having whether or not it once caught something.
	 */
	test('text typed before hydration survives and submits', async ({ page }) => {
		let released: () => void = () => {};
		const gate = new Promise<void>((r) => (released = r));

		// Dev serves the client entry from /@fs and a generated app module; a
		// built site serves /_app/immutable/entry. Hold whichever applies, or the
		// page hydrates before the typing and the test proves nothing.
		const hydrationModules =
			/(runtime\/client\/entry\.js|generated\/client\/app\.js|_app\/immutable\/entry\/)/;
		await page.route(
			(u) => hydrationModules.test(u.href),
			async (route) => {
				await gate;
				await route.continue();
			}
		);

		await page.goto('/actions?view=all', { waitUntil: 'commit' });

		const form = captureForm(page);
		const input = form.getByLabel('Title');
		await input.waitFor({ state: 'visible' });

		// Nothing has hydrated yet, which the shortcut proves: it is a client
		// side keybinding and does nothing until the app is live.
		await page.keyboard.press('n');
		await expect(page.locator('dialog[open]')).toHaveCount(0);

		await input.fill(TITLE);
		expect(await input.inputValue()).toBe(TITLE);

		// Let the client take over. The binding's first act is to write its own
		// value into the element, which is where the text used to disappear.
		released();
		await page.waitForLoadState('networkidle');

		/**
		 * T-W1 instrumentation.
		 *
		 * This assertion has failed intermittently under full-suite load and has
		 * never been reproduced on demand, so it is not yet known whether it is a
		 * slow harness or real pre-hydration input loss. The difference matters:
		 * the second is a user-visible defect on every page load.
		 *
		 * The evidence needed is the value the input actually held, and whether
		 * the app had hydrated by the time it was read. Captured before the
		 * assertion so a failure carries its own diagnosis rather than needing a
		 * reproduction that has not been forthcoming.
		 */
		const hydrated = await page
			.locator('body')
			.evaluate(() => document.documentElement.hasAttribute('data-sveltekit-preload-data') || Boolean((window as unknown as { __sveltekit?: unknown }).__sveltekit))
			.catch(() => null);
		const actual = await input.inputValue();

		expect(
			actual,
			`T-W1: input value after hydration was ${JSON.stringify(actual)}, expected ` +
				`${JSON.stringify(TITLE)}. Hydration detected: ${hydrated}. ` +
				(actual === ''
					? 'EMPTY means the client overwrote pre-hydration input, which is a real defect.'
					: 'A non-empty mismatch means something else edited the field.')
		).toBe(TITLE);

		await form.getByRole('button', { name: 'Add item' }).click();
		await expect(page.locator('.status-line')).toContainText('Action item added.');
	});
});

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

		await expect(page.locator('.status-line')).toContainText('Action item added.');

		// The item has no deadline, so it sorts last and is not on page one. What
		// must change is the size of the set, which the chip counts report.
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
		// The new item has no deadline, so it sorts to the end and is not on page
		// one. The set grew, which is the claim; where it landed is the sort's job.
		await expect(page.getByRole('navigation', { name: 'Pagination' })).toContainText(
			`of ${expected.counts.action_items + 1} action items`
		);
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

	test('the overdue filter reports the generated overdue count', async ({ page }) => {
		await page.goto('/actions?view=overdue');
		// The list is a page now; the pager carries the number that means the set.
		await expect(page.getByRole('navigation', { name: 'Pagination' })).toContainText(
			`of ${expected.action_bands.overdue} action items`
		);
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
		expect(rows).toBeLessThanOrEqual(50);
	});
});

test.describe('pagination', () => {
	test('the list is a page, and the pager says how big the set is', async ({ page }) => {
		await page.goto('/actions?view=all');
		await expect(page.locator('tbody tr')).toHaveCount(50);
		await expect(page.getByRole('navigation', { name: 'Pagination' })).toContainText(
			`of ${expected.counts.action_items} action items`
		);
	});

	test('changing the page size changes the rows and returns to page one', async ({ page }) => {
		await page.goto('/actions?view=all&page=3');
		await ready(page);
		const pager = page.getByRole('navigation', { name: 'Pagination' });
		await pager.getByLabel('Per page').selectOption('10');
		await page.waitForURL(/page_size=10/);
		await expect(page.locator('tbody tr')).toHaveCount(10);
		await expect(pager).toContainText('Page 1 of');
	});

	test('next and previous move a page and the rows change', async ({ page }) => {
		await page.goto('/actions?view=all&page_size=10');
		await ready(page);
		const firstTitle = await page.locator('tbody tr').first().innerText();
		await page.getByRole('button', { name: 'Next' }).click();
		await page.waitForURL(/page=2/);
		expect(await page.locator('tbody tr').first().innerText()).not.toBe(firstTitle);
		await page.getByRole('button', { name: 'Previous' }).click();
		await page.waitForURL(/page=1/);
	});

	test('previous is disabled on the first page, next on the last', async ({ page }) => {
		await page.goto('/actions?view=all&page_size=500');
		await ready(page);
		await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();
		await page.goto('/actions?view=all&page_size=500&page=6');
		await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
	});

	test('invoices paginate too', async ({ page }) => {
		await page.goto('/invoices?page_size=10');
		await expect(page.getByRole('navigation', { name: 'Pagination' })).toContainText(
			'of 900 invoices'
		);
	});
});

test.describe('the nav says where you are', () => {
	test('exactly one item is marked current, and it is the open page', async ({ page }) => {
		await page.goto('/reports');
		const current = page.locator('.nav-link[aria-current="page"]');
		await expect(current).toHaveCount(1);
		await expect(current).toHaveText('Reports');
	});
});

test.describe('billing periods open to their time', () => {
	test('expanding a period lists its entries and collapsing hides them', async ({ page }) => {
		await page.goto('/invoices?page_size=10');
		await ready(page);

		const toggle = page.getByRole('button', { name: /^Show \d+ entr/ }).first();
		await expect(toggle).toBeVisible();
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');

		await toggle.click();

		// The button relabels itself, so the original locator now resolves to a
		// different period's toggle. Assert on the opened control instead.
		const opened = page.getByRole('button', { name: 'Hide time' });
		await expect(opened).toHaveAttribute('aria-expanded', 'true');
		await expect(page.locator('.entries tbody tr').first()).toBeVisible();

		await opened.click();
		await expect(page.locator('.entries')).toHaveCount(0);
	});

	test('the entries shown add up to the hours the period claims', async ({ page }) => {
		await page.goto('/invoices?page_size=10');
		await ready(page);
		const toggle = page.getByRole('button', { name: /^Show \d+ entr/ }).first();
		await toggle.click();

		const panel = page.locator('.entries').first();
		await expect(panel.locator('tbody tr').first()).toBeVisible();
		const hours = await panel.locator('tbody tr td:nth-child(4)').allInnerTexts();
		const sum = hours.reduce((s, h) => s + Number(h), 0);

		const meta = await page.locator('li').filter({ has: panel }).first().innerText();
		const claimed = Number(meta.match(/([0-9.]+) total h/)?.[1]);
		expect(sum).toBeCloseTo(claimed, 1);
	});
});

test.describe('the dashboard', () => {
	test('shows the six cards and the four headline tiles', async ({ page }) => {
		await page.goto('/');
		for (const title of [
			'Needs you now',
			"Today's meetings",
			'The week ahead',
			'Money past due',
			'Finished today',
			'What will slip'
		]) {
			await expect(page.getByRole('heading', { name: title })).toBeVisible();
		}
		for (const label of ['Overdue', 'Due today', 'Awaiting a decision', 'Past due']) {
			await expect(page.locator('.tile-label', { hasText: new RegExp(`^${label}$`) })).toBeVisible();
		}
		// The design mocks meeting times and agendas. Neither is in the schema.
		await expect(page.getByText('agenda drafted')).toHaveCount(0);
	});

	test('every headline tile is a link to the screen that owns the number', async ({ page }) => {
		await page.goto('/');
		const hrefs = await page.locator('a.tile').evaluateAll((els) =>
			els.map((e) => (e as HTMLAnchorElement).getAttribute('href'))
		);
		expect(hrefs).toEqual([
			'/actions?view=overdue',
			'/actions?view=today',
			'/reports/slipping',
			'/invoices'
		]);
	});

	test('a card shows a few rows and names the true count', async ({ page }) => {
		await page.goto('/');
		const card = page
			.locator('section.card')
			.filter({ has: page.getByRole('heading', { name: 'Needs you now' }) });

		// Six at most, which is the API's cap, not however many happen to fit.
		const rows = await card.locator('li.row').count();
		expect(rows).toBeGreaterThan(0);
		expect(rows).toBeLessThanOrEqual(6);

		// At volume the card must say what it is not showing.
		await expect(card).toContainText(/Showing \d+ of \d+/);
	});

	test('the headline sentence names the worst thing first', async ({ page }) => {
		await page.goto('/');
		const overdue = Number(
			await page.locator('a.tile', { hasText: 'Overdue' }).locator('.tile-value').first().innerText()
		);
		const sub = await page.locator('.sub').innerText();
		if (overdue > 0) expect(sub).toContain('overdue');
	});

	test('the Asana push is visibly unavailable, never silently broken', async ({ page }) => {
		await page.goto('/actions?view=open');
		const push = page.getByRole('button', { name: /^Push/ }).first();
		await expect(push).toBeDisabled();
	});
});

test.describe('tickets: the worked unit under a project', () => {
	const TITLE = 'E2E ticket probe';

	/**
	 * Tickets have no seeded rows, so anything this suite creates has to be
	 * removed or layer 1 fails on the next run. That is deliberate: the leak
	 * guard and the cleanup here check each other.
	 */
	async function removeTicket(request: import('@playwright/test').APIRequestContext, title: string) {
		const res = await request.get('/api/tickets?status=all');
		const body = await res.json();
		for (const t of body.tickets) {
			if (t.title === title) await request.delete(`/api/tickets/${t.id}`);
		}
	}

	test.afterEach(async ({ request }) => {
		await removeTicket(request, TITLE);
	});

	test('a ticket is created on a project and shows estimate against actual', async ({
		page,
		request
	}) => {
		const projects = await (await request.get('/api/projects')).json();
		const project = projects.projects[0];

		await page.goto(`/projects/${project.id}`);
		await ready(page);

		// The form is behind a toggle, so it does not exist until asked for.
		await page.getByRole('button', { name: 'New ticket' }).click();

		// Scoped by its own submit button, the way captureForm is. The project page
		// has several forms and 'Title' appears in more than one of them.
		const form = page
			.locator('form')
			.filter({ has: page.getByRole('button', { name: 'Create ticket' }) });
		await form.getByLabel('Title').fill(TITLE);
		await form.getByLabel(/Estimate/i).fill('8');
		await form.getByRole('button', { name: 'Create ticket' }).click();

		const row = page.getByRole('link', { name: TITLE }).first();
		await expect(row).toBeVisible();

		await row.click();
		await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();

		// A new ticket has an estimate and no time booked. The zero is computed
		// from time entries, so it has to render as a real zero, not a blank.
		await expect(page.locator('main')).toContainText('8');
		await expect(page.locator('main')).toContainText(/0(\.0+)?\s*h/i);
	});

	test('finishing a ticket records when, and reopening it clears that', async ({
		page,
		request
	}) => {
		const projects = await (await request.get('/api/projects')).json();
		const created = await request.post('/api/tickets', {
			data: { project_id: projects.projects[0].id, title: TITLE, estimate_hours: 3 }
		});
		const { ticket } = await created.json();

		await page.goto(`/tickets/${ticket.id}`);
		await ready(page);

		// The page must say when it finished, not merely that it did. This caught a
		// real omission: completed_at was stored and never shown.
		await page.getByLabel(/^Status/i).selectOption('done');
		await expect(page.locator('dl.facts')).toContainText('Finished');

		await page.getByLabel(/^Status/i).selectOption('in_progress');
		await expect(page.locator('dl.facts')).not.toContainText('Finished');
	});

	test('converting an action item leaves the action item standing', async ({ page, request }) => {
		const list = await (await request.get('/api/action-items?view=open&page_size=200')).json();
		const item = list.items.find((i: { project_id?: string }) => i.project_id);
		expect(item, 'the seed should have an open item on a project').toBeTruthy();

		await page.goto(`/actions?view=open&q=${encodeURIComponent(item.title)}`);
		await ready(page);

		await page.getByRole('button', { name: /To ticket/i }).first().click();
		await expect(page.locator('main')).toContainText(/still here as the record/i);

		// The item is the record that the commitment was made. Converting is not
		// a move, and a screen that quietly removed it would be losing history.
		await expect(page.getByText(item.title).first()).toBeVisible();

		const after = await (await request.get('/api/tickets?status=all')).json();
		const made = after.tickets.find(
			(t: { converted_from_action_item_id?: string }) =>
				t.converted_from_action_item_id === item.id
		);
		expect(made).toBeTruthy();
		await request.delete(`/api/tickets/${made.id}`);
	});
});

test.describe('the client page', () => {
	const CONTACT = 'E2E contact probe';

	async function clientId(request: import('@playwright/test').APIRequestContext) {
		const res = await request.get('/api/clients');
		return (await res.json()).clients[0].id as string;
	}

	test.afterEach(async ({ request }) => {
		const res = await request.get('/api/contacts');
		for (const c of (await res.json()).contacts) {
			if (c.name === CONTACT) await request.delete(`/api/contacts/${c.id}`);
		}
	});

	test('shows one client with their money, projects and invoices together', async ({
		page,
		request
	}) => {
		await page.goto(`/clients/${await clientId(request)}`);
		await ready(page);

		for (const section of ['Contacts', 'Contracts', 'Projects', 'Invoices']) {
			await expect(page.getByRole('heading', { name: section })).toBeVisible();
		}
		await expect(page.locator('.money')).toContainText('Outstanding');
		// Zero past due reads as a word, not as 0.00 dressed up as a figure.
		await expect(page.locator('.money')).toContainText(/Past due/);
	});

	test('adds a contact, and refuses a second primary in words', async ({ page, request }) => {
		await page.goto(`/clients/${await clientId(request)}`);
		await ready(page);

		await page.getByRole('button', { name: 'Add contact' }).click();
		const form = page
			.locator('form')
			.filter({ has: page.getByRole('button', { name: 'Add contact', exact: true }) });
		await form.getByLabel('Name').fill(CONTACT);
		await form.getByLabel('Email').fill('probe@example.test');
		await form.getByRole('checkbox', { name: 'Primary contact' }).check();
		await form.getByRole('button', { name: 'Add contact', exact: true }).click();

		await expect(page.getByText(CONTACT).first()).toBeVisible();

		// A second primary is refused by the database. What matters here is that
		// the refusal reaches the screen as a sentence rather than as nothing,
		// which is the whole point of routing writes through apiWrite (D66).
		await page.getByRole('button', { name: 'Add contact' }).first().click();
		const again = page
			.locator('form')
			.filter({ has: page.getByRole('button', { name: 'Add contact', exact: true }) });
		await again.getByLabel('Name').fill(CONTACT);
		await again.getByRole('checkbox', { name: 'Primary contact' }).check();
		await again.getByRole('button', { name: 'Add contact', exact: true }).click();

		await expect(page.getByRole('alert')).toContainText(/already has a primary contact/i);
	});

	test('says fulfillment is set by hand rather than implying it is computed', async ({
		page,
		request
	}) => {
		// The page must not suggest a number it cannot support. Nothing links an
		// invoice to a contract, so no percentage is shown and the screen says why.
		await page.goto(`/clients/${await clientId(request)}`);
		await ready(page);
		await page.getByRole('button', { name: 'Add contract' }).click();
		await expect(page.locator('main')).toContainText(/set by hand/i);
	});
});
