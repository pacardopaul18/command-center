/**
 * A CSV reader.
 *
 * Written rather than pulled in, because the whole need is one file with quoted
 * fields and the alternative is a dependency for forty lines. It handles what
 * RFC 4180 describes and what a spreadsheet export actually produces: quoted
 * fields, commas and newlines inside quotes, doubled quotes as an escape, and
 * CRLF.
 *
 * It does not guess types. Everything comes out a string, and the caller
 * decides what a blank means, because a loader that turned "" into 0 or null on
 * its own would be making a judgement about somebody else's spreadsheet.
 */

export interface CsvTable {
	header: string[];
	rows: Record<string, string>[];
}

export function parseCsv(text: string): CsvTable {
	// A byte order mark on the front of the first header name makes that column
	// unfindable by its own name, and Excel writes one.
	const source = text.replace(/^\uFEFF/, '');

	const records: string[][] = [];
	let field = '';
	let record: string[] = [];
	let quoted = false;

	for (let i = 0; i < source.length; i++) {
		const ch = source[i];

		if (quoted) {
			if (ch === '"') {
				if (source[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					quoted = false;
				}
			} else {
				field += ch;
			}
			continue;
		}

		if (ch === '"') {
			quoted = true;
		} else if (ch === ',') {
			record.push(field);
			field = '';
		} else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && source[i + 1] === '\n') i++;
			record.push(field);
			records.push(record);
			field = '';
			record = [];
		} else {
			field += ch;
		}
	}

	if (field !== '' || record.length > 0) {
		record.push(field);
		records.push(record);
	}

	// A trailing newline leaves one empty record, which is not a row.
	const meaningful = records.filter((r) => r.some((cell) => cell.trim() !== ''));
	if (meaningful.length === 0) return { header: [], rows: [] };

	const header = meaningful[0].map((h) => h.trim());
	const rows = meaningful.slice(1).map((cells) => {
		const row: Record<string, string> = {};
		header.forEach((name, idx) => {
			row[name] = (cells[idx] ?? '').trim();
		});
		return row;
	});

	return { header, rows };
}

/**
 * A name reduced to what two spellings of the same client have in common.
 *
 * Case, punctuation, spacing and the legal suffix all vary between how a client
 * is written in Asana and how their Dropbox folder is named, and none of those
 * differences mean a different client. Anything beyond that is left alone: this
 * is the third precedence rule, below two exact ones, and an over-eager
 * normaliser would collide two real clients into one, which is the failure the
 * unassigned bucket exists to avoid.
 */
export function normaliseName(name: string): string {
	return name
		.toLowerCase()
		.replace(/\b(l\.?l\.?c\.?|inc\.?|ltd\.?|corp\.?|co\.?|p\.?c\.?)\b/g, ' ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}
