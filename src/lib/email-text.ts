/**
 * Splitting a plain-text email into the part somebody wrote and the parts
 * every mail client hides.
 *
 * The quote trail is why threads looked like walls rather than like mail. A
 * five-line reply carries the whole conversation beneath it, prefixed with
 * angle brackets, and by the fourth reply the quoted history is ten times the
 * length of anything new. Gmail collapses it behind an ellipsis. So does this.
 *
 * Nothing is discarded. Collapsed is not deleted: the trail is one click away,
 * because sometimes the quoted part is exactly what is being pointed at.
 */

export interface SplitBody {
	/** What this sender actually wrote. */
	body: string;
	/** The conversation quoted underneath it, if any. */
	quoted: string;
	/** A signature block, if one was marked. */
	signature: string;
}

/**
 * The line that introduces a quote trail.
 *
 * Deliberately several patterns rather than one clever regex. Clients differ,
 * and a pattern that misses means a wall stays; a pattern that over-matches
 * means real text gets hidden. These are the conservative, common forms.
 */
const ATTRIBUTION = [
	// On Fri, 29 Aug 2026 at 14:02, Someone <a@b.test> wrote:
	/^On\s.{0,120}\bwrote:\s*$/i,
	// El vie, 29 ago 2026, Someone escribió:
	/^El\s.{0,120}\bescribi[oó]:\s*$/i,
	/^-{2,}\s*Original Message\s*-{2,}\s*$/i,
	/^-{2,}\s*Forwarded message\s*-{2,}\s*$/i,
	/^_{5,}\s*$/,
	/^From:\s.+$/i
];

/** A signature, by the convention that predates every mail client in use. */
const SIGNATURE_DELIMITER = /^--\s?$/;

function isQuoteLine(line: string): boolean {
	return line.startsWith('>') || line.startsWith(' >');
}

export function splitBody(raw: string): SplitBody {
	const lines = raw.replace(/\r\n/g, '\n').split('\n');

	let quoteStart = -1;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();

		// An attribution line only starts a trail when quoted text follows it.
		// Otherwise "From: accounting" in the middle of a sentence would swallow
		// the rest of a legitimate message.
		if (ATTRIBUTION.some((p) => p.test(line))) {
			const ahead = lines.slice(i + 1, i + 6);
			if (ahead.some((l) => isQuoteLine(l)) || /^From:/i.test(line)) {
				quoteStart = i;
				break;
			}
		}

		// A run of quoted lines starts the trail where the run starts. A single
		// quoted line mid-message is usually somebody quoting one sentence back,
		// which belongs with the body.
		if (isQuoteLine(lines[i])) {
			let run = 0;
			for (let j = i; j < lines.length && run < 3; j++) {
				if (isQuoteLine(lines[j]) || lines[j].trim() === '') run += isQuoteLine(lines[j]) ? 1 : 0;
				else break;
			}
			if (run >= 3) {
				quoteStart = i;
				break;
			}
		}
	}

	const bodyLines = quoteStart === -1 ? lines : lines.slice(0, quoteStart);
	const quoted = quoteStart === -1 ? '' : lines.slice(quoteStart).join('\n').trim();

	// The signature is looked for only in the part that was written here, so a
	// delimiter inside a quote trail does not cut the body short.
	let signature = '';
	let kept = bodyLines;
	for (let i = bodyLines.length - 1; i >= 0; i--) {
		if (SIGNATURE_DELIMITER.test(bodyLines[i])) {
			signature = bodyLines.slice(i + 1).join('\n').trim();
			kept = bodyLines.slice(0, i);
			break;
		}
	}

	return {
		body: kept.join('\n').trim(),
		quoted,
		signature
	};
}

/**
 * Paragraphs, for flowing plain text in the reading font.
 *
 * Plain text mail is hard-wrapped at about 72 columns by the sender's client.
 * Rendering it in a monospace block preserves those breaks and produces the
 * narrow ragged column Paul was looking at. Joining the wrapped lines back into
 * paragraphs and letting the page wrap them is what makes it read like prose.
 *
 * A line is treated as a continuation when the one before it is long enough to
 * have been wrapped rather than ended deliberately. Short lines are left as
 * their own lines, which keeps lists, addresses and signatures intact.
 */
const WRAP_THRESHOLD = 60;

export function toParagraphs(text: string): string[] {
	const paragraphs: string[] = [];
	let current: string[] = [];

	for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
		const line = raw.trimEnd();

		if (line.trim() === '') {
			if (current.length) paragraphs.push(current.join(' '));
			current = [];
			continue;
		}

		// A bullet, a quote marker or an indent starts its own line rather than
		// being folded into the sentence above it.
		const standalone = /^\s*([-*•]|\d+[.)]|>)/.test(line) || /^\s{2,}/.test(raw);
		const previous = current[current.length - 1];

		if (standalone || (previous !== undefined && previous.length < WRAP_THRESHOLD)) {
			if (current.length) paragraphs.push(current.join(' '));
			current = [line.trim()];
			continue;
		}

		current.push(line.trim());
	}

	if (current.length) paragraphs.push(current.join(' '));
	return paragraphs.filter((p) => p.trim());
}
