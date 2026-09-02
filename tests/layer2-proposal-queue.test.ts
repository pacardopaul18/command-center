import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:5173';
const ROOT = process.cwd();

function code(...parts: string[]): string {
	return readFileSync(join(ROOT, ...parts), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const actionItems = code('src', 'lib', 'server', 'api', 'action-items.ts');
const meetingAi = code('src', 'lib', 'server', 'api', 'meeting-ai.ts');
const page = readFileSync(join(ROOT, 'src', 'routes', 'actions', '+page.svelte'), 'utf8');

/**
 * The review queue is on the page the reviewing is for.
 *
 * Proposals were reviewable only on the screen that produced them, so the loop
 * was invisible from the one page that says what Paul owes people. A queue
 * nobody passes is a queue nobody empties.
 */

describe('layer 2: one queue, whatever produced the row', () => {
	it('returns proposals from both sources with their counts', async () => {
		const res = await fetch(`${BASE}/api/action-items/proposals?status=pending`);
		expect(res.ok, 'the queue route is unreachable').toBe(true);

		const body = (await res.json()) as {
			proposals: { source: string }[];
			counts: { pending: number; accepted: number; rejected: number };
		};
		expect(Array.isArray(body.proposals)).toBe(true);
		for (const key of ['pending', 'accepted', 'rejected']) {
			expect(typeof body.counts[key as keyof typeof body.counts]).toBe('number');
		}
		for (const p of body.proposals) expect(['mail', 'meeting']).toContain(p.source);
	});

	it('is declared above the parameterised route, or it is unreachable', () => {
		/*
		 * Hono matches in definition order, so a literal path declared after a
		 * parameterised one never runs. `/proposals` was being caught by `/:id`
		 * and answering "Action item not found" for a route that existed and was
		 * correct. Nothing errored at build time and the handler was simply never
		 * called, which is why this is asserted rather than remembered.
		 */
		const queue = actionItems.indexOf("actionItems.get('/proposals'");
		const byId = actionItems.indexOf("actionItems.get('/:id'");
		expect(queue).toBeGreaterThan(-1);
		expect(byId).toBeGreaterThan(-1);
		expect(queue, '/proposals is declared after /:id and can never be reached').toBeLessThan(byId);
	});

	it('rejects a source or decision it does not know', async () => {
		// D108: a named thing that is not one of the known ones is refused.
		for (const path of ['nowhere/x/accept', 'mail/x/maybe']) {
			const res = await fetch(`${BASE}/api/action-items/proposals/${path}`, { method: 'POST' });
			expect(res.status).toBe(400);
		}
	});

	it('404s a proposal that is not pending rather than acting on it', async () => {
		const res = await fetch(
			`${BASE}/api/action-items/proposals/mail/does-not-exist/accept`,
			{ method: 'POST' }
		);
		expect(res.status).toBe(404);
	});
});

describe('layer 2: both extraction paths refuse the same things', () => {
	it('offers no proposal without evidence, from a transcript either', () => {
		/*
		 * The mail path refused these from the start. The meeting path stored a
		 * null and offered the proposal anyway, so the two queues asked different
		 * things of the person reading them: one guaranteed a sentence to check
		 * and the other did not.
		 */
		expect(meetingAi).toMatch(/const usable = items\.filter\(\(item\) => Boolean\(item\.evidence/);
		expect(meetingAi).toMatch(/\.\.\.usable\.map\(\(item\)/);
	});

	it('says how many it dropped, so silence is not read as finding nothing', () => {
		// D138: extracted eight and offered six has to be sayable.
		expect(meetingAi).toMatch(/skipped_no_evidence: withoutEvidence/);
		expect(meetingAi).toMatch(/offered: usable\.length/);
	});
});

describe('layer 2: the reviewer can see what they are deciding about', () => {
	it('shows the evidence at the point of decision, not behind a click', () => {
		/*
		 * A reviewer deciding whether Paul really promised something needs the
		 * sentence in front of them. Making them open something first is how a
		 * queue gets cleared by accepting everything.
		 */
		expect(page).toMatch(/<blockquote class="evidence">\{proposal\.evidence\}<\/blockquote>/);
	});

	it('shows the words rather than inventing a date', () => {
		// An inferred deadline becomes a fact the moment somebody accepts.
		expect(page).toMatch(/said "\{proposal\.due_signal\}", no date given/);
	});

	it('says nothing here is an action item yet', () => {
		expect(page).toMatch(/until you accept it/);
	});

	it('disables only the row being decided', () => {
		// One shared busy flag would freeze the whole queue on every click.
		expect(page).toMatch(/disabled=\{reviewing === proposal\.id\}/);
	});
});
