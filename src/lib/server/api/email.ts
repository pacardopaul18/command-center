import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import type { ApiEnv } from './env';
import { nowUtc } from '../dates';
import { ApiError } from './validate';
import { GoogleError } from '../google';
import { BATCH_SIZE, ingestStep, triageBatch } from '../mail-jobs';
import {
	assertOwned,
	assertThreadOwned,
	resolveAccount,
	resolveScope,
	scopePlaceholders
} from '../accounts';
import { draftReply } from '../ai';
import { stripHtml } from '../google';

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

/** How much body text is kept. Beyond this is quoted history and signatures. */

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

/** The account this request is about. Named, or the only one there is. */
async function connectionRow(db: D1Database, named?: string) {
	return resolveAccount(db, named);
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
	const conn = await connectionRow(c.env.DB, c.req.query('account'));
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
	requireConfig(c.env);
	const conn = await connectionRow(c.env.DB, c.req.query('account'));
	try {
		// The same function the cron calls. The budget is larger than the cron's
		// because this invocation is not shared with a digest, but it is not
		// unlimited: at twenty five messages a call the worker exceeded its CPU
		// limit outright (error 1102), because every message means a base64
		// decode, an R2 write and several D1 writes. Ten or so per call finishes
		// comfortably, and more calls cost nothing since the job is resumable.
		// Six messages a call. Sixty exceeded the CPU limit once the rich body was
		// being kept, because each message now decodes two MIME parts and writes
		// markup instead of stripped text. More calls cost nothing: the job
		// records its position after every one.
		const outcome = await ingestStep(c.env, conn.id, 36);
		return c.json({ ok: true, ...outcome });
	} catch (err) {
		throw asApiError(err);
	}
});

/** Stops a run without discarding it. Resumes from the same cursor. */
email.post('/ingest/pause', async (c) => {
	const conn = await connectionRow(c.env.DB, c.req.query('account'));
	await c.env.DB.prepare(
		"UPDATE email_ingest_state SET status = 'paused', updated_at = ? WHERE connection_id = ?"
	)
		.bind(nowUtc(), conn.id)
		.run();
	return c.json({ ok: true, status: 'paused' });
});

email.post('/ingest/resume', async (c) => {
	const conn = await connectionRow(c.env.DB, c.req.query('account'));
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
	const conn = await connectionRow(c.env.DB, c.req.query('account'));
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
	// One account, or every account on purpose. `all` has to be asked for by
	// name: the unified inbox is a feature, and a query that crossed accounts
	// without being told to is the defect D110 was.
	const scope = await resolveScope(c.env.DB, c.req.query('account'));
	const where: string[] = [`t.connection_id IN (${scopePlaceholders(scope)})`];
	const binds: unknown[] = [...scope.ids];

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
        conn.account_email AS account_email,
        t.connection_id AS account_id,
        (SELECT COUNT(*) FROM email_messages m WHERE m.thread_id = t.id) AS actual_count,
        (SELECT m.from_email FROM email_messages m WHERE m.thread_id = t.id
          ORDER BY m.sent_at DESC LIMIT 1) AS latest_from,
        (SELECT m.from_name FROM email_messages m WHERE m.thread_id = t.id
          ORDER BY m.sent_at DESC LIMIT 1) AS latest_from_name,
        (SELECT m.snippet FROM email_messages m WHERE m.thread_id = t.id
          ORDER BY m.sent_at DESC LIMIT 1) AS latest_snippet
     FROM email_threads t
     LEFT JOIN clients cl ON cl.id = t.client_id
     LEFT JOIN connections conn ON conn.id = t.connection_id
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
     WHERE t.connection_id IN (${scopePlaceholders(scope)})
       AND t.archived_at IS NULL
     GROUP BY ${effective}`
	)
		.bind(...scope.ids)
		.all<{ severity: string | null; n: number }>();

	return c.json({
		scope: scope.kind,
		accounts:
			scope.kind === 'all'
				? scope.accounts.map((a) => ({ id: a.id, account_email: a.account_email }))
				: [{ id: scope.account.id, account_email: scope.account.account_email }],
		threads: results ?? [],
		counts: Object.fromEntries(
			(counts.results ?? []).map((r) => [r.severity ?? 'untriaged', Number(r.n)])
		)
	});
});

email.get('/threads/:id', async (c) => {
	const account = await resolveAccount(c.env.DB, c.req.query('account'));
	await assertThreadOwned(c.env.DB, c.req.param('id'), account.id);

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

	const draft = await c.env.DB.prepare('SELECT * FROM email_drafts WHERE thread_id = ?')
		.bind(id)
		.first();

	const attachments = await c.env.DB.prepare(
		`SELECT a.*, m.id AS on_message FROM email_attachments a
     JOIN email_messages m ON m.id = a.message_id
     WHERE m.thread_id = ? ORDER BY a.filename`
	)
		.bind(id)
		.all();

	return c.json({
		thread,
		messages: rows,
		bodies,
		open_ids: openIds,
		draft,
		attachments: attachments.results ?? []
	});
});

/** One message body, streamed out of R2. Never re-fetched from Google. */
email.get('/messages/:id/body', async (c) => {
	const account = await resolveAccount(c.env.DB, c.req.query('account'));
	await assertOwned(c.env.DB, 'email_messages', c.req.param('id'), account.id);

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
/** Threads reported per batch in the status endpoint. */
const SUMMARY_BATCH = 5;

/** Bodies are truncated before they are sent. Quoted history is not context. */

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
	if (!c.env.ANTHROPIC_API_KEY) {
		throw new ApiError(
			503,
			'No AI key is configured. Set it with `wrangler secret put ANTHROPIC_API_KEY`.'
		);
	}
	const conn = await connectionRow(c.env.DB, c.req.query('account'));
	try {
		// Same reasoning as the ingest budget: bounded per invocation, resumed by
		// the next call.
		const outcome = await triageBatch(c.env, conn.id, 160);
		return c.json({ ok: true, ...outcome });
	} catch (err) {
		throw asApiError(err);
	}
});

/** How much of the mail has been summarised, without summarising anything. */
email.get('/summarise', async (c) => {
	const conn = await connectionRow(c.env.DB, c.req.query('account'));
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

	/**
	 * Measured spend, read from what the API reported rather than estimated.
	 *
	 * Prices are not stored here. A hardcoded rate goes stale silently and then
	 * the meter is confidently wrong about money, which is worse than a meter
	 * that reports tokens and lets Paul apply the current rate himself.
	 */
	const usage = await c.env.DB.prepare(
		`SELECT kind, model, COUNT(*) AS calls,
            SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
            MAX(at) AS last_at
     FROM ai_usage GROUP BY kind, model ORDER BY calls DESC`
	).all();

	const today = await c.env.DB.prepare(
		`SELECT COUNT(*) AS calls, SUM(input_tokens) AS input_tokens,
            SUM(output_tokens) AS output_tokens
     FROM ai_usage WHERE at >= ?`
	)
		.bind(new Date(Date.now() - 86_400_000).toISOString())
		.first<Record<string, number | null>>();

	return c.json({
		usage: usage.results ?? [],
		last_24h: {
			calls: Number(today?.calls ?? 0),
			input_tokens: Number(today?.input_tokens ?? 0),
			output_tokens: Number(today?.output_tokens ?? 0)
		},
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
	const account = await resolveAccount(c.env.DB, c.req.query('account'));
	await assertThreadOwned(c.env.DB, c.req.param('id'), account.id);

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
	const account = await resolveAccount(c.env.DB, c.req.query('account'));
	await assertThreadOwned(c.env.DB, c.req.param('id'), account.id);

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
	const account = await resolveAccount(c.env.DB, c.req.query('account'));
	await assertThreadOwned(c.env.DB, c.req.param('id'), account.id);

	const undo = c.req.query('undo') === 'true';
	const result = await c.env.DB.prepare(
		'UPDATE email_threads SET read_at = ?, updated_at = ? WHERE id = ?'
	)
		.bind(undo ? null : nowUtc(), nowUtc(), c.req.param('id'))
		.run();
	if (!result.meta.changes) throw new ApiError(404, 'Thread not found.');
	return c.json({ ok: true, read: !undo });
});

/* -------------------------------------------------------------------------
 * Drafting
 * ---------------------------------------------------------------------- */

/** How many of Paul's own messages are used as the voice sample. */
const VOICE_SAMPLES = 6;

/** Characters kept per voice sample. A greeting and a sign-off is the point. */
const VOICE_CHARS = 1500;

const DRAFT_THREAD_CHARS = 20_000;

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
	return (format === 'html' ? stripHtml(raw) : raw).slice(0, limit).trim();
}

/**
 * Things Paul actually sent, as the voice sample.
 *
 * Found by matching the sender against the connected account, which is the only
 * reliable marker of authorship in an ingested mailbox. Deliberately shown
 * rather than described: telling a model to write "professionally but warmly"
 * produces the average of everyone ever described that way, while six real
 * messages carry his greeting, his sign-off and how blunt he is willing to be,
 * none of which he could have specified accurately if asked.
 *
 * Short ones are skipped. "Thanks, will do" is a real message and teaches
 * nothing about how he writes at length.
 */
async function voiceSamples(
	db: D1Database,
	files: R2Bucket,
	account: string | null
): Promise<string[]> {
	if (!account) return [];

	const { results } = await db
		.prepare(
			`SELECT body_key, body_format FROM email_messages
       WHERE LOWER(from_email) = LOWER(?) AND body_key IS NOT NULL AND body_bytes > 400
       ORDER BY sent_at DESC LIMIT ?`
		)
		.bind(account, VOICE_SAMPLES)
		.all<{ body_key: string | null; body_format: string | null }>();

	const samples: string[] = [];
	for (const row of results ?? []) {
		const text = await bodyText(files, row.body_key, row.body_format, VOICE_CHARS);
		if (text.length > 120) samples.push(text);
	}
	return samples;
}

/** Client and project facts, when the thread is linked to one. */
async function clientContext(db: D1Database, clientId: string | null): Promise<string | null> {
	if (!clientId) return null;

	const client = await db
		.prepare('SELECT name, billing_terms, notes FROM clients WHERE id = ?')
		.bind(clientId)
		.first<{ name: string; billing_terms: string | null; notes: string | null }>();
	if (!client) return null;

	const projects = await db
		.prepare(
			`SELECT name, status, next_milestone FROM projects WHERE client_id = ?
       ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END LIMIT 5`
		)
		.bind(clientId)
		.all<{ name: string; status: string; next_milestone: string | null }>();

	const lines = [`Client: ${client.name}`];
	if (client.billing_terms) lines.push(`Billing terms: ${client.billing_terms}`);
	for (const p of projects.results ?? []) {
		lines.push(
			`Project: ${p.name} (${p.status})` + (p.next_milestone ? `, next: ${p.next_milestone}` : '')
		);
	}
	return lines.join('\n');
}

/**
 * Proposes a reply to one thread.
 *
 * Explicit per thread rather than generated for everything. A draft is Paul
 * putting words in his own mouth, and producing hundreds of them unasked would
 * make the app a thing to review rather than a thing that helps.
 */
email.post('/threads/:id/draft', async (c) => {
	const account = await resolveAccount(c.env.DB, c.req.query('account'));
	await assertThreadOwned(c.env.DB, c.req.param('id'), account.id);

	const apiKey = c.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		throw new ApiError(503, 'No AI key is configured.');
	}

	const id = c.req.param('id');
	const thread = await c.env.DB.prepare(
		`SELECT t.*, cl.name AS client_name FROM email_threads t
     LEFT JOIN clients cl ON cl.id = t.client_id WHERE t.id = ?`
	)
		.bind(id)
		.first<{
			id: string;
			subject: string | null;
			client_id: string | null;
			gist: string | null;
			last_at: string | null;
		}>();
	if (!thread) throw new ApiError(404, 'Thread not found.');

	const conn = await c.env.DB.prepare(
		"SELECT account_email FROM connections WHERE provider = 'google'"
	).first<{ account_email: string | null }>();

	const messages = await c.env.DB.prepare(
		`SELECT id, from_email, sent_at, body_key, body_format FROM email_messages
     WHERE thread_id = ? ORDER BY sent_at ASC LIMIT 12`
	)
		.bind(id)
		.all<{
			id: string;
			from_email: string | null;
			sent_at: string;
			body_key: string | null;
			body_format: string | null;
		}>();

	const rows = messages.results ?? [];
	const withBodies: { from: string | null; sent_at: string; body: string }[] = [];
	let budget = DRAFT_THREAD_CHARS;

	// Newest first while filling the budget, so a long thread keeps the part the
	// reply is actually answering.
	for (let i = rows.length - 1; i >= 0; i--) {
		const text = await bodyText(c.env.FILES, rows[i].body_key, rows[i].body_format, 6000);
		if (!text) continue;
		if (text.length > budget) break;
		budget -= text.length;
		withBodies.unshift({ from: rows[i].from_email, sent_at: rows[i].sent_at, body: text });
	}

	if (withBodies.length === 0) {
		throw new ApiError(400, 'This thread has no readable messages to reply to.');
	}

	const [voice, context] = await Promise.all([
		voiceSamples(c.env.DB, c.env.FILES, conn?.account_email ?? null),
		clientContext(c.env.DB, thread.client_id)
	]);

	let drafted;
	try {
		drafted = await draftReply(apiKey, {
			subject: thread.subject ?? '(no subject)',
			messages: withBodies,
			voice,
			gist: thread.gist,
			context
		});
	} catch (err) {
		throw asApiError(err);
	}

	const at = nowUtc();
	await c.env.DB.prepare(
		`INSERT INTO email_drafts
       (id, thread_id, body, based_on_message_id, based_on_last_at, model, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET
       body = excluded.body,
       based_on_message_id = excluded.based_on_message_id,
       based_on_last_at = excluded.based_on_last_at,
       model = excluded.model,
       edited_body = NULL,
       edited_at = NULL,
       copied_at = NULL,
       updated_at = excluded.updated_at`
	)
		.bind(
			crypto.randomUUID(),
			id,
			drafted.body,
			rows[rows.length - 1]?.id ?? null,
			thread.last_at,
			drafted.model,
			at,
			at
		)
		.run();

	const draft = await c.env.DB.prepare('SELECT * FROM email_drafts WHERE thread_id = ?')
		.bind(id)
		.first();

	return c.json({
		draft,
		voice_samples: voice.length,
		had_client_context: Boolean(context)
	});
});

/** Paul's edit, kept beside the model's version rather than over it. */
email.patch('/threads/:id/draft', async (c) => {
	const account = await resolveAccount(c.env.DB, c.req.query('account'));
	await assertThreadOwned(c.env.DB, c.req.param('id'), account.id);

	const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
	const edited = typeof body.body === 'string' ? body.body : null;
	if (edited === null) throw new ApiError(400, 'A draft body is required.');

	const result = await c.env.DB.prepare(
		'UPDATE email_drafts SET edited_body = ?, edited_at = ?, updated_at = ? WHERE thread_id = ?'
	)
		.bind(edited, nowUtc(), nowUtc(), c.req.param('id'))
		.run();
	if (!result.meta.changes) throw new ApiError(404, 'No draft on that thread.');
	return c.json({ ok: true });
});

/**
 * Records that Paul copied the draft out.
 *
 * Deliberately not called sent. This app has no way to know whether a message
 * was ever sent, and a field named for sending would eventually be read as if
 * it did know.
 */
email.post('/threads/:id/draft/copied', async (c) => {
	const account = await resolveAccount(c.env.DB, c.req.query('account'));
	await assertThreadOwned(c.env.DB, c.req.param('id'), account.id);

	const result = await c.env.DB.prepare(
		'UPDATE email_drafts SET copied_at = ?, updated_at = ? WHERE thread_id = ?'
	)
		.bind(nowUtc(), nowUtc(), c.req.param('id'))
		.run();
	if (!result.meta.changes) throw new ApiError(404, 'No draft on that thread.');
	return c.json({ ok: true });
});

email.delete('/threads/:id/draft', async (c) => {
	const account = await resolveAccount(c.env.DB, c.req.query('account'));
	await assertThreadOwned(c.env.DB, c.req.param('id'), account.id);

	const result = await c.env.DB.prepare('DELETE FROM email_drafts WHERE thread_id = ?')
		.bind(c.req.param('id'))
		.run();
	if (!result.meta.changes) throw new ApiError(404, 'No draft on that thread.');
	return c.json({ ok: true });
});
