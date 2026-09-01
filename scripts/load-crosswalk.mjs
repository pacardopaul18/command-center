/**
 * Posts the client crosswalk file to the app, which loads and applies it.
 *
 * A courier, nothing more. The parsing, the client rows and the matching all
 * live in the app, because a Worker has no filesystem and the production path
 * has to be the path that was exercised locally. If this script held the
 * loading logic, production would run code that had never been tested.
 *
 * Usage: node scripts/load-crosswalk.mjs docs/data/macgray_client_crosswalk.csv [--port 5174]
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (!file) {
	console.error('Give the crosswalk file: node scripts/load-crosswalk.mjs <path.csv>');
	process.exit(1);
}

const port = flag('port', '5174');
const workspace = flag('workspace', '');
const text = readFileSync(file, 'utf8');

const url =
	`http://${flag('host', '127.0.0.1')}:${port}/api/crosswalk?source=${encodeURIComponent(basename(file))}` +
	(workspace ? `&workspace=${encodeURIComponent(workspace)}` : '');

const res = await fetch(url, {
	method: 'POST',
	headers: { 'content-type': 'text/csv' },
	body: text
});

const body = await res.json();
if (!res.ok) {
	console.error(`load failed (${res.status}): ${JSON.stringify(body)}`);
	process.exit(1);
}

// Counts, so a truncated or stale file announces itself rather than looking
// like a smaller client list.
console.log(`load   ${JSON.stringify(body.load)}`);
console.log(`match  ${body.matched ? JSON.stringify(body.match) : body.not_matched_because}`);
