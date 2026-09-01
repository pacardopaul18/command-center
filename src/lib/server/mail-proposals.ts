import type { D1Database } from '@cloudflare/workers-types';
import { nowUtc } from './dates';

/**
 * Turning extracted commitments into things Paul reviews.
 *
 * NO AI HERE, AND THAT IS THE POINT. The model already did its reading when it
 * extracted the commitment; this is bookkeeping on top of that answer. A second
 * model call to decide whether the first one's answer is worth showing would be
 * paying twice to make the same guess.
 *
 * A COMMITMENT NEVER BECOMES AN ACTION ITEM DIRECTLY. It becomes a proposal
 * with its evidence attached, and a person accepts or rejects it. The Action
 * items screen is the one place that says what Paul owes people; filling it
 * with a model's readings of sentences would make it stop being believed within
 * a week, and once that happens no amount of later accuracy brings it back.
 *
 * Only what Paul owes. A commitment `owed_by: 'them'` is something somebody
 * else promised, which belongs on a waiting-on view and not in his own list.
 */

const newId = () => crypto.randomUUID();

export interface ProposalRun {
	commitments_considered: number;
	proposals_created: number;
	already_proposed: number;
	skipped_owed_by_them: number;
	skipped_no_evidence: number;
	mapped_to_client: number;
	mapped_to_project: number;
}

interface CommitmentRow {
	id: string;
	thread_id: string | null;
	source_message_id: string;
	owed_to: string | null;
	what: string;
	due_signal: string | null;
	due_date: string | null;
	evidence: string | null;
	model: string | null;
	from_email: string | null;
	to_email: string | null;
	subject: string | null;
}

/**
 * Where a thread's correspondent maps, if anywhere.
 *
 * Matched on the email domain against a client's own contacts. Deliberately
 * conservative: an unmapped proposal is a proposal Paul files himself, and a
 * proposal filed against the wrong client is worse, because it is invisible and
 * gets believed. The same argument as the unassigned bucket. D175.
 */
async function clientByDomain(db: D1Database): Promise<Map<string, string>> {
	const { results } = await db
		.prepare(
			`SELECT DISTINCT c.client_id, LOWER(SUBSTR(c.email, INSTR(c.email, '@') + 1)) AS domain
       FROM contacts c
       WHERE c.email IS NOT NULL AND c.email LIKE '%@%' AND c.client_id IS NOT NULL`
		)
		.all<{ client_id: string; domain: string }>();

	const map = new Map<string, string>();
	for (const row of results ?? []) {
		// A domain shared by two clients is an ambiguity, and resolving it by
		// whichever row came back first would make the answer depend on row
		// order. Neither wins.
		if (map.has(row.domain)) map.set(row.domain, '');
		else map.set(row.domain, row.client_id);
	}
	for (const [domain, id] of map) if (!id) map.delete(domain);

	// Free mail domains are not client identity. One gmail.com contact would
	// otherwise file every personal correspondent under that client.
	for (const free of ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com']) {
		map.delete(free);
	}

	return map;
}

/**
 * Creates one pending proposal per commitment Paul owes.
 *
 * Idempotent by the unique key on `commitment_id`: running it twice does not
 * offer the same sentence for review a second time, which matters because a
 * reviewer who has already rejected something should never see it again.
 */
export async function proposeFromCommitments(
	db: D1Database,
	limit = 500
): Promise<ProposalRun> {
	const at = nowUtc();
	const out: ProposalRun = {
		commitments_considered: 0,
		proposals_created: 0,
		already_proposed: 0,
		skipped_owed_by_them: 0,
		skipped_no_evidence: 0,
		mapped_to_client: 0,
		mapped_to_project: 0
	};

	const { results } = await db
		.prepare(
			`SELECT c.id, c.thread_id, c.source_message_id, c.owed_by, c.owed_to, c.what,
              c.due_signal, c.due_date, c.model,
              /*
               * The sentence, falling back to the message snippet.
               *
               * The evidence column arrived in 0040 and is null on anything
               * extracted before it. The snippet is the first line of the
               * message, weaker but still something a reviewer can read. Where
               * neither exists the proposal is not offered at all.
               */
              COALESCE(c.evidence, m.snippet) AS evidence,
              m.from_email, m.to_emails AS to_email, t.subject
       FROM commitments c
       LEFT JOIN email_messages m ON m.id = c.source_message_id
       LEFT JOIN email_threads t ON t.id = c.thread_id
       WHERE c.status = 'open'
       ORDER BY c.id
       LIMIT ?`
		)
		.bind(limit)
		.all<CommitmentRow & { owed_by: string }>();

	const domains = await clientByDomain(db);

	const { results: existing } = await db
		.prepare('SELECT commitment_id FROM mail_action_proposals')
		.all<{ commitment_id: string }>();
	const seen = new Set((existing ?? []).map((r) => r.commitment_id));

	for (const row of results ?? []) {
		out.commitments_considered += 1;

		if (row.owed_by !== 'paul') {
			// Somebody else's promise. Real, and not Paul's action item: it belongs
			// on a waiting-on view, which is a different screen answering a
			// different question.
			out.skipped_owed_by_them += 1;
			continue;
		}

		if (seen.has(row.id)) {
			out.already_proposed += 1;
			continue;
		}

		if (!row.evidence || !row.evidence.trim()) {
			/*
			 * No evidence, no proposal.
			 *
			 * A reviewer cannot judge a claim they cannot check, and a proposal
			 * with nothing behind it asks them to trust the model rather than to
			 * review it. Counted, not silently dropped.
			 */
			out.skipped_no_evidence += 1;
			continue;
		}

		const counterpart = (row.owed_to ?? row.to_email ?? '').toLowerCase();
		const domain = counterpart.includes('@') ? counterpart.split('@').pop()! : '';
		const clientId = domain ? (domains.get(domain) ?? null) : null;
		if (clientId) out.mapped_to_client += 1;

		/*
		 * A project only when the client has exactly one live one.
		 *
		 * With several, choosing would be a guess, and an unfiled proposal is a
		 * question Paul answers in a second rather than a wrong answer nobody
		 * spots.
		 */
		let projectId: string | null = null;
		if (clientId) {
			const one = await db
				.prepare(
					`SELECT id FROM projects
           WHERE client_id = ? AND status != 'done'
           LIMIT 2`
				)
				.bind(clientId)
				.all<{ id: string }>();
			if ((one.results ?? []).length === 1) {
				projectId = one.results![0].id;
				out.mapped_to_project += 1;
			}
		}

		await db
			.prepare(
				`INSERT INTO mail_action_proposals
         (id, commitment_id, thread_id, source_message_id, title, context, owner,
          due_signal, deadline, ambiguous, ambiguity_note, evidence, status,
          client_id, project_id, model, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'pending', ?13, ?14, ?15, ?16)
         ON CONFLICT(commitment_id) DO NOTHING`
			)
			.bind(
				newId(),
				row.id,
				row.thread_id,
				row.source_message_id,
				row.what.slice(0, 300),
				row.subject ? `From the thread "${row.subject}"` : null,
				row.owed_to,
				row.due_signal,
				// A date only where the message stated one. `due_signal` carries
				// "next week" without pretending to know which day that is.
				row.due_date,
				row.due_date ? 0 : row.due_signal ? 1 : 0,
				row.due_date ? null : row.due_signal ? `The message said "${row.due_signal}" without a date.` : null,
				row.evidence,
				clientId,
				projectId,
				row.model,
				at
			)
			.run();

		out.proposals_created += 1;
		seen.add(row.id);
	}

	return out;
}

/**
 * Accepts a proposal, creating the action item it becomes.
 *
 * The link is written on the proposal, which the table's own CHECK requires: a
 * proposal cannot claim to be accepted and point at nothing.
 */
export async function acceptProposal(
	db: D1Database,
	proposalId: string
): Promise<{ action_item_id: string } | null> {
	const proposal = await db
		.prepare(
			`SELECT id, title, context, owner, deadline, client_id, project_id, status
       FROM mail_action_proposals WHERE id = ?`
		)
		.bind(proposalId)
		.first<{
			id: string;
			title: string;
			context: string | null;
			owner: string | null;
			deadline: string | null;
			client_id: string | null;
			project_id: string | null;
			status: string;
		}>();

	if (!proposal || proposal.status !== 'pending') return null;

	const actionId = newId();
	const at = nowUtc();

	await db
		.prepare(
			`INSERT INTO action_items
       (id, title, context, owner, deadline, status, project_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`
		)
		.bind(
			actionId,
			proposal.title,
			proposal.context,
			proposal.owner,
			proposal.deadline,
			proposal.project_id,
			at,
			at
		)
		.run();

	await db
		.prepare(
			`UPDATE mail_action_proposals
       SET status = 'accepted', action_item_id = ?, reviewed_at = ?
       WHERE id = ?`
		)
		.bind(actionId, at, proposalId)
		.run();

	return { action_item_id: actionId };
}

/** Rejects a proposal. It stays, so the same sentence is never offered again. */
export async function rejectProposal(db: D1Database, proposalId: string): Promise<boolean> {
	const res = await db
		.prepare(
			`UPDATE mail_action_proposals SET status = 'rejected', reviewed_at = ?
       WHERE id = ? AND status = 'pending'`
		)
		.bind(nowUtc(), proposalId)
		.run();
	return (res.meta?.changes ?? 0) > 0;
}
