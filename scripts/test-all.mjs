#!/usr/bin/env node
/**
 * One command, four layers.
 *
 *   npm test
 *
 * Layers, and why they are separate:
 *
 *   1  data integrity   reads the SQLite file directly and compares it to the
 *                       values the generator recorded. Never asks the app.
 *   2  API contract     the HTTP surface, plus the client write guard as a unit.
 *   3  end to end       real browser, real pages, totals read out of the DOM.
 *   4  scheduled        the cron handler, from the built bundle.
 *
 * Local only. Nothing here can point a layer at production, and layer 2 asserts
 * the Asana push is unreachable so no seeded row can escape into a real
 * workspace.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:5173';
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

function run(label, command, args) {
	return new Promise((resolve) => {
		const started = Date.now();
		console.log(`\n${bold(`=== ${label} ===`)}`);
		const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
		child.on('close', (code) =>
			resolve({ label, code: code ?? 1, seconds: ((Date.now() - started) / 1000).toFixed(1) })
		);
	});
}

/**
 * The bundle only matters to layer 4, and rebuilding it while a dev server is
 * running fails on Windows because vite cannot remove an output directory the
 * server is holding open. So it is rebuilt only when one of its own inputs has
 * changed, which in the ordinary case is never and the conflict never arises.
 */
const BUNDLE = '.svelte-kit/cloudflare/_scheduled.js';
const BUNDLE_INPUTS = [
	'src/lib/server/scheduled.ts',
	'src/lib/server/backup.ts',
	'src/lib/server/digest.ts',
	'src/lib/server/dates.ts',
	'src/lib/server/house-style.ts',
	'scripts/wrap-worker.js'
];

function bundleIsStale() {
	if (!existsSync(BUNDLE)) return true;
	const built = statSync(BUNDLE).mtimeMs;
	return BUNDLE_INPUTS.filter(existsSync).some((f) => statSync(f).mtimeMs > built);
}

async function preflight() {
	const problems = [];

	if (!existsSync('seed/expected.json')) {
		problems.push('seed/expected.json is missing. Run: npm run seed:generate');
	}

	// The seed must actually be loaded, or layer 1 fails in a way that reads like
	// a defect rather than like an unprepared machine.
	if (existsSync('seed/expected.json')) {
		try {
			const res = await fetch(`${BASE}/api/action-items?view=all`);
			const body = await res.json();
			const want = JSON.parse(readFileSync('seed/expected.json', 'utf8')).counts.action_items;
			// paging.total, not items.length. The list is a page now, and counting
			// the rows on screen would report 50 no matter how much is loaded.
			const have = body.paging?.total ?? body.items?.length ?? 0;
			if (have < want) {
				problems.push(
					`The volume seed does not look loaded: ${have} action items, ` +
						`expected at least ${want}. Run: npm run seed:load`
				);
			}
		} catch {
			console.log(`  note: ${BASE} is not answering yet, the browser layer will start it`);
		}
	}

	if (problems.length) {
		console.error(`\n${red('Cannot start:')}`);
		for (const p of problems) console.error(`  - ${p}`);
		process.exit(1);
	}
}

await preflight();

const results = [];

if (bundleIsStale()) {
	const build = await run('build, so layer 4 tests what Cloudflare runs', 'npm', ['run', 'build']);
	results.push(build);
	if (build.code !== 0) {
		console.error(
			'\nThe build failed. If it could not remove .svelte-kit/cloudflare, a dev or preview ' +
				'server is holding it open. Stop that server, run `npm run build`, then re-run the suite.'
		);
	}
} else {
	console.log(`\n${bold('=== build ===')}\n  bundle is current, skipping`);
}

if (results.every((r) => r.code === 0)) {
	results.push(await run('layers 1, 2 and 4', 'npx', ['vitest', 'run']));
	results.push(await run('layer 3, browser', 'npx', ['playwright', 'test']));
}

console.log(`\n${bold('=== summary ===')}`);
let failed = 0;
for (const r of results) {
	const ok = r.code === 0;
	if (!ok) failed++;
	console.log(`  ${ok ? green('PASS') : red('FAIL')}  ${r.label}  (${r.seconds}s)`);
}

if (failed) {
	console.log(`\n${red(`${failed} stage(s) failed.`)}`);
	process.exit(1);
}
console.log(`\n${green('All layers passed.')}`);
