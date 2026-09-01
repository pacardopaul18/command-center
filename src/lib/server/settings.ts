import type { KVNamespace } from '@cloudflare/workers-types';
import { DEFAULT_SETTINGS, readSettings, type Settings } from '$lib/settings';

/**
 * Reading and writing the settings object.
 *
 * One key, one JSON object, written whole. Per-key entries would mean a read
 * per setting on every page load, and KV charges by the read.
 *
 * `readSettings` runs on the way out as well as on the way in, so a value
 * written by an older version of the app, or by hand, is narrowed to something
 * the code can rely on. A settings store that can return a shape the app does
 * not expect is a store that eventually crashes a page nobody was editing.
 */

const KEY = 'settings:v1';

export async function getSettings(kv: KVNamespace): Promise<Settings> {
	const raw = await kv.get(KEY, 'json').catch(() => null);
	return readSettings(raw);
}

/**
 * Merges a patch over what is stored and writes the whole object back.
 *
 * A patch rather than a replace, so a screen that only knows about six settings
 * cannot silently clear the seventh when a later version adds one.
 */
export async function saveSettings(
	kv: KVNamespace,
	patch: Record<string, unknown>
): Promise<Settings> {
	const current = await getSettings(kv);
	const merged = readSettings({ ...current, ...patch });
	await kv.put(KEY, JSON.stringify(merged));
	return merged;
}

/**
 * Settings for code that runs without a request, and cannot fail because of them.
 *
 * The scheduled handler reads these to decide whether to send a digest. If KV
 * is unreachable the digest must still go: a preference store being down is not
 * a reason to stop the one thing this app does on a timer, and defaults are
 * exactly the behaviour it had before settings existed.
 */
export async function getSettingsOrDefaults(kv: KVNamespace | undefined): Promise<Settings> {
	if (!kv) return DEFAULT_SETTINGS;
	try {
		return await getSettings(kv);
	} catch {
		return DEFAULT_SETTINGS;
	}
}
