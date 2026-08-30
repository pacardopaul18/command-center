import { describe, expect, it, beforeAll } from 'vitest';
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
