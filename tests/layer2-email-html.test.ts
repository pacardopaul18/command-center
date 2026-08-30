import { describe, expect, it } from 'vitest';
import { decodeEntities, looksLikeHtml, parseEmailHtml, type EmailNode } from '../src/lib/email-html';

/**
 * The email HTML parser, which handles the most hostile input in the app.
 *
 * Marketing mail carries scripts, tracking pixels, styles that would escape
 * into the page, and links whose text says one thing and whose href says
 * another. The parser is the boundary, so its guarantees are asserted rather
 * than trusted, and each test below names the attack or the malformation it
 * exists to stop.
 */

function flatten(nodes: EmailNode[]): string {
	return nodes
		.map((n) => (n.kind === 'text' ? n.text : flatten(n.children)))
		.join('');
}

function tags(nodes: EmailNode[]): string[] {
	return nodes.flatMap((n) => (n.kind === 'element' ? [n.tag, ...tags(n.children)] : []));
}

function findTag(nodes: EmailNode[], tag: string): EmailNode | undefined {
	for (const node of nodes) {
		if (node.kind !== 'element') continue;
		if (node.tag === tag) return node;
		const deeper = findTag(node.children, tag);
		if (deeper) return deeper;
	}
	return undefined;
}

describe('layer 2: the email parser drops what can execute', () => {
	it('discards a script tag and everything inside it', () => {
		const nodes = parseEmailHtml('<p>Before</p><script>alert(1)</script><p>After</p>');
		expect(tags(nodes)).not.toContain('script');
		// Dropping only the tag would leave the code rendered as prose.
		expect(flatten(nodes)).not.toContain('alert');
		expect(flatten(nodes)).toContain('Before');
		expect(flatten(nodes)).toContain('After');
	});

	it('discards a style block rather than reading the css aloud', () => {
		const nodes = parseEmailHtml('<style>.a{color:red}</style><p>Real</p>');
		expect(flatten(nodes)).not.toContain('color:red');
		expect(flatten(nodes)).toContain('Real');
	});

	it('drops iframes, forms, objects and svg entirely', () => {
		for (const tag of ['iframe', 'form', 'object', 'embed', 'svg']) {
			const nodes = parseEmailHtml(`<${tag}>payload</${tag}><p>kept</p>`);
			expect(tags(nodes), `${tag} survived`).not.toContain(tag);
			expect(flatten(nodes)).not.toContain('payload');
		}
	});

	it('never keeps an event handler attribute, because none are read at all', () => {
		const nodes = parseEmailHtml('<p onclick="steal()" onmouseover="x()">text</p>');
		const node = findTag(nodes, 'p');
		expect(node).toBeTruthy();
		// Only href, src and alt are ever read off a tag, so there is no path by
		// which an on* attribute reaches a node in the first place.
		expect(JSON.stringify(node)).not.toContain('onclick');
		expect(JSON.stringify(node)).not.toContain('steal');
	});

	it('drops a style attribute, so mail cannot restyle the app around it', () => {
		const nodes = parseEmailHtml('<div style="position:fixed;top:0">x</div>');
		expect(JSON.stringify(nodes)).not.toContain('position:fixed');
	});
});

describe('layer 2: the email parser refuses unsafe urls', () => {
	it('turns a javascript: link into plain text rather than a link', () => {
		const nodes = parseEmailHtml('<a href="javascript:alert(1)">Click me</a>');
		expect(findTag(nodes, 'a')).toBeUndefined();
		// The words survive; the link does not. A clickable thing that goes
		// nowhere would be worse than showing it as text.
		expect(flatten(nodes)).toContain('Click me');
	});

	it('refuses data: and vbscript: hrefs too', () => {
		for (const href of ['data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox', 'VBScript:x']) {
			const nodes = parseEmailHtml(`<a href="${href}">x</a>`);
			expect(findTag(nodes, 'a'), `${href} produced a link`).toBeUndefined();
		}
	});

	it('keeps http, https and mailto', () => {
		for (const href of ['https://example.test/x', 'http://example.test', 'mailto:a@b.test']) {
			const nodes = parseEmailHtml(`<a href="${href}">x</a>`);
			const link = findTag(nodes, 'a');
			expect(link, `${href} was dropped`).toBeTruthy();
			if (link?.kind === 'element') expect(link.href).toBe(href);
		}
	});

	it('drops an image whose source is not a safe absolute url', () => {
		expect(findTag(parseEmailHtml('<img src="javascript:x">'), 'img')).toBeUndefined();
		expect(findTag(parseEmailHtml('<img src="/relative.png">'), 'img')).toBeUndefined();
		expect(findTag(parseEmailHtml('<img src="https://x.test/p.gif">'), 'img')).toBeTruthy();
	});

	it('survives an href hidden behind entity encoding', () => {
		// &#106; is 'j'. A parser that decoded after checking the scheme would let
		// this through as a link.
		const nodes = parseEmailHtml('<a href="&#106;avascript:alert(1)">x</a>');
		expect(findTag(nodes, 'a')).toBeUndefined();
	});
});

describe('layer 2: the email parser survives real mail', () => {
	it('handles unclosed tags rather than refusing the message', () => {
		// Email HTML is frequently malformed. A parser that rejected bad input
		// would refuse to show mail people actually receive.
		const nodes = parseEmailHtml('<p>One<p>Two<div>Three');
		expect(flatten(nodes)).toContain('One');
		expect(flatten(nodes)).toContain('Two');
		expect(flatten(nodes)).toContain('Three');
	});

	it('ignores a stray angle bracket instead of eating the rest', () => {
		const nodes = parseEmailHtml('<p>5 < 6 and 7 > 2</p>');
		expect(flatten(nodes)).toContain('5');
		expect(flatten(nodes)).toContain('2');
	});

	it('skips comments, including the conditional ones Outlook mail carries', () => {
		const nodes = parseEmailHtml('<!--[if mso]><table><tr><td><![endif]--><p>Body</p>');
		expect(flatten(nodes).trim()).toBe('Body');
	});

	it('keeps table structure, which is how most mail is laid out', () => {
		const nodes = parseEmailHtml('<table><tr><td>Cell</td></tr></table>');
		expect(tags(nodes)).toContain('table');
		expect(tags(nodes)).toContain('td');
		expect(flatten(nodes)).toContain('Cell');
	});

	it('does not recurse forever on deeply nested markup', () => {
		const deep = '<div>'.repeat(500) + 'bottom' + '</div>'.repeat(500);
		expect(() => parseEmailHtml(deep)).not.toThrow();
	});

	it('caps a pathological document rather than building it all', () => {
		const many = '<p>x</p>'.repeat(20000);
		const nodes = parseEmailHtml(many);
		expect(tags(nodes).length).toBeLessThanOrEqual(4000);
	});
});

describe('layer 2: entities and detection', () => {
	it('decodes named and numeric entities', () => {
		expect(decodeEntities('Tom &amp; Jerry &lt;x&gt; &#65; &#x42;')).toBe('Tom & Jerry <x> A B');
	});

	it('drops control characters rather than emitting them', () => {
		expect(decodeEntities('a&#0;b&#8;c')).toBe('abc');
	});

	it('leaves an unknown entity alone rather than mangling it', () => {
		expect(decodeEntities('100&fake;')).toBe('100&fake;');
	});

	it('tells html from a plain body that merely mentions a bracket', () => {
		expect(looksLikeHtml('<p>hello</p>')).toBe(true);
		expect(looksLikeHtml('<table><tr><td>x')).toBe(true);
		expect(looksLikeHtml('I said 5 < 6 to him')).toBe(false);
		expect(looksLikeHtml('plain text, no markup at all')).toBe(false);
	});
});
