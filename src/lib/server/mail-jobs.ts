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
import { listAccounts } from './accounts';
import { recordUsage } from './ai-usage';
import type { Usage } from './ai';
import { checkAiBudget } from './ai-budget';

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

/**
 * What triage is shown: the subject, the sender and the opening.
 *
 * A four way question does not need the whole conversation. Sending it anyway
 * was paying for tokens that changed no answer, and on a mailbox this size that
 * is most of the bill.
 */
const TRIAGE_CHARS = 1200;

/** Severities worth paying the larger model to summarise. */
const WORTH_SUMMARISING: readonly string[] = ['urgent', 'important'];

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

/**
 * The account a job is running for.
 *
 * Takes an id rather than finding "the" connection. A job that resolves its own
 * account is a job that cannot be told which one to work on, and with more than
 * one connected it would silently pick whichever row came first.
 */
async function connectionRow(db: D1Database, accountId: string) {
	return db
		.prepare('SELECT id, account_email FROM connections WHERE id = ?')
		.bind(accountId)
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
export async function ingestStep(
	env: MailEnv,
	accountId: string,
	budgetUnits: number
): Promise<IngestOutcome> {
	const budget = new Budget(budgetUnits);
	const conn = await connectionRow(env.DB, accountId);
	if (!conn) throw new Error('That account is not connected.');

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
			conn.id,
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

/**
 * Keeps a thread inside the size the model can answer about.
 *
 * Trimmed from the front: recent messages are what a summary is mostly about,
 * and the oldest are usually already covered by whatever came before.
 */
function trimThread(
	bodies: { from: string | null; sent_at: string; body: string }[]
): { from: string | null; sent_at: string; body: string }[] {
	let total = 0;
	const kept: typeof bodies = [];
	for (let i = bodies.length - 1; i >= 0; i--) {
		if (total + bodies[i].body.length > MAX_CHARS_PER_THREAD) break;
		total += bodies[i].body.length;
		kept.unshift(bodies[i]);
	}
	return kept.length > 0 ? kept : [bodies[0]];
}

/**
 * Records what a call cost.
 *
 * Written from the response rather than estimated from row counts, so the meter
 * in Settings reports measured usage. A spend meter built on guesses is a
 * second thing that can be wrong about money.
 */

export interface TriageOutcome {
	summarised: number;
	/** No readable body, so nothing to judge. */
	skipped: number;
	/** Tried and could not be answered. Recorded so it is not retried forever. */
	failed: number;
	remaining: number;
	spent: number;
	/**
	 * Why the run stopped early, when it did.
	 *
	 * A hard refusal from the API used to come back as ok:true with every count
	 * at zero, which reads as "there was nothing to do" and is the opposite of
	 * what happened. The usage limit is the case that matters: the app is not
	 * broken and nothing is wrong with the mail, the account simply cannot spend
	 * until the limit resets, and that is worth saying rather than implying.
	 */
	stopped: string | null;
}

/**
 * Summarises and triages as many threads as the budget allows.
 *
 * One pass answers both questions against the same bodies, which are the
 * expensive part to load. Running them in parallel halves the wait per thread.
 */
export async function triageBatch(
	env: MailEnv,
	accountId: string,
	budgetUnits: number,
	/**
	 * The named backfill run this batch belongs to, when it belongs to one.
	 *
	 * Ordinary cron triage passes nothing and draws on the monthly ceiling. A
	 * corpus pass names its run and draws on that run's allowance instead, so
	 * one cannot eat the other.
	 */
	runName: string | null = null
): Promise<TriageOutcome> {
	const budget = new Budget(budgetUnits);
	const apiKey = env.ANTHROPIC_API_KEY;
	if (!apiKey) throw new Error('No AI key is configured.');

	const conn = await connectionRow(env.DB, accountId);
	if (!conn) throw new Error('That account is not connected.');

	/**
	 * The spend stop, checked before any thread is read.
	 *
	 * Before, not after: a check that runs once the call has returned has
	 * already spent the money. Checked once per batch rather than per thread,
	 * because a batch is at most fourteen calls and re-reading the month for
	 * each would cost more queries than it could ever save in cents.
	 *
	 * The refusal comes back as `stopped`, carrying the reason, which is what
	 * that field exists for. A run that was refused and a run with nothing to do
	 * both return zeros, and only the reason tells them apart. D138.
	 */
	const budgetVerdict = await checkAiBudget(env.DB, { run: runName });
	if (!budgetVerdict.ok) {
		return {
			summarised: 0,
			skipped: 0,
			failed: 0,
			remaining: 0,
			spent: 0,
			stopped: budgetVerdict.reason
		};
	}

	/**
	 * Threads whose newest message has not been triaged.
	 *
	 * Keyed on the id of the latest message rather than on `summary_at < last_at`.
	 * A timestamp comparison re-runs whenever anything moves `last_at`, including
	 * a re-read that changed nothing anybody said, and it ties on writes landing
	 * in the same second. An id is exact: unchanged means there is nothing new to
	 * read, so there is nothing to pay for.
	 */
	const { results } = await env.DB.prepare(
		`SELECT t.id, t.subject, t.last_at, t.severity, t.severity_override,
            (SELECT m.id FROM email_messages m WHERE m.thread_id = t.id
              ORDER BY m.sent_at DESC LIMIT 1) AS newest_message_id
     FROM email_threads t
     WHERE t.connection_id = ?
       AND NOT (t.severity IS NULL AND t.classified_at IS NOT NULL)
     ORDER BY t.last_at DESC
     LIMIT 200`
	)
		.bind(conn.id)
		.all<{
			id: string;
			subject: string | null;
			last_at: string | null;
			severity: string | null;
			severity_override: string | null;
			newest_message_id: string | null;
		}>();

	let summarised = 0;
	let skipped = 0;
	let failed = 0;
	let stopped: string | null = null;

	for (const thread of results ?? []) {
		if (!budget.canAfford(COST_PER_THREAD)) break;

		// Everything is triaged. Only what triage said matters is summarised, and
		// nothing is done twice for a thread whose newest message has not changed.
		const needsTriage = await env.DB.prepare(
			`SELECT 1 FROM email_threads
       WHERE id = ? AND (severity IS NULL OR triaged_message_id IS NOT ?)`
		)
			.bind(thread.id, thread.newest_message_id)
			.first();

		const effective = thread.severity_override ?? thread.severity;
		const deservesSummary = effective !== null && WORTH_SUMMARISING.includes(effective);
		const needsSummary = deservesSummary
			? await env.DB.prepare(
					`SELECT 1 FROM email_threads
         WHERE id = ? AND (summary IS NULL OR summary_message_id IS NOT ?)`
				)
					.bind(thread.id, thread.newest_message_id)
					.first()
			: null;

		if (!needsTriage && !needsSummary) continue;

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
			const text = (m.body_format === 'html' ? stripHtml(raw) : raw).slice(
				0,
				MAX_CHARS_PER_MESSAGE
			);
			if (text.trim()) withBodies.push({ from: m.from_email, sent_at: m.sent_at, body: text });
		}

		if (withBodies.length === 0) {
			skipped += 1;
			continue;
		}

		const subject = thread.subject ?? '(no subject)';
		const at = nowUtc();

		try {
			if (needsTriage) {
				// The opening only. A four way answer does not improve with the rest
				// of the conversation, and on this many threads the difference is
				// most of the bill.
				const opening = [
					{
						from: withBodies[0].from,
						sent_at: withBodies[0].sent_at,
						body: withBodies[0].body.slice(0, TRIAGE_CHARS)
					}
				];
				const triaged = await triageThread(apiKey, subject, opening);
				await env.DB.prepare(
					`UPDATE email_threads
           SET category = ?, severity = ?, gist = ?, classified_at = ?,
               classified_model = ?, triaged_message_id = ?, updated_at = ?
           WHERE id = ?`
				)
					.bind(
						triaged.triage.category,
						triaged.triage.severity,
						triaged.triage.gist,
						at,
						triaged.model,
						thread.newest_message_id,
						at,
						thread.id
					)
					.run();
				await recordUsage(env.DB, 'triage', triaged.usage, thread.id, accountId, runName);
				budget.spend(2);

				// A thread only just judged urgent should get its summary in the same
				// pass rather than waiting for the next firing.
				if (WORTH_SUMMARISING.includes(triaged.triage.severity)) {
					const trimmed = trimThread(withBodies);
					const summarised = await summariseThread(apiKey, subject, trimmed);
					await env.DB.prepare(
						`UPDATE email_threads
             SET summary = ?, summary_model = ?, summary_at = ?, summary_message_id = ?,
                 updated_at = ? WHERE id = ?`
					)
						.bind(
							summarised.summary,
							summarised.model,
							at,
							thread.newest_message_id,
							at,
							thread.id
						)
						.run();
					await recordUsage(env.DB, 'summary', summarised.usage, thread.id, accountId, runName);
					budget.spend(COST_PER_THREAD);
				}
			} else if (needsSummary) {
				const trimmed = trimThread(withBodies);
				const summarised = await summariseThread(apiKey, subject, trimmed);
				await env.DB.prepare(
					`UPDATE email_threads
           SET summary = ?, summary_model = ?, summary_at = ?, summary_message_id = ?,
               updated_at = ? WHERE id = ?`
				)
					.bind(summarised.summary, summarised.model, at, thread.newest_message_id, at, thread.id)
					.run();
				await recordUsage(env.DB, 'summary', summarised.usage, thread.id, accountId, runName);
				budget.spend(COST_PER_THREAD);
			}

			summarised += 1;
		} catch (err) {
			const message = String(err);
			// A spending limit is not a transient blip and not a bad thread: it
			// stops the whole run and will keep stopping it until it resets.
			const limited = /usage limit|regain access|credit balance|quota/i.test(message);
			const transient =
				limited || (err instanceof AiError && (err.status === 429 || err.status >= 500));
			if (transient) {
				stopped = limited
					? 'The AI account has reached its usage limit, so nothing can be read until it resets. ' +
						'Nothing is wrong with the mail or the app.'
					: 'The AI service was briefly unavailable, so the run stopped and will resume.';
				console.error('triage stopping', message);
				break;
			}
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
		`SELECT COUNT(*) AS n FROM email_threads t
     WHERE t.connection_id = ?
       AND NOT (t.severity IS NULL AND t.classified_at IS NOT NULL)
       AND (t.severity IS NULL
            OR t.triaged_message_id IS NOT (SELECT m.id FROM email_messages m
                 WHERE m.thread_id = t.id ORDER BY m.sent_at DESC LIMIT 1))`
	)
		.bind(conn.id)
		.first<{ n: number }>();

	return {
		summarised,
		skipped,
		failed,
		remaining: Number(remaining?.n ?? 0),
		spent: budget.spent,
		stopped
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
	const accounts = await listAccounts(env.DB);
	if (accounts.length === 0) return { ran: 'nothing', detail: 'no Google account connected' };

	/**
	 * The budget is split across accounts rather than spent on the first one.
	 *
	 * With several connected, giving the whole firing to whichever came first
	 * would starve the rest exactly as an unfinished ingest starved triage
	 * before D107. The same lesson, one level up: priority is fine, exclusivity
	 * is not.
	 */
	const share = Math.max(12, Math.floor(budgetUnits / accounts.length));
	const parts: string[] = [];
	let ran: MaintenanceOutcome['ran'] = 'nothing';

	for (const account of accounts) {
		const label = account.account_email ?? account.id;
		let left = share;

		const state = await env.DB.prepare(
			'SELECT status FROM email_ingest_state WHERE connection_id = ?'
		)
			.bind(account.id)
			.first<{ status: string }>();

		if (state && (state.status === 'running' || state.status === 'failed')) {
			const ingestShare = Math.max(12, Math.floor(share * 0.4));
			try {
				const outcome = await ingestStep(env, account.id, ingestShare);
				ran = 'ingest';
				left -= Math.max(outcome.spent, 1);
				parts.push(`${label} ingest ${outcome.fetched} stored, status ${outcome.status}`);
			} catch (err) {
				parts.push(`${label} ingest failed: ${String(err)}`);
				left -= ingestShare;
			}
		}

		if (left >= COST_PER_THREAD) {
			try {
				const outcome = await triageBatch(env, account.id, left);
				ran = ran === 'ingest' ? 'ingest' : 'triage';
				parts.push(
					`${label} triage ${outcome.summarised} done, ${outcome.skipped} skipped, ` +
						`${outcome.failed} failed, ${outcome.remaining} left`
				);
			} catch (err) {
				parts.push(`${label} triage failed: ${String(err)}`);
			}
		}
	}

	return {
		ran,
		detail: parts.length > 0 ? parts.join('; ') : 'nothing to do'
	};
}
