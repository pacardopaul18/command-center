/**
 * Schema drift detection.
 *
 * The deploy model has a structural gap, found the hard way on 2026-08-29 when
 * /templates returned a 500 in production. Pushing to main auto-builds and
 * auto-deploys the Worker, but D1 migrations are applied by hand. A push that
 * carries both new code and a new migration therefore ships code that queries a
 * table the live database does not have yet, and the gap stays open until
 * somebody remembers to run the migration. Nothing in the system noticed. The
 * first signal was a 500 in Paul's browser.
 *
 * EXPECTED_MIGRATION is the highest-numbered file in migrations/ at the moment
 * this bundle was built, injected by vite.config.ts. It is derived from the same
 * tree that produced the code, so it means exactly "the schema this build was
 * written against". Comparing it to what the database reports turns an invisible
 * ordering mistake into a named, checkable fact.
 *
 * This detects drift. It does not prevent it. Prevention is the ordering rule in
 * DECISIONS.md D50: migrate remote first, push the dependent code second.
 */

import type { D1Database } from '@cloudflare/workers-types';

/** Injected at build time by vite.config.ts. */
declare const __EXPECTED_MIGRATION__: string;

export const EXPECTED_MIGRATION: string =
	typeof __EXPECTED_MIGRATION__ === 'string' ? __EXPECTED_MIGRATION__ : '';

export interface SchemaStatus {
	expected: string;
	applied: string | null;
	applied_count: number;
	drift: boolean;
	/** Present only when drift is true. Says which way it drifted. */
	detail?: string;
}

/**
 * Compares the schema this build expects against what the database has.
 *
 * Reads d1_migrations, which is wrangler's own bookkeeping table, rather than
 * probing for specific tables. That keeps the check honest as the schema grows:
 * a new migration is covered the moment its file exists, with nothing to
 * remember to add here.
 */
export async function schemaStatus(db: D1Database): Promise<SchemaStatus> {
	let applied: string | null = null;
	let count = 0;

	try {
		const row = await db
			.prepare('SELECT COUNT(*) AS n, MAX(name) AS latest FROM d1_migrations')
			.first<{ n: number; latest: string | null }>();
		applied = row?.latest ?? null;
		count = row?.n ?? 0;
	} catch {
		// No d1_migrations at all means an unmigrated database, which is drift of
		// the most severe kind. Reporting it beats letting the check itself fail.
		return {
			expected: EXPECTED_MIGRATION,
			applied: null,
			applied_count: 0,
			drift: true,
			detail: 'The database has no migration history. Nothing has been applied.'
		};
	}

	// Migration filenames are zero padded and monotonic, so string comparison is
	// ordering. Verified against the current set: 0001 through 0007 sort right.
	if (!EXPECTED_MIGRATION) {
		return { expected: '', applied, applied_count: count, drift: false };
	}

	if (applied === EXPECTED_MIGRATION) {
		return { expected: EXPECTED_MIGRATION, applied, applied_count: count, drift: false };
	}

	const behind = applied === null || applied < EXPECTED_MIGRATION;
	return {
		expected: EXPECTED_MIGRATION,
		applied,
		applied_count: count,
		drift: true,
		detail: behind
			? `The database is behind this build. Apply migrations up to ${EXPECTED_MIGRATION} with: npx wrangler d1 migrations apply command-center-db --remote`
			: `The database is ahead of this build. It has ${applied}, this build was made at ${EXPECTED_MIGRATION}. A newer migration was applied before its code was deployed.`
	};
}
