import { ApiError } from './api/validate';
import { richTextToPlain, sanitizeRichText } from '$lib/rich-text';

/**
 * One rich-text field, read off a request body.
 *
 * Every route that stores prose calls this and nothing else. The point of a
 * single function is that the sanitising and the plain-text projection cannot
 * come apart: a route that remembered one and forgot the other would either
 * store markup where search reads, or store an HTML column whose plain twin
 * says something different.
 *
 * THE SERVER IS THE BOUNDARY. The editor sanitises too, so what the writer sees
 * is what will be stored, but that is a courtesy. A request can be posted by
 * anything, so the value that reaches the database is the one this function
 * built out of a parsed tree, never the one the browser sent.
 *
 * Accepts either shape. A caller that sends `<field>_html` is using the editor.
 * A caller that sends the plain `<field>` is an older client, an import or a
 * script, and its text is converted so the two paths cannot diverge.
 */
export interface RichField {
	html: string | null;
	plain: string | null;
}

/** The ceiling. Prose, not a document store: 40k is a very long ticket. */
const MAX_HTML = 40_000;

export function readRichField(
	body: Record<string, unknown>,
	field: string,
	label: string
): RichField {
	const htmlKey = `${field}_html`;
	const rawHtml = body[htmlKey];
	const rawPlain = body[field];

	// Neither sent. Not the same as sent empty, and the caller decides which of
	// those it is, so both come back null and the patch builder skips the field.
	if (rawHtml === undefined && rawPlain === undefined) return { html: null, plain: null };

	if (rawHtml !== undefined && rawHtml !== null && typeof rawHtml !== 'string') {
		throw new ApiError(400, `${label} must be text.`);
	}
	if (rawPlain !== undefined && rawPlain !== null && typeof rawPlain !== 'string') {
		throw new ApiError(400, `${label} must be text.`);
	}

	const source = typeof rawHtml === 'string' && rawHtml.trim() ? rawHtml : null;

	if (source) {
		if (source.length > MAX_HTML) {
			throw new ApiError(400, `${label} must be ${MAX_HTML} characters or fewer.`);
		}
		const html = sanitizeRichText(source);
		return { html, plain: richTextToPlain(html) };
	}

	// No HTML, so whatever plain text came with the request is the value. Stored
	// as text with no HTML twin, which is exactly what a row that has never been
	// through the editor looks like, so nothing about it is a special case later.
	const plain = typeof rawPlain === 'string' ? rawPlain.trim() || null : null;
	if (plain && plain.length > MAX_HTML) {
		throw new ApiError(400, `${label} must be ${MAX_HTML} characters or fewer.`);
	}
	return { html: null, plain };
}

/** Whether the request said anything at all about this field. */
export function mentionsRichField(body: Record<string, unknown>, field: string): boolean {
	return field in body || `${field}_html` in body;
}
