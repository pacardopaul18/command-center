import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:5173';

/**
 * Where a digest goes, and what it says about the preference it overrode.
 *
 * Two findings from the write-capable path audit, both about the same thing:
 * a send is an outward-facing act, and every fact governing it has to be
 * visible rather than compiled in or silently bypassed.
 */

const ROOT = process.cwd();

/** Code with the prose removed, so a comment explaining a rule cannot satisfy it. */
function code(...parts: string[]): string {
	return readFileSync(join(ROOT, ...parts), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('layer 2: a digest has no fallback recipient', () => {
	const digest = code('src', 'lib', 'server', 'digest.ts');
	const route = code('src', 'lib', 'server', 'api', 'digests.ts');

	it('has no address written into the source', () => {
		/*
		 * The old fallback was Paul's own address, so the behaviour was right and
		 * that was luck rather than design. A destination that survives a
		 * configuration mistake is a destination nobody chose, and mail arriving
		 * on the strength of a line in the source is not something anybody can
		 * explain afterwards. Same family as D108.
		 *
		 * Deliberately blunt: any address at all in either file fails, so a later
		 * "temporary" default has to argue with this test.
		 */
		const address = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

		for (const [name, text] of [
			['digest.ts', digest],
			['api/digests.ts', route]
		] as const) {
			const found = (text.match(address) ?? []).filter(
				// Resend's sandbox sender is allowed and is the opposite case: an
				// unset sender narrows where mail can go, because that domain only
				// delivers to the account owner.
				(a) => a !== 'onboarding@resend.dev'
			);
			expect(
				found,
				`${name} carries an email address. A digest recipient comes from DIGEST_TO ` +
					'or the send is refused; it is never compiled in.'
			).toEqual([]);
		}
	});

	it('refuses the send rather than choosing somebody', () => {
		expect(digest).toMatch(/status: 'skipped_no_recipient'/);
		expect(digest).toMatch(/DIGEST_TO is not set/);
		// And the refusal is a named outcome, not a bare false. D138.
		expect(digest).toMatch(/'skipped_no_recipient'/);
	});

	it('reports the recipient that is configured, from the same place the sender reads', async () => {
		/*
		 * DIGEST_TO is set in wrangler.toml, so the fallback that was removed was
		 * latent rather than active: it would only have fired if somebody deleted
		 * the var. That is still worth removing, because the failure it produced
		 * would have been mail going somewhere on the strength of a line in the
		 * source instead of a deployment failing loudly.
		 *
		 * So the assertion is that the screen reports configuration, and reports
		 * the same configuration the sender uses. A screen that could differ from
		 * the sender about where mail goes is the actual hazard.
		 */
		const configured = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8')
			.match(/^DIGEST_TO\s*=\s*"([^"]+)"/m)?.[1];

		const res = await fetch(`${BASE}/api/digests/status`);
		expect(res.ok).toBe(true);
		const body = (await res.json()) as { to: string | null };

		expect(
			body.to,
			'The status screen and wrangler.toml disagree about where digests go.'
		).toBe(configured ?? null);
	});

});

describe('layer 2: a manual send says what the preference says', () => {
	it('reads the same preference the cron reads', () => {
		const route = code('src', 'lib', 'server', 'api', 'digests.ts');
		const cron = code('src', 'lib', 'server', 'scheduled.ts');

		// Both sides read it from the same place. Two readers of one setting is
		// fine; two definitions of what the setting means is not.
		expect(cron).toMatch(/getSettingsOrDefaults/);
		expect(route).toMatch(/getSettingsOrDefaults/);
		for (const text of [route, cron]) {
			expect(text).toMatch(/kind === 'morning' \? prefs\.morning_digest : prefs\.evening_digest/);
		}
	});

	it('returns the preference state alongside what it did', async () => {
		// Dry run: the question is what the route reports, and asserting it by
		// sending real mail would be a strange way to check a safety property.
		const res = await fetch(`${BASE}/api/digests/preview?kind=morning`);
		expect([200, 404]).toContain(res.status);

		const route = code('src', 'lib', 'server', 'api', 'digests.ts');
		expect(route).toMatch(/scheduled_digest_enabled: scheduled/);
		// And when the two disagree it says so in words, because a boolean in a
		// payload is not an explanation.
		expect(route).toMatch(/is switched off in Settings/);
	});
});
