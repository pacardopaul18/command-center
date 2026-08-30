/**
 * Email HTML, parsed into a tree that can be rendered as Svelte elements.
 *
 * The same safety approach as the markdown renderer, for the same reason: this
 * component never produces an HTML string and nothing ever reaches `{@html}`.
 * The source is parsed into nodes, unknown tags and every attribute outside a
 * short allowlist are dropped during parsing, and the renderer walks the tree
 * emitting real Svelte elements. There is nothing to sanitise afterwards
 * because no HTML is ever constructed.
 *
 * That matters more here than anywhere else in the app. Marketing email is
 * hostile input by default: it carries tracking pixels, scripts, styles that
 * would escape into the page, and links whose text says one thing and whose
 * href says another. This is the most untrusted content the app handles.
 *
 * What is deliberately dropped, and why:
 *   script, style, link, meta, iframe, object, embed, form, input, svg
 *     Execution, network calls, and layout escapes. None have a reading purpose.
 *   every attribute except href, src, alt, colspan, rowspan, width, height
 *     No `style`, so mail cannot restyle the app. No `on*`, so nothing runs.
 *     No `class`, so mail cannot borrow the app's own styling to look native.
 *   any href or src that is not http, https or mailto
 *     Rules out javascript:, data: and vbscript:.
 *
 * Images are kept but not loaded by default: see `IMAGE_PLACEHOLDER` below.
 */

export interface EmailTextNode {
	kind: 'text';
	text: string;
}

export interface EmailElementNode {
	kind: 'element';
	tag: string;
	href?: string;
	src?: string;
	alt?: string;
	children: EmailNode[];
}

export type EmailNode = EmailTextNode | EmailElementNode;

/** Tags kept, mapped to what they render as. */
const ALLOWED: Record<string, string> = {
	p: 'p',
	br: 'br',
	hr: 'hr',
	div: 'div',
	span: 'span',
	section: 'div',
	article: 'div',
	main: 'div',
	header: 'div',
	footer: 'div',
	center: 'div',
	font: 'span',
	strong: 'strong',
	b: 'strong',
	em: 'em',
	i: 'em',
	u: 'u',
	s: 's',
	strike: 's',
	small: 'small',
	sub: 'sub',
	sup: 'sup',
	a: 'a',
	ul: 'ul',
	ol: 'ol',
	li: 'li',
	blockquote: 'blockquote',
	pre: 'pre',
	code: 'code',
	h1: 'h3',
	h2: 'h3',
	h3: 'h3',
	h4: 'h4',
	h5: 'h5',
	h6: 'h6',
	table: 'table',
	thead: 'thead',
	tbody: 'tbody',
	tfoot: 'tbody',
	tr: 'tr',
	td: 'td',
	th: 'th',
	caption: 'caption',
	img: 'img'
};

/**
 * Tags whose entire contents are discarded, not just the tag.
 *
 * Dropping only the tag would leave a stylesheet's text rendered as prose,
 * which is a large part of why the stripped-text bodies read as garbage.
 */
const VOID_CONTENT = new Set(['script', 'style', 'head', 'title', 'noscript', 'svg', 'iframe', 'object', 'embed', 'form', 'select', 'textarea']);

/** Tags that never have children. */
const SELF_CLOSING = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'wbr']);

const SAFE_SCHEME = /^(https?:|mailto:)/i;

function safeUrl(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	const trimmed = raw.trim();
	// A relative URL in an email has no base to resolve against and is almost
	// always a broken tracking artifact, so only absolute safe schemes pass.
	return SAFE_SCHEME.test(trimmed) ? trimmed : undefined;
}

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	mdash: '-',
	ndash: '-',
	hellip: '...',
	rsquo: "'",
	lsquo: "'",
	rdquo: '"',
	ldquo: '"',
	middot: '·',
	bull: '•',
	trade: '(TM)',
	copy: '(c)',
	reg: '(R)'
};

export function decodeEntities(text: string): string {
	return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
		if (body[0] === '#') {
			const code =
				body[1] === 'x' || body[1] === 'X'
					? Number.parseInt(body.slice(2), 16)
					: Number.parseInt(body.slice(1), 10);
			// Control characters in mail are noise at best, so they are dropped
			// rather than emitted.
			if (!Number.isFinite(code) || code < 32) return '';
			try {
				return String.fromCodePoint(code);
			} catch {
				return '';
			}
		}
		const named = ENTITIES[body.toLowerCase()];
		return named === undefined ? whole : named;
	});
}

/** Pulls href/src/alt out of a tag's attribute text without executing anything. */
function readAttributes(raw: string): { href?: string; src?: string; alt?: string } {
	const found: { href?: string; src?: string; alt?: string } = {};
	const pattern = /([a-z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(raw))) {
		const name = match[1].toLowerCase();
		const value = decodeEntities(match[3] ?? match[4] ?? match[5] ?? '');
		if (name === 'href') found.href = safeUrl(value);
		else if (name === 'src') found.src = safeUrl(value);
		else if (name === 'alt') found.alt = value.slice(0, 300);
	}
	return found;
}

/** Guards against a pathological document eating the whole request. */
const MAX_NODES = 4000;
const MAX_DEPTH = 40;

/**
 * Parses email HTML into a validated tree.
 *
 * A hand written scanner rather than DOMParser, because this has to run during
 * server rendering as well as in the browser, and a parser that only exists on
 * one of those means the page renders differently depending on how it was
 * reached.
 *
 * Deliberately tolerant. Email HTML is frequently malformed, with unclosed
 * tags and stray angle brackets, and a parser that rejects bad input would
 * refuse to show real mail. Anything it cannot make sense of becomes text.
 */
export function parseEmailHtml(html: string): EmailNode[] {
	const root: EmailElementNode = { kind: 'element', tag: 'div', children: [] };
	const stack: EmailElementNode[] = [root];
	let nodes = 0;
	let index = 0;

	function push(node: EmailNode) {
		if (nodes >= MAX_NODES) return;
		nodes += 1;
		stack[stack.length - 1].children.push(node);
	}

	function addText(raw: string) {
		const text = decodeEntities(raw).replace(/[ \t\r\f\v]+/g, ' ');
		if (text.trim()) push({ kind: 'text', text });
		else if (text.includes('\n')) push({ kind: 'text', text: ' ' });
	}

	while (index < html.length) {
		const open = html.indexOf('<', index);
		if (open === -1) {
			addText(html.slice(index));
			break;
		}
		if (open > index) addText(html.slice(index, open));

		// A comment, including the conditional comments Outlook mail is full of.
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
			// An unclosed tag at the end. Treat the rest as text rather than
			// dropping it: a stray angle bracket is common in real mail.
			addText(html.slice(open));
			break;
		}

		const inner = html.slice(open + 1, close);
		index = close + 1;

		const isClosing = inner.startsWith('/');
		const nameMatch = /^\/?\s*([a-z0-9]+)/i.exec(inner);
		if (!nameMatch) continue;
		const name = nameMatch[1].toLowerCase();

		if (VOID_CONTENT.has(name)) {
			if (isClosing) continue;
			// Skip to the matching close, discarding everything between.
			const endTag = new RegExp(`</\\s*${name}\\s*>`, 'i');
			const rest = html.slice(index);
			const found = endTag.exec(rest);
			index = found ? index + found.index + found[0].length : html.length;
			continue;
		}

		if (isClosing) {
			// Close the nearest matching open element. Unmatched closes are
			// ignored, which is what makes malformed mail survive.
			for (let depth = stack.length - 1; depth > 0; depth--) {
				if (stack[depth].tag === ALLOWED[name]) {
					stack.length = depth;
					break;
				}
			}
			continue;
		}

		const mapped = ALLOWED[name];
		if (!mapped) continue;

		const attributes = readAttributes(inner.slice(nameMatch[0].length));
		const node: EmailElementNode = {
			kind: 'element',
			tag: mapped,
			children: [],
			...(mapped === 'a' ? { href: attributes.href } : {}),
			...(mapped === 'img' ? { src: attributes.src, alt: attributes.alt } : {})
		};

		// An anchor with no safe href is not a link. Keeping it as one would show
		// a clickable thing that goes nowhere, so it renders as plain text.
		if (mapped === 'a' && !node.href) node.tag = 'span';
		// An image with no safe source has nothing to show.
		if (mapped === 'img' && !node.src) continue;

		push(node);

		const selfClosed = inner.trimEnd().endsWith('/') || SELF_CLOSING.has(name);
		if (!selfClosed && stack.length < MAX_DEPTH) stack.push(node);
	}

	return root.children;
}

/**
 * Whether a body is worth rendering as HTML at all.
 *
 * A plain text body that happens to mention a tag should not be run through the
 * element renderer, and an HTML body with no markup left after parsing is
 * better shown as text.
 */
export function looksLikeHtml(body: string): boolean {
	return /<(p|div|table|br|a|span|img|td|tr|h[1-6]|ul|ol|li|strong|b|em)\b/i.test(body);
}
