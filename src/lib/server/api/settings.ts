import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { readJsonObject } from './validate';
import { getSettings, saveSettings } from '../settings';
import { NOT_BUILT } from '$lib/settings';

/**
 * Settings: read the whole object, patch part of it.
 *
 * No per-key routes. A setting is never meaningful on its own, the object is
 * small, and a route per key would be twelve routes that all do the same thing
 * with a different string in them.
 *
 * The list of controls the prototype draws and this app does not build is
 * returned alongside, so the page can say why each is missing on the screen
 * where a reader went looking for it.
 */
export const settings = new Hono<ApiEnv>();

settings.get('/', async (c) => {
	return c.json({ settings: await getSettings(c.env.SESSIONS), not_built: NOT_BUILT });
});

settings.patch('/', async (c) => {
	const body = await readJsonObject(c.req.raw);
	/**
	 * Validation lives in `readSettings`, which runs on the way in and on the
	 * way out. A value this route accepted but the reader rejected would be
	 * stored and then ignored, which is the same silent lie a dead toggle is.
	 */
	return c.json({ settings: await saveSettings(c.env.SESSIONS, body) });
});
