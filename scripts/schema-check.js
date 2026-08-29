#!/usr/bin/env node
/**
 * Compares the migrations in this tree against the migrations applied to a
 * database, and fails if the database is behind.
 *
 * Usage:
 *   node scripts/schema-check.js --remote
 *   node scripts/schema-check.js --local
 *
 * This is the pre-push check for the deploy gap that took /templates down on
 * 2026-08-29: code auto-deploys on push, migrations do not. Run it before
 * pushing anything that touches migrations/, and run it again after applying a
 * migration to confirm the two sides agree.
 *
 * Exit 0 means the database has everything this tree expects. Exit 1 means it
 * does not, and pushing now would ship code against a schema that is missing.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';

/**
 * Resolves wrangler's own entry point so it can be run under this node, rather
 * than shelling out to `npx`.
 *
 * On Windows, node refuses to spawn a .cmd shim without shell: true, and turning
 * the shell on would put strings through cmd.exe quoting. Running the JS
 * directly has neither problem and skips npx's resolution step.
 *
 * The bin path is read from wrangler's package.json rather than hardcoded,
 * because wrangler's "exports" map does not expose ./bin/wrangler.js and a
 * direct require.resolve of it fails. ./package.json is exported, so this
 * resolves the manifest and reads the bin entry it declares.
 */
function findWrangler() {
	const manifestPath = createRequire(import.meta.url).resolve('wrangler/package.json');
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.wrangler;
	if (!bin) throw new Error('wrangler package.json declares no wrangler bin.');
	return resolvePath(dirname(manifestPath), bin);
}

const wranglerBin = findWrangler();

const DB = 'command-center-db';
const target = process.argv.includes('--local') ? '--local' : '--remote';

const local = readdirSync('migrations')
	.filter((f) => f.endsWith('.sql'))
	.sort();

if (local.length === 0) {
	console.error('No migrations found in migrations/.');
	process.exit(1);
}

let applied;
try {
	// --json keeps this parseable. wrangler still prints its banner to stdout, so
	// the JSON is found rather than assumed to start at byte zero.
	const raw = execFileSync(
		process.execPath,
		[
			wranglerBin,
			'd1',
			'execute',
			DB,
			target,
			'--json',
			'--command',
			'SELECT name FROM d1_migrations ORDER BY name'
		],
		{ encoding: 'utf8', env: { ...process.env, CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }
	);
	const start = raw.indexOf('[');
	if (start === -1) throw new Error('No JSON in wrangler output.');
	applied = JSON.parse(raw.slice(start))[0].results.map((r) => r.name);
} catch (err) {
	console.error(`Could not read d1_migrations from the ${target.slice(2)} database.`);
	console.error(String(err.stderr || err.message || err).trim().split('\n').slice(-4).join('\n'));
	process.exit(1);
}

const missing = local.filter((m) => !applied.includes(m));
const extra = applied.filter((m) => !local.includes(m));

console.log(`Database:  ${DB} (${target.slice(2)})`);
console.log(`In tree:   ${local.length} migration(s), latest ${local[local.length - 1]}`);
console.log(`Applied:   ${applied.length} migration(s), latest ${applied[applied.length - 1] ?? 'none'}`);

if (extra.length > 0) {
	console.log('');
	console.log('The database has migrations this tree does not:');
	for (const m of extra) console.log(`  ${m}`);
	console.log('That means a migration was applied and its file was never committed, or you are on an old branch.');
}

if (missing.length > 0) {
	console.log('');
	console.log('NOT APPLIED. Deploying this tree would run code against a database missing:');
	for (const m of missing) console.log(`  ${m}`);
	console.log('');
	console.log('Apply first, push second:');
	console.log(`  npx wrangler d1 export ${DB} ${target} --output backups/snapshot-$(date +%F).sql`);
	console.log(`  npx wrangler d1 migrations apply ${DB} ${target}`);
	process.exit(1);
}

console.log('');
console.log('OK. The database has every migration in this tree.');
