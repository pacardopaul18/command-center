/**
 * The house SOP shape.
 *
 * Every new SOP starts from this. It came out of SOP-001, the Plaud to Claude
 * to Asana meeting capture procedure, which was written against a real recorded
 * session and then reviewed for shape rather than for content. What survived
 * that review is here.
 *
 * WHY A TEMPLATE RATHER THAN A CONVENTION. A procedure written from a blank box
 * gets the parts its author was thinking about and misses the parts that only
 * matter when something has gone wrong. Every section below exists because its
 * absence has a cost:
 *
 *   Roles, with a deputy      A procedure with one named person is a procedure
 *                             that stops when that person is away. The deputy
 *                             is named up front, not found on the day.
 *   Timing on every step      "Then file it" is not a schedule. Without a
 *                             deadline per step, work that is merely late is
 *                             indistinguishable from work that was skipped.
 *   A check on every step     A step with no check cannot be verified, so
 *                             nobody can say whether it happened.
 *   Failure modes             The symptom is what somebody actually sees. A
 *                             table keyed on the symptom is findable at the
 *                             moment it is needed; prose about causes is not.
 *   Escalation                Says who to tell, so a repeated fault becomes a
 *                             pattern instead of a series of one-offs.
 *   Open questions            The things the procedure does not settle, written
 *                             down rather than left as an assumption the author
 *                             happened to make.
 *
 * PROPOSE, REVIEW, PUSH. Any step where this app or an automation produces work
 * for a person is written in those three parts from the outset. SOP-001's steps
 * 6 and 7 are the case: extraction proposes, a person reviews, and only then
 * does anything reach Asana. Written that way now, the app taking the work over
 * later reads as a change of tooling rather than a change of policy.
 */

/** The sections a SOP written to the house shape has, in order. */
export const SOP_SECTIONS = [
	'Purpose',
	'Scope',
	'Roles',
	'Prerequisites',
	'Procedure',
	'Verification log',
	'Failure modes',
	'Escalation',
	'Open questions'
] as const;

export type SopSection = (typeof SOP_SECTIONS)[number];

/**
 * The template body, as the rich text the editor stores.
 *
 * Written as HTML because that is what the field holds after P2. Square
 * brackets mark what has to be replaced; a SOP still carrying them is
 * unfinished, and `unfilledPlaceholders` below is how a screen can say so.
 */
export const SOP_TEMPLATE_HTML = [
	'<h1>Purpose</h1>',
	'<p>[What this procedure produces, and why it matters that it is done the same way each time.]</p>',

	'<h1>Scope</h1>',
	'<p>[What this covers. Say what it excludes as well: a boundary nobody wrote down is a boundary somebody will guess at.]</p>',

	'<h1>Roles</h1>',
	'<table>',
	'<tr><td>Role</td><td>Who</td><td>Deputy</td><td>Responsibility</td></tr>',
	'<tr><td>[Doer]</td><td>[Name]</td><td>[Name]</td><td>[What they do]</td></tr>',
	'<tr><td>[Verifier]</td><td>[Name]</td><td>[Name]</td><td>[What they check]</td></tr>',
	'<tr><td>Escalation</td><td>[Name]</td><td>[Name]</td><td>Faults and repeated failures</td></tr>',
	'<tr><td>Approver</td><td>[Name]</td><td>[Name]</td><td>Exceptions and changes to this SOP</td></tr>',
	'</table>',
	'<p>Every role carries a named deputy. A procedure that names one person is a procedure that stops when that person is away.</p>',

	'<h1>Prerequisites</h1>',
	'<ul><li>[Access, account or tool needed before step 1]</li><li>[The next one]</li></ul>',

	'<h1>Procedure</h1>',

	'<h2>Step 1: [What happens]</h2>',
	'<p><strong>When:</strong> [same day, next business morning, within one hour]</p>',
	'<p>[What the person does.]</p>',
	'<p><em>Check:</em> [what is true afterwards if this worked, stated so somebody else could confirm it]</p>',

	'<h2>Step 2: [What happens]</h2>',
	'<p><strong>When:</strong> [deadline]</p>',
	'<p>[What the person does.]</p>',
	'<p><em>Why this matters:</em> [only where the reason is not obvious from the step]</p>',
	'<p><em>Check:</em> [the observable outcome]</p>',

	'<h2>Step 3: [A step where something proposes work]</h2>',
	'<p><strong>When:</strong> [deadline]</p>',
	'<p><strong>Propose.</strong> [What produces the draft: a person, this app, or an automation.]</p>',
	'<p><strong>Review.</strong> [Who checks it, and what they are checking for.]</p>',
	'<p><strong>Push.</strong> [What happens to the approved result, and where it lands.]</p>',
	'<p><em>Check:</em> [the observable outcome]</p>',

	'<h1>Verification log</h1>',
	'<p>Verifications are recorded against this SOP in the app, not written here. Each entry names who verified, when, which step, and whether it passed. The fault rate is read off the same record, so how often the procedure fails is measurable rather than anecdotal.</p>',

	'<h1>Failure modes</h1>',
	'<table>',
	'<tr><td>Symptom</td><td>Likely cause</td><td>Action</td></tr>',
	'<tr><td>[What somebody actually sees]</td><td>[Why it happens]</td><td>[What to do about it]</td></tr>',
	'</table>',
	'<p>Keyed on the symptom, because the symptom is what the reader has when they come looking.</p>',

	'<h1>Escalation</h1>',
	'<p>[Who to tell, and what to tell them. Log what was observed, when, and which record, so a repeated fault is visible as a pattern rather than as a series of one-offs.]</p>',

	'<h1>Open questions</h1>',
	'<ol><li>[Something this procedure does not settle, for the approver to answer]</li></ol>',

	'<hr>',
	'<p><em>Draft. Nothing in this SOP is in force until [approver] approves it.</em></p>'
].join('');

/**
 * The placeholders still in a body.
 *
 * A SOP created from the template and saved half filled looks finished from the
 * list, and the square brackets are only visible to somebody who opens it. This
 * is what lets a screen say how much is left.
 */
export function unfilledPlaceholders(body: string | null | undefined): number {
	if (!body) return 0;
	return (body.match(/\[[^\]<>]{2,}\]/g) ?? []).length;
}

/** Whether a body still looks like the untouched template. */
export function isUnstartedTemplate(body: string | null | undefined): boolean {
	return unfilledPlaceholders(body) >= unfilledPlaceholders(SOP_TEMPLATE_HTML);
}
