import type { D1Database } from '@cloudflare/workers-types';

/**
 * How many proposals are waiting for a person, in one place.
 *
 * A proposal is a machine's reading of something Paul may have promised. It
 * becomes an action item only when he accepts it, and until then it is waiting
 * on him. Three pages report that number and they were not all reporting the
 * same one.
 *
 * WHAT WENT WRONG, and it is F15's shape a second time. Action items summed
 * both sources and said 27. `today.ts` summed only `meeting_action_proposals`
 * and would have said 24. Meetings did not report it at all and showed
 * "Awaiting your review 0", which is a true statement about unreviewed AI
 * summaries and reads as a statement about the queue. Three pages, three
 * different answers to what a reader hears as one question, and only one of
 * them was actually wrong.
 *
 * D215 put the review queue on the page the reviewing happens on. This is the
 * other half: the count of that queue is one expression, and every page that
 * mentions it reads from here.
 *
 * BOTH SOURCES, ALWAYS. Mail and meetings produce proposals through different
 * paths and land in different tables, and that is an implementation detail of
 * where they came from. It is not a distinction the person clearing the queue
 * has any reason to care about, and a count that silently covers one of them is
 * wrong in the direction that looks fine.
 */

/**
 * The expression, for queries that need it inline beside other counts.
 *
 * Exported as SQL rather than only as a function because several callers are
 * building one row of totals and a second round trip to get one number is a
 * second thing that can disagree.
 */
export const PENDING_PROPOSALS_SQL = `(
  (SELECT COUNT(*) FROM mail_action_proposals WHERE status = 'pending') +
  (SELECT COUNT(*) FROM meeting_action_proposals WHERE status = 'pending')
)`;

/** The same expression, scoped to one meeting. */
export const PENDING_PROPOSALS_FOR_MEETING_SQL = `(
  SELECT COUNT(*) FROM meeting_action_proposals p
  WHERE p.meeting_id = m.id AND p.status = 'pending'
)`;

export interface ProposalCounts {
	pending: number;
	accepted: number;
	rejected: number;
}

/**
 * Every state, from both sources.
 *
 * Accepted and rejected are counted too, because "27 pending" alone cannot
 * distinguish a queue nobody has started from one somebody has worked through.
 * The three together say which.
 */
export async function proposalCounts(db: D1Database): Promise<ProposalCounts> {
	const row = await db
		.prepare(
			`SELECT
         ${PENDING_PROPOSALS_SQL} AS pending,
         (SELECT COUNT(*) FROM mail_action_proposals WHERE status = 'accepted') +
         (SELECT COUNT(*) FROM meeting_action_proposals WHERE status = 'accepted') AS accepted,
         (SELECT COUNT(*) FROM mail_action_proposals WHERE status = 'rejected') +
         (SELECT COUNT(*) FROM meeting_action_proposals WHERE status = 'rejected') AS rejected`
		)
		.first<ProposalCounts>();

	return {
		pending: Number(row?.pending ?? 0),
		accepted: Number(row?.accepted ?? 0),
		rejected: Number(row?.rejected ?? 0)
	};
}
