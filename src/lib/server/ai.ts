import Anthropic from '@anthropic-ai/sdk';
import { todayInWorkingZone, WORKING_TIME_ZONE } from './dates';

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

Write in plain markdown. Use short declarative sentences. No hype, no emoji, no
exclamation points, and never an em dash. Sentence case for headings.

Structure the summary as:

## What was decided
## What is still open
## Context worth keeping

Omit any section that has nothing in it rather than writing "none".

Report only what the transcript supports. Where a name, a number or a date is
unclear in the source, say it is unclear rather than picking the likely one.
Never invent a figure, a commitment or an attribution.`;

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
		const summary = textOf(message);
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

An action item is a commitment somebody made to do something. Discussion,
opinion, and background are not action items. If the transcript contains no
commitments, return an empty list rather than manufacturing one.

For each item:

- title: the commitment as one short imperative sentence.
- owner: exactly the name used in the transcript. If nobody was named, leave it
  empty and set ambiguous to true. Do not infer an owner from who was talking.
- deadline: only when a date was stated or follows unambiguously from a relative
  reference such as "by Friday". Leave it empty otherwise. Never guess a date.
- evidence: a short verbatim quote from the transcript.

Set ambiguous to true whenever the owner, the deadline, or the commitment itself
is unclear, and say what is unclear in ambiguity_note. Flagging is cheap and a
wrong owner or a wrong date is expensive. When in doubt, flag it.

Never use an em dash.`;

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
				title: title.slice(0, 300),
				context: typeof row.context === 'string' ? row.context.trim().slice(0, 4000) : '',
				owner,
				deadline,
				ambiguous,
				ambiguity_note: note || (missing.length > 0 ? missing.join(', ') : ''),
				evidence: typeof row.evidence === 'string' ? row.evidence.trim().slice(0, 2000) : ''
			});
		}

		return { items, model: message.model };
	} catch (err) {
		if (err instanceof AiError) throw err;
		throw toAiError(err);
	}
}
