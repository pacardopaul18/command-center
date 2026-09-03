#!/usr/bin/env node
/**
 * Puts SOP-001 into the app, from the authored file.
 *
 *   node scripts/install-sop-001.mjs [--base http://127.0.0.1:5174]
 *
 * A script rather than a migration, on purpose. SOP-001 is real firm procedure
 * and belongs in the real database, not in the fixture: a migration would put
 * it into the seed too, where layer 1 asserts the exact set of SOPs and would
 * fail on a row the generator never made.
 *
 * Idempotent. Run it once and it creates the SOP with version 1. Run it again
 * after editing the file and it adds a version with a change note, because a
 * SOP version is immutable history and editing one in place is the thing the
 * database refuses. Run it again with nothing changed and it does nothing at
 * all, so re-running is safe and does not inflate the version count.
 *
 * NOTHING HERE MARKS IT APPROVED. The status stays draft, in the title and in
 * the body, because approval is Dustin's act. This script cannot perform it and
 * neither can the app.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base');
const BASE = baseIndex === -1 ? 'http://127.0.0.1:5174' : args[baseIndex + 1];

const TITLE = 'SOP-001 Meeting Capture: Plaud to Claude to Asana (DRAFT)';
const CATEGORY = 'Client delivery';
const SOURCE = 'docs/data/SOP-001-meeting-capture.md';

/**
 * Markdown to the rich text the field stores.
 *
 * Small and deliberate rather than a markdown library: the source file uses
 * headings, paragraphs, lists, tables, bold, italic and blockquote, and nothing
 * else. A dependency to cover constructs this document does not contain would
 * be a dependency to maintain for no reader.
 *
 * The route sanitises whatever this produces, so a mistake here is a rendering
 * bug and never a security one.
 */
function toHtml(markdown) {
	const escape = (t) =>
		t
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');

	// Inline: bold, italic, code. Applied after escaping so the markers cannot
	// be smuggled in by the text itself.
	const inline = (t) =>
		escape(t)
			.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
			.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
			.replace(/`([^`]+)`/g, '<code>$1</code>');

	const lines = markdown.split(/\r?\n/);
	const out = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		if (!line.trim()) {
			i += 1;
			continue;
		}

		// A horizontal rule, but not a table separator row.
		if (/^---+$/.test(line.trim())) {
			out.push('<hr>');
			i += 1;
			continue;
		}

		const heading = /^(#{1,6})\s+(.*)$/.exec(line);
		if (heading) {
			// Everything below the document title is h2, because the stored body
			// keeps Asana's two heading levels and the renderer maps them down.
			const level = heading[1].length === 1 ? 'h1' : 'h2';
			out.push(`<${level}>${inline(heading[2])}</${level}>`);
			i += 1;
			continue;
		}

		if (line.startsWith('|')) {
			const rows = [];
			while (i < lines.length && lines[i].startsWith('|')) {
				const cells = lines[i]
					.slice(1, lines[i].endsWith('|') ? -1 : undefined)
					.split('|')
					.map((c) => c.trim());
				// The dashes row under the header is markdown punctuation, not data.
				if (!cells.every((c) => /^:?-+:?$/.test(c) || c === '')) {
					rows.push(`<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`);
				}
				i += 1;
			}
			out.push(`<table>${rows.join('')}</table>`);
			continue;
		}

		if (/^[-*]\s+/.test(line)) {
			const items = [];
			while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
				items.push(`<li>${inline(lines[i].replace(/^[-*]\s+/, ''))}</li>`);
				i += 1;
			}
			out.push(`<ul>${items.join('')}</ul>`);
			continue;
		}

		if (/^\d+\.\s+/.test(line)) {
			const items = [];
			while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
				items.push(`<li>${inline(lines[i].replace(/^\d+\.\s+/, ''))}</li>`);
				i += 1;
			}
			out.push(`<ol>${items.join('')}</ol>`);
			continue;
		}

		if (line.startsWith('>')) {
			const quoted = [];
			while (i < lines.length && lines[i].startsWith('>')) {
				quoted.push(inline(lines[i].replace(/^>\s?/, '')));
				i += 1;
			}
			out.push(`<blockquote><p>${quoted.join(' ')}</p></blockquote>`);
			continue;
		}

		// A paragraph runs until a blank line or the start of another block.
		const paragraph = [];
		while (
			i < lines.length &&
			lines[i].trim() &&
			!lines[i].startsWith('|') &&
			!lines[i].startsWith('>') &&
			!/^(#{1,6}\s|[-*]\s|\d+\.\s|---+$)/.test(lines[i])
		) {
			paragraph.push(inline(lines[i]));
			i += 1;
		}
		out.push(`<p>${paragraph.join(' ')}</p>`);
	}

	return out.join('');
}

async function api(path, init) {
	const res = await fetch(`${BASE}${path}`, init);
	const text = await res.text();
	let json = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = null;
	}
	if (!res.ok) {
		throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
	}
	return json;
}

const post = (payload) => ({
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(payload)
});

const html = toHtml(readFileSync(SOURCE, 'utf8'));

const health = await api('/api/health');
console.log(`Target: ${BASE}, serving the ${health.data_environment} database.`);

/**
 * A fingerprint of what was sent, carried in the change note.
 *
 * Comparing the generated HTML against the stored HTML does not work: the route
 * parses and rebuilds every value, so what comes back is canonical and what
 * this script produced is not. That comparison silently added an identical
 * version on the first re-run. The hash is of the source this script sent, so
 * "unchanged file, no new version" is exactly what it means.
 */
const fingerprint = createHash('sha256').update(html).digest('hex').slice(0, 12);
const note = (verb) => `${verb} from ${SOURCE} (source ${fingerprint})`;

const existing = await api('/api/sops?status=all');
const found = (existing.sops ?? []).find((s) => s.title === TITLE);

if (!found) {
	const created = await api(
		'/api/sops',
		post({
			title: TITLE,
			category: CATEGORY,
			body_html: html,
			change_note: note('Initial version')
		})
	);
	console.log(`Created ${created.sop.id} as version 1.`);
	console.log("Status is DRAFT. Approval is Dustin's act, not this script's.");
} else {
	const detail = await api(`/api/sops/${found.id}`);
	const current = (detail.versions ?? []).find((v) => v.id === detail.sop.current_version_id);
	if (current?.change_note?.includes(`source ${fingerprint}`)) {
		console.log(`Already current at version ${current.version_number}. Nothing to do.`);
	} else {
		const updated = await api(
			`/api/sops/${found.id}/versions`,
			post({ body_html: html, change_note: note('Updated') })
		);
		console.log(`Added version ${updated.version_number}.`);
	}
}