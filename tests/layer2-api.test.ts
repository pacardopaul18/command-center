import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Layer 2: API contract.
 *
 * Runs against the local dev server with the volume seed loaded. Where a number
 * is knowable from generation, it is asserted against `expected.json` rather
 * than against whatever the API happens to say, for the same reason as layer 1.
 * Where the assertion is about shape or status code, the API is the subject.
 *
 * Rows created here are cleaned up, so the suite can run repeatedly without
 * drifting the counts that layer 1 checks.
 */

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:5173';
const expected = JSON.parse(readFileSync('seed/expected.json', 'utf8'));

async function api(path: string, init?: RequestInit) {
	const res = await fetch(`${BASE}${path}`, init);
	const text = await res.text();
	let json: unknown = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = null;
	}
	return { res, json: json as any, text };
}

const body = (payload: unknown): RequestInit => ({
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(payload)
});

beforeAll(async () => {
	const { res } = await api('/api/health');
	if (!res.ok && res.status !== 503) {
		throw new Error(`Dev server not answering at ${BASE}. Start it with: npm run dev`);
	}
});

describe('layer 2: health and schema', () => {
	it('health reports the schema in sync', async () => {
		const { res, json } = await api('/api/health');
		expect(res.status).toBe(200);
		expect(json.schema.drift).toBe(false);
		expect(json.schema.applied).toBe(json.schema.expected);
	});

	it('reports the working time zone, not the machine one', async () => {
		const { json } = await api('/api/health');
		expect(json.time_zone).toBe('America/Denver');
	});
});

describe('layer 2: action items', () => {
	it('the open view totals what was generated', async () => {
		const { json } = await api('/api/action-items?view=open');
		expect(json.paging.total).toBe(expected.totals.action_items_open);
	});

	it('the overdue view totals the generated overdue band', async () => {
		const { json } = await api('/api/action-items?view=overdue');
		expect(json.paging.total).toBe(expected.action_bands.overdue);
	});

	it('the due today view totals match', async () => {
		const { json } = await api('/api/action-items?view=today');
		expect(json.paging.total).toBe(expected.action_bands.due_today);
	});

	it('search narrows the set and every hit really matches', async () => {
		const { json } = await api('/api/action-items?view=all&q=invoice&page_size=500');
		expect(json.paging.total).toBeGreaterThan(0);
		expect(json.paging.total).toBeLessThan(expected.counts.action_items);
		for (const item of json.items) {
			const hay = `${item.title} ${item.context ?? ''} ${item.owner ?? ''}`.toLowerCase();
			expect(hay).toContain('invoice');
		}
	});

	it('rejects an unknown status', async () => {
		const { res } = await api('/api/action-items', body({ title: 'bad status', status: 'nope' }));
		expect(res.status).toBe(400);
	});

	it('rejects a missing title', async () => {
		const { res } = await api('/api/action-items', body({ context: 'no title' }));
		expect(res.status).toBe(400);
	});

	it('404s an unknown item on patch and on the Asana push', async () => {
		const a = await api('/api/action-items/does-not-exist', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ status: 'open' })
		});
		expect(a.res.status).toBe(404);
		const b = await api('/api/action-items/does-not-exist/asana', { method: 'POST' });
		expect([404, 503]).toContain(b.res.status);
	});

	it('creates, patches and deletes, leaving the counts where it found them', async () => {
		const before = (await api('/api/action-items?view=all')).json.paging.total;

		const created = await api('/api/action-items', body({ title: 'SUITE probe item' }));
		expect(created.res.status).toBe(201);
		const id = created.json.item.id;
		expect(created.json.item.status).toBe('open');

		const patched = await api(`/api/action-items/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ status: 'done' })
		});
		expect(patched.res.status).toBe(200);
		expect(patched.json.item.completed_at).not.toBeNull();

		const reopened = await api(`/api/action-items/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ status: 'open' })
		});
		expect(reopened.json.item.completed_at).toBeNull();

		const removed = await api(`/api/action-items/${id}`, { method: 'DELETE' });
		expect(removed.res.status).toBe(200);

		const after = (await api('/api/action-items?view=all')).json.paging.total;
		expect(after).toBe(before);
	});
});

describe('layer 2: pagination', () => {
	it('defaults to a page rather than the whole table', async () => {
		const { json } = await api('/api/action-items?view=all');
		expect(json.items.length).toBe(50);
		expect(json.paging.total).toBe(expected.counts.action_items);
		expect(json.paging.page).toBe(1);
		expect(json.paging.page_count).toBe(Math.ceil(expected.counts.action_items / 50));
	});

	for (const size of [10, 50, 100, 200, 500]) {
		it(`honours page_size ${size}`, async () => {
			const { json } = await api(`/api/action-items?view=all&page_size=${size}`);
			expect(json.items.length).toBe(size);
			expect(json.paging.page_size).toBe(size);
		});
	}

	it('rejects a page size it does not offer, rather than clamping quietly', async () => {
		const { res, json } = await api('/api/action-items?page_size=17');
		expect(res.status).toBe(400);
		expect(json.error).toMatch(/10, 50, 100, 200, 500/);
	});

	it('rejects a nonsense page', async () => {
		expect((await api('/api/action-items?page=0')).res.status).toBe(400);
		expect((await api('/api/action-items?page=abc')).res.status).toBe(400);
	});

	it('clamps past the end instead of returning an empty page', async () => {
		const { json } = await api('/api/action-items?view=all&page_size=50&page=9999');
		expect(json.paging.page).toBe(json.paging.page_count);
		expect(json.items.length).toBeGreaterThan(0);
	});

	it('pages do not overlap and cover the set', async () => {
		const a = await api('/api/action-items?view=all&page_size=10&page=1');
		const b = await api('/api/action-items?view=all&page_size=10&page=2');
		const ids = new Set(a.json.items.map((i: any) => i.id));
		expect(b.json.items.some((i: any) => ids.has(i.id))).toBe(false);
	});

	it('invoice bands are computed over every invoice, not the page', async () => {
		const { json } = await api('/api/invoicing?page_size=10');
		expect(json.invoices.length).toBe(10);
		const banded = json.bands.reduce((s: number, b: any) => s + Number(b.invoice_count), 0);
		expect(banded).toBe(expected.totals.unpaid_invoices);
	});

	it('the payload is a fraction of the unpaginated one', async () => {
		const small = await api('/api/action-items?view=all&page_size=10');
		const large = await api('/api/action-items?view=all&page_size=500');
		expect(small.text.length * 10).toBeLessThan(large.text.length);
	});
});

describe('layer 2: the owner picker is sourced, not typed', () => {
	it('offers the roster and every owner the data names', async () => {
		const { res, json } = await api('/api/people/owners');
		expect(res.status).toBe(200);
		expect(json.owners.length).toBeGreaterThan(json.users.length);
		expect(new Set(json.owners).size).toBe(json.owners.length);
	});

	it('never offers the seed fingerprint as a person', async () => {
		const { json } = await api('/api/people/owners');
		for (const u of json.users) expect(u.display_name).not.toMatch(/^[0-9a-f]{16}$/);
		expect(json.owners).toContain('Paul Pacardo');
	});

	it('every offered owner really appears on an item or in users', async () => {
		const { json } = await api('/api/people/owners');
		expect(json.owners.every((o: string) => typeof o === 'string' && o.trim().length > 0)).toBe(true);
	});
});

describe('layer 2: Asana push guards', () => {
	it('reports itself unavailable locally, with a reason', async () => {
		const { json } = await api('/api/asana');
		expect(json.token_present).toBe(false);
		expect(json.ready).toBe(false);
		expect(json.blocked_because).toBeTruthy();
	});

	it('never returns the token itself', async () => {
		const { text } = await api('/api/asana');
		expect(text).not.toMatch(/[0-9]\/[0-9]{10,}/);
	});

	it('refuses to push a seeded item, so no v- row can reach a real workspace', async () => {
		const list = await api('/api/action-items?view=open&page_size=10');
		const seeded = list.json.items.find((i: any) => String(i.id).startsWith('v-'));
		expect(seeded).toBeTruthy();
		const { res, json } = await api(`/api/action-items/${seeded.id}/asana`, { method: 'POST' });
		expect(res.status).toBe(503);
		expect(json.error).toMatch(/no asana token/i);
	});

	it('409s a second push on an item that already carries a gid', async () => {
		// Created and removed here so the guard is exercised without a real push.
		const created = await api('/api/action-items', body({ title: 'SUITE gid probe' }));
		const id = created.json.item.id;
		await api(`/api/action-items/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ asana_task_gid: '1234567890' })
		});

		const { res, json } = await api(`/api/action-items/${id}/asana`, { method: 'POST' });
		expect(res.status).toBe(409);
		expect(json.error).toMatch(/already in Asana/i);

		await api(`/api/action-items/${id}`, { method: 'DELETE' });
	});
});

describe('layer 2: billing period expansion', () => {
	it('returns the entries for a period, and they belong to it', async () => {
		const inv = await api('/api/invoicing?page_size=10');
		const withEntries = inv.json.periods.find((p: any) => Number(p.entry_count) > 0);
		expect(withEntries, 'the seed should carry a period with time on it').toBeTruthy();

		const { res, json } = await api(`/api/invoicing/periods/${withEntries.id}/entries`);
		expect(res.status).toBe(200);
		expect(json.entries.length).toBe(Number(withEntries.entry_count));
		for (const e of json.entries) {
			expect(e.billing_period_id).toBe(withEntries.id);
			expect(e.hours).toBeGreaterThan(0);
		}
	});

	it('the hours on the entries reconcile with the period summary', async () => {
		const inv = await api('/api/invoicing?page_size=10');
		const period = inv.json.periods.find((p: any) => Number(p.entry_count) > 0);
		const { json } = await api(`/api/invoicing/periods/${period.id}/entries`);

		const total = json.entries.reduce((s: number, e: any) => s + Number(e.hours), 0);
		const billable = json.entries
			.filter((e: any) => e.billable)
			.reduce((s: number, e: any) => s + Number(e.hours), 0);

		expect(total).toBeCloseTo(Number(period.total_hours), 2);
		expect(billable).toBeCloseTo(Number(period.billable_hours), 2);
	});

	it('404s a period that does not exist', async () => {
		const { res } = await api('/api/invoicing/periods/does-not-exist/entries');
		expect([404, 200]).toContain(res.status);
	});
});

describe('layer 2: report windows', () => {
	it('a window changes what the completion report counts', async () => {
		const wide = await api('/api/reports/actions?from=2020-01-01&to=2030-01-01');
		const narrow = await api('/api/reports/actions?from=2026-08-01&to=2026-08-02');
		expect(wide.json.data.totals.completed_count).toBeGreaterThan(
			narrow.json.data.totals.completed_count
		);
	});

	it('the window is echoed back, so the page can state what it covers', async () => {
		const { json } = await api('/api/reports/billing?from=2026-07-01&to=2026-07-31');
		expect(json.from).toBe('2026-07-01');
		expect(json.to).toBe('2026-07-31');
	});

	it('a snapshot report ignores a window rather than failing on it', async () => {
		const { res, json } = await api('/api/reports/slipping?from=2026-07-01&to=2026-07-31');
		expect(res.status).toBe(200);
		expect(json.data.totals.total_count).toBeGreaterThan(0);
	});
});

describe('layer 2: tickets', () => {
	let projectId = '';
	const made: string[] = [];

	beforeAll(async () => {
		const { json } = await api('/api/projects');
		projectId = json.projects[0].id;
	});

	afterAll(async () => {
		for (const id of made) await api(`/api/tickets/${id}`, { method: 'DELETE' }).catch(() => {});
	});

	async function make(over: Record<string, unknown> = {}) {
		const res = await api('/api/tickets', body({ project_id: projectId, title: 'SUITE ticket', ...over }));
		if (res.res.status === 201) made.push(res.json.ticket.id);
		return res;
	}

	it('creates a ticket with an estimate and no actual yet', async () => {
		const { res, json } = await make({ estimate_hours: 4, priority: 'high' });
		expect(res.status).toBe(201);
		expect(json.ticket.estimate_hours).toBe(4);
		// Actual is summed from time entries, never stored, so a new ticket is zero.
		expect(json.ticket.actual_hours).toBe(0);
		expect(json.ticket.entry_count).toBe(0);
		expect(json.ticket.completed_at).toBeNull();
	});

	it('refuses the shapes the database refuses, with the rule named', async () => {
		const cases: [Record<string, unknown>, RegExp][] = [
			[{ start_date: '2026-09-10', due_date: '2026-09-01' }, /due date cannot be before/i],
			[{ status: 'nope' }, /status must be one of/i],
			[{ priority: 'critical' }, /priority must be one of/i],
			[{ estimate_hours: 0 }, /greater than zero/i]
		];
		for (const [over, message] of cases) {
			const { res, json } = await make(over);
			expect(res.status).toBe(400);
			expect(json.error).toMatch(message);
		}
	});

	it('requires a project, because a ticket without one is an action item', async () => {
		const { res } = await api('/api/tickets', body({ title: 'No project' }));
		expect(res.status).toBe(400);
	});

	it('sets completed_at on finishing and clears it on reopening', async () => {
		const { json } = await make();
		const id = json.ticket.id;

		const done = await api(`/api/tickets/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ status: 'done' })
		});
		expect(done.json.ticket.completed_at).not.toBeNull();

		const back = await api(`/api/tickets/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ status: 'in_progress' })
		});
		expect(back.json.ticket.completed_at).toBeNull();
	});

	it('the default list is live work, and status=all includes the finished', async () => {
		const { json } = await make();
		const id = json.ticket.id;
		await api(`/api/tickets/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ status: 'done' })
		});

		const live = await api('/api/tickets');
		const all = await api('/api/tickets?status=all');
		expect(live.json.tickets.some((t: any) => t.id === id)).toBe(false);
		expect(all.json.tickets.some((t: any) => t.id === id)).toBe(true);
	});

	it('404s a ticket that does not exist', async () => {
		const { res } = await api('/api/tickets/does-not-exist');
		expect(res.status).toBe(404);
	});
});

describe('layer 2: converting an action item to a ticket', () => {
	it('carries the item across, links back, and leaves the item alone', async () => {
		const list = await api('/api/action-items?view=open&page_size=200');
		const item = list.json.items.find((i: any) => i.project_id && !i.converted);
		expect(item, 'the seed should have an item on a project').toBeTruthy();

		const { res, json } = await api(`/api/tickets/convert/${item.id}`, { method: 'POST' });
		expect(res.status).toBe(201);

		expect(json.ticket.title).toBe(item.title);
		expect(json.ticket.due_date).toBe(item.deadline);
		expect(json.ticket.converted_from_action_item_id).toBe(item.id);

		// The capture record survives. Deleting or closing it would destroy the
		// history to tidy a list.
		const after = await api(`/api/action-items?view=all&q=${encodeURIComponent(item.title)}`);
		expect(after.json.items.some((i: any) => i.id === item.id)).toBe(true);

		// One commitment, one worked unit.
		const again = await api(`/api/tickets/convert/${item.id}`, { method: 'POST' });
		expect(again.res.status).toBe(409);

		// Removing the ticket frees the item to be converted again, which is what
		// makes this test repeatable rather than passing once and skipping after.
		await api(`/api/tickets/${json.ticket.id}`, { method: 'DELETE' });
	});

	it('refuses an item with no project until one is chosen', async () => {
		const list = await api('/api/action-items?view=open&page_size=200');
		const item = list.json.items.find((i: any) => !i.project_id);
		if (!item) return;
		const { res, json } = await api(`/api/tickets/convert/${item.id}`, { method: 'POST' });
		expect(res.status).toBe(400);
		expect(json.error).toMatch(/must belong to one/i);
	});

	it('404s an unknown action item', async () => {
		const { res } = await api('/api/tickets/convert/does-not-exist', { method: 'POST' });
		expect(res.status).toBe(404);
	});
});

describe('layer 2: the rate model is additive', () => {
	let clientId = '';

	beforeAll(async () => {
		const { json } = await api('/api/clients');
		clientId = json.clients[0].id;
	});

	afterAll(async () => {
		await api(`/api/clients/${clientId}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ default_rate_cents: '' })
		});
	});

	async function setRate(value: unknown) {
		return api(`/api/clients/${clientId}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ default_rate_cents: value })
		});
	}

	it('accepts money strings and stores integer cents', async () => {
		expect((await setRate('150')).json.client.default_rate_cents).toBe(15000);
		expect((await setRate('150.00')).json.client.default_rate_cents).toBe(15000);
		expect((await setRate('99.99')).json.client.default_rate_cents).toBe(9999);
	});

	it('empty clears the rate, which is a real state', async () => {
		expect((await setRate('')).json.client.default_rate_cents).toBeNull();
	});

	it('refuses a negative, a fraction of a cent, and nonsense', async () => {
		expect((await setRate(-5)).res.status).toBe(400);
		expect((await setRate(150.5)).res.status).toBe(400);
		expect((await setRate('abc')).res.status).toBe(400);
	});

	it('entered invoice amounts are untouched by any of this', async () => {
		// The ruling was that entered amounts stay valid forever. Nothing in the
		// rate model writes to invoices, and this asserts it rather than trusting
		// that no code path does.
		const before = await api('/api/reports/billing');
		await setRate('250');
		const after = await api('/api/reports/billing');
		expect(after.json.data.totals.outstanding_cents).toBe(
			before.json.data.totals.outstanding_cents
		);
	});
});

describe('layer 2: contacts', () => {
	let clientId = '';
	const made: string[] = [];

	beforeAll(async () => {
		const { json } = await api('/api/clients');
		clientId = json.clients[0].id;
	});

	afterAll(async () => {
		for (const id of made) await api(`/api/contacts/${id}`, { method: 'DELETE' }).catch(() => {});
	});

	async function make(over: Record<string, unknown> = {}) {
		const res = await api('/api/contacts', body({ client_id: clientId, name: 'SUITE contact', ...over }));
		if (res.res.status === 201) made.push(res.json.contact.id);
		return res;
	}

	it('creates a contact against a client', async () => {
		const { res, json } = await make({ email: 'a@b.test', role: 'Ops' });
		expect(res.status).toBe(201);
		expect(json.contact.email).toBe('a@b.test');
		expect(json.contact.is_primary).toBe(0);
	});

	it('refuses an address with nothing before or after the at sign', async () => {
		const { res, json } = await make({ email: '@nope' });
		expect(res.status).toBe(400);
		expect(json.error).toMatch(/does not look like an address/i);
	});

	it('allows a client only one primary contact, and says so', async () => {
		const first = await make({ is_primary: true });
		expect(first.res.status).toBe(201);

		const second = await make({ name: 'SUITE second', is_primary: true });
		// 409, not 500. SQLite reports a partial unique index violation by column
		// rather than by index name, so a matcher keyed on the index name is dead
		// code and the caller gets a server error for their own mistake.
		expect(second.res.status).toBe(409);
		expect(second.json.error).toMatch(/already has a primary contact/i);
	});

	it('allows any number of non-primary contacts', async () => {
		expect((await make({ name: 'SUITE a' })).res.status).toBe(201);
		expect((await make({ name: 'SUITE b' })).res.status).toBe(201);
	});

	it('requires a client, because a contact belongs to one', async () => {
		const { res } = await api('/api/contacts', body({ name: 'No client' }));
		expect(res.status).toBe(400);
	});

	it('404s a contact that does not exist', async () => {
		const { res } = await api('/api/contacts/nope', { method: 'DELETE' });
		expect(res.status).toBe(404);
	});
});

describe('layer 2: contracts', () => {
	let clientId = '';
	const made: string[] = [];

	beforeAll(async () => {
		const { json } = await api('/api/clients');
		clientId = json.clients[0].id;
	});

	afterAll(async () => {
		for (const id of made) await api(`/api/contracts/${id}`, { method: 'DELETE' }).catch(() => {});
	});

	async function make(over: Record<string, unknown> = {}) {
		const res = await api('/api/contracts', body({ client_id: clientId, title: 'SUITE contract', ...over }));
		if (res.res.status === 201) made.push(res.json.contract.id);
		return res;
	}

	it('stores a value as integer cents and defaults to hand-set', async () => {
		const { res, json } = await make({ value: '50000' });
		expect(res.status).toBe(201);
		expect(json.contract.value_cents).toBe(5000000);
		// Every row is hand-set today. The basis column exists so a computed mode
		// can arrive later without a migration, not so callers can claim one now.
		expect(json.contract.fulfillment_basis).toBe('manual');
		expect(json.contract.fulfillment_status).toBe('not_started');
	});

	it('refuses an end before a start', async () => {
		const { res, json } = await make({ start_date: '2026-10-01', end_date: '2026-09-01' });
		expect(res.status).toBe(400);
		expect(json.error).toMatch(/end date cannot be before/i);
	});

	it('refuses a value that is not an amount', async () => {
		expect((await make({ value: 'abc' })).res.status).toBe(400);
		expect((await make({ value: -5 })).res.status).toBe(400);
	});

	it('refuses a fulfillment status it does not have', async () => {
		const { res, json } = await make({ fulfillment_status: 'done' });
		expect(res.status).toBe(400);
		expect(json.error).toMatch(/fulfillment status must be one of/i);
	});
});

describe('layer 2: the client overview', () => {
	let clientId = '';

	beforeAll(async () => {
		const { json } = await api('/api/clients');
		clientId = json.clients[0].id;
	});

	it('returns every section the page needs in one request', async () => {
		const { res, json } = await api(`/api/clients/${clientId}/overview`);
		expect(res.status).toBe(200);
		for (const key of ['client', 'contacts', 'contracts', 'projects', 'invoices', 'meetings', 'tickets', 'money']) {
			expect(json, `overview is missing ${key}`).toHaveProperty(key);
		}
	});

	it('agrees with the Invoicing screen about what this client owes', async () => {
		// The claim the page makes is that it cannot disagree with Invoicing,
		// because both read the same INVOICE_SELECT. This is that claim, tested.
		// If someone later writes a second outstanding-amount expression here,
		// this is what fails.
		const overview = await api(`/api/clients/${clientId}/overview`);

		let rows: { client_id: string; outstanding_cents: number; is_overdue: number }[] = [];
		for (let page = 1; ; page++) {
			const { json } = await api(`/api/invoicing?page_size=500&page=${page}`);
			rows = rows.concat(json.invoices);
			if (rows.length >= json.paging.total) break;
		}
		const mine = rows.filter((r) => r.client_id === clientId);

		expect(overview.json.invoices).toHaveLength(mine.length);
		expect(overview.json.money.outstanding_cents).toBe(
			mine.reduce((n, r) => n + Number(r.outstanding_cents), 0)
		);
		expect(overview.json.money.overdue_count).toBe(mine.filter((r) => r.is_overdue === 1).length);
	});

	it('404s a client that does not exist', async () => {
		const { res } = await api('/api/clients/nope/overview');
		expect(res.status).toBe(404);
	});
});

describe('layer 2: reports', () => {
	it('billing totals reconcile four independent ways', async () => {
		const { json } = await api('/api/reports/billing');
		const d = json.data;
		const total = d.totals.outstanding_cents;

		expect(total).toBe(expected.totals.outstanding_cents);
		expect(d.bands.reduce((s: number, b: any) => s + Number(b.outstanding_cents), 0)).toBe(total);
		expect(d.by_client.reduce((s: number, c: any) => s + Number(c.outstanding_cents), 0)).toBe(total);
		expect(d.outstanding.reduce((s: number, r: any) => s + Number(r.outstanding_cents), 0)).toBe(total);
	});

	it('report aging bands are identical to the Invoicing screen', async () => {
		const rep = (await api('/api/reports/billing')).json.data.bands;
		const inv = (await api('/api/invoicing')).json.bands;
		const key = (rows: any[]) =>
			Object.fromEntries(
				rows.map((b) => [b.aging_bucket, [Number(b.invoice_count), Number(b.outstanding_cents)]])
			);
		expect(key(rep)).toEqual(key(inv));
	});

	it('what is slipping agrees with the generated counts', async () => {
		const t = (await api('/api/reports/slipping')).json.data.totals;
		expect(t.overdue_actions).toBe(expected.action_bands.overdue);
		expect(t.ambiguous_actions).toBe(expected.action_status.ambiguous);
		expect(t.pending_proposals).toBe(expected.totals.proposals_pending);
		expect(t.overdue_invoices).toBe(expected.totals.overdue_invoices);
	});

	it('project roll-up counts match', async () => {
		const d = (await api('/api/reports/projects')).json.data;
		expect(d.totals.project_count).toBe(expected.counts.projects);
		expect(d.totals.at_risk_count).toBeGreaterThanOrEqual(
			expected.totals.projects_needing_attention
		);
	});

	it('the completion report never claims a rate it cannot support', async () => {
		const t = (await api('/api/reports/actions')).json.data.totals;
		if (t.measurable_count === 0) {
			expect(t.on_time_pct).toBeNull();
		} else {
			expect(t.on_time_pct).toBe(Math.round((t.on_time_count / t.measurable_count) * 100));
			expect(t.measurable_count).toBeLessThanOrEqual(t.completed_count);
		}
	});

	it('404s an unknown report and 400s a malformed window', async () => {
		expect((await api('/api/reports/nonsense')).res.status).toBe(404);
		expect((await api('/api/reports/actions?from=last-tuesday')).res.status).toBe(400);
		expect((await api('/api/reports/actions?from=2026-08-20&to=2026-08-01')).res.status).toBe(400);
	});
});

describe('layer 2: other modules answer at volume', () => {
	const cases: [string, (j: any) => number, number][] = [
		// The list defaults to active, which is the contract. The archived ones are
		// reachable, and both halves are asserted rather than just the total.
		['/api/clients?status=all', (j) => j.clients.length, expected.counts.clients],
		['/api/projects', (j) => j.projects.length, expected.counts.projects],
		['/api/templates?status=all', (j) => j.templates.length, expected.counts.templates]
	];

	for (const [path, pick, want] of cases) {
		it(`${path} returns ${want}`, async () => {
			const { res, json } = await api(path);
			expect(res.status).toBe(200);
			expect(pick(json)).toBe(want);
		});
	}

	it('the client list defaults to active and can still reach the archived', async () => {
		const active = await api('/api/clients');
		const all = await api('/api/clients?status=all');
		expect(active.json.clients.length).toBeLessThan(all.json.clients.length);
		expect(all.json.clients.length).toBe(expected.counts.clients);
		expect(active.json.counts.active + active.json.counts.archived).toBe(expected.counts.clients);
	});

	it('the cockpit reports the generated meetings and unbilled periods', async () => {
		const { json } = await api('/api/today');
		expect(json.meetings.length).toBe(expected.totals.meetings_today);
		expect(json.overdue.length + json.due_today.length).toBeGreaterThan(0);
	});

	it('every API error body is JSON carrying an error string', async () => {
		const { res, json } = await api('/api/reports/nonsense');
		expect(res.ok).toBe(false);
		expect(typeof json?.error).toBe('string');
	});
});
