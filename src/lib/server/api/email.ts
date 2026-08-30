import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { nowUtc } from '../dates';
import { ApiError } from './validate';
import { GoogleError, accessToken, getMessage, listMessageIds, stripHtml } from '../google';
import { AiError, summariseThread, triageThread } from '../ai';

/**
 * Gmail ingestion, browsing, and the state of the ingestion itself.
 *
 * Read only, structurally: no send scope exists, so nothing here could write to
 * Gmail even if it tried (D70, guarded by the scope tests in D82).
 *
 * THE SHAPE OF THE PROBLEM. Listing a month of mail is one cheap call. Reading
 * it is one call per message, hundreds of them, and a Worker request will not
 * live long enough to do that. So ingestion is a series of small batches that
 * each record where they got to. Nothing depends on a single request surviving,
 * a batch that fails loses only that batch, and the run resumes from the
 * recorded cursor rather than starting over.
 *
 * Progress is a stored record, not a variable in a request. Paul has to be able
 * to see how far it has got, and a number that only exists inside a request
 * that has already ended cannot be shown to anybody.
 */

export const email = new Hono<ApiEnv>();

/**
 * Messages read per batch.
 *
 * Each one is a separate Gmail call. Small enough to finish well inside a
 * request, large enough that a month of mail is a handful of batches rather
 * than a hundred.
 */
const BATCH_SIZE = 25;

/** How much body text is kept. Beyond this is quoted history and signatures. */
const MAX_BODY_BYTES = 100_000;

function requireConfig(env: { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string }) {
	if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
		throw new ApiError(503, 'Google is not configured on this Worker.');
	}
	return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}

function asApiError(err: unknown): unknown {
	if (err instanceof GoogleError) {
		return new ApiError(err.status, err.detail ? `${err.message} Google said: ${err.detail}` : err.message);
	}
	return err;
}

async function connectionRow(db: D1Database) {
	const row = await db
		.prepare("SELECT id, account_email, status FROM connections WHERE provider = 'google'")
		.first<{ id: string; account_email: string | null; status: string }>();
	if (!row) throw new ApiError(400, 'No Google account is connected.');
	return row;
}

async function readState(db: D1Database, connectionId: string) {
	return db
		.prepare('SELECT * FROM email_ingest_state WHERE connection_id = ?')
		.bind(connectionId)
		.first<{
			connection_id: string;
			status: string;
			window_days: number;
			page_token: string | null;
			total_estimate: number | null;
			discovered: number;
			fetched: number;
			started_at: string | null;
			updated_at: string | null;
			finished_at: string | null;
			last_error: string | null;
		}>();
}

/**
 * Links a message to a client by matching the sender against known contacts.
 *
 * An exact address match only. Matching on the domain would be wrong often
 * enough to be worse than nothing: two clients can both use gmail.com, and mail
 * from a stranger at a shared domain would be filed under somebody else's name.
 * A wrong attribution is more expensive than a blank one, because a blank one
 * is visibly missing and a wrong one is not.
 */
async function matchSender(db: D1Database, fromEmail: string | null) {
	if (!fromEmail) return { client_id: null, contact_id: null };
	const hit = await db
		.prepare('SELECT id, client_id FROM contacts WHERE LOWER(email) = ? LIMIT 1')
		.bind(fromEmail.toLowerCase())
		.first<{ id: string; client_id: string }>();
	return hit ? { client_id: hit.client_id, contact_id: hit.id } : { client_id: null, contact_id: null };
}

/** Where a body lives in R2. Keyed by provider id so a re-read overwrites. */
function bodyKey(connectionId: string, messageId: string): string {
	return `email/${connectionId}/${messageId}.txt`;
}

/* -------------------------------------------------------------------------
 * Ingestion
 * ---------------------------------------------------------------------- */

/**
 * Starts, or restarts, a run.
 *
 * Deliberately does not fetch anything. It records the intent and clears the
 * cursor, and the batches do the work. Separating "begin a run" from "do some
 * of it" is what lets the readout show a run that has started and read nothing
 * yet, which is a real state and the one a person is most likely to be looking
 * at.
 */
email.post('/ingest/start', async (c) => {
	const conn = await connectionRow(c.env.DB);
	const days = Math.min(Math.max(Number(c.req.query('days') ?? 30), 1), 365);
	const now = nowUtc();

	await c.env.DB.prepare(
		`INSERT INTO email_ingest_state
       (connection_id, status, window_days, page_token, total_estimate, discovered, fetched,
        started_at, updated_at, finished_at, last_error)
     VALUES (?, 'running', ?, NULL, NULL, 0, 0, ?, ?, NULL, NULL)
     ON CONFLICT(connection_id) DO UPDATE SET
       status = 'running', window_days = excluded.window_days, page_token = NULL,
       total_estimate = NULL, discovered = 0, fetched = 0,
       started_at = excluded.started_at, updated_at = excluded.updated_at,
       finished_at = NULL, last_error = NULL`
	)
		.bind(conn.id, days, now, now)
		.run();

	return c.json({ ok: true, status: 'running', window_days: days });
});

/**
 * Reads one batch and records where it got to.
 *
 * Called repeatedly until `done`. Every batch writes its own progress before
 * returning, so a run interrupted at any point resumes from the last completed
 * batch rather than from the beginning.
 */
email.post('/ingest/step', async (c) => {
	const { clientId, clientSecret } = requireConfig(c.env);
	const conn = await connectionRow(c.env.DB);
	const state = await readState(c.env.DB, conn.id);

	if (!state) throw new ApiError(400, 'No ingest has been started.');
	if (state.status === 'done') return c.json({ ok: true, status: 'done', ...counters(state) });
	if (state.status === 'paused') return c.json({ ok: true, status: 'paused', ...counters(state) });

	const at = nowUtc();

	try {
		const tokens = await accessToken(c.env.SESSIONS, clientId, clientSecret);
		const query = `newer_than:${state.window_days}d`;

		const page = await listMessageIds(tokens.access_token, query, state.page_token, BATCH_SIZE);

		let fetched = 0;
		for (const ref of page.messages) {
			// Already have it, and have it properly: a resumed run should not pay
			// for the same message twice.
			//
			// `body_format IS NULL` means the row predates keeping the rich body,
			// so its stored body is the stripped text that read as garbage. Those
			// are re-read rather than skipped, which is what lets one more pass
			// upgrade everything already held instead of stranding it.
			const existing = await c.env.DB.prepare(
				`SELECT id, body_format FROM email_messages
         WHERE connection_id = ? AND provider_message_id = ?`
			)
				.bind(conn.id, ref.id)
				.first<{ id: string; body_format: string | null }>();
			if (existing && existing.body_format) continue;

			const message = await getMessage(tokens.access_token, ref.id, true);
			await storeMessage(c.env.DB, c.env.FILES, conn.id, message, at);
			fetched += 1;
		}

		const discovered = state.discovered + page.messages.length;

		// The first page's estimate is kept and later ones are ignored. Gmail's
		// `resultSizeEstimate` is per page, not per query: a real run reported 201
		// on page one and 11 on the last, and overwriting each time would have made
		// the readout say "186 of 11", which reads as broken rather than as an
		// estimate being an estimate. First page is the closest thing to a total.
		const total = state.total_estimate ?? page.resultSizeEstimate;
		const finished = !page.nextPageToken;

		await c.env.DB.prepare(
			`UPDATE email_ingest_state
       SET status = ?, page_token = ?, total_estimate = ?, discovered = ?, fetched = ?,
           updated_at = ?, finished_at = ?
       WHERE connection_id = ?`
		)
			.bind(
				finished ? 'done' : 'running',
				page.nextPageToken,
				total,
				discovered,
				state.fetched + fetched,
				at,
				finished ? at : null,
				conn.id
			)
			.run();

		return c.json({
			ok: true,
			status: finished ? 'done' : 'running',
			batch_fetched: fetched,
			batch_seen: page.messages.length,
			discovered,
			fetched: state.fetched + fetched,
			total_estimate: total
		});
	} catch (err) {
		// A failed batch is recorded rather than swallowed, and the cursor is left
		// where it was so the next attempt covers the same page again. Losing a
		// page silently is worse than reading one twice: the second is free.
		const message = err instanceof GoogleError ? err.message : 'The batch failed.';
		await c.env.DB.prepare(
			`UPDATE email_ingest_state SET status = 'failed', last_error = ?, updated_at = ?
       WHERE connection_id = ?`
		)
			.bind(message, at, conn.id)
			.run();
		throw asApiError(err);
	}
});

function counters(state: { discovered: number; fetched: number; total_estimate: number | null }) {
	return {
		discovered: state.discovered,
		fetched: state.fetched,
		total_estimate: state.total_estimate
	};
}

/**
 * Writes one message: metadata to D1, body to R2.
 *
 * The two writes are ordered so a failure cannot leave a row claiming a body
 * that is not there. R2 first, then the row that references it.
 */
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
			crypto.randomUUID(),
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
}

/** The thread row, created on first sight and kept current after that. */
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

/** Stops a run without discarding it. Resumes from the same cursor. */
email.post('/ingest/pause', async (c) => {
	const conn = await connectionRow(c.env.DB);
	await c.env.DB.prepare(
		"UPDATE email_ingest_state SET status = 'paused', updated_at = ? WHERE connection_id = ?"
	)
		.bind(nowUtc(), conn.id)
		.run();
	return c.json({ ok: true, status: 'paused' });
});

email.post('/ingest/resume', async (c) => {
	const conn = await connectionRow(c.env.DB);
	await c.env.DB.prepare(
		`UPDATE email_ingest_state SET status = 'running', last_error = NULL, updated_at = ?
     WHERE connection_id = ?`
	)
		.bind(nowUtc(), conn.id)
		.run();
	return c.json({ ok: true, status: 'running' });
});

/**
 * What the ingestion has done so far.
 *
 * Read without touching Google, so a screen showing progress does not cause
 * work by being looked at.
 */
email.get('/ingest', async (c) => {
	const conn = await connectionRow(c.env.DB);
	const state = await readState(c.env.DB, conn.id);

	const stored = await c.env.DB.prepare(
		`SELECT COUNT(*) AS messages,
            SUM(CASE WHEN body_key IS NOT NULL THEN 1 ELSE 0 END) AS with_body,
            MIN(sent_at) AS oldest, MAX(sent_at) AS newest
     FROM email_messages WHERE connection_id = ?`
	)
		.bind(conn.id)
		.first<{ messages: number; with_body: number | null; oldest: string | null; newest: string | null }>();

	const threads = await c.env.DB.prepare(
		'SELECT COUNT(*) AS n FROM email_threads WHERE connection_id = ?'
	)
		.bind(conn.id)
		.first<{ n: number }>();

	return c.json({
		account: conn.account_email,
		state: state ?? null,
		batch_size: BATCH_SIZE,
		stored: {
			messages: Number(stored?.messages ?? 0),
			with_body: Number(stored?.with_body ?? 0),
			threads: Number(threads?.n ?? 0),
			oldest: stored?.oldest ?? null,
			newest: stored?.newest ?? null
		}
	});
});

/* -------------------------------------------------------------------------
 * Browsing
 * ---------------------------------------------------------------------- */

email.get('/threads', async (c) => {
	const where: string[] = [
		"t.connection_id = (SELECT id FROM connections WHERE provider = 'google')"
	];
	const binds: unknown[] = [];

	const clientId = c.req.query('client_id');
	if (clientId) {
		where.push('t.client_id = ?');
		binds.push(clientId);
	}
	if (c.req.query('unlinked') === 'true') where.push('t.client_id IS NULL');

	/**
	 * Severity, with Paul's correction winning.
	 *
	 * Filtering has to use the same expression the list displays, or a thread
	 * shows one label and is filtered by another. That is why the effective
	 * value is written once here and reused.
	 */
	const effective = 'COALESCE(t.severity_override, t.severity)';
	const effectiveCategory = 'COALESCE(t.category_override, t.category)';

	const severity = c.req.query('severity');
	if (severity && severity !== 'all') {
		const wanted = severity.split(',').filter(Boolean);
		if (wanted.length) {
			where.push(`${effective} IN (${wanted.map(() => '?').join(',')})`);
			binds.push(...wanted);
		}
	}

	const category = c.req.query('category');
	if (category && category !== 'all') {
		where.push(`${effectiveCategory} = ?`);
		binds.push(category);
	}

	// Archived is hidden unless asked for, the way every mail client behaves.
	if (c.req.query('archived') === 'true') where.push('t.archived_at IS NOT NULL');
	else where.push('t.archived_at IS NULL');

	if (c.req.query('untriaged') === 'true') where.push('t.severity IS NULL');

	const q = c.req.query('q')?.trim();
	if (q) {
		where.push(
			`(t.subject LIKE ? OR t.gist LIKE ? OR EXISTS (SELECT 1 FROM email_messages m
        WHERE m.thread_id = t.id AND (m.from_email LIKE ? OR m.snippet LIKE ?)))`
		);
		const like = `%${q}%`;
		binds.push(like, like, like, like);
	}

	const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 200);

	const { results } = await c.env.DB.prepare(
		`SELECT t.id, t.subject, t.message_count, t.first_at, t.last_at,
        t.client_id, t.gist, t.summary, t.summary_at,
        t.severity, t.category, t.severity_override, t.category_override,
        t.corrected_at, t.archived_at, t.read_at,
        ${effective} AS effective_severity,
        ${effectiveCategory} AS effective_category,
        cl.name AS client_name,
        (SELECT COUNT(*) FROM email_messages m WHERE m.thread_id = t.id) AS actual_count,
        (SELECT m.from_email FROM email_messages m WHERE m.thread_id = t.id
          ORDER BY m.sent_at DESC LIMIT 1) AS latest_from,
        (SELECT m.from_name FROM email_messages m WHERE m.thread_id = t.id
          ORDER BY m.sent_at DESC LIMIT 1) AS latest_from_name,
        (SELECT m.snippet FROM email_messages m WHERE m.thread_id = t.id
          ORDER BY m.sent_at DESC LIMIT 1) AS latest_snippet
     FROM email_threads t
     LEFT JOIN clients cl ON cl.id = t.client_id
     WHERE ${where.join(' AND ')}
     ORDER BY
       CASE ${effective}
         WHEN 'urgent' THEN 0 WHEN 'important' THEN 1
         WHEN 'routine' THEN 2 WHEN 'noise' THEN 3 ELSE 1 END,
       t.last_at DESC
     LIMIT ?`
	)
		.bind(...binds, limit)
		.all();

	// Counts for the filter bar, over the same set minus the severity filter, so
	// the numbers beside each chip say how many that chip would show.
	const counts = await c.env.DB.prepare(
		`SELECT ${effective} AS severity, COUNT(*) AS n
     FROM email_threads t
     WHERE t.connection_id = (SELECT id FROM connections WHERE provider = 'google')
       AND t.archived_at IS NULL
     GROUP BY ${effective}`
	).all<{ severity: string | null; n: number }>();

	return c.json({
		threads: results ?? [],
		counts: Object.fromEntries(
			(counts.results ?? []).map((r) => [r.severity ?? 'untriaged', Number(r.n)])
		)
	});
});

email.get('/threads/:id', async (c) => {
	const id = c.req.param('id');
	const thread = await c.env.DB.prepare(
		`SELECT t.*, cl.name AS client_name FROM email_threads t
     LEFT JOIN clients cl ON cl.id = t.client_id WHERE t.id = ?`
	)
		.bind(id)
		.first();
	if (!thread) throw new ApiError(404, 'Thread not found.');

	const messages = await c.env.DB.prepare(
		'SELECT * FROM email_messages WHERE thread_id = ? ORDER BY sent_at ASC'
	)
		.bind(id)
		.all<{ id: string; body_key: string | null; body_format: string | null }>();

	const rows = messages.results ?? [];

	/**
	 * Bodies for the messages that will be open on arrival.
	 *
	 * Gmail's behaviour, and the reason Paul called the old page inefficient: a
	 * single message thread is fully open, and a longer one opens its latest.
	 * Making him click to see anything at all was work the page could have done.
	 *
	 * Only those bodies are sent. Loading every message of a long thread would
	 * push a lot of text nobody asked for, so the rest load on demand.
	 */
	const openIds = rows.length === 1 ? [rows[0].id] : rows.slice(-1).map((r) => r.id);
	const bodies: Record<string, { body: string; format: string | null }> = {};

	for (const row of rows) {
		if (!openIds.includes(row.id) || !row.body_key) continue;
		const object = await c.env.FILES.get(row.body_key);
		if (object) bodies[row.id] = { body: await object.text(), format: row.body_format };
	}

	return c.json({ thread, messages: rows, bodies, open_ids: openIds });
});

/** One message body, streamed out of R2. Never re-fetched from Google. */
email.get('/messages/:id/body', async (c) => {
	const row = await c.env.DB.prepare(
		'SELECT body_key, body_format FROM email_messages WHERE id = ?'
	)
		.bind(c.req.param('id'))
		.first<{ body_key: string | null; body_format: string | null }>();

	if (!row) throw new ApiError(404, 'Message not found.');
	if (!row.body_key) {
		return c.json({ body: null, format: null, reason: 'No body was stored for this message.' });
	}

	const object = await c.env.FILES.get(row.body_key);
	if (!object) {
		// The row says there is a body and R2 does not have it. Saying so is more
		// useful than an empty string that looks like an empty email.
		throw new ApiError(404, 'The stored body is missing from storage.');
	}
	return c.json({ body: await object.text(), format: row.body_format });
});

/* -------------------------------------------------------------------------
 * The AI pass
 * ---------------------------------------------------------------------- */

/** Threads summarised per call. Each is a separate model request. */
const SUMMARY_BATCH = 5;

/** Bodies are truncated before they are sent. Quoted history is not context. */
const MAX_CHARS_PER_MESSAGE = 8000;
const MAX_MESSAGES_PER_THREAD = 12;

/**
 * Summarises threads that do not have a current summary.
 *
 * Batched for the same reason ingestion is: a request will not live long enough
 * to summarise hundreds of threads, and a batch that fails should cost one
 * batch rather than the run.
 *
 * A thread is re-summarised when it has grown since its summary was written.
 * `summary_at` against `last_at` is what makes that visible, and it is why the
 * timestamp is stored rather than just the text: a summary with no date cannot
 * be known to be stale.
 */
email.post('/summarise', async (c) => {
	const apiKey = c.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		throw new ApiError(
			503,
			'No AI key is configured. Set it with `wrangler secret put ANTHROPIC_API_KEY`.'
		);
	}

	const conn = await connectionRow(c.env.DB);
	const limit = Math.min(Math.max(Number(c.req.query('limit') ?? SUMMARY_BATCH), 1), 20);

	const { results } = await c.env.DB.prepare(
		`SELECT id, subject, last_at FROM email_threads
     WHERE connection_id = ?
       AND (summary IS NULL OR summary_at IS NULL OR summary_at < last_at
            OR severity IS NULL)
     ORDER BY last_at DESC
     LIMIT ?`
	)
		.bind(conn.id, limit)
		.all<{ id: string; subject: string | null; last_at: string | null }>();

	const threads = results ?? [];
	const done: string[] = [];
	const skipped: string[] = [];

	for (const thread of threads) {
		const messages = await c.env.DB.prepare(
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
			const object = await c.env.FILES.get(m.body_key);
			if (!object) continue;
			const raw = await object.text();
			// The model is given text, never markup. Feeding it HTML spends the
			// context window on tags and tracking URLs instead of on what the
			// message says.
			const text = (m.body_format === 'html' ? stripHtml(raw) : raw).slice(
				0,
				MAX_CHARS_PER_MESSAGE
			);
			if (text.trim()) {
				withBodies.push({ from: m.from_email, sent_at: m.sent_at, body: text });
			}
		}

		// Nothing to read is not a failure and not a thread to invent a summary
		// for. Summarising a subject line alone would produce a confident sentence
		// with no evidence under it.
		if (withBodies.length === 0) {
			skipped.push(thread.id);
			continue;
        }

		try {
			const subject = thread.subject ?? '(no subject)';

			// Both questions against the same bodies, which are already loaded.
			// Running them in parallel halves the wait for a batch.
			const [summarised, triaged] = await Promise.all([
				summariseThread(apiKey, subject, withBodies),
				triageThread(apiKey, subject, withBodies)
			]);

			const at = nowUtc();
			await c.env.DB.prepare(
				`UPDATE email_threads
         SET summary = ?, summary_model = ?, summary_at = ?,
             category = ?, severity = ?, gist = ?,
             classified_at = ?, classified_model = ?, updated_at = ?
         WHERE id = ?`
			)
				.bind(
					summarised.summary,
					summarised.model,
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
			done.push(thread.id);
		} catch (err) {
			// One thread failing must not lose the batch. The rest still get
			// summarised and the failure is reported rather than swallowed.
			if (err instanceof AiError && err.status === 429) {
				return c.json(
					{ ok: false, summarised: done.length, skipped: skipped.length, error: err.message },
					429
				);
			}
			throw err;
		}
	}

	const remaining = await c.env.DB.prepare(
		`SELECT COUNT(*) AS n FROM email_threads
     WHERE connection_id = ?
       AND (summary IS NULL OR summary_at IS NULL OR summary_at < last_at
            OR severity IS NULL)`
	)
		.bind(conn.id)
		.first<{ n: number }>();

	return c.json({
		ok: true,
		summarised: done.length,
		skipped: skipped.length,
		remaining: Number(remaining?.n ?? 0)
	});
});

/** How much of the mail has been summarised, without summarising anything. */
email.get('/summarise', async (c) => {
	const conn = await connectionRow(c.env.DB);
	const counts = await c.env.DB.prepare(
		`SELECT COUNT(*) AS threads,
            SUM(CASE WHEN summary IS NOT NULL THEN 1 ELSE 0 END) AS summarised,
            SUM(CASE WHEN severity IS NOT NULL THEN 1 ELSE 0 END) AS triaged,
            SUM(CASE WHEN summary IS NOT NULL AND summary_at < last_at THEN 1 ELSE 0 END) AS stale,
            SUM(CASE WHEN corrected_at IS NOT NULL THEN 1 ELSE 0 END) AS corrected
     FROM email_threads WHERE connection_id = ?`
	)
		.bind(conn.id)
		.first<Record<string, number | null>>();

	// What the model said against what Paul said it should have been. This pair
	// is the whole training signal, which is why the override is stored beside
	// the answer rather than on top of it.
	const disagreements = await c.env.DB.prepare(
		`SELECT severity AS model_said, severity_override AS paul_said, COUNT(*) AS n
     FROM email_threads
     WHERE connection_id = ? AND severity_override IS NOT NULL AND severity_override != severity
     GROUP BY severity, severity_override
     ORDER BY n DESC`
	)
		.bind(conn.id)
		.all();

	return c.json({
		threads: Number(counts?.threads ?? 0),
		summarised: Number(counts?.summarised ?? 0),
		triaged: Number(counts?.triaged ?? 0),
		stale: Number(counts?.stale ?? 0),
		corrected: Number(counts?.corrected ?? 0),
		disagreements: disagreements.results ?? [],
		batch_size: SUMMARY_BATCH
	});
});

/* -------------------------------------------------------------------------
 * Corrections and triage state
 * ---------------------------------------------------------------------- */

const SEVERITIES = ['urgent', 'important', 'routine', 'noise'];
const CATEGORIES = ['correspondence', 'automated', 'newsletter', 'notification'];

/**
 * Paul disagreeing with the model.
 *
 * Written to the override columns, never over the model's own answer. The pair
 * is the signal: what it said next to what it should have said is the only
 * thing that can teach it anything, and overwriting destroys exactly the half
 * that carries the lesson. It also means a correction survives the thread being
 * re-classified later.
 */
email.post('/threads/:id/correct', async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
	const severity = body.severity === null || body.severity === undefined
		? null
		: String(body.severity);
	const category = body.category === null || body.category === undefined
		? null
		: String(body.category);

	if (severity !== null && !SEVERITIES.includes(severity)) {
		throw new ApiError(400, `Severity must be one of: ${SEVERITIES.join(', ')}.`);
	}
	if (category !== null && !CATEGORIES.includes(category)) {
		throw new ApiError(400, `Category must be one of: ${CATEGORIES.join(', ')}.`);
	}

	const result = await c.env.DB.prepare(
		`UPDATE email_threads
     SET severity_override = ?, category_override = ?, corrected_at = ?, updated_at = ?
     WHERE id = ?`
	)
		.bind(severity, category, nowUtc(), nowUtc(), c.req.param('id'))
		.run();

	if (!result.meta.changes) throw new ApiError(404, 'Thread not found.');
	return c.json({ ok: true });
});

/**
 * Archive and read state, which live here and are never pushed to Gmail.
 *
 * Archiving in Gmail needs `gmail.modify`, a write scope this app deliberately
 * never requested. So this archives the copy, not the mailbox. That is a real
 * limitation and it is the price of the guarantee: nothing this app does can
 * alter Paul's actual mail.
 */
email.post('/threads/:id/archive', async (c) => {
	const undo = c.req.query('undo') === 'true';
	const result = await c.env.DB.prepare(
		'UPDATE email_threads SET archived_at = ?, updated_at = ? WHERE id = ?'
	)
		.bind(undo ? null : nowUtc(), nowUtc(), c.req.param('id'))
		.run();
	if (!result.meta.changes) throw new ApiError(404, 'Thread not found.');
	return c.json({ ok: true, archived: !undo });
});

email.post('/threads/:id/read', async (c) => {
	const undo = c.req.query('undo') === 'true';
	const result = await c.env.DB.prepare(
		'UPDATE email_threads SET read_at = ?, updated_at = ? WHERE id = ?'
	)
		.bind(undo ? null : nowUtc(), nowUtc(), c.req.param('id'))
		.run();
	if (!result.meta.changes) throw new ApiError(404, 'Thread not found.');
	return c.json({ ok: true, read: !undo });
});
