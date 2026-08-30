import { Hono } from 'hono';
import type { ApiEnv } from './env';

/**
 * Who can own an action item.
 *
 * Two sources, deliberately. The `users` table is the roster, and the distinct
 * owner strings already stored on action items are everyone the data has
 * actually named. A picker built only from `users` would fail to match most of
 * the existing rows, and a picker that offered nothing but free text is what
 * this replaces.
 *
 * The seed metadata row is excluded by role. It is a fingerprint, not a person,
 * and it has no business appearing in a dropdown.
 */
export const people = new Hono<ApiEnv>();

people.get('/owners', async (c) => {
	const db = c.env.DB;

	const [users, owners] = await Promise.all([
		db
			.prepare(
				"SELECT id, display_name FROM users WHERE role != 'seed-metadata' ORDER BY display_name COLLATE NOCASE"
			)
			.all<{ id: string; display_name: string }>(),
		db
			.prepare(
				`SELECT DISTINCT owner FROM action_items
         WHERE owner IS NOT NULL AND TRIM(owner) != ''
         ORDER BY owner COLLATE NOCASE`
			)
			.all<{ owner: string }>()
	]);

	const roster = (users.results ?? []).map((u) => u.display_name);
	const seen = new Set(roster.map((n) => n.toLowerCase()));
	const others = (owners.results ?? [])
		.map((r) => r.owner)
		.filter((name) => !seen.has(name.toLowerCase()));

	return c.json({
		users: users.results ?? [],
		// Roster first, then everyone the data names, so the people who are
		// really in the system sort above historical strings.
		owners: [...roster, ...others]
	});
});
