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
	it('the open view returns what was generated', async () => {
		const { json } = await api('/api/action-items?view=open');
		expect(json.items.length).toBe(expected.totals.action_items_open);
	});

	it('the overdue view matches the generated overdue band', async () => {
		const { json } = await api('/api/action-items?view=overdue');
		expect(json.items.length).toBe(expected.action_bands.overdue);
	});

	it('the due today view matches', async () => {
		const { json } = await api('/api/action-items?view=today');
		expect(json.items.length).toBe(expected.action_bands.due_today);
	});

	it('search narrows the set and every hit really matches', async () => {
		const { json } = await api('/api/action-items?view=all&q=invoice');
		expect(json.items.length).toBeGreaterThan(0);
		expect(json.items.length).toBeLessThan(expected.counts.action_items);
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
		const before = (await api('/api/action-items?view=all')).json.items.length;

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

		const after = (await api('/api/action-items?view=all')).json.items.length;
		expect(after).toBe(before);
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
		const list = await api('/api/action-items?view=open');
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
