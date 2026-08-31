/**
 * The fields a template asks for, read out of the template itself.
 *
 * The redesign draws per-template input fields that feed generation. Storing
 * them would mean a schema, a form to maintain them, and a second copy of the
 * truth that drifts the first time somebody edits the body and forgets the
 * field list. Reading them out of the placeholders already in the text costs no
 * schema and cannot drift, because there is nothing to drift from.
 *
 * The syntax is `[like this]`, and it was not chosen here. Every template
 * already written uses it, and the AI drafting prompt already promises that
 * anything it does not know comes back "as a bracketed placeholder". Inventing
 * a second spelling would have meant every existing template asking for nothing
 * and every generated draft producing placeholders this cannot see.
 *
 * This is deliberately not a template engine. There are no conditionals, no
 * loops and no expressions, and adding them would turn a reply pattern into a
 * program somebody has to debug in a textarea.
 */

export interface TemplateInput {
	/** The exact text between the brackets, which is the substitution key. */
	key: string;
	/** The same thing as a field label: `client name` reads as "Client name". */
	label: string;
}

/**
 * A placeholder starts with a letter.
 *
 * That one rule is what keeps ordinary prose out. `[1]` is a footnote, and
 * `[2026-08-31]` is a date somebody bracketed; neither is a question anyone
 * wants a form field for. Length is capped for the same reason: a bracketed
 * sentence is an aside, not a placeholder.
 */
const PLACEHOLDER = /\[([A-Za-z][A-Za-z0-9 _-]{0,39})\]/g;

/**
 * Every distinct placeholder in a body, in the order it first appears.
 *
 * Order of first appearance, not alphabetical: the form should read in the
 * order the document does, so filling it in top to bottom follows the text.
 * Duplicates collapse, because the same placeholder used three times is one
 * question asked once.
 */
export function templateInputs(body: string): TemplateInput[] {
	const seen = new Set<string>();
	const out: TemplateInput[] = [];

	for (const match of body.matchAll(PLACEHOLDER)) {
		const key = match[1].trim();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push({ key, label: humanise(key) });
	}

	return out;
}

/** `client_name` and `client-name` and `clientName` all read as "Client name". */
function humanise(key: string): string {
	const words = key
		.replace(/[_-]+/g, ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.trim()
		.toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The body with the answers put in.
 *
 * A placeholder with no answer is left exactly as it was rather than replaced
 * with an empty string. A half-filled template that still shows `[name]` is
 * obviously unfinished; one with a blank where the name should be looks
 * finished and goes out that way.
 */
export function fillTemplate(body: string, values: Record<string, string>): string {
	return body.replace(PLACEHOLDER, (whole, rawKey: string) => {
		const key = rawKey.trim();
		const value = values[key];
		return value !== undefined && value !== '' ? value : whole;
	});
}

/** Which placeholders are still unanswered, for the sentence that says so. */
export function missingInputs(body: string, values: Record<string, string>): TemplateInput[] {
	return templateInputs(body).filter(({ key }) => !values[key]);
}
