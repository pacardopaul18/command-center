/**
 * Rich text, for the fields people write prose into.
 *
 * Ticket descriptions, project and client notes, meeting notes and SOP bodies
 * were plain textareas. A description pasted out of Asana arrived as a wall of
 * run-together sentences with its lists and emphasis gone, which is a real loss:
 * the structure was how the writer said what mattered.
 *
 * THE SAFETY APPROACH IS THE SAME ONE THE APP ALREADY USES, and it is stronger
 * than sanitising. Nothing here filters a hostile string and hopes it caught
 * everything. The input is parsed into a validated tree, and the stored string
 * is built back up from that tree with every piece of text escaped. The output
 * can only contain constructs this file knows how to emit, so a missed attack
 * vector is not the failure mode: a bug in the serialiser would be, and the
 * serialiser is thirty lines with no branches that emit caller-supplied markup.
 *
 * `{@html}` never appears anywhere in this feature. The renderer walks the same
 * tree emitting real Svelte elements, exactly as `EmailNodes.svelte` does.
 *
 * WHAT IS STORED. Two columns per field. The HTML goes in `<field>_html`, and
 * the plain-text projection stays in the original column. That way every
 * existing reader keeps working untouched: search, the digests, the AI prompts,
 * the CSV exports and the Asana push all read plain text and none of them had
 * to learn about markup. The projection is derived on write, so the two cannot
 * drift.
 *
 * THE ALLOW LIST IS ASANA'S. Asana's rich text is a fixed subset of HTML, and a
 * description that round-trips through this app has to come back the same or
 * the mirror is lying about what is in the workspace. Every tag Asana emits is
 * kept. Nothing else is.
 */

export interface RichTextNode {
	kind: 'text';
	text: string;
}

export interface RichElementNode {
	kind: 'element';
	tag: RichTag;
	href?: string;
	children: RichNode[];
}

export type RichNode = RichTextNode | RichElementNode;

/**
 * The tags that survive, which is Asana's set and no more.
 *
 * `h1` and `h2` are kept as themselves rather than demoted. A ticket
 * description is rendered inside a page that already owns its single `h1`, so
 * the renderer maps heading levels down at draw time. Demoting them here would
 * mean the stored HTML no longer matched what Asana holds, and the field would
 * lose a level every time it was edited and saved.
 */
const TAGS = [
	'p',
	'br',
	'hr',
	'strong',
	'em',
	'u',
	's',
	'code',
	'pre',
	'blockquote',
	'ol',
	'ul',
	'li',
	'a',
	'h1',
	'h2',
	'table',
	'tr',
	'td'
] as const;

export type RichTag = (typeof TAGS)[number];

/** Input tags accepted, mapped to the tag they are stored as. */
const ACCEPTED: Record<string, RichTag> = {
	p: 'p',
	div: 'p',
	br: 'br',
	hr: 'hr',
	strong: 'strong',
	b: 'strong',
	em: 'em',
	i: 'em',
	u: 'u',
	s: 's',
	strike: 's',
	del: 's',
	code: 'code',
	pre: 'pre',
	blockquote: 'blockquote',
	ol: 'ol',
	ul: 'ul',
	li: 'li',
	a: 'a',
	h1: 'h1',
	h2: 'h2',
	// Anything deeper than h2 is a heading Asana does not have. Kept as h2
	// rather than dropped, because losing a heading loses the structure the
	// writer put there, and one level of flattening does not.
	h3: 'h2',
	h4: 'h2',
	h5: 'h2',
	h6: 'h2',
	table: 'table',
	tbody: 'table',
	thead: 'table',
	tr: 'tr',
	td: 'td',
	th: 'td',
	// Asana wraps a whole rich-text value in <body>. Unwrapped rather than
	// dropped with its contents, which would empty every pasted description.
	body: 'p',
	span: 'p'
};

/**
 * Tags whose contents go too, not just the tag.
 *
 * Dropping only the tag would leave a stylesheet or a script body rendered as
 * prose. Nothing in this set has a reading purpose.
 */
const DISCARD_CONTENT = new Set([
	'script',
	'style',
	'head',
	'title',
	'noscript',
	'svg',
	'iframe',
	'object',
	'embed',
	'form',
	'select',
	'textarea',
	'template'
]);

/** Tags that never have children. */
const SELF_CLOSING = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'wbr', 'source']);

/**
 * Tags that are unwrapped rather than kept when they hold no useful structure.
 *
 * `body` and `span` map to `p` above so their contents survive the parse. At
 * serialise time a `p` holding only other blocks would produce invalid nesting,
 * so the block is flattened. Kept here rather than solved in the parser because
 * the parser's job is to be tolerant and the serialiser's is to be strict.
 */
const BLOCK = new Set<RichTag>(['p', 'hr', 'blockquote', 'ol', 'ul', 'li', 'h1', 'h2', 'pre', 'table', 'tr', 'td']);

const SAFE_SCHEME = /^(https?:|mailto:)/i;

function safeHref(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	const trimmed = raw.trim();
	// Absolute safe schemes only. This rules out javascript:, data: and
	// vbscript:, and a relative href in a pasted description has no base to
	// resolve against and would point at this app rather than at what was meant.
	return SAFE_SCHEME.test(trimmed) ? trimmed : undefined;
}

/**
 * Entities, decoded faithfully.
 *
 * Deliberately not shared with `email-html.ts`, whose decoder turns an em dash
 * into a hyphen and a non-breaking space into a space on purpose: mail is being
 * flattened for reading. This content is being stored and sent back, so a
 * character that goes in has to come out, and a lossy decode would quietly
 * rewrite a client's own words a little more on every save.
 */
const NAMED: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	/*
	 * The punctuation that pasted content actually carries.
	 *
	 * An entity this table does not know passes through as literal text and is
	 * then escaped, so a body holding one comes back with a visible "&amp;" in
	 * front of it: corrupted once, on the first save, and not recoverable. Found
	 * because the SOP template used one.
	 *
	 * Decoded to the real character rather than to an approximation. Mail is
	 * flattened for reading, which is why the decoder in email-html.ts turns
	 * these into hyphens; this content is stored and read back, so a character
	 * that goes in has to come out.
	 */
	mdash: '—',
	ndash: '–',
	hellip: '…',
	lsquo: '‘',
	rsquo: '’',
	ldquo: '“',
	rdquo: '”',
	bull: '•',
	middot: '·',
	deg: '°',
	trade: '™',
	copy: '©',
	reg: '®',
	pound: '£',
	euro: '€'
};

export function decodeRichEntities(text: string): string {
	return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
		if (body[0] === '#') {
			const code =
				body[1] === 'x' || body[1] === 'X'
					? Number.parseInt(body.slice(2), 16)
					: Number.parseInt(body.slice(1), 10);
			if (!Number.isFinite(code) || code < 32) return '';
			try {
				return String.fromCodePoint(code);
			} catch {
				return '';
			}
		}
		const named = NAMED[body.toLowerCase()];
		return named === undefined ? whole : named;
	});
}

/** Escapes text for the five places it could otherwise be read as markup. */
export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Guards against a pathological paste eating the request. */
const MAX_NODES = 4000;
const MAX_DEPTH = 30;

/** Reads href out of a tag's attribute text. Every other attribute is dropped. */
function readHref(raw: string): string | undefined {
	const pattern = /([a-z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(raw))) {
		if (match[1].toLowerCase() === 'href') {
			return safeHref(decodeRichEntities(match[3] ?? match[4] ?? match[5] ?? ''));
		}
	}
	return undefined;
}

/**
 * Parses rich text HTML into a validated tree.
 *
 * A hand written scanner rather than DOMParser, because this runs on the server
 * as well as in the browser and a parser that exists only in one of them means
 * the stored value depends on where the save happened.
 *
 * Tolerant on purpose. Content pasted out of Asana, Word or a browser is often
 * malformed, and a parser that refused it would refuse real work. Anything it
 * cannot make sense of becomes text, which is visible and recoverable, rather
 * than being dropped, which is not.
 */
export function parseRichText(html: string): RichNode[] {
	const root: RichElementNode = { kind: 'element', tag: 'p', children: [] };
	const stack: RichElementNode[] = [root];
	let nodes = 0;
	let index = 0;

	function push(node: RichNode) {
		if (nodes >= MAX_NODES) return;
		nodes += 1;
		stack[stack.length - 1].children.push(node);
	}

	function addText(raw: string) {
		const text = decodeRichEntities(raw);
		if (text) push({ kind: 'text', text });
	}

	while (index < html.length) {
		const open = html.indexOf('<', index);
		if (open === -1) {
			addText(html.slice(index));
			break;
		}
		if (open > index) addText(html.slice(index, open));

		if (html.startsWith('<!--', open)) {
			const end = html.indexOf('-->', open);
			index = end === -1 ? html.length : end + 3;
			continue;
		}
		if (html.startsWith('<!', open)) {
			const end = html.indexOf('>', open);
			index = end === -1 ? html.length : end + 1;
			continue;
		}

		const close = html.indexOf('>', open);
		if (close === -1) {
			// A stray angle bracket at the end. Text, not a dropped tag.
			addText(html.slice(open));
			break;
		}

		const inner = html.slice(open + 1, close);
		index = close + 1;

		const isClosing = inner.startsWith('/');
		const nameMatch = /^\/?\s*([a-z0-9]+)/i.exec(inner);
		if (!nameMatch) {
			addText(html.slice(open, close + 1));
			continue;
		}
		const name = nameMatch[1].toLowerCase();

		if (DISCARD_CONTENT.has(name)) {
			if (isClosing) continue;
			const endTag = new RegExp(`</\\s*${name}\\s*>`, 'i');
			const rest = html.slice(index);
			const found = endTag.exec(rest);
			index = found ? index + found.index + found[0].length : html.length;
			continue;
		}

		if (isClosing) {
			const mapped = ACCEPTED[name];
			if (!mapped) continue;
			for (let depth = stack.length - 1; depth > 0; depth--) {
				if (stack[depth].tag === mapped) {
					stack.length = depth;
					break;
				}
			}
			continue;
		}

		const mapped = ACCEPTED[name];
		if (!mapped) continue;

		const node: RichElementNode = { kind: 'element', tag: mapped, children: [] };
		if (mapped === 'a') {
			node.href = readHref(inner.slice(nameMatch[0].length));
			// An anchor with no safe href is not a link. Rendering one would show
			// something clickable that goes nowhere, so it keeps its text and
			// loses its linkhood.
			if (!node.href) node.tag = 'p';
		}

		push(node);

		const selfClosed = inner.trimEnd().endsWith('/') || SELF_CLOSING.has(name);
		if (!selfClosed && stack.length < MAX_DEPTH) stack.push(node);
	}

	return root.children;
}

/** Whether a node holds anything a reader would see. */
function hasContent(node: RichNode): boolean {
	if (node.kind === 'text') return node.text.trim().length > 0;
	if (node.tag === 'br' || node.tag === 'hr') return true;
	return node.children.some(hasContent);
}

/**
 * Builds the canonical HTML back up from the tree.
 *
 * This is the half that makes the whole thing safe. Every tag emitted is a
 * literal in this function, every attribute is `href` and nothing else, and
 * every piece of text goes through `escapeHtml`. Nothing the caller sent is
 * ever concatenated into markup.
 */
function serialize(nodes: RichNode[]): string {
	let out = '';
	for (const node of nodes) {
		if (node.kind === 'text') {
			out += escapeHtml(node.text);
			continue;
		}
		if (node.tag === 'br') {
			out += '<br>';
			continue;
		}
		if (node.tag === 'hr') {
			out += '<hr>';
			continue;
		}
		if (!hasContent(node)) continue;

		const inner = serialize(node.children);
		if (node.tag === 'a') {
			out += `<a href="${escapeHtml(node.href ?? '')}">${inner}</a>`;
			continue;
		}
		// A paragraph that turned out to hold other blocks is unwrapped rather
		// than emitted, because <p><ul></ul></p> is not valid and a browser will
		// silently restructure it into something that no longer round-trips.
		if (node.tag === 'p' && node.children.some((c) => c.kind === 'element' && BLOCK.has(c.tag))) {
			out += inner;
			continue;
		}
		out += `<${node.tag}>${inner}</${node.tag}>`;
	}
	return out;
}

/**
 * The one function every write path calls.
 *
 * Idempotent by construction: the output is already canonical, so parsing and
 * re-serialising it produces the same string. That property is asserted in the
 * tests, because a sanitiser that changes its own output changes the stored
 * value on every save and nothing would ever settle.
 */
export function sanitizeRichText(html: string | null | undefined): string | null {
	if (html === null || html === undefined) return null;
	const trimmed = String(html).trim();
	if (!trimmed) return null;
	const out = serialize(parseRichText(trimmed)).trim();
	return out || null;
}

/**
 * How the plain projection separates things.
 *
 * A paragraph boundary is a blank line and a line break is one newline, which
 * is the distinction the writer made and the only way the text can be turned
 * back into the same HTML. Collapsing both to a single newline was the first
 * version, and plainToRichText(richTextToPlain(x)) then lost a paragraph
 * boundary on every pass: a note saved three times would arrive as one block.
 */
const ENDS_PARAGRAPH = new Set<RichTag>(['p', 'h1', 'h2', 'blockquote', 'pre', 'ul', 'ol', 'table']);
const ENDS_LINE = new Set<RichTag>(['br', 'hr', 'li', 'tr']);

/**
 * The plain-text projection, which is what search and every existing reader see.
 *
 * Not a fallback and not a preview. It is the same content with the markup
 * removed, derived on write so it cannot drift from the HTML beside it. A list
 * keeps its bullets because a run of items with no separator reads as one long
 * sentence, which is the exact failure this whole change is fixing.
 */
export function richTextToPlain(html: string | null | undefined): string | null {
	if (html === null || html === undefined) return null;
	const source = String(html);
	if (!source.trim()) return null;

	let out = '';
	const walk = (nodes: RichNode[], listDepth: number) => {
		for (const node of nodes) {
			if (node.kind === 'text') {
				out += node.text.replace(/\s+/g, ' ');
				continue;
			}
			if (node.tag === 'hr') {
				out += '\n';
				continue;
			}
			if (node.tag === 'br') {
				out += '\n';
				continue;
			}
			if (node.tag === 'li') out += '- ';
			if (node.tag === 'td' && out && !out.endsWith('\n')) out += '\t';
			walk(node.children, node.tag === 'ol' || node.tag === 'ul' ? listDepth + 1 : listDepth);
			if (ENDS_PARAGRAPH.has(node.tag)) {
				out = out.replace(/\n+$/, '') + '\n\n';
			} else if (ENDS_LINE.has(node.tag) && !out.endsWith('\n')) {
				out += '\n';
			}
		}
	};
	walk(parseRichText(source), 0);

	return (
		out
			// Runs of blank lines collapse to one. A pasted description often has
			// an empty paragraph between every real one.
			.replace(/[ \t]+\n/g, '\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim() || null
	);
}

/**
 * Turns an existing plain value into HTML, for a field being edited for the
 * first time.
 *
 * Every one of these fields already holds plain text written before there was
 * an editor. Opening one and seeing a single run-on paragraph would look like
 * the editor had eaten the line breaks, so the blank-line blocks become
 * paragraphs and single newlines become breaks, which is what the writer meant.
 */
export function plainToRichText(text: string | null | undefined): string | null {
	if (text === null || text === undefined) return null;
	const source = String(text).replace(/\r\n?/g, '\n').trim();
	if (!source) return null;

	return source
		.split(/\n{2,}/)
		.map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
		.join('');
}

/**
 * Whether an editor value is really empty.
 *
 * A contenteditable that has been focused and cleared leaves `<p></p>` or a
 * lone `<br>` behind. Storing that would make an empty field test as present,
 * so every "does this have notes" check on every screen would start saying yes.
 */
export function isRichTextEmpty(html: string | null | undefined): boolean {
	return sanitizeRichText(html) === null || richTextToPlain(html) === null;
}
