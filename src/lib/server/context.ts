import type { D1Database } from '@cloudflare/workers-types';
import type { R2Bucket } from '@cloudflare/workers-types';
import { nowUtc } from './dates';
import { stripHtml } from './google';
import {
	AiError,
	buildContactProfile,
	buildThreadDigest,
	buildVoiceProfile,
	extractCommitments
} from './ai';
import type { Usage } from './ai';

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

/* -------------------------------------------------------------------------
 * The AI passes
 * ---------------------------------------------------------------------- */

const MAX_CHARS_PER_MESSAGE = 6000;
const MAX_CHARS_PER_THREAD = 18_000;
const VOICE_SAMPLES = 12;
const VOICE_CHARS = 1500;

export interface ContextEnv {
	DB: D1Database;
	FILES: R2Bucket;
	ANTHROPIC_API_KEY?: string;
}

export interface PassOutcome {
	profiles: number;
	digests: number;
	commitments: number;
	voice: number;
	skipped: number;
	failed: number;
	calls: number;
	input_tokens: number;
	output_tokens: number;
	stopped_early: string | null;
}

async function bodyText(
	files: R2Bucket,
	key: string | null,
	format: string | null,
	limit: number
): Promise<string> {
	if (!key) return '';
	const object = await files.get(key);
	if (!object) return '';
	const raw = await object.text();
	// The model is given text, never markup: HTML spends the context window on
	// tags and tracking URLs instead of on what the message says.
	return (format === 'html' ? stripHtml(raw) : raw).slice(0, limit).trim();
}

/** Messages of one thread, newest-weighted and bounded. */
async function threadBodies(
	env: ContextEnv,
	threadId: string
): Promise<{ from: string | null; sent_at: string; body: string }[]> {
	const { results } = await env.DB.prepare(
		`SELECT from_email, sent_at, body_key, body_format FROM email_messages
     WHERE thread_id = ? ORDER BY sent_at ASC LIMIT 12`
	)
		.bind(threadId)
		.all<{
			from_email: string | null;
			sent_at: string;
			body_key: string | null;
			body_format: string | null;
		}>();

	const all: { from: string | null; sent_at: string; body: string }[] = [];
	for (const m of results ?? []) {
		const text = await bodyText(env.FILES, m.body_key, m.body_format, MAX_CHARS_PER_MESSAGE);
		if (text) all.push({ from: m.from_email, sent_at: m.sent_at, body: text });
	}

	let total = 0;
	const kept: typeof all = [];
	for (let i = all.length - 1; i >= 0; i--) {
		if (total + all[i].body.length > MAX_CHARS_PER_THREAD) break;
		total += all[i].body.length;
		kept.unshift(all[i]);
	}
	return kept.length > 0 ? kept : all.slice(0, 1);
}

async function record(
	db: D1Database,
	connectionId: string,
	kind: 'triage' | 'summary' | 'draft',
	usage: Usage,
	threadId: string | null
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO ai_usage
         (id, kind, model, input_tokens, output_tokens, thread_id, connection_id, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			crypto.randomUUID(),
			kind,
			usage.model,
			usage.input_tokens,
			usage.output_tokens,
			threadId,
			connectionId,
			nowUtc()
		)
		.run();
}

/**
 * One supervised context pass over an account.
 *
 * Bounded by a call ceiling rather than a wall clock, because the thing worth
 * limiting is spend. Transient failures end the pass and touch nothing;
 * permanent ones are recorded against the row so the pass does not return to
 * them forever. Same rule as the triage drain, and for the same reason: one bad
 * thread must not block the queue.
 *
 * Nothing here selects its own threads. Everything comes through
 * `eligibleThreads`, which is the single place the category exclusion lives.
 */
export async function runContextPass(
	env: ContextEnv,
	connectionId: string,
	accountEmail: string | null,
	maxCalls = 60
): Promise<PassOutcome> {
	const apiKey = env.ANTHROPIC_API_KEY;
	if (!apiKey) throw new Error('No AI key is configured.');

	const out: PassOutcome = {
		profiles: 0,
		digests: 0,
		commitments: 0,
		voice: 0,
		skipped: 0,
		failed: 0,
		calls: 0,
		input_tokens: 0,
		output_tokens: 0,
		stopped_early: null
	};

	const spend = (usage: Usage) => {
		out.calls += 1;
		out.input_tokens += usage.input_tokens;
		out.output_tokens += usage.output_tokens;
	};

	const transient = (err: unknown) =>
		err instanceof AiError && (err.status === 429 || err.status >= 500);

	// --- 1. Voice, once per account. Every draft depends on it. ---------------
	const existingVoice = await env.DB.prepare(
		'SELECT built_from_message_id FROM voice_profiles WHERE connection_id = ?'
	)
		.bind(connectionId)
		.first<{ built_from_message_id: string | null }>();

	const newestSent = await env.DB.prepare(
		`SELECT id FROM email_messages
     WHERE connection_id = ? AND LOWER(from_email) = LOWER(?)
     ORDER BY sent_at DESC LIMIT 1`
	)
		.bind(connectionId, accountEmail ?? '')
		.first<{ id: string }>();

	if (newestSent && existingVoice?.built_from_message_id !== newestSent.id && out.calls < maxCalls) {
		const { results } = await env.DB.prepare(
			`SELECT body_key, body_format FROM email_messages
       WHERE connection_id = ? AND LOWER(from_email) = LOWER(?)
         AND body_key IS NOT NULL AND body_bytes > 300
       ORDER BY sent_at DESC LIMIT ?`
		)
			.bind(connectionId, accountEmail ?? '', VOICE_SAMPLES)
			.all<{ body_key: string | null; body_format: string | null }>();

		const samples: string[] = [];
		for (const row of results ?? []) {
			const text = await bodyText(env.FILES, row.body_key, row.body_format, VOICE_CHARS);
			if (text.length > 100) samples.push(text);
		}

		if (samples.length === 0) {
			out.skipped += 1;
		} else {
			try {
				const built = await buildVoiceProfile(apiKey, samples);
				spend(built.usage);
				const at = nowUtc();
				await env.DB.prepare(
					`INSERT INTO voice_profiles
             (connection_id, greetings, sign_offs, sentence_length, formality,
              recurring_phrases, notes, built_from_messages, model,
              built_from_message_id, built_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(connection_id) DO UPDATE SET
             greetings = excluded.greetings, sign_offs = excluded.sign_offs,
             sentence_length = excluded.sentence_length, formality = excluded.formality,
             recurring_phrases = excluded.recurring_phrases, notes = excluded.notes,
             built_from_messages = excluded.built_from_messages, model = excluded.model,
             built_from_message_id = excluded.built_from_message_id,
             built_at = excluded.built_at`
				)
					.bind(
						connectionId,
						built.voice.greetings,
						built.voice.sign_offs,
						built.voice.sentence_length,
						built.voice.formality,
						built.voice.recurring_phrases,
						built.voice.notes,
						samples.length,
						built.model,
						newestSent.id,
						at
					)
					.run();
				await record(env.DB, connectionId, 'summary', built.usage, null);
				out.voice = 1;
			} catch (err) {
				if (transient(err)) {
					out.stopped_early = String(err);
					return out;
				}
				out.failed += 1;
			}
		}
	}

	// --- 2. Digests and commitments, per eligible thread ----------------------
	const threads = await eligibleThreads(env.DB, connectionId, 200);

	for (const thread of threads) {
		if (out.calls >= maxCalls) {
			out.stopped_early = `call ceiling of ${maxCalls} reached`;
			return out;
		}

		const existing = await env.DB.prepare(
			'SELECT built_from_message_id FROM thread_digests WHERE connection_id = ? AND thread_id = ?'
		)
			.bind(connectionId, thread.id)
			.first<{ built_from_message_id: string | null }>();

		// Identity, not recency. Unchanged newest message means nothing new to
		// read, so nothing to pay for.
		if (existing && existing.built_from_message_id === thread.newest_message_id) continue;

		const bodies = await threadBodies(env, thread.id);
		if (bodies.length === 0) {
			out.skipped += 1;
			continue;
		}

		const subject = thread.subject ?? '(no subject)';
		const at = nowUtc();

		try {
			const digest = await buildThreadDigest(apiKey, subject, bodies);
			spend(digest.usage);
			await env.DB.prepare(
				`INSERT INTO thread_digests
           (id, connection_id, thread_id, summary, decisions, open_asks,
            paul_commitments, next_move, model, built_from_message_id, built_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, thread_id) DO UPDATE SET
           summary = excluded.summary, decisions = excluded.decisions,
           open_asks = excluded.open_asks, paul_commitments = excluded.paul_commitments,
           next_move = excluded.next_move, model = excluded.model,
           built_from_message_id = excluded.built_from_message_id,
           built_at = excluded.built_at`
			)
				.bind(
					crypto.randomUUID(),
					connectionId,
					thread.id,
					digest.digest.summary,
					digest.digest.decisions,
					digest.digest.open_asks,
					digest.digest.paul_commitments,
					digest.digest.next_move,
					digest.model,
					thread.newest_message_id,
					at
				)
				.run();
			await record(env.DB, connectionId, 'summary', digest.usage, thread.id);
			out.digests += 1;

			if (out.calls >= maxCalls) {
				out.stopped_early = `call ceiling of ${maxCalls} reached`;
				return out;
			}

			const found = await extractCommitments(apiKey, subject, bodies);
			spend(found.usage);
			await record(env.DB, connectionId, 'summary', found.usage, thread.id);

			// Replaced rather than appended: a re-read of the same thread should
			// correct what it found last time, not stack a second copy beside it.
			await env.DB.prepare('DELETE FROM commitments WHERE connection_id = ? AND thread_id = ?')
				.bind(connectionId, thread.id)
				.run();

			for (const c of found.commitments) {
				const source = await env.DB.prepare(
					`SELECT id FROM email_messages WHERE thread_id = ? ORDER BY sent_at DESC LIMIT 1`
				)
					.bind(thread.id)
					.first<{ id: string }>();
				if (!source) continue;

				await env.DB.prepare(
					`INSERT INTO commitments
             (id, connection_id, thread_id, source_message_id, owed_by, owed_to,
              what, due_signal, model, built_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				)
					.bind(
						crypto.randomUUID(),
						connectionId,
						thread.id,
						source.id,
						c.owed_by,
						c.owed_to || null,
						c.what,
						c.due_signal || null,
						found.model,
						at,
						at,
						at
					)
					.run();
				out.commitments += 1;
			}
		} catch (err) {
			if (transient(err)) {
				out.stopped_early = String(err);
				return out;
			}
			out.failed += 1;
		}
	}

	// --- 3. Contact profiles, for people Paul actually replies to -------------
	const { results: contacts } = await env.DB.prepare(
		`SELECT id, email, threads_replied FROM mail_contacts
     WHERE connection_id = ? AND threads_replied > 0
     ORDER BY threads_replied DESC, messages_received DESC`
	)
		.bind(connectionId)
		.all<{ id: string; email: string; threads_replied: number }>();

	for (const contact of contacts ?? []) {
		if (out.calls >= maxCalls) {
			out.stopped_early = `call ceiling of ${maxCalls} reached`;
			return out;
		}

		const newest = await env.DB.prepare(
			`SELECT m.id FROM email_messages m
       JOIN email_threads t ON t.id = m.thread_id
       WHERE m.connection_id = ? AND LOWER(m.from_email) = LOWER(?)
         AND t.category = 'correspondence'
       ORDER BY m.sent_at DESC LIMIT 1`
		)
			.bind(connectionId, contact.email)
			.first<{ id: string }>();
		if (!newest) {
			out.skipped += 1;
			continue;
		}

		const existing = await env.DB.prepare(
			'SELECT built_from_message_id FROM contact_profiles WHERE connection_id = ? AND mail_contact_id = ?'
		)
			.bind(connectionId, contact.id)
			.first<{ built_from_message_id: string | null }>();
		if (existing && existing.built_from_message_id === newest.id) continue;

		const { results: threadRows } = await env.DB.prepare(
			`SELECT DISTINCT t.id FROM email_threads t
       JOIN email_messages m ON m.thread_id = t.id
       WHERE t.connection_id = ? AND t.category = 'correspondence'
         AND LOWER(m.from_email) = LOWER(?)
       ORDER BY t.last_at DESC LIMIT 4`
		)
			.bind(connectionId, contact.email)
			.all<{ id: string }>();

		const bodies: { from: string | null; sent_at: string; body: string }[] = [];
		for (const t of threadRows ?? []) bodies.push(...(await threadBodies(env, t.id)));
		if (bodies.length === 0) {
			out.skipped += 1;
			continue;
		}

		try {
			const built = await buildContactProfile(apiKey, contact.email, bodies.slice(0, 12));
			spend(built.usage);
			await env.DB.prepare(
				`INSERT INTO contact_profiles
           (id, connection_id, mail_contact_id, relationship, usual_topics,
            expected_tone, open_commitments, model, built_from_message_id, built_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, mail_contact_id) DO UPDATE SET
           relationship = excluded.relationship, usual_topics = excluded.usual_topics,
           expected_tone = excluded.expected_tone,
           open_commitments = excluded.open_commitments,
           model = excluded.model,
           built_from_message_id = excluded.built_from_message_id,
           built_at = excluded.built_at`
			)
				.bind(
					crypto.randomUUID(),
					connectionId,
					contact.id,
					built.profile.relationship,
					built.profile.usual_topics,
					built.profile.expected_tone,
					built.profile.open_commitments,
					built.model,
					newest.id,
					nowUtc()
				)
				.run();
			await record(env.DB, connectionId, 'summary', built.usage, null);
			out.profiles += 1;
		} catch (err) {
			if (transient(err)) {
				out.stopped_early = String(err);
				return out;
			}
			out.failed += 1;
		}
	}

	return out;
}
