/**
 * Did the seed actually load?
 *
 * The reload used to fail on a UNIQUE violation, leave yesterday's rows in
 * place, and print a log file path. As far as anyone reading the terminal could
 * tell it had worked, and the rehearsal's first step would have measured the
 * previous day with a number 26 too high.
 *
 * So the load says so itself. It compares what is in the database against the
 * expectations the generator wrote at the same moment it wrote the SQL, and the
 * anchor date against today. Two sources that were never derived from each
 * other cannot make the same mistake by accident, which is layer 1's argument
 * applied to the loader.
 */

import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';

function openDb() {
	const file = readdirSync(DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	if (!file) {
		console.error('SEED CHECK: no local database. Run npm run dev once first.');
		process.exit(1);
	}
	return new DatabaseSync(join(DIR, file));
}

const expected = JSON.parse(readFileSync('seed/expected.json', 'utf8'));
const db = openDb();

const problems = [];

/**
 * Row counts, which catch a load that aborted part way through.
 *
 * Counted by the v- prefix rather than as whole tables. Every row this fixture
 * writes carries it, and every DELETE at the top of the generated SQL removes
 * by it, so "how many of my rows are here" is the question the loader can
 * actually answer. Counting whole tables asked a different question and got a
 * different answer the moment a table was shared with another fixture: the dev
 * seed writes one ledger line, and the ledger stream was reported one row over
 * on a load that had gone perfectly.
 *
 * Rows without the prefix are somebody else's problem and layer 1's job: it
 * asserts separately that no unprefixed row exists in the tables the suite
 * counts on.
 */
for (const [table, want] of Object.entries(expected.counts ?? {})) {
	let got = -1;
	try {
		got = db.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE id LIKE 'v-%'`).get().n;
	} catch {
		problems.push(`${table}: table missing`);
		continue;
	}
	if (got !== want) problems.push(`${table}: ${got} seeded rows, expected ${want}`);
}

/**
 * The anchor. This is the one that was wrong: the data was intact and simply
 * belonged to yesterday, so every count matched and every date-relative figure
 * did not.
 */
const anchor = expected.today_mt;
const todayMt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());

if (anchor !== todayMt) {
	problems.push(
		`anchor is ${anchor} but today is ${todayMt} in the working zone. ` +
			'Regenerate with npm run seed:generate before loading.'
	);
}

/** And the figure that actually caught it, asserted directly. */
const overdue = db
	.prepare("SELECT COUNT(*) AS n FROM action_items WHERE status != 'done' AND deadline < ?")
	.get(anchor).n;

if (overdue !== expected.action_bands.overdue) {
	problems.push(
		`overdue action items: ${overdue}, expected ${expected.action_bands.overdue}. ` +
			'The rows in the database are not the rows the generator described.'
	);
}

db.close();

if (problems.length > 0) {
	console.error('\nSEED CHECK FAILED. The database does not match what was generated:\n');
	for (const p of problems) console.error(`  - ${p}`);
	console.error('\nFix: npm run seed:generate && npm run seed:load\n');
	process.exit(1);
}

console.log(
	`SEED OK. Anchored to ${anchor}, ${expected.counts.action_items} action items, ` +
		`${overdue} overdue, matching the generator.`
);
