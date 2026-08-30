import { describe, expect, it } from 'vitest';
import { splitBody, toParagraphs } from '../src/lib/email-text';

/**
 * Splitting and flowing plain text mail.
 *
 * The risk here runs both ways and the tests are built around that. Under
 * matching leaves the quote wall that made threads unreadable. Over matching
 * hides something the sender actually wrote, which is worse, because the reader
 * has no way to tell that anything is missing.
 */

describe('layer 2: separating a reply from its quote trail', () => {
	it('splits on the standard attribution line', () => {
		const raw = [
			'Sounds good, Tuesday works.',
			'',
			'On Fri, 29 Aug 2026 at 14:02, Dana <dana@x.test> wrote:',
			'> Can we move it to Tuesday?',
			'> The room is booked.',
			'> Thanks'
		].join('\n');

		const split = splitBody(raw);
		expect(split.body).toBe('Sounds good, Tuesday works.');
		expect(split.quoted).toContain('Can we move it to Tuesday?');
	});

	it('splits on a run of quoted lines with no attribution', () => {
		const raw = ['Yes.', '', '> point one', '> point two', '> point three'].join('\n');
		const split = splitBody(raw);
		expect(split.body).toBe('Yes.');
		expect(split.quoted).toContain('point one');
	});

	it('keeps a single quoted line with the body, because that is a citation', () => {
		// Somebody quoting one sentence back to answer it is writing, not
		// trailing. Hiding it would remove the thing the reply is about.
		const raw = ['> the deadline is the 3rd', '', 'Confirmed, we will hit that.'].join('\n');
		const split = splitBody(raw);
		expect(split.body).toContain('the deadline is the 3rd');
		expect(split.body).toContain('Confirmed');
		expect(split.quoted).toBe('');
	});

	it('does not treat an ordinary message as a quote trail', () => {
		const raw = 'Hi Paul,\n\nHope you are well. Can we talk Thursday?\n\nDana';
		const split = splitBody(raw);
		expect(split.quoted).toBe('');
		expect(split.body).toContain('Thursday');
	});

	it('handles forwarded messages', () => {
		const raw = [
			'Passing this on.',
			'',
			'---------- Forwarded message ----------',
			'> original text here',
			'> more original text',
			'> and more'
		].join('\n');
		expect(splitBody(raw).body).toBe('Passing this on.');
	});

	it('separates a signature on the conventional delimiter', () => {
		const raw = ['Thanks for this.', '', '-- ', 'Dana Reyes', 'Ops lead', 'x.test'].join('\n');
		const split = splitBody(raw);
		expect(split.body).toBe('Thanks for this.');
		expect(split.signature).toContain('Dana Reyes');
	});

	it('does not let a delimiter inside a quote trail cut the reply short', () => {
		const raw = [
			'Agreed.',
			'',
			'On Fri, 29 Aug 2026, Dana wrote:',
			'> Here it is.',
			'> --',
			'> Dana',
			'> Ops'
		].join('\n');
		const split = splitBody(raw);
		expect(split.body).toBe('Agreed.');
		// The signature belongs to the quoted message, not to this one.
		expect(split.signature).toBe('');
	});
});

describe('layer 2: flowing hard-wrapped text', () => {
	it('joins lines the sender wrapped back into a paragraph', () => {
		// This is the whole reason plain mail looked like a narrow ragged column:
		// the breaks are the sender's client wrapping at 72 columns, not the
		// sender's meaning.
		const raw = [
			'This is a long line that the sending client wrapped because it ran past',
			'the seventy two column mark, and it continues on the following line as',
			'part of the same sentence.'
		].join('\n');

		const paragraphs = toParagraphs(raw);
		expect(paragraphs).toHaveLength(1);
		expect(paragraphs[0]).toContain('wrapped because it ran past the seventy two column mark');
	});

	it('keeps a blank line as a paragraph break', () => {
		expect(toParagraphs('First paragraph.\n\nSecond paragraph.')).toHaveLength(2);
	});

	it('leaves list items on their own lines', () => {
		const raw = ['We need:', '- the scope note', '- the signed contract', '- a date'].join('\n');
		const paragraphs = toParagraphs(raw);
		expect(paragraphs.length).toBeGreaterThanOrEqual(4);
		expect(paragraphs).toContain('- the scope note');
	});

	it('leaves numbered items alone too', () => {
		expect(toParagraphs('1. first\n2. second')).toEqual(['1. first', '2. second']);
	});

	it('does not glue short lines together, so addresses survive', () => {
		const raw = ['Dana Reyes', 'Beacon Analytics', '14 Some Street'].join('\n');
		expect(toParagraphs(raw)).toHaveLength(3);
	});

	it('returns nothing for an empty body rather than a blank paragraph', () => {
		expect(toParagraphs('')).toEqual([]);
		expect(toParagraphs('\n\n  \n')).toEqual([]);
	});
});
