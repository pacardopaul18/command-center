import type { D1Database, KVNamespace, R2Bucket } from '@cloudflare/workers-types';
import { nowUtc } from './dates';
import {
	GoogleError,
	accessToken,
	getMessage,
	isDraft,
	listMessageIds,
	stripHtml
} from './google';
import { AiError, summariseThread, triageThread } from './ai';

/**
 * Mail work, as jobs that can be run by anything.
 *
 * Extracted from the API routes because they were the only thing that could run
 * them, which meant every heavy job ran only while Paul kept a browser tab open.
 * That was a defensible v1 shortcut and it stopped being defensible at 858
 * messages: he navigated away, everything stopped, and 747 threads sat
 * untriaged looking like a broken classifier rather than an unfinished one.
 *
 * Now the cron runs them, the API runs them, and both call these functions.
 * Nothing depends on a tab staying open ever again.
 *
 * THE BUDGET IS THE POINT. A scheduled invocation has a hard ceiling on
 * subrequests, and every message read, every R2 object and every D1 query
 * spends one. So each job takes a budget, decrements it as it works, and stops
 * cleanly when it runs low rather than being cut off mid-write. Stopping early
 * costs nothing because both jobs are resumable by design.
 */

export interface MailEnv {
	DB: D1Database;
	SESSIONS: KVNamespace;
	FILES: R2Bucket;
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	ANTHROPIC_API_KEY?: string;
}

/**
 * Subrequests a scheduled firing may spend on mail.
 *
 * Deliberately well under the platform ceiling. The digest and the backup share
 * the same invocation, and a mail job that used the whole allowance would starve
 * the job the firing actually exists for.
 */
export const CRON_BUDGET = 35;

/** Messages read per API-driven batch, where the ceiling is far higher. */
export const BATCH_SIZE = 25;

/**
 * Stored body size.
 *
 * Lowered from 100k after the worker started exceeding its CPU limit on the
 * re-read. Keeping the rich body means decoding both MIME alternatives and
 * writing markup rather than stripped text, so a batch does several times the
 * work it used to. Sixty thousand characters is far more than any message a
 * person reads to the end.
 */
const MAX_BODY_BYTES = 60_000;
const MAX_CHARS_PER_MESSAGE = 8000;
const MAX_MESSAGES_PER_THREAD = 12;

/**
 * Total characters sent for one thread, across all its messages.
 *
 * A per-message cap alone is not a cap: twelve messages at eight thousand
 * characters is ninety six thousand, and a thread that long made the model
 * write until it hit its own output ceiling, which surfaced as a hard failure
 * rather than a long summary. Bounding the whole thread bounds the answer.
 */
const MAX_CHARS_PER_THREAD = 24_000;

/** Roughly what one message costs: a Gmail read, an R2 put, a few D1 writes. */
const COST_PER_MESSAGE = 6;

/** Roughly what one thread costs: bodies out of R2, two model calls, a write. */
const COST_PER_THREAD = 8;

class Budget {
	remaining: number;
	spent = 0;

	constructor(total: number) {
		this.remaining = total;
	}

	/** True when there is room for another unit of work of this size. */
	canAfford(cost: number): boolean {
		return this.remaining >= cost;
	}

	spend(cost: number) {
		this.remaining -= cost;
		this.spent += cost;
	}
}

export interface IngestOutcome {
	status: string;
	seen: number;
	fetched: number;
	discovered: number;
	total_estimate: number | null;
	spent: number;
}

async function connectionRow(db: D1Database) {
	return db
		.prepare("SELECT id, account_email FROM connections WHERE provider = 'google'")
		.first<{ id: string; account_email: string | null }>();
}

async function matchSender(db: D1Database, fromEmail: string | null) {
	if (!fromEmail) return { client_id: null, contact_id: null };
	const hit = await db
		.prepare('SELECT id, client_id FROM contacts WHERE LOWER(email) = ? LIMIT 1')
		.bind(fromEmail.toLowerCase())
		.first<{ id: string; client_id: string }>();
	return hit ? { client_id: hit.client_id, contact_id: hit.id } : { client_id: null, contact_id: null };
}

function bodyKey(connectionId: string, messageId: string): string {
	return `email/${connectionId}/${messageId}.txt`;
}

async function upsertThread(
	db: D1Database,
	connectionId: string,
	message: Awaited<ReturnType<typeof getMessage>>,
	at: string
): Promise<string> {
	const existing = await db
		.prepare('SELECT id FROM email_threads WHERE connection_id = ? AND provider_thread_id = ?')
		.bind(connectionId, message.provider_thread_id)
		.first<{ id: string }>();

	const match = await matchSender(db, message.from_email);

	if (existing) {
		await db
			.prepare(
				`UPDATE email_threads
         SET subject = COALESCE(?, subject),
             message_count = (SELECT COUNT(*) FROM email_messages WHERE thread_id = ?) + 1,
             first_at = MIN(COALESCE(first_at, ?), ?),
             last_at = MAX(COALESCE(last_at, ?), ?),
             client_id = COALESCE(client_id, ?),
             contact_id = COALESCE(contact_id, ?),
             updated_at = ?
         WHERE id = ?`
			)
			.bind(
				message.subject,
				existing.id,
				message.sent_at,
				message.sent_at,
				message.sent_at,
				message.sent_at,
				match.client_id,
				match.contact_id,
				at,
				existing.id
			)
			.run();
		return existing.id;
	}

	const id = crypto.randomUUID();
	await db
		.prepare(
			`INSERT INTO email_threads
         (id, connection_id, provider_thread_id, subject, message_count, first_at, last_at,
          client_id, contact_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			id,
			connectionId,
			message.provider_thread_id,
			message.subject,
			message.sent_at,
			message.sent_at,
			match.client_id,
			match.contact_id,
			at,
			at
		)
		.run();
	return id;
}

async function storeMessage(
	db: D1Database,
	files: R2Bucket,
	connectionId: string,
	message: Awaited<ReturnType<typeof getMessage>>,
	at: string
): Promise<void> {
	let key: string | null = null;
	let bytes: number | null = null;

	if (message.body && message.body.trim()) {
		const text = message.body.slice(0, MAX_BODY_BYTES);
		key = bodyKey(connectionId, message.provider_message_id);
		const encoded = new TextEncoder().encode(text);
		await files.put(key, encoded);
		bytes = encoded.byteLength;
	}

	const threadId = await upsertThread(db, connectionId, message, at);
	const match = await matchSender(db, message.from_email);
	const messageRowId = crypto.randomUUID();

	await db
		.prepare(
			`INSERT INTO email_messages
         (id, connection_id, thread_id, provider_message_id, provider_thread_id,
          subject, from_email, from_name, to_emails, cc_emails, sent_at, snippet,
          label_ids, is_unread, body_key, body_bytes, body_format, client_id, contact_id, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(connection_id, provider_message_id) DO UPDATE SET
         subject = excluded.subject, snippet = excluded.snippet,
         label_ids = excluded.label_ids, is_unread = excluded.is_unread,
         body_key = excluded.body_key, body_bytes = excluded.body_bytes,
         body_format = excluded.body_format,
         fetched_at = excluded.fetched_at`
		)
		.bind(
			messageRowId,
			connectionId,
			threadId,
			message.provider_message_id,
			message.provider_thread_id,
			message.subject,
			message.from_email,
			message.from_name,
			message.to_emails,
			message.cc_emails,
			message.sent_at,
			message.snippet,
			message.label_ids,
			message.is_unread,
			key,
			bytes,
			message.body_format,
			match.client_id,
			match.contact_id,
			at
		)
		.run();

	if (message.attachments.length === 0) return;

	// The row that was just written, which may be an existing one if this
	// message was re-read. The metadata attaches to whichever it is.
	const stored = await db
		.prepare('SELECT id FROM email_messages WHERE connection_id = ? AND provider_message_id = ?')
		.bind(connectionId, message.provider_message_id)
		.first<{ id: string }>();
	if (!stored) return;

	for (const file of message.attachments) {
		// Metadata only. The file itself is fetched on demand, because most
		// attachments are never opened and downloading every one during ingest
		// would spend the whole budget on files nobody wants.
		await db
			.prepare(
				`INSERT INTO email_attachments
           (id, message_id, provider_attachment_id, filename, mime_type, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(message_id, provider_attachment_id) DO UPDATE SET
           filename = excluded.filename,
           mime_type = excluded.mime_type,
           size_bytes = excluded.size_bytes`
			)
			.bind(
				crypto.randomUUID(),
				stored.id,
				file.provider_attachment_id,
				file.filename,
				file.mime_type,
				file.size_bytes
			)
			.run();
	}
}

/**
 * Reads as much mail as the budget allows, then records where it got to.
 *
 * The cursor is written after the batch, never before, so a run cut short by
 * the budget or by a failure resumes from the last message actually stored.
 */
export async function ingestStep(env: MailEnv, budgetUnits: number): Promise<IngestOutcome> {
	const budget = new Budget(budgetUnits);
	const conn = await connectionRow(env.DB);
	if (!conn) throw new Error('No Google account is connected.');

	const state = await env.DB.prepare(
		'SELECT * FROM email_ingest_state WHERE connection_id = ?'
	)
		.bind(conn.id)
		.first<{
			status: string;
			window_days: number;
			page_token: string | null;
			total_estimate: number | null;
			discovered: number;
			fetched: number;
		}>();

	if (!state) throw new Error('No ingest has been started.');
	if (state.status === 'done' || state.status === 'paused') {
		return {
			status: state.status,
			seen: 0,
			fetched: 0,
			discovered: state.discovered,
			total_estimate: state.total_estimate,
			spent: 0
		};
	}

	const at = nowUtc();

	try {
		const tokens = await accessToken(
			env.SESSIONS,
			env.GOOGLE_CLIENT_ID ?? '',
			env.GOOGLE_CLIENT_SECRET ?? ''
		);
		budget.spend(1);

		// `-in:drafts` keeps unsent drafts out of the listing entirely, so they
		// are never fetched and never stored. Correspondence is what was sent and
		// received; a draft is a thought Paul had and chose not to send.
		const page = await listMessageIds(
			tokens.access_token,
			`newer_than:${state.window_days}d -in:drafts`,
			state.page_token,
			BATCH_SIZE
		);
		budget.spend(1);

		let fetched = 0;
		let seen = 0;

		for (const ref of page.messages) {
			// Stop cleanly rather than being cut off part way through writing a
			// message. The page token is not advanced, so the next run covers the
			// rest of this page.
			if (!budget.canAfford(COST_PER_MESSAGE)) break;
			seen += 1;

			const existing = await env.DB.prepare(
				`SELECT id, body_format FROM email_messages
         WHERE connection_id = ? AND provider_message_id = ?`
			)
				.bind(conn.id, ref.id)
				.first<{ id: string; body_format: string | null }>();

			// A row with no recorded format predates keeping the rich body, so its
			// stored body is the stripped text that read as garbage. Re-read rather
			// than skipped, which is what upgrades everything already held.
			if (existing && existing.body_format) continue;

			const message = await getMessage(tokens.access_token, ref.id, true);

			// The second guard. The query should have excluded it; if one arrives
			// anyway it is dropped here rather than stored, because the query is a
			// string and strings get edited.
			if (isDraft(message.label_ids)) continue;

			await storeMessage(env.DB, env.FILES, conn.id, message, at);
			budget.spend(COST_PER_MESSAGE);
			fetched += 1;
		}

		// The page is only finished, and the cursor only advanced, when every
		// message on it was handled. Otherwise the same page is read again.
		const pageComplete = seen === page.messages.length;
		const finished = pageComplete && !page.nextPageToken;

		await env.DB.prepare(
			`UPDATE email_ingest_state
       SET status = ?, page_token = ?, total_estimate = ?, discovered = ?, fetched = ?,
           updated_at = ?, finished_at = ?
       WHERE connection_id = ?`
		)
			.bind(
				finished ? 'done' : 'running',
				pageComplete ? page.nextPageToken : state.page_token,
				state.total_estimate ?? page.resultSizeEstimate,
				state.discovered + seen,
				state.fetched + fetched,
				at,
				finished ? at : null,
				conn.id
			)
			.run();

		return {
			status: finished ? 'done' : 'running',
			seen,
			fetched,
			discovered: state.discovered + seen,
			total_estimate: state.total_estimate ?? page.resultSizeEstimate,
			spent: budget.spent
		};
	} catch (err) {
		const message = err instanceof GoogleError ? err.message : String(err);
		await env.DB.prepare(
			`UPDATE email_ingest_state SET status = 'failed', last_error = ?, updated_at = ?
       WHERE connection_id = ?`
		)
			.bind(message, at, conn.id)
			.run();
		throw err;
	}
}

export interface TriageOutcome {
	summarised: number;
	/** No readable body, so nothing to judge. */
	skipped: number;
	/** Tried and could not be answered. Recorded so it is not retried forever. */
	failed: number;
	remaining: number;
	spent: number;
}

/**
 * Summarises and triages as many threads as the budget allows.
 *
 * One pass answers both questions against the same bodies, which are the
 * expensive part to load. Running them in parallel halves the wait per thread.
 */
export async function triageBatch(env: MailEnv, budgetUnits: number): Promise<TriageOutcome> {
	const budget = new Budget(budgetUnits);
	const apiKey = env.ANTHROPIC_API_KEY;
	if (!apiKey) throw new Error('No AI key is configured.');

	const conn = await connectionRow(env.DB);
	if (!conn) throw new Error('No Google account is connected.');

	const { results } = await env.DB.prepare(
		`SELECT id, subject, last_at FROM email_threads
     WHERE connection_id = ?
       AND (summary IS NULL OR summary_at IS NULL OR summary_at < last_at OR severity IS NULL)
       AND NOT (severity IS NULL AND classified_at IS NOT NULL)
     ORDER BY last_at DESC
     LIMIT 40`
	)
		.bind(conn.id)
		.all<{ id: string; subject: string | null; last_at: string | null }>();

	let summarised = 0;
	let skipped = 0;
	let failed = 0;

	for (const thread of results ?? []) {
		if (!budget.canAfford(COST_PER_THREAD)) break;

		const messages = await env.DB.prepare(
			`SELECT from_email, sent_at, body_key, body_format FROM email_messages
       WHERE thread_id = ? ORDER BY sent_at ASC LIMIT ?`
		)
			.bind(thread.id, MAX_MESSAGES_PER_THREAD)
			.all<{
				from_email: string | null;
				sent_at: string;
				body_key: string | null;
				body_format: string | null;
			}>();

		const withBodies: { from: string | null; sent_at: string; body: string }[] = [];
		for (const m of messages.results ?? []) {
			if (!m.body_key) continue;
			const object = await env.FILES.get(m.body_key);
			if (!object) continue;
			const raw = await object.text();
			// The model is given text, never markup: feeding it HTML spends the
			// context window on tags and tracking URLs.
			const text = (m.body_format === 'html' ? stripHtml(raw) : raw).slice(
				0,
				MAX_CHARS_PER_MESSAGE
			);
			if (text.trim()) withBodies.push({ from: m.from_email, sent_at: m.sent_at, body: text });
		}

		// Trim from the front when a thread is very long. The recent messages are
		// what a summary is mostly about, and the oldest are usually the part
		// already covered by whatever came before.
		let total = 0;
		const trimmed: typeof withBodies = [];
		for (let i = withBodies.length - 1; i >= 0; i--) {
			if (total + withBodies[i].body.length > MAX_CHARS_PER_THREAD) break;
			total += withBodies[i].body.length;
			trimmed.unshift(withBodies[i]);
		}
		const sending = trimmed.length > 0 ? trimmed : [withBodies[0]];

		// Nothing readable is not a failure, and not a thread to invent a label
		// for. Triaging a subject line alone produces a confident answer with no
		// evidence under it.
		if (withBodies.length === 0) {
			skipped += 1;
			continue;
		}

		const subject = thread.subject ?? '(no subject)';
		try {
			const [summarisedThread, triaged] = await Promise.all([
				summariseThread(apiKey, subject, sending),
				triageThread(apiKey, subject, sending)
			]);

			const at = nowUtc();
			await env.DB.prepare(
				`UPDATE email_threads
         SET summary = ?, summary_model = ?, summary_at = ?,
             category = ?, severity = ?, gist = ?,
             classified_at = ?, classified_model = ?, updated_at = ?
         WHERE id = ?`
			)
				.bind(
					summarisedThread.summary,
					summarisedThread.model,
					at,
					triaged.triage.category,
					triaged.triage.severity,
					triaged.triage.gist,
					at,
					triaged.model,
					at,
					thread.id
				)
				.run();
			budget.spend(COST_PER_THREAD);
			summarised += 1;
		} catch (err) {
			/**
			 * Transient against permanent, and the distinction is load bearing.
			 *
			 * A rate limit or an unreachable API says nothing about this thread. The
			 * first version of this recovery marked every failure as attempted, so
			 * thirteen perfectly good threads were about to be written off over a
			 * network blip and never looked at again. Transient failures end the
			 * batch and leave the thread untouched for the next run.
			 *
			 * Only a failure that will recur no matter how often it is retried, such
			 * as a thread whose answer will not fit, is recorded as attempted.
			 */
			const transient =
				err instanceof AiError && (err.status === 429 || err.status >= 500);
			if (transient) {
				console.error('triage stopping, transient failure', String(err));
				break;
			}

			// ONE BAD THREAD MUST NOT BLOCK THE QUEUE.
			//
			// Throwing here killed the whole batch, and because the failing thread
			// stayed first in the ordering, every following run hit it again and
			// died in the same place. The backlog could never drain past it.
			//
			// So the attempt is recorded and the loop continues. `classified_at`
			// means it was tried; `severity` still null means no answer was got.
			// The thread stays visibly untriaged rather than being given a made up
			// label, and the pending query skips anything already attempted.
			console.error('triage failed for thread', thread.id, String(err));
			await env.DB.prepare(
				'UPDATE email_threads SET classified_at = ?, updated_at = ? WHERE id = ?'
			)
				.bind(nowUtc(), nowUtc(), thread.id)
				.run();
			failed += 1;
			budget.spend(COST_PER_THREAD);
		}
	}

	const remaining = await env.DB.prepare(
		`SELECT COUNT(*) AS n FROM email_threads
     WHERE connection_id = ?
       AND (summary IS NULL OR summary_at IS NULL OR summary_at < last_at OR severity IS NULL)
       AND NOT (severity IS NULL AND classified_at IS NOT NULL)`
	)
		.bind(conn.id)
		.first<{ n: number }>();

	return {
		summarised,
		skipped,
		failed,
		remaining: Number(remaining?.n ?? 0),
		spent: budget.spent
	};
}

export interface MaintenanceOutcome {
	ran: 'ingest' | 'triage' | 'nothing';
	detail: string;
}

/**
 * One firing's worth of mail work.
 *
 * Ingest first when a run is unfinished, because triaging a thread whose later
 * messages have not arrived produces a summary that is immediately stale.
 * Otherwise triage, which is where the backlog lives.
 *
 * Never throws. A mail job failing must not fail the invocation the digest or
 * the backup was the point of, so problems are reported in the returned detail
 * and in the log rather than by taking the firing down.
 */
export async function runMailMaintenance(
	env: MailEnv,
	budgetUnits = CRON_BUDGET
): Promise<MaintenanceOutcome> {
	const conn = await connectionRow(env.DB);
	if (!conn) return { ran: 'nothing', detail: 'no Google account connected' };

	const state = await env.DB.prepare(
		'SELECT status FROM email_ingest_state WHERE connection_id = ?'
	)
		.bind(conn.id)
		.first<{ status: string }>();

	if (state && (state.status === 'running' || state.status === 'failed')) {
		try {
			const outcome = await ingestStep(env, budgetUnits);
			return {
				ran: 'ingest',
				detail:
					`${outcome.fetched} stored, ${outcome.seen} seen, ` +
					`${outcome.discovered} listed so far, status ${outcome.status}`
			};
		} catch (err) {
			return { ran: 'ingest', detail: `failed: ${String(err)}` };
		}
	}

	try {
		const outcome = await triageBatch(env, budgetUnits);
		return {
			ran: 'triage',
			detail:
				`${outcome.summarised} triaged, ${outcome.skipped} skipped, ` +
				`${outcome.failed} failed, ${outcome.remaining} still to do`
		};
	} catch (err) {
		return { ran: 'triage', detail: `failed: ${String(err)}` };
	}
}