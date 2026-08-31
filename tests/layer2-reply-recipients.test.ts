import { describe, expect, it } from 'vitest';
import { bareAddress, replyRecipients } from '../src/lib/reply-recipients';

/**
 * Who a reply addresses, which is the part that fails without telling anyone.
 *
 * A wrong To is obvious the moment it is sent. A dropped Cc is not: the person
 * who was removed finds out later, or never. So reply-all-minus-me is asserted
 * on cases that actually occur in a thread rather than on one happy path.
 *
 * Addresses here are synthetic. D89.
 */

const ME = 'paul@mine.invalid';

const msg = (
	from: string,
	to: string | null,
	cc: string | null,
	sent_at: string
) => ({ from_email: from, to_emails: to, cc_emails: cc, sent_at });

describe('reply recipients', () => {
	it('addresses the last person who wrote, not the last message', () => {
		const r = replyRecipients(
			[
				msg('rina@client.invalid', ME, null, '2026-08-01T09:00:00Z'),
				msg(ME, 'rina@client.invalid', null, '2026-08-02T09:00:00Z')
			],
			ME
		);
		// Paul wrote last. The reply still goes to Rina.
		expect(r.to).toEqual(['rina@client.invalid']);
		expect(r.cc).toEqual([]);
	});

	it('keeps everyone else on the thread in Cc', () => {
		const r = replyRecipients(
			[
				msg('rina@client.invalid', `${ME}, dex@client.invalid`, 'joy@client.invalid', '2026-08-01T09:00:00Z')
			],
			ME
		);
		expect(r.to).toEqual(['rina@client.invalid']);
		expect(r.cc).toEqual(['dex@client.invalid', 'joy@client.invalid']);
	});

	it('never addresses the account holder, in either field', () => {
		const r = replyRecipients(
			[msg('rina@client.invalid', `${ME}, dex@client.invalid`, ME, '2026-08-01T09:00:00Z')],
			ME
		);
		expect(r.to).not.toContain(ME);
		expect(r.cc).not.toContain(ME);
	});

	it('treats a display name and a bare address as one person', () => {
		const r = replyRecipients(
			[
				msg(
					'Rina Dela Cruz <rina@client.invalid>',
					`Paul Pacardo <${ME}>`,
					'rina@client.invalid',
					'2026-08-01T09:00:00Z'
				)
			],
			ME
		);
		expect(r.to).toEqual(['rina@client.invalid']);
		// Rina is the recipient, so she must not also appear as a copy.
		expect(r.cc).not.toContain('rina@client.invalid');
		expect(r.cc).not.toContain(ME);
	});

	it('puts one named sender in To and the rest in Cc, for a per-message reply', () => {
		const r = replyRecipients(
			[
				msg('rina@client.invalid', ME, 'dex@client.invalid', '2026-08-01T09:00:00Z'),
				msg('joy@client.invalid', ME, null, '2026-08-03T09:00:00Z')
			],
			ME,
			'rina@client.invalid'
		);
		expect(r.to).toEqual(['rina@client.invalid']);
		expect(r.cc).toContain('joy@client.invalid');
		expect(r.cc).toContain('dex@client.invalid');
	});

	it('returns no recipient rather than guessing when only the holder wrote', () => {
		const r = replyRecipients([msg(ME, null, null, '2026-08-01T09:00:00Z')], ME);
		expect(r.to).toEqual([]);
	});

	it('reads the address out of a display form', () => {
		expect(bareAddress('Rina <rina@client.invalid>')).toBe('rina@client.invalid');
		expect(bareAddress('  RINA@client.invalid ')).toBe('rina@client.invalid');
	});
});
