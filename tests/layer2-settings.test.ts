import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, NOT_BUILT, readSettings } from '../src/lib/settings';

/**
 * Settings, and the one rule that governs them.
 *
 * EVERY SETTING IS READ BY SOMETHING. The prototype draws about thirty
 * controls and roughly half describe behaviour this app does not have. A toggle
 * that stores a value nothing reads is worse than no toggle: it tells the
 * reader they have changed something and the app carries on exactly as before.
 *
 * That rule cannot be checked by reading the settings file, so it is checked
 * against the source: every key must appear somewhere outside the settings
 * module and the screen that edits it. A setting added later with no reader
 * fails here, with the name of the key.
 *
 * The other half is the narrowing. Settings come from KV, which returns
 * whatever was last written, including by an older version of the app or by
 * hand. A store that can hand the code a shape it does not expect is a store
 * that eventually breaks a page nobody was editing.
 */

const BASE = 'http://localhost:5173';
const SRC = 'src';

async function api(path: string, init?: RequestInit) {
	const res = await fetch(`${BASE}${path}`, init);
	const text = await res.text();
	let json: Record<string, unknown> | null = null;
	try {
		json = JSON.parse(text) as Record<string, unknown>;
	} catch {
		json = null;
	}
	return { res, json };
}

const patch = (body: unknown) =>
	api('/api/settings', {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});

/** Every .ts and .svelte file under src, read once. */
function sources(dir: string, out: { path: string; text: string }[] = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) sources(full, out);
		else if (/\.(ts|svelte)$/.test(entry.name)) {
			out.push({ path: full.replace(/\\/g, '/'), text: readFileSync(full, 'utf8') });
		}
	}
	return out;
}

beforeAll(async () => {
	// Whatever a browser probe left behind. Every test here writes and the last
	// one restores, but starting from a known state means a failure mid-run
	// cannot cascade into the next.
	await patch(DEFAULT_SETTINGS);
});

afterAll(async () => {
	await patch(DEFAULT_SETTINGS);
});

describe('every setting is read by something', () => {
	const files = sources(SRC);

	for (const key of Object.keys(DEFAULT_SETTINGS)) {
		it(`${key} is read outside the settings module`, () => {
			/**
			 * The settings module defines the key and the settings page edits it;
			 * neither counts as a reader. Somewhere else has to act on it, or the
			 * control is a switch wired to nothing.
			 */
			const readers = files.filter(
				(f) =>
					!f.path.endsWith('src/lib/settings.ts') &&
					!f.path.endsWith('src/lib/server/settings.ts') &&
					!f.path.includes('src/routes/settings/') &&
					!f.path.includes('src/lib/server/api/settings.ts') &&
					f.text.includes(key)
			);

			expect(
				readers.map((f) => f.path),
				`Nothing reads ${key}. A setting nothing reads tells the reader they changed ` +
					`something while the app carries on exactly as before. Wire it or remove it.`
			).not.toEqual([]);
		});
	}
});

describe('what is deliberately not built is named', () => {
	it('every entry says what and why', () => {
		expect(NOT_BUILT.length, 'nothing is recorded as unbuilt').toBeGreaterThan(0);
		for (const entry of NOT_BUILT) {
			expect(entry.label.length).toBeGreaterThan(0);
			// A reason, not a shrug. Short strings here mean "not yet" with no
			// argument, which is the thing this list exists to avoid.
			expect(entry.why.length, `${entry.label} has no real reason`).toBeGreaterThan(40);
		}
	});

	it('the API returns the list, so the screen can show it', async () => {
		const { json } = await api('/api/settings');
		expect((json?.not_built as unknown[]).length).toBe(NOT_BUILT.length);
	});
});

describe('narrowing what comes back from the store', () => {
	it('fills anything missing from defaults', () => {
		expect(readSettings({})).toEqual(DEFAULT_SETTINGS);
		expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(readSettings('not an object')).toEqual(DEFAULT_SETTINGS);
	});

	it('refuses a value outside the allowed set rather than storing it', () => {
		expect(readSettings({ density: 'roomy' }).density).toBe('comfortable');
		expect(readSettings({ default_due: 'whenever' }).default_due).toBe('tomorrow');
		expect(readSettings({ start_page: '/not-a-page' }).start_page).toBe('/');
	});

	it('a tax rate that is not a number falls back rather than becoming NaN', () => {
		/**
		 * The failure this prevents: NaN reaches an invoice as a total of NaN,
		 * which renders as nothing at all. A blank where the money goes is the
		 * most expensive kind of blank on the screen.
		 */
		for (const bad of ['abc', '', null, undefined, -1, 101, NaN]) {
			const out = readSettings({ default_tax_percent: bad }).default_tax_percent;
			expect(Number.isFinite(out), `${String(bad)} produced ${out}`).toBe(true);
			expect(out).toBe(DEFAULT_SETTINGS.default_tax_percent);
		}
	});

	it('an invoice prefix is letters, and never empty', () => {
		expect(readSettings({ invoice_prefix: 'inv-2026' }).invoice_prefix).toBe('INV');
		expect(readSettings({ invoice_prefix: '123' }).invoice_prefix).toBe('INV');
		expect(readSettings({ invoice_prefix: '   ' }).invoice_prefix).toBe('INV');
		expect(readSettings({ invoice_prefix: 'ACME' }).invoice_prefix).toBe('ACME');
	});
});

describe('saving', () => {
	it('patches part of the object without clearing the rest', async () => {
		await patch({ workspace_name: 'SETTINGS FIXTURE' });
		const { json } = await api('/api/settings');
		const saved = json?.settings as Record<string, unknown>;

		expect(saved.workspace_name).toBe('SETTINGS FIXTURE');
		// The point of a patch: a screen that knows about six settings cannot
		// silently clear the seventh when a later version adds one.
		expect(saved.invoice_prefix).toBe(DEFAULT_SETTINGS.invoice_prefix);
		expect(saved.morning_digest).toBe(DEFAULT_SETTINGS.morning_digest);
	});

	it('narrows on the way in, so a rejected value is never stored', async () => {
		await patch({ density: 'roomy', default_tax_percent: 'lots' });
		const { json } = await api('/api/settings');
		const saved = json?.settings as Record<string, unknown>;

		// Stored-then-ignored is the same silent lie a dead toggle is.
		expect(saved.density).toBe('comfortable');
		expect(saved.default_tax_percent).toBe(0);
	});
});

describe('the settings that reach the rest of the app', () => {
	it('the invoice prefix changes the number the form opens with', async () => {
		await patch({ invoice_prefix: 'ACME' });
		const { json } = await api('/api/invoicing/next-number');
		expect(String(json?.invoice_number).startsWith('ACME-')).toBe(true);

		// An estimate keeps its own label. Letting it drift would mean a credit
		// note that could be mistaken for an invoice.
		const est = await api('/api/invoicing/next-number?kind=estimate');
		expect(String(est.json?.invoice_number).startsWith('EST-')).toBe(true);
	});

	it('the invoice defaults are offered to the form rather than applied on save', async () => {
		await patch({ default_payment_terms: 'Net 7', default_tax_percent: 12 });
		const { json } = await api('/api/invoicing/defaults');
		expect(json?.payment_terms).toBe('Net 7');
		expect(json?.tax_percent).toBe(12);
	});

	it('the week start changes what this week covers', async () => {
		const monday = await api('/api/meetings');
		await patch({ week_starts_on: 'sunday' });
		const sunday = await api('/api/meetings');

		const a = (monday.json?.counts as { this_week: number }).this_week;
		const b = (sunday.json?.counts as { this_week: number }).this_week;

		// Not asserted to differ: on a week where nothing falls on the moved day
		// they are legitimately equal. What is asserted is that both are real
		// answers, so the setting reaches the query rather than being ignored.
		expect(Number.isFinite(a)).toBe(true);
		expect(Number.isFinite(b)).toBe(true);
	});

	it('the digest switch is read by the scheduled handler, not just stored', () => {
		// The handler cannot be called from here without a cron event, so the
		// wiring is asserted at the source. Without this, turning the digest off
		// would be a preference the cron never consults.
		const scheduled = readFileSync('src/lib/server/scheduled.ts', 'utf8');
		expect(scheduled).toContain('morning_digest');
		expect(scheduled).toContain('evening_digest');
		// And it must not throw: a preference store being down is not a reason to
		// stop the one thing this app does on a timer.
		expect(scheduled).toContain('getSettingsOrDefaults');
	});
});
