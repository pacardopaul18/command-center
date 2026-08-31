/**
 * What never needs a model.
 *
 * Pillar 4's cost is decided here rather than in the prompts. Measured on the
 * real mailbox: of 865 messages, Gmail had already filed 201 as Promotions and
 * 537 as Updates, and Paul had written in only 19 threads out of 775. The mail
 * that is actually correspondence is about 15 per cent of the corpus.
 *
 * So the cheapest possible pass is the one already paid for: Gmail's own
 * categories, which arrive with every message and are stored today in
 * `label_ids`. Everything below is arithmetic on data the app already holds.
 *
 * The rule is conservative in one direction on purpose. A newsletter treated as
 * correspondence costs a fraction of a cent. A client's invoice treated as bulk
 * is a missed obligation, so anything from someone Paul has ever written to is
 * correspondence regardless of how Gmail filed it.
 */

export type MailClass = 'correspondence' | 'bulk' | 'transactional';

export interface RuleInput {
	fromEmail: string | null;
	labelIds: string | null;
	/** True when Paul has sent a message to this address or in this thread. */
	knownCorrespondent: boolean;
}

/** Senders that are machines by construction. */
const NO_REPLY = /(^|[.\-_])(no-?reply|do-?not-?reply|notifications?|mailer|bounce|postmaster|automated)([.\-_]|@)/i;

/** Gmail's own filing. Free, already stored, and better than a guess. */
const BULK_LABELS = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS'];

/**
 * Updates is deliberately not bulk.
 *
 * It holds receipts, confirmations and invoices as well as product noise. The
 * expensive mistake in this whole design would be filing a client's invoice as
 * a newsletter, so Updates gets its own class: worth indexing and searchable,
 * not worth a synthesis call of its own.
 */
const TRANSACTIONAL_LABELS = ['CATEGORY_UPDATES'];

function hasLabel(labelIds: string | null, wanted: string[]): boolean {
	if (!labelIds) return false;
	return wanted.some((l) => labelIds.includes(l));
}

export function classify(input: RuleInput): MailClass {
	// Anyone Paul has written to is correspondence, whatever Gmail thinks. This
	// check is first because it is the one that must never be overridden.
	if (input.knownCorrespondent) return 'correspondence';

	if (hasLabel(input.labelIds, BULK_LABELS)) return 'bulk';
	if (input.fromEmail && NO_REPLY.test(input.fromEmail)) return 'bulk';
	if (hasLabel(input.labelIds, TRANSACTIONAL_LABELS)) return 'transactional';

	return 'correspondence';
}

/**
 * Whether a message is worth spending a model call on.
 *
 * Bulk is never read by a model. Transactional is embedded so it can be found,
 * but not summarised: a receipt does not need a paragraph written about it, it
 * needs to be findable when somebody asks what was paid.
 */
export function needsModel(cls: MailClass): boolean {
	return cls === 'correspondence';
}

/** Whether it enters the retrieval index at all. */
export function needsEmbedding(cls: MailClass): boolean {
	return cls !== 'bulk';
}

/**
 * The projected split for a corpus, for budgeting before spending.
 *
 * Returns counts rather than an estimate in dollars, because the price per call
 * belongs with the pricing table and this belongs with the rules.
 */
export function projectCorpus(inputs: RuleInput[]): Record<MailClass, number> {
	const out: Record<MailClass, number> = { correspondence: 0, bulk: 0, transactional: 0 };
	for (const input of inputs) out[classify(input)] += 1;
	return out;
}
