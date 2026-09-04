import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const API = join(ROOT, 'src', 'lib', 'server', 'api');

/**
 * A literal route declared after a parameterised one is unreachable.
 *
 * Hono matches in definition order, so `/:id` declared first swallows `/undo`,
 * `/proposals` and anything else that arrives at the same shape. The request
 * does not 404: it is handled by the wrong route and fails with whatever that
 * route says about an id it cannot use.
 *
 * WHY THIS IS A TEST AND NOT A NOTE. It already is a note, in the standing
 * constraints, naming this exact case after `/proposals` was shadowed by
 * `/:id`. It was written and adopted, and the undo route was still declared
 * after `/:source/:id/:decision` and arrived as a decision called "undo". A
 * constraint you only consult when already suspicious does not prevent the
 * thing you are not suspicious about. This one runs every time.
 *
 * The check is on declaration order within one router, which is what Hono
 * dispatches on, rather than on anything about the handlers.
 */

interface Route {
	router: string;
	method: string;
	path: string;
	line: number;
}

function routesIn(file: string): Route[] {
	const out: Route[] = [];
	const text = readFileSync(file, 'utf8');
	text.split('\n').forEach((line, i) => {
		const m = /^\s*(\w+)\.(get|post|put|patch|delete)\(\s*'([^']+)'/.exec(line);
		if (m) out.push({ router: m[1], method: m[2], path: m[3], line: i + 1 });
	});
	return out;
}

/** Whether an earlier pattern swallows a later concrete path. */
function shadows(earlier: string, later: string): boolean {
	const a = earlier.split('/').filter(Boolean);
	const b = later.split('/').filter(Boolean);
	if (a.length !== b.length) return false;

	let usesParam = false;
	for (let i = 0; i < a.length; i++) {
		if (a[i].startsWith(':')) {
			// A wildcard segment eats whatever the later route spells out there.
			if (!b[i].startsWith(':')) usesParam = true;
			continue;
		}
		if (a[i] !== b[i]) return false;
	}
	// Identical paths are a different defect and not this one.
	return usesParam;
}

describe('layer 2: no route is unreachable behind a parameterised one', () => {
	const files = readdirSync(API)
		.filter((f) => f.endsWith('.ts'))
		.map((f) => join(API, f));

	it('scans every API module, and finds routes to scan', () => {
		// A scan that found nothing would pass every case it contains. D166.
		const total = files.flatMap(routesIn).length;
		expect(files.length).toBeGreaterThan(10);
		expect(total, 'the scanner matched no routes, so it is checking nothing').toBeGreaterThan(80);
	});

	it('declares every literal path before the pattern that would swallow it', () => {
		const problems: string[] = [];

		for (const file of files) {
			const routes = routesIn(file);
			for (let later = 0; later < routes.length; later++) {
				for (let earlier = 0; earlier < later; earlier++) {
					const a = routes[earlier];
					const b = routes[later];
					if (a.router !== b.router || a.method !== b.method) continue;
					if (shadows(a.path, b.path)) {
						problems.push(
							`${file.slice(API.length + 1)}: ${b.method.toUpperCase()} '${b.path}' ` +
								`(line ${b.line}) is unreachable behind '${a.path}' (line ${a.line})`
						);
					}
				}
			}
		}

		expect(problems, 'these routes can never be reached').toEqual([]);
	});
});
