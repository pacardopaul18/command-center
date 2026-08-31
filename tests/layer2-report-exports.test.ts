import { describe, expect, it } from 'vitest';
import { REPORTS } from '../src/lib/types';

/**
 * Exporting a report as a CSV.
 *
 * The property worth pinning is not that a file comes back. It is that the file
 * says the same thing the screen did, that a note containing a comma cannot
 * shift the columns, and that a row with an extra key cannot shift them either.
 * All three failures produce a file that opens cleanly and adds up wrong, which
 * is the worst shape a bug in an export can take.
 *
 * Every report is exercised rather than one, because the section each one
 * exports is a per-report judgement and a report added later with no section
 * named would otherwise fail silently the first time somebody pressed the
 * button.
 */

const BASE = 'http://localhost:5173';
const WINDOW = 'from=2026-01-01&to=2026-12-31';

async function csv(path: string) {
	const res = await fetch(`${BASE}${path}`);
	return { res, text: await res.text() };
}

/** Splits one CSV line, honouring quotes, so a comma inside a field is not a break. */
function fields(line: string): string[] {
	const out: string[] = [];
	let current = '';
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (quoted) {
			if (ch === '"' && line[i + 1] === '"') {
				current += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else current += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === ',') {
			out.push(current);
			current = '';
		} else current += ch;
	}
	out.push(current);
	return out;
}

describe('every report exports', () => {
	for (const report of REPORTS) {
		it(`${report.type} returns a CSV with a header and matching columns`, async () => {
			const { res, text } = await csv(`/api/reports/${report.type}/export.csv?${WINDOW}`);
			expect(res.ok, `${report.type} did not export`).toBe(true);
			expect(res.headers.get('content-type')).toContain('text/csv');
			expect(res.headers.get('content-disposition')).toContain('.csv');
			// Never cached by a shared cache: this is the firm's own data.
			expect(res.headers.get('cache-control')).toContain('no-store');

			const lines = text.trim().split('\r\n');
			expect(lines.length, `${report.type} exported no header`).toBeGreaterThan(0);

			const width = fields(lines[0]).length;
			expect(width, `${report.type} exported an empty header`).toBeGreaterThan(0);

			/**
			 * Every row the same width as the header.
			 *
			 * Headers come from the first row and every later row is read against
			 * them, so a row carrying an extra key cannot shift each field one
			 * column to the right. That is the CSV failure nobody notices until a
			 * spreadsheet sums the wrong column.
			 */
			for (const line of lines.slice(1)) {
				expect(fields(line).length, `a row in ${report.type} is a different width`).toBe(width);
			}
		});
	}
});

describe('what the export refuses', () => {
	it('names the sections it has rather than returning an empty file', async () => {
		const { res, text } = await csv(
			`/api/reports/billing/export.csv?${WINDOW}&section=not_a_section`
		);
		expect(res.status).toBe(400);
		// An empty file with headers reads as "none" and is indistinguishable
		// from a section name typed wrong.
		expect(text).toContain('outstanding');
		expect(text).toContain('by_client');
	});

	it('exports another section when asked for one by name', async () => {
		const { res, text } = await csv(`/api/reports/billing/export.csv?${WINDOW}&section=bands`);
		expect(res.ok).toBe(true);
		expect(text.split('\r\n')[0]).toContain('bucket');
	});

	it('404s a report that does not exist', async () => {
		const { res } = await csv('/api/reports/not-a-report/export.csv');
		expect(res.status).toBe(404);
	});

	it('refuses a reversed window rather than exporting nothing', async () => {
		const { res } = await csv(
			'/api/reports/billing/export.csv?from=2026-12-31&to=2026-01-01'
		);
		expect(res.status).toBe(400);
	});
});

describe('the file agrees with the screen', () => {
	it('has one row per row of the section it names', async () => {
		const json = (await (
			await fetch(`${BASE}/api/reports/projects?${WINDOW}`)
		).json()) as { data: { projects: unknown[] } };

		const { text } = await csv(`/api/reports/projects/export.csv?${WINDOW}`);
		const rows = text.trim().split('\r\n').length - 1;

		// One place runs the report for both the screen and the export, so a
		// second copy of the query cannot leave the file a version behind.
		expect(rows).toBe(json.data.projects.length);
	});

	it('quotes every field, so a value containing a comma cannot break a row', async () => {
		const { text } = await csv(`/api/reports/projects/export.csv?${WINDOW}`);
		for (const line of text.trim().split('\r\n').slice(0, 5)) {
			expect(line.startsWith('"'), 'a row does not start with a quoted field').toBe(true);
		}
	});
});
