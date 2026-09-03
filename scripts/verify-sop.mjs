#!/usr/bin/env node
/**
 * Checks the installed SOP-001 against the file it was written from.
 *
 *   npm run verify:sop -- --base http://127.0.0.1:5175
 *
 * The companion to the skip in `tests/layer2-sop-template.test.ts`. The authored
 * source is deliberately not in version control, so the suite cannot assert
 * against it on a machine that does not hold it and skips with a stated reason
 * instead. This is the check that bites where the file does exist: it compares
 * what is installed against what was authored and fails loudly when they
 * disagree.
 *
 * The two halves are different questions and both are needed:
 *
 *   the suite    the document says the right things
 *   this script  the app holds what the document says
 *
 * A document that is correct and never installed is a document nobody follows.
 * An installed record that has drifted from its source is worse, because the
 * app is then the authority on a procedure it is no longer a faithful copy of.
 *
 * EXIT CODES. 0 when they agree, or when the source is absent and there is
 * nothing to verify, which is said plainly rather than passed silently. 1 when
 * the source is present and the install disagrees with it, is missing, or has
 * been marked approved by something other than Dustin.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base');
const BASE = baseIndex === -1 ? 'http://127.0.0.1:5175' : args[baseIndex + 1];

const SOURCE = 'docs/data/SOP-001-meeting-capture.md';
const TITLE = 'SOP-001 Meeting Capture: Plaud to Claude to Asana (DRAFT)';

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

if (!existsSync(SOURCE)) {
	/*
	 * Said out loud, not swallowed. The point of the whole arrangement is that
	 * "not checked" never looks like "checked and fine".
	 */
	console.log(`${SOURCE} is not present on this machine.`);
	console.log('SOP source not present, install unverified. Nothing to check.');
	process.exit(0);
}

const source = readFileSync(SOURCE, 'utf8');
const fingerprint = createHash('sha256')
	// The installer hashes the HTML it generated from this file. Recomputing that
	// here would mean keeping a second copy of the converter in step with the
	// first, so the source text is hashed instead and the installer's note is
	// matched on the same basis. Both derive from one file; only the file
	// changing changes the answer.
	.update(source)
	.digest('hex')
	.slice(0, 12);

const problems = [];

/** The things the document itself has to keep saying. */
const REQUIRED = [
	[/\*\*Status:\*\* DRAFT/, 'the status line no longer says DRAFT'],
	[/Nothing here is in force until he approves it/, 'the not-in-force sentence is gone'],
	[/\| Role \| Who \| Deputy \|/, 'the roles table lost its deputy column'],
	[/TO BE NAMED/, "the Filer's deputy has been filled in without Dustin naming one"],
	[/### Step 6: Propose the to-dos/, 'step 6 is no longer written as propose'],
	[/### Step 7: Push the reviewed to-dos/, 'step 7 is no longer written as push'],
	[/CD meetings/, 'the Chasin Dreams confidentiality exception is gone'],
	[/not optional and not subject to convenience/, 'the exception is no longer marked non-optional']
];

for (const [pattern, complaint] of REQUIRED) {
	if (!pattern.test(source)) problems.push(`Source: ${complaint}.`);
}

const whens = (source.match(/\*\*When:\*\*/g) ?? []).length;
if (whens < 8) {
	problems.push(`Source: only ${whens} steps carry a timing, and there are eight.`);
}

let sop = null;
try {
	const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
	console.log(`Target: ${BASE}, serving the ${health.data_environment} database.`);

	const list = await fetch(`${BASE}/api/sops?status=all`).then((r) => r.json());
	sop = (list.sops ?? []).find((s) => s.title === TITLE) ?? null;
} catch (err) {
	console.error(red(`Could not reach ${BASE}: ${err.message}`));
	console.error('Start the real-data server first, or pass --base.');
	process.exit(1);
}

if (!sop) {
	problems.push(`Install: no SOP titled "${TITLE}" exists. Run scripts/install-sop-001.mjs.`);
} else {
	const detail = await fetch(`${BASE}/api/sops/${sop.id}`).then((r) => r.json());
	const current = (detail.versions ?? []).find((v) => v.id === detail.sop.current_version_id);

	if (!current?.change_note?.includes(`source ${fingerprint}`)) {
		problems.push(
			`Install: version ${current?.version_number ?? '?'} was written from a different source ` +
				`than ${SOURCE} holds now. Re-run scripts/install-sop-001.mjs.`
		);
	}

	// The document says DRAFT. The record has to agree, because the record is
	// what somebody reads before following the procedure.
	if (!/DRAFT/i.test(detail.sop.title)) {
		problems.push('Install: the stored title no longer says DRAFT.');
	}
	if (detail.viewing?.body && !/DRAFT/i.test(detail.viewing.body)) {
		problems.push('Install: the stored body no longer says it is a draft.');
	}
}

if (problems.length) {
	console.error(red(`\nSOP-001 verification failed: ${problems.length} problem(s).`));
	for (const p of problems) console.error(`  - ${p}`);
	process.exit(1);
}

console.log(green(`SOP-001 verified: the install matches ${SOURCE} (source ${fingerprint}).`));
console.log('Status is DRAFT, awaiting Dustin.');
