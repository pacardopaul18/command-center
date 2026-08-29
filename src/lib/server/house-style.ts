/**
 * House style for everything an AI writes.
 *
 * F2 from the first live extraction test: the summary prompt already said
 * "never an em dash" and the model emitted one anyway. That is the lesson, not
 * the bug. A prompt is a request, not a constraint. Anything that must always
 * hold gets enforced in code, and the prompt exists to make the enforcement
 * rarely necessary rather than to be the enforcement.
 *
 * So both:
 *   HOUSE_STYLE is prepended to every AI prompt in the app.
 *   enforceHouseStyle runs over every string an AI produces before it is stored
 *   or shown.
 *
 * Same shape as the markdown decision (D44): make the bad outcome structurally
 * impossible rather than asking for it not to happen.
 */

export const HOUSE_STYLE = `Write in plain, calm, professional English. Short declarative sentences.

Style rules, all absolute:

- Never use an em dash or an en dash. Use a comma, a full stop, or the word "to"
  for a range. This is not a preference; text containing one is wrong.
- No hype, no marketing language, no exclamation points, no emoji.
- Sentence case for headings and buttons, not title case.
- Never invent a figure, a name, a date, or a commitment. Where the source is
  unclear, say it is unclear rather than choosing the likely reading.
- Do not merge two names into one entity. If it is not certain that two names
  refer to the same organisation or person, treat them as separate and say the
  relationship is unclear.`;

/**
 * Removes dashes the house style forbids, and repairs the punctuation that
 * replacing them creates.
 *
 * Ranges become "to" because "2020 to 2024" is what a person would write.
 * Everything else becomes a comma, which is what an em dash was standing in for.
 */
export function enforceHouseStyle(text: string): string {
	if (!text) return text;

	let out = text;

	// Numeric ranges read as ranges, not as an interruption.
	out = out.replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2');

	// A dash used as a parenthetical or clause break becomes a comma. Any spaces
	// around it are absorbed so "word — word" and "word—word" both land as
	// "word, word".
	out = out.replace(/\s*[‒–—―]\s*/g, ', ');

	// Replacing next to existing punctuation produces things like ",," or ".,".
	// Repair rather than leave the damage the fix caused.
	out = out.replace(/,\s*,+/g, ', ');
	out = out.replace(/([.,;:!?])\s*,\s*/g, '$1 ');
	out = out.replace(/\s+,/g, ',');
	out = out.replace(/,\s*$/gm, '');
	out = out.replace(/[ \t]{2,}/g, ' ');

	return out;
}

/** True when any forbidden dash survives. Used to assert in tests. */
export function hasForbiddenDash(text: string): boolean {
	return /[‒–—―]/.test(text ?? '');
}
