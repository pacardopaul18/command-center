import { TICKET_STATUSES } from './types';
import type { TicketStatus } from './types';

/**
 * What a section says about a task's status, when anybody has said.
 *
 * Pillar 2. Asana's real vocabulary for where a task is, at MacGray, is the
 * section it sits in, and there are 103 distinct names across 66 projects. The
 * projection has always refused to turn those into the app's six statuses,
 * because a rule that did so would be guessing the answer the reconciliation
 * exists to ask.
 *
 * This is the resolver for the crosswalk that replaces the guess. Every mapping
 * is somebody's decision, recorded with who made it and when. Nothing here
 * infers, matches loosely, normalises case, or falls back to a default, and
 * each of those is a deliberate refusal rather than an omission:
 *
 *   No inference        the whole point. A rule would produce a status for
 *                       every section including the 100 that carry none.
 *   No fuzzy matching   "Sales" and "Sales Ops" are different sections and a
 *                       near-match would silently apply one decision to both.
 *   No default bucket   an unmapped section is unmapped. Dropping it into
 *                       `open` would make 2,400 tasks claim a status nobody
 *                       assigned, and the screen would look complete.
 *
 * Precedence, and it is the only place it lives, the same shape as the client
 * crosswalk's chain in D181:
 *
 *   1. a mapping on this exact section gid
 *   2. a mapping on the verbatim section name
 *   3. unmapped
 */

/**
 * The statuses a section may be mapped to.
 *
 * `not_a_status` is one of them and is the interesting one. "Sales is a
 * business function and carries no status" is a decision; "nobody has looked at
 * Sales" is not. Collapsing them would lose the record that the question was
 * asked and would make the reconciliation impossible to finish.
 */
export const SECTION_MAPPINGS = [...TICKET_STATUSES, 'not_a_status'] as const;
export type SectionMapping = (typeof SECTION_MAPPINGS)[number];

export function isSectionMapping(value: unknown): value is SectionMapping {
	return typeof value === 'string' && (SECTION_MAPPINGS as readonly string[]).includes(value);
}

/** One row of the crosswalk, as stored. */
export interface SectionStatusRow {
	id: string;
	section_name: string | null;
	section_gid: string | null;
	status: SectionMapping;
	source: 'manual';
	mapped_by: string;
	mapped_at: string;
	note: string | null;
}

/** What the resolver answers. Never a bare status: the provenance travels with it. */
export interface SectionVerdict {
	/** The mapped status, or null when nothing maps this section. */
	status: TicketStatus | null;
	/** How the answer was reached, including when it was not reached. */
	via: 'section_gid' | 'section_name' | 'not_a_status' | 'unmapped';
	/** Who decided, and when. Null when nobody has. */
	mapped_by: string | null;
	mapped_at: string | null;
	note: string | null;
}

const UNMAPPED: SectionVerdict = {
	status: null,
	via: 'unmapped',
	mapped_by: null,
	mapped_at: null,
	note: null
};

/**
 * Resolves one section against the crosswalk.
 *
 * Takes the rows rather than a database, so it is pure and so the precedence
 * can be tested without one. The caller loads the table once and resolves many
 * sections against it; there are 103 names and 281 sections, so the whole
 * crosswalk fits in memory by a wide margin.
 */
export function resolveSection(
	section: { gid?: string | null; name?: string | null },
	rows: SectionStatusRow[]
): SectionVerdict {
	const byGid = section.gid
		? rows.find((r) => r.section_gid !== null && r.section_gid === section.gid)
		: undefined;
	const byName =
		!byGid && section.name
			? // Exact, including case. A section named "sales" is not the section
				// named "Sales" as far as this app is concerned, because Asana treats
				// them as two sections and so must the crosswalk.
				rows.find((r) => r.section_name !== null && r.section_name === section.name)
			: undefined;

	const hit = byGid ?? byName;
	if (!hit) return UNMAPPED;

	if (hit.status === 'not_a_status') {
		return {
			status: null,
			via: 'not_a_status',
			mapped_by: hit.mapped_by,
			mapped_at: hit.mapped_at,
			note: hit.note
		};
	}

	return {
		status: hit.status,
		via: byGid ? 'section_gid' : 'section_name',
		mapped_by: hit.mapped_by,
		mapped_at: hit.mapped_at,
		note: hit.note
	};
}

/**
 * How the verdict reads on a screen.
 *
 * Three outcomes and they must not look alike. An unmapped section and a
 * section somebody decided carries no status are both "no status", and telling
 * them apart is the whole reason the reconciliation can be finished. D220: a
 * correct absence that reads as a failure sends somebody looking for a bug.
 */
export function sectionLabel(verdict: SectionVerdict): string {
	if (verdict.via === 'unmapped') return 'Not mapped yet';
	if (verdict.via === 'not_a_status') return 'Carries no status';
	return verdict.status ?? 'Not mapped yet';
}

/** Counts for a screen that has to say how much of the reconciliation is done. */
export interface SectionProgress {
	sections: number;
	mapped_to_status: number;
	marked_no_status: number;
	unmapped: number;
	/** Null until at least one section exists, so an empty mirror says nothing. */
	decided_share: number | null;
}

export function sectionProgress(verdicts: SectionVerdict[]): SectionProgress {
	const sections = verdicts.length;
	const mapped = verdicts.filter((v) => v.via === 'section_gid' || v.via === 'section_name').length;
	const none = verdicts.filter((v) => v.via === 'not_a_status').length;
	return {
		sections,
		mapped_to_status: mapped,
		marked_no_status: none,
		unmapped: sections - mapped - none,
		// Null rather than zero on an empty mirror, so "nothing loaded" cannot
		// read as "nothing decided". D214.
		decided_share: sections > 0 ? (mapped + none) / sections : null
	};
}
