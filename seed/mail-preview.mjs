/**
 * Local mail seed, for reviewing the Mail redesign.
 *
 * LOCAL ONLY. Writes to .wrangler/state, which is the miniflare emulation on
 * this machine. It never touches the remote D1, R2 or KV, and it must never be
 * pointed at them: the account it seeds is fictional and would be indelible
 * noise in the real database.
 *
 * Every subject, sender, body and gist below is invented for this file. Nothing
 * comes from Paul's mail, and nothing comes from the redesign prototype's
 * sample threads, which were read for layout only and are seeded nowhere. D89.
 *
 *   node seed/mail-preview.mjs          seed
 *   node seed/mail-preview.mjs --clear  remove everything it made
 *
 * Two accounts, because the parts of the redesign most worth reviewing are the
 * mailbox picker, the All mailboxes union and the per-row account attribution,
 * and none of them exist with one account connected.
 */

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const D1_DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const R2_DIR = '.wrangler/state/v3/r2/miniflare-R2BucketObject';
const R2_BLOBS = '.wrangler/state/v3/r2/command-center-files/blobs';

const A = 'preview-personal';
const B = 'preview-firm';
const A_EMAIL = 'paul@northsideops.invalid';
const B_EMAIL = 'paul@vantage-partners.invalid';

function open(dir) {
	if (!existsSync(dir)) throw new Error(`Not found: ${dir}. Run npm run dev once first.`);
	const file = readdirSync(dir).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
	if (!file) throw new Error(`No database in ${dir}.`);
	return new DatabaseSync(join(dir, file));
}

const db = open(D1_DIR);
const r2 = open(R2_DIR);

const ISO = (daysAgo, hour = 9) => {
	const d = new Date(Date.UTC(2026, 7, 31, hour, 0, 0));
	d.setUTCDate(d.getUTCDate() - daysAgo);
	return d.toISOString().replace('.000Z', 'Z');
};

const blobIds = [];

function putBody(key, text, contentType) {
	const id = randomBytes(40).toString('hex');
	writeFileSync(join(R2_BLOBS, id), text);
	r2.prepare('DELETE FROM _mf_objects WHERE key = ?').run(key);
	r2.prepare(
		`INSERT INTO _mf_objects (key, blob_id, version, size, etag, uploaded, checksums, http_metadata, custom_metadata)
     VALUES (?, ?, ?, ?, ?, ?, '{}', ?, '{}')`
	).run(
		key,
		id,
		randomBytes(16).toString('hex'),
		Buffer.byteLength(text),
		createHash('md5').update(text).digest('hex'),
		Date.now(),
		JSON.stringify({ contentType })
	);
	blobIds.push(id);
	return Buffer.byteLength(text);
}

function clear() {
	for (const id of [A, B]) {
		for (const t of [
			'email_drafts',
			'email_attachments',
			'email_messages',
			'email_threads',
			'calendar_events',
			'calendars',
			'email_ingest_state',
			'connections'
		]) {
			try {
				if (t === 'email_drafts') {
					db.prepare(
						`DELETE FROM email_drafts WHERE thread_id IN
             (SELECT id FROM email_threads WHERE connection_id = ?)`
					).run(id);
				} else if (t === 'email_attachments') {
					db.prepare(
						`DELETE FROM email_attachments WHERE message_id IN
             (SELECT id FROM email_messages WHERE connection_id = ?)`
					).run(id);
				} else if (t === 'connections') {
					db.prepare('DELETE FROM connections WHERE id = ?').run(id);
				} else {
					db.prepare(`DELETE FROM ${t} WHERE connection_id = ?`).run(id);
				}
			} catch {
				// A table this build does not have is not an error worth stopping for.
			}
		}
	}
	const stale = r2.prepare("SELECT blob_id FROM _mf_objects WHERE key LIKE 'preview/%'").all();
	for (const row of stale) rmSync(join(R2_BLOBS, row.blob_id), { force: true });
	r2.prepare("DELETE FROM _mf_objects WHERE key LIKE 'preview/%'").run();
}

/**
 * The threads. Invented, and spread deliberately across everything the two
 * screens can show: each severity, both categories, needs-you and not,
 * archived and not, summarised and not, corrected and not.
 */
const THREADS = [
	{
		s: 'urgent', c: 'correspondence', from: 'rina.delacruz@harborlight.invalid', name: 'Rina Dela Cruz',
		subj: 'Harborlight: signed SOW still outstanding for the October start',
		gist: 'They need the countersigned SOW before they can raise the PO, and the start date is tied to it.',
		days: 0, needsYou: true, summary:
			'Harborlight cannot raise the purchase order until the SOW is countersigned. Rina has asked twice. The October 6 start is contingent on the PO existing, so this is the item holding the engagement date.'
	},
	{
		s: 'urgent', c: 'correspondence', from: 'accounts@pinedaassociates.invalid', name: 'Pineda Associates',
		subj: 'Overdue: invoice 2026-118, 41 days',
		gist: 'Second reminder on an invoice that is now well past terms.',
		days: 1, needsYou: true
	},
	{
		s: 'urgent', c: 'correspondence', from: 'dmalabanan@stonebridge.invalid', name: 'Dex Malabanan',
		subj: 'Stonebridge migration: we are blocked on the read-only credential',
		gist: 'Their team cannot start the dry run without the credential you said you would send Monday.',
		days: 2, needsYou: true, attachments: [
			{ name: 'stonebridge-runbook.pdf', mime: 'application/pdf', bytes: 214_512 },
			{ name: 'access-request.csv', mime: 'text/csv', bytes: 2_104 }
		]
	},
	{
		s: 'important', c: 'correspondence', from: 'joy.fernandez@caldera.invalid', name: 'Joy Fernandez',
		subj: 'Caldera: three dates that work for the kickoff',
		gist: 'Offers three kickoff slots and asks you to pick one this week.',
		days: 1, needsYou: true, html: true
	},
	{
		s: 'important', c: 'correspondence', from: 'marco@twinpeaksconsult.invalid', name: 'Marco Uy',
		subj: 'Re: scope for the reporting workstream',
		gist: 'Agrees the scope but wants the reporting split out and priced separately.',
		days: 3, needsYou: false
	},
	{
		s: 'important', c: 'correspondence', from: 'hr@vantage-partners.invalid', name: 'Vantage People Team',
		subj: 'Policy acknowledgement due Friday',
		gist: 'Routine acknowledgement, but it has a hard Friday deadline.',
		days: 2, needsYou: true, account: B
	},
	{
		s: 'important', c: 'correspondence', from: 'tessa.ramos@harborlight.invalid', name: 'Tessa Ramos',
		subj: 'Harborlight: revised numbers for the Q4 forecast',
		gist: 'Sends revised figures and asks whether they change your estimate.',
		days: 4, needsYou: true, corrected: true
	},
	{
		s: 'important', c: 'correspondence', from: 'noel.bautista@caldera.invalid', name: 'Noel Bautista',
		subj: 'Caldera: who owns the data mapping on your side',
		gist: 'Wants a named owner for the mapping before their team commits resource.',
		days: 5, needsYou: false, account: B
	},
	{
		s: 'routine', c: 'correspondence', from: 'billing@cloudhostco.invalid', name: 'CloudHost Billing',
		subj: 'Your August invoice is ready',
		gist: 'Monthly hosting invoice, no action unless the amount looks wrong.',
		days: 2, needsYou: false
	},
	{
		s: 'routine', c: 'correspondence', from: 'no-reply@calendarapp.invalid', name: 'Calendar',
		subj: 'Invitation: Stonebridge weekly sync',
		gist: 'Recurring invitation for the Tuesday sync.',
		days: 3, needsYou: false
	},
	{
		s: 'routine', c: 'correspondence', from: 'anna.lim@twinpeaksconsult.invalid', name: 'Anna Lim',
		subj: 'Notes from Thursday, nothing needed from you',
		gist: 'Meeting notes shared for the record.',
		days: 6, needsYou: false, html: true
	},
	{
		s: 'routine', c: 'correspondence', from: 'support@ticketdesk.invalid', name: 'Ticket Desk',
		subj: 'Ticket 88214 has been closed',
		gist: 'Closure confirmation for a ticket you raised last month.',
		days: 7, needsYou: false
	},
	{
		s: 'routine', c: 'correspondence', from: 'library@vantage-partners.invalid', name: 'Vantage Library',
		subj: 'New template pack published',
		gist: 'Firm template pack update.',
		days: 8, needsYou: false, account: B
	},
	{
		s: 'noise', c: 'correspondence', from: 'news@industryweekly.invalid', name: 'Industry Weekly',
		subj: 'The five trends reshaping professional services',
		gist: 'Newsletter.',
		days: 1, needsYou: false, html: true
	},
	{
		s: 'noise', c: 'correspondence', from: 'offers@toolvendor.invalid', name: 'Tool Vendor',
		subj: 'Last chance: 40% off through Sunday',
		gist: 'Promotional mail.',
		days: 2, needsYou: false, html: true
	},
	{
		s: 'noise', c: 'correspondence', from: 'digest@forumsite.invalid', name: 'Forum Digest',
		subj: 'Your weekly digest: 14 new posts',
		gist: 'Forum digest.',
		days: 4, needsYou: false, account: B
	},
	{
		s: null, c: null, from: 'gabriel.tan@newlead.invalid', name: 'Gabriel Tan',
		subj: 'Introduction from a mutual contact',
		gist: null,
		days: 0, needsYou: true
	},
	{
		s: null, c: null, from: 'events@conferenceco.invalid', name: 'Conference Co',
		subj: 'Speaker invitation for the November programme',
		gist: null,
		days: 1, needsYou: true
	},
	{
		s: 'routine', c: 'correspondence', from: 'rina.delacruz@harborlight.invalid', name: 'Rina Dela Cruz',
		subj: 'Harborlight: thanks, received',
		gist: 'Acknowledgement, closed out.',
		days: 12, needsYou: false, archived: true
	},
	{
		s: 'noise', c: 'correspondence', from: 'news@industryweekly.invalid', name: 'Industry Weekly',
		subj: 'Weekly roundup, August 12',
		gist: 'Newsletter, already read.',
		days: 19, needsYou: false, archived: true
	},
	{
		s: 'important', c: 'correspondence', from: 'marco@twinpeaksconsult.invalid', name: 'Marco Uy',
		subj: 'Closed: reporting workstream agreed',
		gist: 'Settled and filed.',
		days: 21, needsYou: false, archived: true, account: B
	}
];

const PLAIN = (who) => `Hi Paul,

${who}

I have kept this short because I know the week is busy. If it is easier to talk
it through, I have time Thursday afternoon or Friday morning.

Thanks,
`;

const HTML_BODY = `<div>
<p>Hi Paul,</p>
<p>Putting the options in a table so they are easier to compare:</p>
<table>
<tr><th>Option</th><th>Date</th><th>Who needs to be there</th></tr>
<tr><td>A</td><td>Tuesday 8 September</td><td>Both teams</td></tr>
<tr><td>B</td><td>Thursday 10 September</td><td>Delivery only</td></tr>
<tr><td>C</td><td>Monday 14 September</td><td>Both teams, plus finance</td></tr>
</table>
<p>Our preference is <strong>Option B</strong>, but any of them work.</p>
<p><img src="https://tracking.newsletterhost.invalid/pixel.gif?id=preview" alt="" /></p>
<p>Best,<br />The team</p>
<blockquote><p>On 28 August you wrote: happy to look at dates once the SOW is signed.</p></blockquote>
</div>`;

function seed() {
	clear();

	for (const [id, email] of [
		[A, A_EMAIL],
		[B, B_EMAIL]
	]) {
		// One connected recently and one a while ago, so the re-auth notice is
		// visible in review without both mailboxes shouting it.
		const connectedDaysAgo = id === A ? 2 : 20;
		db.prepare(
			`INSERT INTO connections (id, provider, account_email, status, connected_at, created_at, updated_at)
       VALUES (?, 'google', ?, 'connected', ?, ?, ?)`
		).run(id, email, ISO(connectedDaysAgo), ISO(connectedDaysAgo), ISO(0));

		try {
			db.prepare(
				`INSERT INTO email_ingest_state (connection_id, status, window_days, discovered, fetched)
         VALUES (?, 'idle', 30, ?, ?)`
			).run(id, id === A ? 412 : 96, id === A ? 412 : 96);
		} catch {
			// Older schema without the table. Not fatal for a preview seed.
		}

		db.prepare(
			`INSERT INTO calendars (id, connection_id, provider_calendar_id, summary, sync_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
		).run(`${id}-cal`, id, `${id}-pc`, email, ISO(20), ISO(0));
	}

	let n = 0;
	for (const t of THREADS) {
		const acct = t.account ?? A;
		const owner = acct === A ? A_EMAIL : B_EMAIL;
		const tid = `preview-t${n}`;
		const last = ISO(t.days, 9 + (n % 8));

		db.prepare(
			`INSERT INTO email_threads
       (id, connection_id, provider_thread_id, subject, message_count, first_at, last_at,
        category, severity, gist, summary, summary_model, summary_at,
        classified_at, classified_model, severity_override, corrected_at, archived_at,
        created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
		).run(
			tid, acct, `${tid}-pt`, t.subj, t.needsYou ? 2 : 3, ISO(t.days + 2), last,
			t.c, t.s, t.gist,
			t.summary ?? null, t.summary ? 'claude-sonnet-5' : null, t.summary ? last : null,
			t.s ? last : null, t.s ? 'claude-haiku-4-5-20251001' : null,
			t.corrected ? 'important' : null, t.corrected ? last : null,
			t.archived ? ISO(t.days - 1) : null,
			last, last
		);

		// Newest last. The detail view reverses, so the reader meets the newest
		// first, and needsYou decides whether that newest one is Paul's.
		const count = t.needsYou ? 2 : 3;
		for (let i = 0; i < count; i++) {
			const mine = t.needsYou ? i === 0 : i === count - 1;
			const mid = `${tid}-m${i}`;
			const isNewest = i === count - 1;
			const useHtml = Boolean(t.html) && isNewest;
			const body = useHtml ? HTML_BODY : PLAIN(t.gist ?? 'Following up on the thread below.');
			const key = `preview/${mid}.${useHtml ? 'html' : 'txt'}`;
			const bytes = putBody(key, body, useHtml ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8');

			db.prepare(
				`INSERT INTO email_messages
         (id, connection_id, thread_id, provider_message_id, provider_thread_id, subject,
          from_email, from_name, to_emails, sent_at, snippet, is_unread,
          body_key, body_bytes, body_format, fetched_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
			).run(
				mid, acct, tid, `${mid}-pm`, `${tid}-pt`, t.subj,
				mine ? owner : t.from,
				mine ? 'Paul Pacardo' : t.name,
				mine ? t.from : owner,
				ISO(t.days + (count - 1 - i), 9 + (n % 8)),
				(t.gist ?? t.subj).slice(0, 120),
				isNewest && t.needsYou ? 1 : 0,
				key, bytes, useHtml ? 'html' : 'text', last
			);

			if (isNewest && t.attachments) {
				for (const [j, a] of t.attachments.entries()) {
					try {
						db.prepare(
							`INSERT INTO email_attachments
               (id, message_id, provider_attachment_id, filename, mime_type, size_bytes, created_at)
               VALUES (?,?,?,?,?,?,?)`
						).run(`${mid}-a${j}`, mid, `${mid}-pa${j}`, a.name, a.mime, a.bytes, last);
					} catch {
						// Schema variant without this table. Skip rather than stop.
					}
				}
			}
		}
		n++;
	}

	// One stored draft, so the draft callout and its copy affordance are visible
	// without spending anything on the model.
	try {
		db.prepare(
			`INSERT INTO email_drafts (id, thread_id, body, based_on_message_id, based_on_last_at, model, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
		).run(
			'preview-draft-0', 'preview-t0',
			`Hi Rina,\n\nThanks for chasing. The countersigned SOW is with me now and I will have it back to you by [DATE], which should let you raise the PO without moving the October 6 start.\n\nIf the date does slip, tell me early and I will look at what can start in parallel.\n\nPaul`,
			'preview-t0-m1', ISO(0, 9), 'claude-sonnet-5', ISO(0, 10), ISO(0, 10)
		);
	} catch {
		// Draft table shape differs. The rest of the preview stands.
	}

	const threads = db.prepare('SELECT COUNT(*) n FROM email_threads').get().n;
	const messages = db.prepare('SELECT COUNT(*) n FROM email_messages').get().n;
	console.log(`Seeded 2 accounts, ${threads} threads, ${messages} messages, bodies in R2.`);
	console.log(`  ${A_EMAIL}  and  ${B_EMAIL}`);
}

const clearing = process.argv.includes('--clear');
if (clearing) {
	clear();
	console.log('Preview mail seed removed.');
} else {
	seed();
}
db.close();
r2.close();
