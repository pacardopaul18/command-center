import type { D1Database } from '@cloudflare/workers-types';
import { nowUtc } from './dates';

/**
 * The context engine's rule-derived half.
 *
 * Nothing here calls a model. The pre-audit found 18 senders across 7 domains
 * carry every real correspondence thread, which is small enough that the whole
 * contact graph falls out of the headers by counting. Paying a model to work
 * out who Paul emails would be paying for arithmetic.
 *
 * What the counting produces is also the relevance signal the AI passes are
 * then pointed at: who Paul actually replies to. On the corpus as it stands he
 * replied in 19 of 21 correspondence threads, and that agrees almost exactly
 * with what triage decided independently. Two signals agreeing is worth having
 * before either is trusted alone.
 */

/**
 * Categories that never enter the context engine.
 *
 * Not a cost optimisation applied afterwards. A context engine that read job
 * alerts and newsletters would be paying to learn nothing, and worse, would
 * dilute a contact graph of 18 real people with 145 senders nobody corresponds
 * with. `null` is excluded too: untriaged waits for triage rather than being
 * read speculatively.
 */
export const CONTEXT_CATEGORIES = ['correspondence'] as const;

export interface SeedOutcome {
	contacts: number;
	threads_considered: number;
	messages_considered: number;
	linked_to_client: number;
}

/**
 * Rebuilds the contact graph for one account from message headers.
 *
 * Recomputed rather than incrementally updated. The counts are cheap, the
 * corpus is small, and an incremental counter that drifts is worse than one
 * that is right every time it is asked: a reply rate that is quietly wrong
 * makes every relevance judgement downstream quietly wrong too.
 */
export async function seedContacts(
	db: D1Database,
	connectionId: string,
	accountEmail: string | null
): Promise<SeedOutcome> {
	const at = nowUtc();
	const categories = CONTEXT_CATEGORIES.map(() => '?').join(', ');

	// Everyone who wrote into a correspondence thread, other than Paul himself.
	// He is not a contact in his own contact graph, and including him would
	// make him the most frequent correspondent by a wide margin.
	const { results } = await db
		.prepare(
			`SELECT
         LOWER(m.from_email) AS email,
         MAX(m.from_name) AS display_name,
         COUNT(*) AS messages_received,
         COUNT(DISTINCT m.thread_id) AS threads_involved,
         MIN(m.sent_at) AS first_seen,
         MAX(m.sent_at) AS last_seen
       FROM email_messages m
       JOIN email_threads t ON t.id = m.thread_id
       WHERE m.connection_id = ?
         AND t.category IN (${categories})
         AND m.from_email IS NOT NULL
         AND LOWER(m.from_email) IS NOT LOWER(?)
       GROUP BY LOWER(m.from_email)`
		)
		.bind(connectionId, ...CONTEXT_CATEGORIES, accountEmail ?? '')
		.all<{
			email: string;
			display_name: string | null;
			messages_received: number;
			threads_involved: number;
			first_seen: string | null;
			last_seen: string | null;
		}>();

	const people = results ?? [];
	let linked = 0;

	for (const person of people) {
		const domain = person.email.includes('@') ? person.email.split('@').pop() ?? null : null;

		// Threads this person is in where Paul also wrote. This is the reply
		// rate, and it is the strongest free signal of who matters.
		const replied = await db
			.prepare(
				`SELECT COUNT(DISTINCT m.thread_id) AS n
         FROM email_messages m
         WHERE m.connection_id = ?
           AND LOWER(m.from_email) = LOWER(?)
           AND m.thread_id IN (
             SELECT thread_id FROM email_messages
             WHERE connection_id = ? AND LOWER(from_email) = LOWER(?)
           )`
			)
			.bind(connectionId, accountEmail ?? '', connectionId, person.email)
			.first<{ n: number }>();

		// Messages Paul sent into threads this person is in.
		const sentTo = await db
			.prepare(
				`SELECT COUNT(*) AS n FROM email_messages
         WHERE connection_id = ? AND LOWER(from_email) = LOWER(?)
           AND thread_id IN (
             SELECT thread_id FROM email_messages
             WHERE connection_id = ? AND LOWER(from_email) = LOWER(?)
           )`
			)
			.bind(connectionId, accountEmail ?? '', connectionId, person.email)
			.first<{ n: number }>();

		const severity = await db
			.prepare(
				`SELECT COALESCE(t.severity_override, t.severity) AS sev
         FROM email_threads t
         JOIN email_messages m ON m.thread_id = t.id
         WHERE m.connection_id = ? AND LOWER(m.from_email) = LOWER(?)
           AND COALESCE(t.severity_override, t.severity) IS NOT NULL
         ORDER BY CASE COALESCE(t.severity_override, t.severity)
           WHEN 'urgent' THEN 0 WHEN 'important' THEN 1
           WHEN 'routine' THEN 2 ELSE 3 END
         LIMIT 1`
			)
			.bind(connectionId, person.email)
			.first<{ sev: string | null }>();

		// An exact address match against a Client 360 contact, never a domain
		// match: two clients can share a mail provider, and a confidently wrong
		// client attribution is worse than a blank one.
		const known = await db
			.prepare('SELECT id, client_id FROM contacts WHERE LOWER(email) = LOWER(?) LIMIT 1')
			.bind(person.email)
			.first<{ id: string; client_id: string }>();
		if (known) linked += 1;

		await db
			.prepare(
				`INSERT INTO mail_contacts
           (id, connection_id, email, display_name, domain,
            messages_received, messages_sent_to, threads_involved, threads_replied,
            first_seen, last_seen, top_severity, contact_id, client_id,
            derived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, email) DO UPDATE SET
           display_name = excluded.display_name,
           domain = excluded.domain,
           messages_received = excluded.messages_received,
           messages_sent_to = excluded.messages_sent_to,
           threads_involved = excluded.threads_involved,
           threads_replied = excluded.threads_replied,
           first_seen = excluded.first_seen,
           last_seen = excluded.last_seen,
           top_severity = excluded.top_severity,
           contact_id = excluded.contact_id,
           client_id = excluded.client_id,
           derived_at = excluded.derived_at,
           updated_at = excluded.updated_at`
			)
			.bind(
				crypto.randomUUID(),
				connectionId,
				person.email,
				person.display_name,
				domain,
				person.messages_received,
				Number(sentTo?.n ?? 0),
				person.threads_involved,
				Number(replied?.n ?? 0),
				person.first_seen,
				person.last_seen,
				severity?.sev ?? null,
				known?.id ?? null,
				known?.client_id ?? null,
				at,
				at,
				at
			)
			.run();
	}

	const scope = await db
		.prepare(
			`SELECT COUNT(*) AS threads,
              (SELECT COUNT(*) FROM email_messages m JOIN email_threads t2 ON t2.id = m.thread_id
                WHERE m.connection_id = ? AND t2.category IN (${categories})) AS messages
       FROM email_threads t
       WHERE t.connection_id = ? AND t.category IN (${categories})`
		)
		.bind(connectionId, ...CONTEXT_CATEGORIES, connectionId, ...CONTEXT_CATEGORIES)
		.first<{ threads: number; messages: number }>();

	return {
		contacts: people.length,
		threads_considered: Number(scope?.threads ?? 0),
		messages_considered: Number(scope?.messages ?? 0),
		linked_to_client: linked
	};
}

/**
 * Threads eligible for the AI passes.
 *
 * The single place the exclusion is expressed, so a future pass cannot widen it
 * by writing its own query. Excluded categories produce no context rows at all,
 * and the suite asserts that rather than trusting this comment.
 */
export async function eligibleThreads(
	db: D1Database,
	connectionId: string,
	limit = 50
): Promise<{ id: string; subject: string | null; newest_message_id: string | null }[]> {
	const categories = CONTEXT_CATEGORIES.map(() => '?').join(', ');
	const { results } = await db
		.prepare(
			`SELECT t.id, t.subject,
              (SELECT m.id FROM email_messages m WHERE m.thread_id = t.id
                ORDER BY m.sent_at DESC LIMIT 1) AS newest_message_id
       FROM email_threads t
       WHERE t.connection_id = ?
         AND t.category IN (${categories})
       ORDER BY t.last_at DESC
       LIMIT ?`
		)
		.bind(connectionId, ...CONTEXT_CATEGORIES, limit)
		.all<{ id: string; subject: string | null; newest_message_id: string | null }>();
	return results ?? [];
}
