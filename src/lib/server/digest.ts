import { daysAgoUtc, todayInWorkingZone, workingDayStartUtc, WORKING_TIME_ZONE } from './dates';

/**
 * Start-of-day and end-of-day digests.
 *
 * The scheduled handler in the built worker calls runDigest. Everything here is
 * pure enough to be exercised over HTTP as well, which is how it gets tested
 * without waiting for a cron to fire.
 *
 * UTC and DST conversion is not re-derived here. workingDayStartUtc in
 * ./dates.ts is the reference implementation, with its boundary cases recorded
 * in docs/DECISIONS.md.
 */

export type DigestKind = 'morning' | 'evening';

/** The Mountain Time hours the digests are meant to land at. */
export const DIGEST_HOURS: Record<DigestKind, number> = {
	morning: 7,
	evening: 17
};

export type DigestEnv = App.Platform['env'];

/**
 * Which digest, if any, is due at this instant.
 *
 * Cron Triggers are UTC only, so the schedule fires at every UTC hour that could
 * be 07:00 or 17:00 Mountain in either half of the year. This function is what
 * decides whether the firing is the real one: it reads the Mountain hour and
 * matches it against the target. On the wrong side of a DST changeover the
 * handler simply does nothing.
 */
export function digestDueAt(now: Date = new Date()): DigestKind | null {
	const hour = Number(
		new Intl.DateTimeFormat('en-GB', {
			timeZone: WORKING_TIME_ZONE,
			hour: '2-digit',
			hour12: false
		}).format(now)
	);

	for (const [kind, target] of Object.entries(DIGEST_HOURS) as [DigestKind, number][]) {
		if (hour === target) return kind;
	}
	return null;
}

export interface DigestContent {
	subject: string;
	text: string;
	/** The same content as `text`, marked up. Derived from the same array. */
	html: string;
	empty: boolean;
}

interface Row {
	[key: string]: unknown;
}

function line(prefix: string, rows: Row[], render: (r: Row) => string): string[] {
	if (rows.length === 0) return [];
	return [prefix, ...rows.map((r) => `  - ${render(r)}`), ''];
}

/** Every dynamic value in the digest passes through this before reaching HTML. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Renders the digest lines as HTML.
 *
 * The digest is sent as text and HTML together. The text part was always
 * correct: it carries real blank lines between sections. What it does not
 * survive is a reader that strips newlines without putting anything in their
 * place, which is how "start of day, 2026-08-28" and "Nothing needs attention"
 * ended up welded together in the one message that has been sent so far. A text
 * body whose meaning depends entirely on whitespace is fragile in exactly the
 * surfaces the digest is read in first.
 *
 * This takes the same `parts` array the text is joined from, so the two cannot
 * disagree about content. Same reasoning as ReportBody being shared between the
 * screen and the print route: one source, two renderings, no drift.
 *
 * Titles and client names reach here from the database, some of them written by
 * a model, so every one is escaped. A digest is not a place to discover that a
 * task title contained a tag.
 */
function toHtml(parts: string[]): string {
	const out: string[] = [];
	let list: string[] = [];

	const flush = () => {
		if (list.length === 0) return;
		out.push(`<ul>${list.map((i) => `<li>${i}</li>`).join('')}</ul>`);
		list = [];
	};

	for (const part of parts) {
		if (part === '') {
			flush();
			continue;
		}
		if (part.startsWith('  - ')) {
			list.push(escapeHtml(part.slice(4)));
			continue;
		}
		flush();
		out.push(`<p>${escapeHtml(part)}</p>`);
	}
	flush();

	return out.join('\n');
}

/** Builds the digest body. Plain text, no em dashes, no hype. */
export async function buildDigest(
	env: DigestEnv,
	kind: DigestKind,
	day: string
): Promise<DigestContent> {
	const db = env.DB;
	const stale = daysAgoUtc(5);
	const dayStart = workingDayStartUtc(day);

	const overdue = await db
		.prepare(
			`SELECT a.title, a.deadline, a.owner, p.name AS project_name
       FROM action_items a LEFT JOIN projects p ON p.id = a.project_id
       WHERE a.status != 'done' AND a.deadline IS NOT NULL AND a.deadline < ?
       ORDER BY a.deadline ASC`
		)
		.bind(day)
		.all();

	const dueToday = await db
		.prepare(
			`SELECT a.title, a.owner, p.name AS project_name
       FROM action_items a LEFT JOIN projects p ON p.id = a.project_id
       WHERE a.status != 'done' AND a.deadline = ?`
		)
		.bind(day)
		.all();

	const flagged = await db
		.prepare(
			`SELECT title, status FROM action_items
       WHERE status IN ('ambiguous', 'blocked')
       ORDER BY status, created_at`
		)
		.all();

	const stalled = await db
		.prepare(
			`SELECT title, updated_at FROM action_items
       WHERE status = 'waiting' AND updated_at < ?
       ORDER BY updated_at ASC`
		)
		.bind(stale)
		.all();

	/**
	 * Invoices past due.
	 *
	 * Two things changed with migration 0024. Estimates and credit notes now
	 * exist and are not receivables, and a voided invoice counts toward nothing,
	 * so both are filtered out here rather than being chased in an email.
	 *
	 * And clients can be flagged for chasing on the invoicing screen. That flag
	 * is what it says it is: it sorts those clients to the top of this list and
	 * marks them, because a prompt to Paul is the only kind of reminder this app
	 * can send. It cannot mail the client, asserted in
	 * tests/layer2-no-send-surface.test.ts.
	 */
	const aging = await db
		.prepare(
			`SELECT i.invoice_number, cl.name AS client_name,
              (i.amount_cents - i.amount_paid_cents) AS outstanding_cents,
              CAST(julianday(?1) - julianday(i.due_date) AS INTEGER) AS days_overdue,
              cl.digest_reminders AS flagged
       FROM invoices i JOIN clients cl ON cl.id = i.client_id
       WHERE i.amount_paid_cents < i.amount_cents AND julianday(?1) > julianday(i.due_date)
         AND i.kind = 'invoice' AND i.voided_at IS NULL
       ORDER BY cl.digest_reminders DESC, days_overdue DESC`
		)
		.bind(day)
		.all();

	const overdueRows = (overdue.results ?? []) as Row[];
	const todayRows = (dueToday.results ?? []) as Row[];
	const flaggedRows = (flagged.results ?? []) as Row[];
	const stalledRows = (stalled.results ?? []) as Row[];
	const agingRows = (aging.results ?? []) as Row[];

	const money = (cents: number) =>
		`${Math.floor(cents / 100).toLocaleString('en-US')}.${String(cents % 100).padStart(2, '0')}`;

	const parts: string[] = [];

	if (kind === 'morning') {
		parts.push(`Command Center, start of day, ${day}`, '');
		parts.push(
			...line('Overdue', overdueRows, (r) =>
				`${r.title} (due ${r.deadline}${r.project_name ? `, ${r.project_name}` : ''})`
			)
		);
		parts.push(
			...line('Due today', todayRows, (r) =>
				`${r.title}${r.project_name ? ` (${r.project_name})` : ''}`
			)
		);
	} else {
		const closed = await db
			.prepare(
				`SELECT title FROM action_items
         WHERE status = 'done' AND completed_at >= ?`
			)
			.bind(dayStart)
			.all();
		const closedRows = (closed.results ?? []) as Row[];

		parts.push(`Command Center, end of day, ${day}`, '');
		parts.push(...line('Finished today', closedRows, (r) => String(r.title)));
		parts.push(
			...line('Still open and overdue', overdueRows, (r) => `${r.title} (due ${r.deadline})`)
		);
		parts.push(...line('Still open and due today', todayRows, (r) => String(r.title)));
	}

	parts.push(
		...line('Needs clarification or blocked', flaggedRows, (r) => `${r.title} (${r.status})`)
	);
	parts.push(
		...line('Stalled follow-ups, no movement in 5 days', stalledRows, (r) => String(r.title))
	);
	parts.push(
		...line(
			'Invoices past due',
			agingRows,
			(r) =>
				`${r.invoice_number}, ${r.client_name}, ${money(Number(r.outstanding_cents))} outstanding, ` +
				`${r.days_overdue} days past${Number(r.flagged) === 1 ? ', flagged for chasing' : ''}`
		)
	);

	const empty =
		overdueRows.length === 0 &&
		todayRows.length === 0 &&
		flaggedRows.length === 0 &&
		stalledRows.length === 0 &&
		agingRows.length === 0;

	if (empty) {
		parts.push('Nothing needs attention. No overdue items, nothing due today, no invoices past due.', '');
	}

	parts.push('Open the cockpit at https://work.kabuhayan.app');

	const headline =
		overdueRows.length > 0
			? `${overdueRows.length} overdue`
			: todayRows.length > 0
				? `${todayRows.length} due today`
				: 'nothing overdue';

	return {
		subject: `Command Center ${kind === 'morning' ? 'start of day' : 'end of day'}: ${headline}`,
		text: parts.join('\n'),
		html: toHtml(parts),
		empty
	};
}

export interface DigestResult {
	kind: DigestKind;
	day: string;
	status: 'sent' | 'already_sent' | 'skipped_no_key' | 'failed';
	detail?: string;
	subject?: string;
	/** Dry run only. The HTML part, so the rendering can be checked without sending. */
	html?: string;
}

/** KV key that makes a send idempotent for a given Mountain day and kind. */
export function digestKey(day: string, kind: DigestKind): string {
	return `digest:${day}:${kind}`;
}

/**
 * Sends one digest, at most once per Mountain day per kind.
 *
 * Cron Triggers do not retry on failure, so the marker is written only after
 * Resend accepts the message. A failed send therefore leaves the day unmarked
 * and the next firing in that hour will try again, which is the mitigation for
 * the no-retry caveat rather than a guarantee against it.
 */
export async function runDigest(
	env: DigestEnv,
	kind: DigestKind,
	options: { force?: boolean; dryRun?: boolean } = {}
): Promise<DigestResult> {
	const day = todayInWorkingZone();
	const key = digestKey(day, kind);

	if (!options.force && !options.dryRun) {
		const already = await env.SESSIONS.get(key);
		if (already) return { kind, day, status: 'already_sent', detail: already };
	}

	const content = await buildDigest(env, kind, day);

	if (options.dryRun) {
		return {
			kind,
			day,
			status: 'sent',
			detail: content.text,
			subject: content.subject,
			html: content.html
		};
	}

	if (!env.RESEND_API_KEY) {
		return { kind, day, status: 'skipped_no_key', detail: 'RESEND_API_KEY is not set.' };
	}

	const from = env.DIGEST_FROM || 'onboarding@resend.dev';
	const to = env.DIGEST_TO || 'pacardopaul18@gmail.com';

	const res = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			authorization: `Bearer ${env.RESEND_API_KEY}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			from,
			to,
			subject: content.subject,
			text: content.text,
			html: content.html
		})
	});

	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		return { kind, day, status: 'failed', detail: `${res.status} ${detail}`.trim() };
	}

	// Marker written only after acceptance, so a failure stays retryable.
	await env.SESSIONS.put(key, new Date().toISOString(), { expirationTtl: 60 * 60 * 24 * 7 });

	return { kind, day, status: 'sent', subject: content.subject };
}
