import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { nowUtc } from '../dates';
import { ApiError, optionalDate, optionalText, readJsonObject, requiredText } from './validate';
import { AiError, extractActionItems, summariseTranscript } from '../ai';
import { checkAiBudget } from '../ai-budget';
import { recordUsage } from '../ai-usage';

/**
 * AI summary and extraction, with the human in the loop.
 *
 * The shape of this module is the human review step, not a decoration on it:
 *
 * - Summarising writes to `meetings.summary` and leaves `summary_reviewed_at`
 *   null. An unreviewed summary is visibly unreviewed until Paul says otherwise.
 * - Extraction writes proposals, never action items. A proposal becomes work
 *   only when it is accepted, one at a time, and accepting records which action
 *   item it became.
 * - An accepted proposal that the model flagged as ambiguous becomes an action
 *   item with status `ambiguous`, so it lands in the cockpit's "what will slip"
 *   band rather than looking like settled work.
 *
 * Nothing here writes an action item without an explicit accept.
 */
export const meetingAi = new Hono<ApiEnv>();

function apiKey(c: { env: ApiEnv['Bindings'] }): string {
	const key = c.env.ANTHROPIC_API_KEY;
	if (!key) {
		throw new ApiError(
			503,
			'No Anthropic API key is configured. Set it with `wrangler secret put ANTHROPIC_API_KEY`.'
		);
	}
	return key;
}

async function loadTranscript(
	c: { env: ApiEnv['Bindings'] },
	id: string
): Promise<{ title: string; meeting_date: string; transcript_text: string }> {
	const meeting = await c.env.DB.prepare(
		'SELECT title, meeting_date, transcript_text FROM meetings WHERE id = ?'
	)
		.bind(id)
		.first<{ title: string; meeting_date: string; transcript_text: string | null }>();

	if (!meeting) throw new ApiError(404, 'Meeting not found.');
	if (!meeting.transcript_text || meeting.transcript_text.trim().length === 0) {
		throw new ApiError(400, 'Import a transcript before running the AI steps.');
	}
	return { ...meeting, transcript_text: meeting.transcript_text };
}

/** Generates a summary and stores it unreviewed. */
meetingAi.post('/:id/summarize', async (c) => {
	const id = c.req.param('id');
	/**
	 * The spend stop, before the call rather than after it.
	 *
	 * A refusal is a 402, not a 500 and not a silent success: the reader is told
	 * the ceiling was reached and by how much, which is a sentence they can act
	 * on. D138 applies to routes as much as to jobs.
	 */
	const verdict = await checkAiBudget(c.env.DB);
	if (!verdict.ok) throw new ApiError(402, verdict.reason);

	const meeting = await loadTranscript(c, id);

	try {
		const { summary, model, usage } = await summariseTranscript(
			apiKey(c),
			meeting.transcript_text,
			meeting.title
		);

		await c.env.DB.prepare(
			'UPDATE meetings SET summary = ?, summary_reviewed_at = NULL, updated_at = ? WHERE id = ?'
		)
			.bind(summary, nowUtc(), id)
			.run();

		/**
		 * Recorded, because a cost the meter cannot see is a cost the stop
		 * cannot stop. These two routes spent money and wrote nothing to
		 * `ai_usage`, so summarising a transcript was invisible to the ceiling
		 * that reads it.
		 */
		await recordUsage(c.env.DB, 'summary', usage, null, null);

		return c.json({ summary, model, reviewed: false });
	} catch (err) {
		if (err instanceof AiError) throw new ApiError(err.status, err.message);
		throw err;
	}
});

/** Marks the current summary as reviewed by a human. */
meetingAi.post('/:id/summary/review', async (c) => {
	const id = c.req.param('id');
	const existing = await c.env.DB.prepare('SELECT summary FROM meetings WHERE id = ?')
		.bind(id)
		.first<{ summary: string | null }>();
	if (!existing) throw new ApiError(404, 'Meeting not found.');
	if (!existing.summary) throw new ApiError(400, 'There is no summary to review.');

	const now = nowUtc();
	await c.env.DB.prepare(
		'UPDATE meetings SET summary_reviewed_at = ?, updated_at = ? WHERE id = ?'
	)
		.bind(now, now, id)
		.run();

	return c.json({ reviewed_at: now });
});

/**
 * Extracts proposals. Replaces any pending proposals from a previous run, and
 * deliberately leaves accepted and rejected ones alone: re-running extraction
 * must not resurrect something Paul already rejected, or duplicate something he
 * already accepted.
 */
meetingAi.post('/:id/extract', async (c) => {
	const id = c.req.param('id');
	/**
	 * The spend stop, before the call rather than after it.
	 *
	 * A refusal is a 402, not a 500 and not a silent success: the reader is told
	 * the ceiling was reached and by how much, which is a sentence they can act
	 * on. D138 applies to routes as much as to jobs.
	 */
	const verdict = await checkAiBudget(c.env.DB);
	if (!verdict.ok) throw new ApiError(402, verdict.reason);

	const meeting = await loadTranscript(c, id);

	try {
		const { items, model, usage } = await extractActionItems(
			apiKey(c),
			meeting.transcript_text,
			meeting.title,
			meeting.meeting_date
		);

		const now = nowUtc();
		const statements = [
			c.env.DB.prepare(
				"DELETE FROM meeting_action_proposals WHERE meeting_id = ? AND status = 'pending'"
			).bind(id),
			...items.map((item) =>
				c.env.DB.prepare(
					`INSERT INTO meeting_action_proposals
             (id, meeting_id, title, context, owner, deadline, ambiguous, ambiguity_note,
              evidence, status, model, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
				).bind(
					crypto.randomUUID(),
					id,
					item.title,
					item.context || null,
					item.owner || null,
					item.deadline || null,
					item.ambiguous ? 1 : 0,
					item.ambiguity_note || null,
					item.evidence || null,
					model,
					now
				)
			)
		];

		await c.env.DB.batch(statements);

		const { results } = await c.env.DB.prepare(
			'SELECT * FROM meeting_action_proposals WHERE meeting_id = ? ORDER BY ambiguous DESC, created_at ASC'
		)
			.bind(id)
			.all();

		// Recorded for the same reason the summary is: an unmetered cost is a
		// cost the ceiling cannot stop.
		await recordUsage(c.env.DB, 'summary', usage, null, null);

		return c.json({ proposals: results ?? [], model, extracted: items.length });
	} catch (err) {
		if (err instanceof AiError) throw new ApiError(err.status, err.message);
		throw err;
	}
});

meetingAi.get('/:id/proposals', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT p.*, a.status AS action_item_status
     FROM meeting_action_proposals p
     LEFT JOIN action_items a ON a.id = p.action_item_id
     WHERE p.meeting_id = ?
     ORDER BY
       CASE p.status WHEN 'pending' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
       p.ambiguous DESC,
       p.created_at ASC`
	)
		.bind(c.req.param('id'))
		.all();
	return c.json({ proposals: results ?? [] });
});

/**
 * Accepting turns one proposal into one action item.
 *
 * The body may correct any field first, which is the point of the review: the
 * model gets names and dates wrong, so the reviewer fixes them here rather than
 * accepting something wrong and repairing it later.
 *
 * A proposal the model flagged as ambiguous becomes an action item with status
 * `ambiguous` unless the reviewer supplied both an owner and a deadline, which
 * is what resolving the ambiguity actually means.
 */
meetingAi.post('/:id/proposals/:proposalId/accept', async (c) => {
	const meetingId = c.req.param('id');
	const proposalId = c.req.param('proposalId');
	const body = await readJsonObject(c.req.raw).catch(() => ({}) as Record<string, unknown>);

	const proposal = await c.env.DB.prepare(
		'SELECT * FROM meeting_action_proposals WHERE id = ? AND meeting_id = ?'
	)
		.bind(proposalId, meetingId)
		.first<{
			title: string;
			context: string | null;
			owner: string | null;
			deadline: string | null;
			ambiguous: number;
			status: string;
		}>();

	if (!proposal) throw new ApiError(404, 'Proposal not found for this meeting.');
	if (proposal.status !== 'pending') {
		throw new ApiError(400, `This proposal was already ${proposal.status}.`);
	}

	const meeting = await c.env.DB.prepare('SELECT project_id FROM meetings WHERE id = ?')
		.bind(meetingId)
		.first<{ project_id: string | null }>();

	const title = 'title' in body ? requiredText(body.title, 'Title', 300) : proposal.title;
	const context =
		'context' in body ? optionalText(body.context, 'Context', 4000) : proposal.context;
	const owner = 'owner' in body ? optionalText(body.owner, 'Owner', 200) : proposal.owner;
	const deadline =
		'deadline' in body ? optionalDate(body.deadline, 'Deadline') : proposal.deadline;
	const projectId =
		'project_id' in body
			? optionalText(body.project_id, 'project_id', 64)
			: (meeting?.project_id ?? null);

	// Ambiguity is resolved by supplying what was missing, not by clicking past it.
	const stillAmbiguous = proposal.ambiguous === 1 && (!owner || !deadline);

	const actionItemId = crypto.randomUUID();
	const now = nowUtc();

	await c.env.DB.batch([
		c.env.DB.prepare(
			`INSERT INTO action_items
         (id, title, context, owner, deadline, status, source, meeting_id, project_id,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'meeting', ?, ?, ?, ?)`
		).bind(
			actionItemId,
			title,
			context,
			owner,
			deadline,
			stillAmbiguous ? 'ambiguous' : 'open',
			meetingId,
			projectId,
			now,
			now
		),
		c.env.DB.prepare(
			"UPDATE meeting_action_proposals SET status = 'accepted', action_item_id = ?, reviewed_at = ? WHERE id = ?"
		).bind(actionItemId, now, proposalId)
	]);

	const created = await c.env.DB.prepare('SELECT * FROM action_items WHERE id = ?')
		.bind(actionItemId)
		.first();

	return c.json({ action_item: created, proposal_id: proposalId }, 201);
});

/** Rejecting keeps the row, so re-extraction does not offer it again. */
meetingAi.post('/:id/proposals/:proposalId/reject', async (c) => {
	const result = await c.env.DB.prepare(
		"UPDATE meeting_action_proposals SET status = 'rejected', reviewed_at = ? WHERE id = ? AND meeting_id = ? AND status = 'pending'"
	)
		.bind(nowUtc(), c.req.param('proposalId'), c.req.param('id'))
		.run();

	if (!result.meta.changes) {
		throw new ApiError(404, 'No pending proposal with that id for this meeting.');
	}
	return c.json({ ok: true });
});
