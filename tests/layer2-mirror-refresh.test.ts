import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function code(...parts: string[]): string {
	return readFileSync(join(ROOT, ...parts), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const mirror = code('src', 'lib', 'server', 'asana-mirror.ts');
const scheduled = code('src', 'lib', 'server', 'scheduled.ts');

/**
 * The mirror stays current, and says how current it is.
 *
 * The accuracy audit found the app faithful to the mirror and the mirror two
 * days behind Asana: the full pull was a snapshot and nothing re-pulled. Eleven
 * tasks and one status across twelve projects, with nothing on any screen
 * saying the data was old. These tests cover both halves, because a refresh
 * nobody can see the age of leaves the second half unfixed.
 */

describe('layer 2: the refresh never opens a hole', () => {
	it('moves the watermark only after the sweep finishes', () => {
		/*
		 * A watermark moved before the work completes opens a gap exactly the size
		 * of whatever failed, and nothing would ever look for those rows again.
		 * Both early returns leave it where it was.
		 */
		const body = mirror.split('export async function refreshMirror')[1];
		const update = body.indexOf('SET refreshed_at = ?, refresh_watermark = ?');
		const budgetExit = body.indexOf('Budget spent part way through');
		expect(update).toBeGreaterThan(-1);
		expect(budgetExit).toBeGreaterThan(-1);
		expect(
			budgetExit < update,
			'the budget exit must return before the watermark is written'
		).toBe(true);
	});

	it('stamps the watermark from when it started, not when it ended', () => {
		// Anything modified while the refresh runs must be caught next time
		// rather than fall between the two.
		expect(mirror).toMatch(/const startedAt = nowUtc\(\);/);
		expect(mirror).toMatch(/\.bind\(startedAt, startedAt, nowUtc\(\), workspaceGid\)/);
	});

	it('overlaps the window rather than trusting an exact boundary', () => {
		expect(mirror).toMatch(/REFRESH_OVERLAP_MS/);
		expect(mirror).toMatch(/Date\.parse\(base\) - REFRESH_OVERLAP_MS/);
	});

	it('refreshes archived projects too', () => {
		// 24 of 66 here are archived. A live-only refresh lets a third of the
		// workspace drift while reporting itself current. D172.
		const body = mirror.split('export async function refreshMirror')[1];
		expect(body).toMatch(/for \(const archived of \[false, true\]\)/);
	});

	it('stands down rather than interleaving with an unfinished pull', () => {
		expect(mirror).toMatch(/state\.phase !== 'done'/);
		expect(mirror).toMatch(/stood down/);
	});

	it('says why it did nothing, whenever it does nothing', () => {
		// D138: a quiet refresh and a refused one both return zeros.
		for (const reason of [
			'No Asana token is configured',
			'never been pulled',
			'stood down',
			'Nothing has changed'
		]) {
			expect(mirror.includes(reason), `no detail for: ${reason}`).toBe(true);
		}
	});
});

describe('layer 2: the refresh is a passenger, not a priority', () => {
	it('runs after mail, never instead of it', () => {
		/*
		 * D107 is about a dispatcher starving the work it exists for. Mail was
		 * already a passenger behind digests and backups; this rides behind mail.
		 */
		const body = scheduled.split('async function passengers()')[1];
		expect(body.indexOf('mailWork()')).toBeLessThan(body.indexOf('mirrorWork()'));
	});

	it('takes a share of a firing rather than the whole of it', () => {
		expect(scheduled).toMatch(/const MIRROR_CALL_SHARE = 45;/);
	});

	it('cannot fail the firing it rides on', () => {
		// A refresh that threw would take a digest or a backup with it.
		const body = scheduled.split('async function mirrorWork()')[1].split('async function passengers')[0];
		expect(body).toMatch(/try \{/);
		expect(body).toMatch(/catch \(err\)/);
		expect(body).not.toMatch(/throw err/);
	});
});

describe('layer 2: staleness is shown, never inferred', () => {
	const component = readFileSync(
		join(ROOT, 'src', 'lib', 'components', 'MirrorFreshness.svelte'),
		'utf8'
	);

	it('reports the age of the data in words', () => {
		// "1,647 minutes" is a number nobody converts in their head.
		expect(component).toMatch(/days ago|hours ago/);
	});

	it('offers a way to make it current', () => {
		// A screen that is hours old with no way to refresh it is a screen
		// somebody stops trusting rather than one they wait on.
		expect(component).toMatch(/\/api\/asana\/refresh/);
	});

	it('marks stale without using the overdue colour', () => {
		// D20 keeps --red for overdue and nothing else. Old data is not an error.
		expect(component).toMatch(/--gold-100/);
		const staleRule = component.split('.freshness.stale')[1]?.split('}')[0] ?? '';
		expect(staleRule).not.toMatch(/--red/);
	});

	it('is on the screen the audit was about', () => {
		const page = readFileSync(join(ROOT, 'src', 'routes', 'projects', '+page.svelte'), 'utf8');
		expect(page).toMatch(/<MirrorFreshness freshness=\{data\.freshness\}/);
	});
});
