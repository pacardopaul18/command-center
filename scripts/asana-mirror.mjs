/**
 * Drives the Asana mirror to completion.
 *
 * The engine is in the app and each call is resumable on its own, so this is a
 * convenience and not the resumption mechanism: if this script dies, the next
 * call picks up from the phase and cursor already recorded. That is the whole
 * reason the engine records where it got to rather than holding progress in
 * memory.
 *
 * Prints a line per invocation, because a pull of this size takes long enough
 * that "still going" and "stuck" have to be distinguishable while it runs.
 *
 * Usage: node scripts/asana-mirror.mjs <workspace_gid> [--port 5174] [--budget 140]
 */

import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const workspace = args.find((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (!workspace) {
	console.error('Give the workspace gid: node scripts/asana-mirror.mjs <workspace_gid>');
	process.exit(1);
}

const port = flag('port', '5174');
const budget = flag('budget', '140');
/*
 * 127.0.0.1, not localhost.
 *
 * On this machine `localhost` resolves to both ::1 and 127.0.0.1, and Node
 * picks one per request without falling back. Vite binds only one of them, so
 * roughly half of these calls were refused with a bare `fetch failed` and the
 * driver stopped on a working server. The dev server is started bound to this
 * address to match.
 */
const host = flag('host', '127.0.0.1');
const url = `http://${host}:${port}/api/asana/mirror?workspace=${workspace}&budget=${budget}`;

const pad = (n, w) => String(n).padStart(w);

/*
 * Progress goes to a file as well as the console.
 *
 * Node block-buffers stdout when it is a pipe rather than a terminal, so a run
 * driven from a script or a background shell prints nothing at all until it
 * exits. For a pull measured in hours that is the difference between "still
 * going" and "stuck", which is the one thing this script exists to show.
 */
const logPath = flag('log', 'mirror-progress.log');
const say = (line) => {
	console.log(line);
	appendFileSync(logPath, `${line}\n`);
};

let stalls = 0;

/*
 * A cap on invocations, so a driver that is making no progress cannot run for
 * ever unattended.
 *
 * It has to say when it fires. The first version simply fell out of the loop,
 * which printed nothing and looked exactly like finishing: the pull was 253
 * tasks short and the only way to know was to read the phase out of the
 * database. A limit that stops work silently is worse than no limit. D138.
 */
const LIMIT = 800;
let hitLimit = true;

for (let i = 1; i <= LIMIT; i++) {
	let body;
	try {
		// A deadline on this side too. A step is budgeted to a fixed number of
		// requests, so one that has not answered in five minutes is not slow, it
		// is stuck, and waiting on it forever means the pull makes no progress
		// while the process still looks busy.
		const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(300_000) });
		body = await res.json();
		if (!res.ok) {
			say(`${pad(i, 3)}  HTTP ${res.status}  ${JSON.stringify(body).slice(0, 200)}`);
			hitLimit = false;
			break;
		}
	} catch (err) {
		// A dropped connection is not a lost pull, and it is not a reason to
		// stop either. The dev server restarts itself whenever a source file
		// changes, and a driver that quit on the first refused connection made
		// no progress for an hour while looking like it had been asked to.
		stalls += 1;
		say(`${pad(i, 3)}  request failed (${stalls}/5): ${err.message}`);
		if (stalls >= 5) {
			say('MIRROR STOPPED: the app did not answer five times running');
			hitLimit = false;
			break;
		}
		await new Promise((r) => setTimeout(r, 5_000));
		continue;
	}

	const t = body.totals;
	say(
		`${pad(i, 3)}  ${body.phase.padEnd(9)} calls=${pad(body.calls, 4)}  ` +
			`proj ${t.projects}(${t.projects_archived} arch)  sec ${t.sections}  ` +
			`task ${t.tasks}  sub ${t.subtasks}  people ${t.assignees}  ` +
			`att ${t.attachments}  story ${t.stories}   ${body.stopped}`
	);

	if (body.done) {
		say('MIRROR COMPLETE');
		hitLimit = false;
		break;
	}
	// A step that stopped on an error keeps its phase and cursor, so the next
	// one resumes rather than restarts. Three in a row with no progress is a
	// real fault; one is the storage layer dropping a connection.
	if (body.stopped.includes(':')) {
		stalls += 1;
		if (stalls >= 3) {
			say('MIRROR STOPPED: three failing steps in a row, see last_error on asana_sync_state');
			hitLimit = false;
			break;
		}
		await new Promise((r) => setTimeout(r, 5_000));
	} else {
		stalls = 0;
	}
}

if (hitLimit) {
	say(
		`MIRROR INCOMPLETE: stopped after ${LIMIT} steps without finishing. ` +
			'The pull is resumable, so running this again continues from where it stopped.'
	);
	process.exitCode = 1;
}
