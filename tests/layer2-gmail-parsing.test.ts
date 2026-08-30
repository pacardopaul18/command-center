import { describe, expect, it } from 'vitest';
import { decodeBody, extractBody, parseAddress, parseAddressList, stripHtml } from '../src/lib/server/google';

/**
 * Gmail parsing, tested directly.
 *
 * This is where the bugs in a mail reader actually live. Not in the fetching,
 * which either works or returns an error, but in the decoding: base64 that is
 * not quite base64, bodies nested one level deeper than expected, names with
 * quotes around them, characters that are not ASCII.
 *
 * Every case below is a real shape Gmail returns, and each one, gone wrong,
 * produces something that looks like working software: a body that is empty, a
 * name that is mangled, a reply whose text was silently dropped.
 */

/** Gmail's base64url: '+' and '/' replaced, which atob does not accept. */
function toBase64Url(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
}

describe('layer 2: decoding a Gmail body', () => {
	it('decodes base64url, which is not what atob accepts', () => {
		expect(decodeBody(toBase64Url('Hello, Paul.'))).toBe('Hello, Paul.');
	});

	it('keeps characters that are not ASCII', () => {
		// Decoding as latin1 mangles every accented name and every smart quote,
		// which is most real correspondence. It fails quietly: the body is still
		// there, just wrong.
		const text = 'Café — naïve “quoted” Ω 日本語';
		expect(decodeBody(toBase64Url(text))).toBe(text);
	});

	it('survives content that produces the base64url substitutions', () => {
		// A body whose base64 contains + or / is where a naive atob call breaks,
		// and it depends on the content, so it works until one day it does not.
		const text = '???>>>~~~<<<???' .repeat(20) + 'ÿÿÿ';
		expect(decodeBody(toBase64Url(text))).toBe(text);
	});
});

describe('layer 2: finding the readable part of a message', () => {
	it('prefers text/plain', () => {
		const found = extractBody({
			mimeType: 'multipart/alternative',
			parts: [
				{ mimeType: 'text/plain', body: { data: toBase64Url('the plain one') } },
				{ mimeType: 'text/html', body: { data: toBase64Url('<p>the html one</p>') } }
			]
		});
		expect(found.text).toBe('the plain one');
	});

	it('walks nested parts, because a reply with an attachment nests deeper', () => {
		// Stopping at the top level silently loses the body of exactly the
		// messages that matter most: real replies with files attached.
		const found = extractBody({
			mimeType: 'multipart/mixed',
			parts: [
				{
					mimeType: 'multipart/alternative',
					parts: [{ mimeType: 'text/plain', body: { data: toBase64Url('buried text') } }]
				},
				{ mimeType: 'application/pdf', body: { data: toBase64Url('not text') } }
			]
		});
		expect(found.text).toBe('buried text');
	});

	it('falls back to html when there is no plain part', () => {
		const found = extractBody({
			mimeType: 'text/html',
			body: { data: toBase64Url('<p>only html</p>') }
		});
		expect(found.text).toBeNull();
		expect(found.html).toBe('<p>only html</p>');
	});

	it('returns nothing rather than throwing on an empty payload', () => {
		expect(extractBody(undefined)).toEqual({ text: null, html: null });
		expect(extractBody({})).toEqual({ text: null, html: null });
	});

	it('stops rather than recursing forever on a self-referencing payload', () => {
		const loop: Record<string, unknown> = { mimeType: 'multipart/mixed' };
		loop.parts = [loop];
		expect(() => extractBody(loop)).not.toThrow();
	});
});

describe('layer 2: turning html into something readable', () => {
	it('drops style and script content rather than reading it out', () => {
		const html = '<style>.a{color:red}</style><p>Real text</p><script>alert(1)</script>';
		const text = stripHtml(html);
		expect(text).toContain('Real text');
		expect(text).not.toContain('color:red');
		expect(text).not.toContain('alert');
	});

	it('turns block ends into line breaks so paragraphs survive', () => {
		expect(stripHtml('<p>One</p><p>Two</p>')).toMatch(/One\s*\n\s*Two/);
		expect(stripHtml('One<br>Two')).toMatch(/One\s*\n\s*Two/);
	});

	it('decodes the entities that would otherwise be read aloud as markup', () => {
		expect(stripHtml('<p>Tom &amp; Jerry &lt;here&gt; &quot;now&quot; &#39;then&#39;</p>')).toBe(
			'Tom & Jerry <here> "now" \'then\''
		);
	});
});

describe('layer 2: parsing addresses', () => {
	it('splits a display name from an address', () => {
		expect(parseAddress('Paul Pacardo <paul@x.test>')).toEqual({
			name: 'Paul Pacardo',
			email: 'paul@x.test'
		});
	});

	it('strips the quotes some clients put around a name', () => {
		expect(parseAddress('"Pacardo, Paul" <paul@x.test>').name).toBe('Pacardo, Paul');
	});

	it('handles a bare address with no name', () => {
		expect(parseAddress('paul@x.test')).toEqual({ name: null, email: 'paul@x.test' });
	});

	it('lowercases the address, so matching a contact is not case dependent', () => {
		// Client linking is an exact address match. If one side is not
		// normalised, mail from Paul@X.test never matches paul@x.test and the
		// link silently never happens.
		expect(parseAddress('Paul <PAUL@X.TEST>').email).toBe('paul@x.test');
	});

	it('returns nothing for an empty header rather than an empty string', () => {
		expect(parseAddress(null)).toEqual({ name: null, email: null });
		expect(parseAddressList(null)).toBeNull();
	});

	it('reads every address out of a header that carries several', () => {
		expect(parseAddressList('A <a@x.test>, "B, Ltd" <b@y.test>, c@z.test')).toBe(
			'a@x.test, b@y.test, c@z.test'
		);
	});
});
