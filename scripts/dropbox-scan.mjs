/**
 * Walks the locally synced Dropbox folder and posts what it finds to the app.
 *
 * READ ONLY, AND NOTHING ELSE. This script opens no file, reads no contents and
 * writes nothing to disk. It calls readdir and lstat and posts names, sizes and
 * modification times. No credentials are needed because the folder is already
 * on this machine; the OAuth connector for production posts the same shape from
 * the API, which is why the ingest lives in the app rather than in here.
 *
 * L2, A HARD RULE: activity is file level. This never reads a directory's
 * modification time, and it never sends one. A synced Dropbox touches folder
 * mtimes when it syncs, so a folder date says when the sync client last thought
 * about the folder rather than when anybody did work in it. Reading one made
 * dormant clients look active. The folder totals are derived by the app from
 * the files.
 *
 * Usage:
 *   node scripts/dropbox-scan.mjs "C:\\Users\\admin\\MacGray, LLC Dropbox" [--port 5174]
 */

import { readdir, lstat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (!root) {
	console.error('Give the Dropbox root: node scripts/dropbox-scan.mjs "<path>"');
	process.exit(1);
}

const port = flag('port', '5174');
// 127.0.0.1 rather than localhost: see scripts/asana-mirror.mjs. `localhost`
// resolves to two addresses here and only one is bound.
const host = flag('host', '127.0.0.1');
const base = `http://${host}:${port}/api/dropbox`;
const BATCH = 500;

/** Sync machinery, not client work. Mirrors the app's own list. */
const IGNORED = new Set([
	'.ds_store',
	'desktop.ini',
	'icon\r',
	'thumbs.db',
	'.dropbox',
	'.dropbox.attr',
	'.dropbox.cache'
]);
const isNoise = (name) => IGNORED.has(name.toLowerCase()) || name.startsWith('~$');

async function post(path, body) {
	const res = await fetch(`${base}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`${path} -> ${res.status} ${text.slice(0, 300)}`);
	return JSON.parse(text);
}

const toPath = (absolute) => '/' + relative(root, absolute).split(sep).join('/');

let folders = 0;
let files = 0;
let bytes = 0;
let skipped = 0;
let pending = [];

async function flush() {
	if (pending.length === 0) return;
	const batch = pending;
	pending = [];
	await post('/scan/entries', { entries: batch });
}

async function walk(dir) {
	let names;
	try {
		names = await readdir(dir, { withFileTypes: true });
	} catch {
		// A folder that cannot be read is counted, not ignored. A scan that
		// silently skipped a locked folder would report a smaller Dropbox as if
		// that were the truth.
		skipped += 1;
		return;
	}

	for (const entry of names) {
		if (isNoise(entry.name)) continue;
		const full = join(dir, entry.name);

		if (entry.isDirectory()) {
			// No stat on a directory. Not for its mtime, not for anything: the
			// value must not be available to send by accident.
			folders += 1;
			pending.push({ kind: 'folder', path: toPath(full) });
			if (pending.length >= BATCH) await flush();
			await walk(full);
			continue;
		}

		if (!entry.isFile()) continue;

		let info;
		try {
			info = await lstat(full);
		} catch {
			skipped += 1;
			continue;
		}

		files += 1;
		bytes += info.size;
		pending.push({
			kind: 'file',
			path: toPath(full),
			size_bytes: info.size,
			modified_at: new Date(info.mtimeMs).toISOString().replace(/\.\d{3}Z$/, 'Z')
		});
		if (pending.length >= BATCH) await flush();
	}
}

const started = Date.now();
const { scan_id } = await post('/scan/open', { root, source: 'local' });
console.log(`scan ${scan_id} open on ${root}`);

await walk(root);
await flush();

const closed = await post('/scan/close', {
	scan_id,
	skipped,
	note: `local walk in ${Math.round((Date.now() - started) / 1000)}s`
});

console.log(
	`walked  folders ${folders}  files ${files}  bytes ${bytes}  unreadable ${skipped}`
);
console.log(`stored  ${JSON.stringify(closed.totals)}`);
console.log(`rolled  ${JSON.stringify(closed.rollup)}`);
console.log(`filed   ${JSON.stringify(closed.match)}`);
