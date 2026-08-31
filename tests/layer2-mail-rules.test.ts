import { describe, expect, it } from 'vitest';
import { classify, needsModel, needsEmbedding, projectCorpus } from '../src/lib/server/mail-rules';

/**
 * The rules that decide what never reaches a model.
 *
 * This is where Pillar 4's cost is set, so the expensive mistake is asserted
 * directly: a message from someone Paul has written to is correspondence no
 * matter how Gmail filed it. Getting that wrong files a client's invoice as a
 * newsletter and loses an obligation, which costs far more than the fraction of
 * a cent saved.
 *
 * Addresses are synthetic.
 */

const bulkLabel = 'INBOX,CATEGORY_PROMOTIONS';
const updateLabel = 'INBOX,CATEGORY_UPDATES';

describe('what needs a model and what does not', () => {
	it('files Gmail promotions as bulk', () => {
		expect(
			classify({ fromEmail: 'offers@vendor.invalid', labelIds: bulkLabel, knownCorrespondent: false })
		).toBe('bulk');
	});

	it('files a no-reply sender as bulk even with no labels', () => {
		for (const from of [
			'no-reply@service.invalid',
			'noreply@service.invalid',
			'do-not-reply@service.invalid',
			'notifications@service.invalid'
		]) {
			expect(classify({ fromEmail: from, labelIds: null, knownCorrespondent: false })).toBe('bulk');
		}
	});

	/** The one that must never be overridden. */
	it('treats anyone Paul has written to as correspondence, whatever Gmail says', () => {
		expect(
			classify({ fromEmail: 'billing@client.invalid', labelIds: bulkLabel, knownCorrespondent: true })
		).toBe('correspondence');
		expect(
			classify({ fromEmail: 'no-reply@client.invalid', labelIds: bulkLabel, knownCorrespondent: true })
		).toBe('correspondence');
	});

	it('keeps updates searchable without paying to summarise them', () => {
		const cls = classify({
			fromEmail: 'receipts@vendor.invalid',
			labelIds: updateLabel,
			knownCorrespondent: false
		});
		expect(cls).toBe('transactional');
		expect(needsModel(cls), 'a receipt was sent for synthesis').toBe(false);
		expect(needsEmbedding(cls), 'a receipt was left out of the index').toBe(true);
	});

	it('never indexes bulk and never skips correspondence', () => {
		expect(needsEmbedding('bulk')).toBe(false);
		expect(needsModel('bulk')).toBe(false);
		expect(needsModel('correspondence')).toBe(true);
		expect(needsEmbedding('correspondence')).toBe(true);
	});

	it('projects a corpus into the three classes', () => {
		const corpus = [
			{ fromEmail: 'a@x.invalid', labelIds: bulkLabel, knownCorrespondent: false },
			{ fromEmail: 'b@x.invalid', labelIds: updateLabel, knownCorrespondent: false },
			{ fromEmail: 'c@x.invalid', labelIds: null, knownCorrespondent: true }
		];
		expect(projectCorpus(corpus)).toEqual({ bulk: 1, transactional: 1, correspondence: 1 });
	});
});
