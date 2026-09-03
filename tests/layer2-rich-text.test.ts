import { describe, expect, it } from 'vitest';
import {
	isRichTextEmpty,
	parseRichText,
	plainToRichText,
	richTextToPlain,
	sanitizeRichText
} from '../src/lib/rich-text';

/**
 * Rich text, and the three properties it has to have.
 *
 * 1. Nothing dangerous survives, and it survives nothing by construction: the
 *    stored string is built from an allow list rather than filtered from the
 *    input.
 * 2. Asana's HTML round-trips. A description that came from the workspace has
 *    to go back the same or the mirror is lying about what is in it.
 * 3. The plain-text projection is real text. Every existing reader in the app,
 *    search included, reads the plain column and none of them learned about
 *    markup.
 */

describe('layer 2: nothing executable survives the parse', () => {
	/*
	 * These are the vectors, and each is checked for what is absent rather than
	 * for an exact output string, because the output being different is fine and
	 * the script running is not.
	 */
	const attacks: [string, string][] = [
		['a script tag', '<p>before</p><script>alert(1)</script><p>after</p>'],
		['a script body without its tag closing', '<script>alert(1)'],
		['an event handler', '<p onclick="alert(1)">text</p>'],
		['an event handler in odd case', '<P OnClick="alert(1)">text</P>'],
		['an unquoted handler', '<p onmouseover=alert(1)>text</p>'],
		['a javascript href', '<a href="javascript:alert(1)">click</a>'],
		['a javascript href with padding', '<a href="  JaVaScRiPt:alert(1)">click</a>'],
		['a data href', '<a href="data:text/html,<script>alert(1)</script>">click</a>'],
		['an inline style', '<p style="position:fixed;inset:0">text</p>'],
		['a style block', '<style>body{display:none}</style><p>text</p>'],
		['an iframe', '<iframe src="https://evil.example"></iframe><p>text</p>'],
		['an image with an onerror', '<img src=x onerror=alert(1)>'],
		['an svg payload', '<svg><script>alert(1)</script></svg><p>text</p>'],
		['a form', '<form action="https://evil.example"><input name="a"></form><p>text</p>'],
		['an entity-encoded script tag', '&lt;script&gt;alert(1)&lt;/script&gt;'],
		['a doubled-up tag', '<scr<script>ipt>alert(1)</script>']
	];

	for (const [name, input] of attacks) {
		it(`drops ${name}`, () => {
			const out = sanitizeRichText(input) ?? '';
			expect(out).not.toMatch(/<script/i);
			expect(out).not.toMatch(/<iframe/i);
			expect(out).not.toMatch(/<style/i);
			expect(out).not.toMatch(/<form/i);
			expect(out).not.toMatch(/<img/i);
			expect(out).not.toMatch(/<svg/i);
			expect(out).not.toMatch(/\son[a-z]+\s*=/i);
			expect(out).not.toMatch(/\sstyle\s*=/i);
			expect(out).not.toMatch(/javascript:/i);
			expect(out).not.toMatch(/\sdata:/i);
		});
	}

	it('keeps the words when it drops the tag', () => {
		// Dropping content along with markup is how a sanitiser silently eats
		// somebody's paragraph. Only the tags whose contents are noise go.
		expect(sanitizeRichText('<p onclick="alert(1)">the real sentence</p>')).toBe(
			'<p>the real sentence</p>'
		);
	});

	it('escapes text that looks like markup rather than re-emitting it', () => {
		const out = sanitizeRichText('<p>use &lt;script&gt; carefully</p>') ?? '';
		expect(out).toBe('<p>use &lt;script&gt; carefully</p>');
	});

	it('keeps an http, https or mailto link and drops every other scheme', () => {
		expect(sanitizeRichText('<a href="https://asana.com/x">t</a>')).toBe(
			'<a href="https://asana.com/x">t</a>'
		);
		expect(sanitizeRichText('<a href="mailto:a@example.com">t</a>')).toBe(
			'<a href="mailto:a@example.com">t</a>'
		);
		// The text survives; only the linkhood is lost.
		expect(sanitizeRichText('<a href="vbscript:x">t</a>')).toBe('<p>t</p>');
	});
});

describe("layer 2: Asana's HTML round-trips", () => {
	/*
	 * Asana's rich text is a fixed subset. A description edited in this app and
	 * one read out of the workspace have to be the same string, or every
	 * comparison between the mirror and the app reports a difference that is
	 * really this function's fault.
	 *
	 * GOLDEN RULE: nothing is written back to Asana. The round trip that matters
	 * is Asana to the app and back out to a reader, not to the workspace.
	 */
	const asana =
		'<body><h1>Scope</h1><p>The <strong>first</strong> phase covers <em>discovery</em> ' +
		'and <u>sign off</u>, not <s>delivery</s>.</p><ul><li>Interviews</li><li>Document review' +
		'</li></ul><ol><li>Draft</li><li>Review</li></ol><blockquote>Agreed on the call.' +
		'</blockquote><pre><code>npm run build</code></pre><hr><p>See ' +
		'<a href="https://app.asana.com/0/1/2">the task</a>.</p></body>';

	it('keeps every tag Asana emits', () => {
		const out = sanitizeRichText(asana) ?? '';
		/*
		 * Matched with the closing bracket, not as a prefix. The first version
		 * looked for `<u` and passed with `u` removed from the allow list
		 * entirely, because `<ul>` starts with `<u`. Found by deleting the rule
		 * and watching the test not care.
		 */
		for (const tag of ['h1', 'p', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code']) {
			expect(out, `${tag} was dropped`).toContain(`<${tag}>`);
		}
		expect(out, 'a was dropped').toContain('<a href=');
		expect(out).toContain('<hr>');
		expect(out).toContain('href="https://app.asana.com/0/1/2"');
	});

	it('loses no words', () => {
		const plain = richTextToPlain(asana) ?? '';
		for (const word of [
			'Scope',
			'first',
			'discovery',
			'sign off',
			'delivery',
			'Interviews',
			'Document review',
			'Draft',
			'Review',
			'Agreed on the call.',
			'npm run build',
			'the task'
		]) {
			expect(plain, `${word} was lost`).toContain(word);
		}
	});

	it('is idempotent, so saving an unchanged field changes nothing', () => {
		/*
		 * A sanitiser that rewrites its own output would change the stored value
		 * on every save. `updated_at` would move, the Asana comparison would
		 * report a difference, and nothing would ever settle.
		 */
		const once = sanitizeRichText(asana);
		const twice = sanitizeRichText(once);
		expect(twice).toBe(once);
		expect(sanitizeRichText(twice)).toBe(once);
	});

	it('unwraps the body wrapper rather than dropping what is inside it', () => {
		// Dropping an unknown outer tag with its contents empties every pasted
		// description, which is a total loss disguised as a clean parse.
		expect(sanitizeRichText('<body><p>kept</p></body>')).toBe('<p>kept</p>');
	});

	it('survives malformed input rather than refusing it', () => {
		// Pasted content is routinely unclosed. Refusing it would refuse real work.
		expect(sanitizeRichText('<p>one<p>two')).toContain('one');
		expect(sanitizeRichText('<p>one<p>two')).toContain('two');
		expect(sanitizeRichText('a < b and c > d')).toContain('a ');
	});
});

describe('layer 2: the plain projection is what search reads', () => {
	it('separates blocks so two paragraphs are not one sentence', () => {
		/*
		 * A blank line between paragraphs, one newline for a line break, because
		 * that is the distinction the writer made. Collapsing both to a single
		 * newline was the first version, and the round-trip test below caught it:
		 * a note saved three times arrived as one block, because each pass turned
		 * a paragraph boundary into a line break and the next pass believed it.
		 */
		expect(richTextToPlain('<p>First.</p><p>Second.</p>')).toBe('First.\n\nSecond.');
		expect(richTextToPlain('<p>First.<br>Still first.</p>')).toBe('First.\nStill first.');
	});

	it('keeps bullets, because a run of items with no separator reads as prose', () => {
		expect(richTextToPlain('<ul><li>One</li><li>Two</li></ul>')).toBe('- One\n- Two');
	});

	it('holds no markup at all', () => {
		const plain = richTextToPlain('<p>a <strong>b</strong> <a href="https://x.example">c</a></p>');
		expect(plain).toBe('a b c');
		expect(plain).not.toMatch(/[<>]/);
	});

	it('gives null for something that only looks like content', () => {
		// What a contenteditable leaves behind after it has been cleared. Storing
		// it would make every "does this have notes" check on every screen say yes.
		for (const empty of ['', '   ', '<p></p>', '<p><br></p>', '<p>   </p>', '<div></div>']) {
			expect(richTextToPlain(empty), `${empty} read as content`).toBe(null);
			expect(isRichTextEmpty(empty), `${empty} read as content`).toBe(true);
		}
		expect(isRichTextEmpty('<p>a</p>')).toBe(false);
	});
});

describe('layer 2: an existing plain value opens as what it was', () => {
	it('turns blank-line blocks into paragraphs and single breaks into breaks', () => {
		expect(plainToRichText('One.\n\nTwo.')).toBe('<p>One.</p><p>Two.</p>');
		expect(plainToRichText('One.\nStill one.')).toBe('<p>One.<br>Still one.</p>');
	});

	it('escapes what it converts', () => {
		expect(plainToRichText('a < b & c')).toBe('<p>a &lt; b &amp; c</p>');
	});

	it('round-trips back to the text it came from', () => {
		const text = 'One.\n\nTwo.\nStill two.';
		expect(richTextToPlain(plainToRichText(text))).toBe(text);
	});

	it('gives null for nothing', () => {
		expect(plainToRichText('')).toBe(null);
		expect(plainToRichText('   \n  ')).toBe(null);
		expect(plainToRichText(null)).toBe(null);
	});
});

describe('layer 2: the parser stops rather than hanging', () => {
	it('caps a pathological nesting depth', () => {
		const deep = '<blockquote>'.repeat(500) + 'x' + '</blockquote>'.repeat(500);
		const out = sanitizeRichText(deep) ?? '';
		expect(out).toContain('x');
		expect((out.match(/<blockquote>/g) ?? []).length).toBeLessThan(500);
	});

	it('caps a pathological node count', () => {
		const wide = '<p>x</p>'.repeat(6000);
		const out = sanitizeRichText(wide) ?? '';
		expect((out.match(/<p>/g) ?? []).length).toBeLessThanOrEqual(4000);
	});

	it('parses a large realistic body quickly', () => {
		const body = '<p>Sentence about the work.</p><ul><li>One</li><li>Two</li></ul>'.repeat(200);
		const started = Date.now();
		parseRichText(body);
		expect(Date.now() - started).toBeLessThan(1000);
	});
});
