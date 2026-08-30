import Anthropic from '@anthropic-ai/sdk';
import { todayInWorkingZone, WORKING_TIME_ZONE } from './dates';
import { enforceHouseStyle, HOUSE_STYLE } from './house-style';

/**
 * The one place the app talks to Claude.
 *
 * Model is Claude Sonnet, per Paul's ruling: extraction accuracy per cost, with
 * the human review step catching what it misses. `claude-sonnet-5` is the
 * current Sonnet id.
 *
 * Two things about this model that shape the code below, both verified against
 * the API reference rather than recalled:
 *
 * - Adaptive thinking is on by default. Omitting `thinking` does not mean "no
 *   thinking" here, so `max_tokens` has to leave room for it or the response
 *   truncates mid-answer.
 * - `temperature`, `top_p` and `top_k` are rejected outright. Behaviour is
 *   steered by the prompt, not by sampling parameters.
 */

export const MODEL = 'claude-sonnet-5';

/**
 * The cheap model, for the questions that do not need the expensive one.
 *
 * Triage answers a four way question from a subject, a snippet and the start of
 * one message. Most of a mailbox is noise, and paying the large model to
 * recognise a job alert as a job alert is the definition of spending money on
 * nothing. Summaries stay on the larger model, and only for threads triage said
 * were worth reading.
 */
export const CHEAP_MODEL = 'claude-haiku-4-5-20251001';

/** What one call actually cost, read off the response rather than guessed. */
export interface Usage {
	model: string;
	input_tokens: number;
	output_tokens: number;
}

function usageOf(message: { model: string; usage?: { input_tokens?: number; output_tokens?: number } }): Usage {
	return {
		model: message.model,
		input_tokens: Number(message.usage?.input_tokens ?? 0),
		output_tokens: Number(message.usage?.output_tokens ?? 0)
	};
}

/** Leaves room for adaptive thinking plus the answer. */
const MAX_TOKENS = 16_000;

export function client(apiKey: string): Anthropic {
	return new Anthropic({ apiKey });
}

export class AiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/**
 * Turns an SDK failure into something the UI can show. A refusal and a rate
 * limit are different problems for the user and should not read the same.
 */
function toAiError(err: unknown): AiError {
	if (err instanceof Anthropic.RateLimitError) {
		return new AiError(429, 'Claude is rate limited right now. Try again shortly.');
	}
	if (err instanceof Anthropic.AuthenticationError) {
		return new AiError(500, 'The Anthropic API key is missing or rejected.');
	}
	if (err instanceof Anthropic.APIConnectionError) {
		return new AiError(502, 'Could not reach the Anthropic API.');
	}
	if (err instanceof Anthropic.APIError) {
		return new AiError(502, `Anthropic API error ${err.status}: ${err.message}`);
	}
	return new AiError(500, 'The AI request failed.');
}

/** Pulls the plain text out of a response, ignoring thinking blocks. */
function textOf(message: Anthropic.Message): string {
	return message.content
		.filter((block): block is Anthropic.TextBlock => block.type === 'text')
		.map((block) => block.text)
		.join('\n')
		.trim();
}

/**
 * Guards every call. A refusal or a truncation is a real outcome, not an
 * exception, and silently returning half a summary would be worse than failing.
 */
function assertUsable(message: Anthropic.Message): void {
	if (message.stop_reason === 'refusal') {
		throw new AiError(422, 'Claude declined to process this transcript.');
	}
	if (message.stop_reason === 'max_tokens') {
		throw new AiError(
			422,
			'The response hit the token limit. Split the transcript by agenda topic and run it again.'
		);
	}
}

const SUMMARY_SYSTEM = `You summarise meeting transcripts for a single-user operations command center.

${HOUSE_STYLE}

Write plain markdown, structured as:

## What was decided
## What is still open
## Context worth keeping

Omit any section that has nothing in it rather than writing "none".

Report only what the transcript supports.`;

export async function summariseTranscript(
	apiKey: string,
	transcript: string,
	meetingTitle: string
): Promise<{ summary: string; model: string }> {
	try {
		const message = await client(apiKey).messages.create({
			model: MODEL,
			max_tokens: MAX_TOKENS,
			system: SUMMARY_SYSTEM,
			messages: [
				{
					role: 'user',
					content: `Meeting: ${meetingTitle}\n\nTranscript:\n\n${transcript}`
				}
			]
		});

		assertUsable(message);
		// Enforced, not requested. See house-style.ts and F2.
		const summary = enforceHouseStyle(textOf(message));
		if (!summary) throw new AiError(502, 'Claude returned an empty summary.');
		return { summary, model: message.model };
	} catch (err) {
		if (err instanceof AiError) throw err;
		throw toAiError(err);
	}
}

/**
 * The extraction schema.
 *
 * Every field is required and `additionalProperties` is false, which structured
 * outputs needs. Optionality is expressed as an empty string rather than a
 * missing key, so the model cannot decide to omit a field it found awkward.
 */
const EXTRACTION_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['items'],
	properties: {
		items: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['title', 'context', 'owner', 'deadline', 'ambiguous', 'ambiguity_note', 'evidence'],
				properties: {
					title: {
						type: 'string',
						description: 'The commitment, as one short imperative sentence.'
					},
					context: {
						type: 'string',
						description: 'One line so the item still makes sense weeks later.'
					},
					owner: {
						type: 'string',
						description: 'Who committed, exactly as named in the transcript. Empty string if nobody was named.'
					},
					deadline: {
						type: 'string',
						description: 'YYYY-MM-DD if a date was stated or can be resolved from a relative reference. Empty string otherwise. Never guess.'
					},
					ambiguous: {
						type: 'boolean',
						description: 'True if the owner, the deadline or the commitment itself is unclear in the transcript.'
					},
					ambiguity_note: {
						type: 'string',
						description: 'What is unclear and why. Empty string when ambiguous is false.'
					},
					evidence: {
						type: 'string',
						description: 'A short verbatim quote from the transcript this was drawn from.'
					}
				}
			}
		}
	}
} as const;

const EXTRACTION_SYSTEM = `You extract action items from meeting transcripts for a single-user operations command center.

${HOUSE_STYLE}

An action item is a commitment somebody made to do something. Discussion,
opinion, and background are not action items. If the transcript contains no
commitments, return an empty list rather than manufacturing one.

For each item:

- title: the commitment as one short imperative sentence.
- owner: exactly the name used in the transcript. If nobody was named, leave it
  empty and set ambiguous to true. Do not infer an owner from who was talking.
- deadline: only when a date was stated or follows unambiguously from a relative
  reference such as "by Friday". Leave it empty otherwise. Never guess a date.
- evidence: a short verbatim quote from the transcript. It must appear in the
  transcript word for word. Never paraphrase it and never compose one.

Set ambiguous to true whenever the owner, the deadline, or the commitment itself
is unclear, and say what is unclear in ambiguity_note. Flagging is cheap and a
wrong owner or a wrong date is expensive. When in doubt, flag it.`;

export interface ExtractedItem {
	title: string;
	context: string;
	owner: string;
	deadline: string;
	ambiguous: boolean;
	ambiguity_note: string;
	evidence: string;
}

export async function extractActionItems(
	apiKey: string,
	transcript: string,
	meetingTitle: string,
	meetingDate: string
): Promise<{ items: ExtractedItem[]; model: string }> {
	try {
		const message = await client(apiKey).messages.create({
			model: MODEL,
			max_tokens: MAX_TOKENS,
			system: EXTRACTION_SYSTEM,
			output_config: {
				format: {
					type: 'json_schema',
					schema: EXTRACTION_SCHEMA
				}
			},
			messages: [
				{
					role: 'user',
					content:
						`Meeting: ${meetingTitle}\n` +
						`Meeting date: ${meetingDate}\n` +
						`Today: ${todayInWorkingZone()} (${WORKING_TIME_ZONE})\n` +
						`Resolve relative dates such as "next Tuesday" against the meeting date.\n\n` +
						`Transcript:\n\n${transcript}`
				}
			]
		});

		assertUsable(message);

		const raw = textOf(message);
		let parsed: { items?: unknown };
		try {
			parsed = JSON.parse(raw) as { items?: unknown };
		} catch {
			throw new AiError(502, 'Claude returned output that was not valid JSON.');
		}

		if (!Array.isArray(parsed.items)) {
			throw new AiError(502, 'Claude returned no item list.');
		}

		// The schema constrains the shape, but this is model output crossing a
		// trust boundary into the database. Validate it like any other input.
		const items: ExtractedItem[] = [];
		for (const entry of parsed.items) {
			if (!entry || typeof entry !== 'object') continue;
			const row = entry as Record<string, unknown>;
			const title = typeof row.title === 'string' ? row.title.trim() : '';
			if (!title) continue;

			const deadline =
				typeof row.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.deadline.trim())
					? row.deadline.trim()
					: '';

			const owner = typeof row.owner === 'string' ? row.owner.trim().slice(0, 200) : '';
			const note =
				typeof row.ambiguity_note === 'string' ? row.ambiguity_note.trim().slice(0, 500) : '';

			// The model is asked to flag what is unclear, and mostly does. This is
			// the backstop: an item with no owner or no deadline is ambiguous
			// whatever the model claimed, because those are exactly the two fields
			// the architecture doc warns extraction gets wrong.
			const missing: string[] = [];
			if (!owner) missing.push('no owner named');
			if (!deadline) missing.push('no deadline stated');
			const ambiguous = row.ambiguous === true || missing.length > 0;

			items.push({
				// House style is enforced on every field the model wrote, not just
				// the prose ones. A title is as visible as a summary.
				title: enforceHouseStyle(title).slice(0, 300),
				context: enforceHouseStyle(
					typeof row.context === 'string' ? row.context.trim() : ''
				).slice(0, 4000),
				owner,
				deadline,
				ambiguous,
				ambiguity_note: enforceHouseStyle(
					note || (missing.length > 0 ? missing.join(', ') : '')
				).slice(0, 500),
				// Evidence is deliberately NOT style-enforced. It is a verbatim quote
				// from the transcript, and rewriting a quote to satisfy house style
				// would break the only check available on whether the model made it
				// up. The confabulation test depends on this being untouched.
				evidence: typeof row.evidence === 'string' ? row.evidence.trim().slice(0, 2000) : ''
			});
		}

		return { items, model: message.model };
	} catch (err) {
		if (err instanceof AiError) throw err;
		throw toAiError(err);
	}
}

/**
 * Drafts client-facing writing from a template.
 *
 * The template body is passed as an exemplar to imitate, not as instructions to
 * follow. That is the whole mechanism: the architecture's goal for this module
 * is replies that sound like the partner, and a model told to "be professional"
 * writes like a model. Told to match a specific piece of real writing, it
 * matches it.
 *
 * The situation is the only new information. Anything the situation does not
 * establish must not appear in the draft, because a confidently invented
 * commitment in a client-facing email is the most expensive thing this app
 * could produce.
 */
const DRAFT_SYSTEM = `You draft client-facing writing for a small consulting firm, in the voice of the person who wrote the example you are given.

${HOUSE_STYLE}

You will be given an example of that person's writing, the situation to respond
to, and what kind of document this is.

Match the example's voice: its sentence length, its level of formality, how it
opens and closes, how direct it is. Match the register, not the specific content.

Use only what the situation tells you. Never invent a date, a figure, a name, a
commitment, or a next step that the situation does not establish. Where
something is needed but unknown, write a short bracketed placeholder such as
[confirm date] rather than choosing something plausible.

Return only the draft itself. No preamble, no explanation, no subject line
unless the example has one.`;

export async function draftFromTemplate(
	apiKey: string,
	input: {
		templateName: string;
		scenario: string | null;
		exemplar: string;
		type: 'email' | 'doc';
		situation: string;
		recipient?: string;
	}
): Promise<{ draft: string; model: string }> {
	try {
		const message = await client(apiKey).messages.create({
			model: MODEL,
			max_tokens: MAX_TOKENS,
			system: DRAFT_SYSTEM,
			messages: [
				{
					role: 'user',
					content:
						`Kind: ${input.type === 'email' ? 'email reply' : 'document'}
` +
						`Template: ${input.templateName}
` +
						(input.scenario ? `Used when: ${input.scenario}
` : '') +
						(input.recipient ? `Writing to: ${input.recipient}
` : '') +
						`
Example of the voice to match:

${input.exemplar}

` +
						`Situation to respond to:

${input.situation}`
				}
			]
		});

		assertUsable(message);
		const draft = enforceHouseStyle(textOf(message));
		if (!draft) throw new AiError(502, 'Claude returned an empty draft.');
		return { draft, model: message.model };
	} catch (err) {
		if (err instanceof AiError) throw err;
		throw toAiError(err);
	}
}

const THREAD_SYSTEM = `You summarise an email thread for a consultant's own reference.

Write two to four sentences of plain prose. No bullets, no headings, no preamble.

Cover, in this order and only where the thread supports it: what the thread is
about, what was decided or agreed, and what is outstanding and on whom.

Rules that matter more than completeness:
- Report only what the messages say. Never infer a decision from silence, and
  never turn a proposal into an agreement.
- If nothing was decided, say so plainly rather than manufacturing a conclusion.
- Name people as the messages name them.
- Do not restate the subject line as a summary.
- Marketing mail, notifications and automated receipts are common. If the thread
  is one of those, say what it is in one sentence and stop.

This summary is read next to the thread itself, so it does not need to repeat
detail a glance would give.`;

/**
 * Summarises one email thread.
 *
 * Deliberately the same shape as `summariseTranscript`: same client, same house
 * style enforcement, same error handling. A thread and a transcript are both a
 * conversation somebody needs the gist of, and building a second path for the
 * second one would mean two prompts to keep honest instead of one.
 */
export async function summariseThread(
	apiKey: string,
	subject: string,
	messages: { from: string | null; sent_at: string; body: string }[]
): Promise<{ summary: string; model: string; usage: Usage }> {
	const rendered = messages
		.map((m) => ['From: ' + (m.from ?? 'unknown'), 'Sent: ' + m.sent_at, '', m.body].join('\n'))
		.join('\n\n---\n\n');

	try {
		const message = await client(apiKey).messages.create({
			model: MODEL,
			max_tokens: MAX_TOKENS,
			system: THREAD_SYSTEM,
			messages: [{ role: 'user', content: 'Subject: ' + subject + '\n\n' + rendered }]
		});

		assertUsable(message);
		// Enforced, not requested, exactly as the transcript path does it.
		const summary = enforceHouseStyle(textOf(message));
		if (!summary) throw new AiError(502, 'Claude returned an empty summary.');
		return { summary, model: message.model, usage: usageOf(message) };
	} catch (err) {
		if (err instanceof AiError) throw err;
		throw toAiError(err);
	}
}

/**
 * Triage of one email thread.
 *
 * Returns a chip, not an essay. The first version of the mail list showed the
 * full summary in every row, which made the list unreadable: a list needs a
 * label and a glance, and the paragraph belongs inside the thread.
 *
 * Severity is about what Paul must do, never about how the sender wrote it.
 * Marketing mail says urgent constantly, and a classifier that believed the
 * sender would rank every promotion above a client's actual question.
 */
const TRIAGE_SYSTEM = `You triage one email thread for a consultant.

Reply with JSON only. No prose, no code fence. Exactly this shape:
{"category":"...","severity":"...","gist":"..."}

category is one of:
  correspondence  a person wrote to a person and a reply is conceivable
  automated       a machine sent it: receipts, alerts, job matches, calendar
  newsletter      a subscription someone reads, or does not
  notification    a service reporting that something happened in it

severity is one of:
  urgent     someone is waiting on Paul now, or money or a deadline is at risk
  important  Paul must act or decide, but not today
  routine    worth knowing, nothing to do
  noise      nothing is lost by never opening it

Severity is about what PAUL must do. It is never about how insistent the
sender sounds. Marketing mail says urgent constantly and is still noise. A
quiet one line question from a client that blocks their work is urgent.
Automated mail is almost never above routine. A receipt is routine, a failed
payment is important, a service outage affecting a client is urgent.

You are shown the subject, the sender and the opening of the thread. That is
enough for this question. Do not ask for more and do not speculate about what
the rest might contain.

gist is ONE line, at most 90 characters. What this is and what it wants, in
plain words. Not a summary, not a subject line restated. If the thread wants
nothing, say what it is and stop.

Report only what the messages support. Never infer a decision from silence,
and never turn a proposal into an agreement.`;

export interface Triage {
	category: 'correspondence' | 'automated' | 'newsletter' | 'notification';
	severity: 'urgent' | 'important' | 'routine' | 'noise';
	gist: string;
}

const CATEGORIES = ['correspondence', 'automated', 'newsletter', 'notification'];
const SEVERITIES = ['urgent', 'important', 'routine', 'noise'];

/**
 * Triages a thread, refusing to guess when the model answers oddly.
 *
 * A model that returns something outside the four allowed values is not
 * lightly coerced to the nearest one. Quietly turning an unrecognised answer
 * into 'routine' would put a confident label on a thread nothing understood,
 * and a wrong label in a filter is worse than an absent one, because an absent
 * one is visible.
 */
export async function triageThread(
	apiKey: string,
	subject: string,
	messages: { from: string | null; sent_at: string; body: string }[]
): Promise<{ triage: Triage; model: string; usage: Usage }> {
	const rendered = messages
		.map((m) => ['From: ' + (m.from ?? 'unknown'), 'Sent: ' + m.sent_at, '', m.body].join('\n'))
		.join('\n\n---\n\n');

	try {
		const message = await client(apiKey).messages.create({
			model: CHEAP_MODEL,
			max_tokens: 400,
			system: TRIAGE_SYSTEM,
			messages: [{ role: 'user', content: 'Subject: ' + subject + '\n\n' + rendered }]
		});

		assertUsable(message);
		const raw = textOf(message).trim();

		// Models sometimes wrap JSON in a fence despite being told not to. That is
		// a formatting habit rather than a failure, so it is unwrapped rather than
		// rejected.
		const body = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

		let parsed: Record<string, unknown>;
		try {
			parsed = JSON.parse(body) as Record<string, unknown>;
		} catch {
			throw new AiError(502, 'Claude did not return usable triage JSON.');
		}

		const category = String(parsed.category ?? '').toLowerCase();
		const severity = String(parsed.severity ?? '').toLowerCase();
		if (!CATEGORIES.includes(category) || !SEVERITIES.includes(severity)) {
			throw new AiError(502, 'Claude returned a category or severity outside the allowed set.');
		}

		const gist = enforceHouseStyle(String(parsed.gist ?? '').trim()).slice(0, 200);
		if (!gist) throw new AiError(502, 'Claude returned an empty gist.');

		return {
			triage: { category, severity, gist } as Triage,
			model: message.model,
			usage: usageOf(message)
		};
	} catch (err) {
		if (err instanceof AiError) throw err;
		throw toAiError(err);
	}
}

/**
 * Drafting a reply in Paul's own register.
 *
 * The voice is not described, it is shown. Telling a model to write
 * 'professionally but warmly' produces the average of everyone who was ever
 * described that way. Giving it half a dozen things Paul actually sent gives
 * it his greeting, his sign-off, his sentence length and how blunt he is
 * willing to be, none of which he could have specified accurately if asked.
 *
 * THE APP CANNOT SEND. There is no send scope and no compose scope, so this
 * produces text that lands in the app and is copied out by hand. That is
 * stated here because it is the reason the prompt never says 'send' and never
 * signs anything on his behalf without his sign-off being visibly his.
 */
const REPLY_SYSTEM = `You draft a reply that Paul will read, edit and send himself.

You are given examples of messages Paul actually sent. Match how he writes:
his greeting, his sign-off, his sentence length, how direct he is. Do not
imitate the people writing TO him.

Write the reply body only. No subject line, no 'Here is a draft', no notes
about what you did. Just the message, ready to paste.

Rules that outrank sounding good:
- Commit to nothing that is not already agreed in the thread. No dates, no
  prices, no scope, no promises Paul has not made. Where a commitment is
  needed, leave a bracketed blank like [date] for him to fill.
- Answer what was actually asked. A reply that is warm and answers nothing
  wastes the reader's time and Paul's.
- If the thread does not contain enough to reply properly, say so in one line
  inside the draft rather than inventing the missing part.
- Never apologise for delay unless the thread shows there was one.
- No em dashes.

Short is better. Most replies are three to six sentences.`;

export interface DraftInput {
	subject: string;
	/** The thread, oldest first. */
	messages: { from: string | null; sent_at: string; body: string }[];
	/** Things Paul actually sent, used as the voice sample. */
	voice: string[];
	/** What the triage said needs doing, when it said anything. */
	gist: string | null;
	/** Client and project context, when the thread is linked to one. */
	context: string | null;
}

export async function draftReply(
	apiKey: string,
	input: DraftInput
): Promise<{ body: string; model: string; usage: Usage }> {
	const thread = input.messages
		.map((m) => ['From: ' + (m.from ?? 'unknown'), 'Sent: ' + m.sent_at, '', m.body].join('\n'))
		.join('\n\n---\n\n');

	const parts: string[] = [];

	if (input.voice.length > 0) {
		parts.push(
			'Messages Paul has sent, as a guide to how he writes:\n\n' +
				input.voice.map((v, i) => '--- example ' + (i + 1) + ' ---\n' + v).join('\n\n')
		);
	} else {
		// Said plainly rather than left to be inferred. A model given no samples
		// will invent a register, and the draft will read like nobody.
		parts.push(
			'No examples of Paul writing are available. Keep the reply plain, short and neutral rather than guessing at a personal style.'
		);
	}

	if (input.context) parts.push('What this app knows about the client:\n' + input.context);
	if (input.gist) parts.push('What this thread appears to need: ' + input.gist);

	parts.push('The thread to reply to, oldest first:\n\nSubject: ' + input.subject + '\n\n' + thread);
	parts.push('Write Paul\u2019s reply to the most recent message.');

	try {
		const message = await client(apiKey).messages.create({
			model: MODEL,
			max_tokens: 1200,
			system: REPLY_SYSTEM,
			messages: [{ role: 'user', content: parts.join('\n\n') }]
		});

		assertUsable(message);
		const body = enforceHouseStyle(textOf(message));
		if (!body) throw new AiError(502, 'Claude returned an empty draft.');
		return { body, model: message.model, usage: usageOf(message) };
	} catch (err) {
		if (err instanceof AiError) throw err;
		throw toAiError(err);
	}
}

/* -------------------------------------------------------------------------
 * E4: the context engine's four passes
 * ---------------------------------------------------------------------- */

/**
 * Shared across all four: report what the messages support and nothing else.
 *
 * A context store is worse than no context store when it is confidently
 * wrong, because everything downstream inherits the error and a draft written
 * from an invented commitment reads exactly like one written from a real one.
 */
const CONTEXT_RULES = `Report only what the messages actually say.

- Never infer a decision from silence, and never turn a proposal into an
  agreement.
- Where the thread does not say, write that it does not say. An honest gap is
  useful; a confident guess is not.
- Names and dates come from the messages. Do not supply either from context.
- No em dashes.`;

const PROFILE_SYSTEM = `You summarise one person's working relationship with Paul,
from the mail between them.

Reply with JSON only, no prose, no code fence:
{"relationship":"...","usual_topics":"...","expected_tone":"...","open_commitments":"..."}

relationship: who this person is to Paul, in one line, as the mail shows it.
usual_topics: what they actually correspond about.
expected_tone: how Paul writes to THIS person specifically. People write
  differently to a client than to a recruiter, and that difference is the
  point of storing it per contact.
open_commitments: anything either owes the other that the mail leaves open,
  or the word none.

If there is too little mail to say, say so in the field rather than
generalising from one message.

${CONTEXT_RULES}`;

export interface ContactProfile {
	relationship: string;
	usual_topics: string;
	expected_tone: string;
	open_commitments: string;
}

function parseJson(raw: string): Record<string, unknown> {
	// Models sometimes fence JSON despite being told not to. A formatting habit
	// rather than a failure, so it is unwrapped rather than rejected.
	const body = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
	try {
		return JSON.parse(body) as Record<string, unknown>;
	} catch {
		throw new AiError(502, 'Claude did not return usable JSON.');
	}
}

function textField(value: unknown, max = 1200): string {
	return enforceHouseStyle(String(value ?? '').trim()).slice(0, max);
}

/** Sonnet grade: 18 contacts at today's scale, and the output is reused often. */
export async function buildContactProfile(
	apiKey: string,
	person: string,
	messages: { from: string | null; sent_at: string; body: string }[]
): Promise<{ profile: ContactProfile; model: string; usage: Usage }> {
	const rendered = messages
		.map((m) => ['From: ' + (m.from ?? 'unknown'), 'Sent: ' + m.sent_at, '', m.body].join('\n'))
		.join('\n\n---\n\n');

	try {
		const message = await client(apiKey).messages.create({
			model: MODEL,
			max_tokens: 700,
			system: PROFILE_SYSTEM,
			messages: [{ role: 'user', content: 'Mail with ' + person + ':\n\n' + rendered }]
		});
		assertUsable(message);
		const parsed = parseJson(textOf(message));
		return {
			profile: {
				relationship: textField(parsed.relationship),
				usual_topics: textField(parsed.usual_topics),
				expected_tone: textField(parsed.expected_tone),
				open_commitments: textField(parsed.open_commitments)
			},
			model: message.model,
			usage: usageOf(message)
		};
	} catch (err) {
		if (err instanceof AiError) throw err;
		throw toAiError(err);
	}
}

const DIGEST_SYSTEM = `You digest one email thread into structured facts.

Reply with JSON only, no prose, no code fence:
{"summary":"...","decisions":"...","open_asks":"...","paul_commitments":"...","next_move":"paul|them|nobody|unclear"}

summary: two or three sentences on what this thread is.
decisions: what was actually agreed, or the word none. A proposal nobody
  answered is not a decision.
open_asks: what is outstanding and on whom, or none.
paul_commitments: what PAUL specifically said he would do, in his own
  wording where possible, or none. This feeds his drafts, so a commitment
  invented here becomes a promise he never made.
next_move: who the thread is waiting on. Use unclear when the thread does
  not say, rather than guessing.

${CONTEXT_RULES}`;

export interface ThreadDigest {
	summary: string;
	decisions: string;
	open_asks: string;
	paul_commitments: string;
	next_move: 'paul' | 'them' | 'nobody' | 'unclear';
}

const MOVES = ['paul', 'them', 'nobody', 'unclear'];

/** Haiku grade: one per correspondence thread, and the shape is constrained. */
export async function buildThreadDigest(
	apiKey: string,
	subject: string,
	messages: { from: string | null; sent_at: string; body: string }[]
): Promise<{ digest: ThreadDigest; model: string; usage: Usage }> {
	const rendered = messages
		.map((m) => ['From: ' + (m.from ?? 'unknown'), 'Sent: ' + m.sent_at, '', m.body].join('\n'))
		.join('\n\n---\n\n');

	try {
		const message = await client(apiKey).messages.create({
			model: CHEAP_MODEL,
			max_tokens: 800,
			system: DIGEST_SYSTEM,
			messages: [{ role: 'user', content: 'Subject: ' + subject + '\n\n' + rendered }]
		});
		assertUsable(message);
		const parsed = parseJson(textOf(message));

		const move = String(parsed.next_move ?? '').toLowerCase();
		return {
			digest: {
				summary: textField(parsed.summary),
				decisions: textField(parsed.decisions),
				open_asks: textField(parsed.open_asks),
				paul_commitments: textField(parsed.paul_commitments),
				// An answer outside the set becomes 'unclear' rather than being
				// coerced to a specific party. Saying the wrong person owes the next
				// move is worse than admitting the thread does not say.
				next_move: (MOVES.includes(move) ? move : 'unclear') as ThreadDigest['next_move']
			},
			model: message.model,
			usage: usageOf(message)
		};
	} catch (err) {
		if (err instanceof AiError) throw err;
		throw toAiError(err);
	}
}

const VOICE_SYSTEM = `You describe how one person writes, from their own sent mail.

Reply with JSON only, no prose, no code fence:
{"greetings":"...","sign_offs":"...","sentence_length":"...","formality":"...","recurring_phrases":"...","notes":"..."}

Quote what he actually writes rather than characterising it. "Hi [name]," and
"Thanks," are useful; "warm and professional" is not, because it describes
half the people who have ever written an email.

sentence_length: short, medium or long, with a rough word count.
formality: where he sits, and whether it changes by recipient.
recurring_phrases: turns of phrase that appear more than once.
notes: anything else a writer imitating him would need, including habits he
  probably does not know he has.

${CONTEXT_RULES}`;

export interface VoiceProfile {
	greetings: string;
	sign_offs: string;
	sentence_length: string;
	formality: string;
	recurring_phrases: string;
	notes: string;
}

/** Sonnet grade: one per account, and every draft depends on it. */
export async function buildVoiceProfile(
	apiKey: string,
	sent: string[]
): Promise<{ voice: VoiceProfile; model: string; usage: Usage }> {
	const rendered = sent.map((m, i) => '--- message ' + (i + 1) + ' ---\n' + m).join('\n\n');

	try {
		const message = await client(apiKey).messages.create({
			model: MODEL,
			max_tokens: 900,
			system: VOICE_SYSTEM,
			messages: [{ role: 'user', content: 'Messages Paul sent:\n\n' + rendered }]
		});
		assertUsable(message);
		const parsed = parseJson(textOf(message));
		return {
			voice: {
				greetings: textField(parsed.greetings, 600),
				sign_offs: textField(parsed.sign_offs, 600),
				sentence_length: textField(parsed.sentence_length, 300),
				formality: textField(parsed.formality, 600),
				recurring_phrases: textField(parsed.recurring_phrases, 900),
				notes: textField(parsed.notes, 1200)
			},
			model: message.model,
			usage: usageOf(message)
		};
	} catch (err) {
		if (err instanceof AiError) throw err;
		throw toAiError(err);
	}
}

const COMMITMENT_SYSTEM = `You extract promises from one email thread.

Reply with JSON only, no prose, no code fence:
{"commitments":[{"owed_by":"paul|them","owed_to":"...","what":"...","due_signal":"..."}]}

A commitment is somebody saying they will do a specific thing. Not an
intention, not a suggestion, not a question about whether something could
happen.

what: the promise, in the words the message used.
due_signal: what the message said about timing, quoted. Leave it empty when
  no timing was given. NEVER supply a date the message did not state: a
  deadline invented here becomes a deadline Paul believes he agreed to.

Return an empty array when nothing was promised. Most threads promise
nothing, and an empty array is the correct answer far more often than not.

${CONTEXT_RULES}`;

export interface ExtractedCommitment {
	owed_by: 'paul' | 'them';
	owed_to: string;
	what: string;
	due_signal: string;
}

/** Haiku grade: runs on the same threads as the digest. */
export async function extractCommitments(
	apiKey: string,
	subject: string,
	messages: { from: string | null; sent_at: string; body: string }[]
): Promise<{ commitments: ExtractedCommitment[]; model: string; usage: Usage }> {
	const rendered = messages
		.map((m) => ['From: ' + (m.from ?? 'unknown'), 'Sent: ' + m.sent_at, '', m.body].join('\n'))
		.join('\n\n---\n\n');

	try {
		const message = await client(apiKey).messages.create({
			model: CHEAP_MODEL,
			max_tokens: 900,
			system: COMMITMENT_SYSTEM,
			messages: [{ role: 'user', content: 'Subject: ' + subject + '\n\n' + rendered }]
		});
		assertUsable(message);
		const parsed = parseJson(textOf(message));
		const raw = Array.isArray(parsed.commitments) ? parsed.commitments : [];

		const commitments: ExtractedCommitment[] = [];
		for (const item of raw) {
			const row = item as Record<string, unknown>;
			const what = textField(row.what, 600);
			// A commitment with no text is a row saying somebody promised something
			// and unable to say what. The database refuses it; so does this.
			if (!what) continue;
			const owedBy = String(row.owed_by ?? '').toLowerCase();
			if (owedBy !== 'paul' && owedBy !== 'them') continue;
			commitments.push({
				owed_by: owedBy,
				owed_to: textField(row.owed_to, 200),
				what,
				due_signal: textField(row.due_signal, 300)
			});
		}

		return { commitments, model: message.model, usage: usageOf(message) };
	} catch (err) {
		if (err instanceof AiError) throw err;
		throw toAiError(err);
	}
}
