/**
 * What makes a project active, written once.
 *
 * The dashboard said 37 active projects and the Projects page, one click away,
 * said 42 live. Both were right. The dashboard counted `status != 'done'` and
 * the page counted `archived = 0`, and five projects are live in Asana with
 * every ticket finished, so they are done by one definition and live by the
 * other.
 *
 * This is F15 again: two expressions for one concept, agreeing until the day
 * they do not, and disagreeing on two screens a reader moves between. The fix
 * is the same fix, which is that there is only one expression.
 *
 * ACTIVE MEANS NOT ARCHIVED. Archived is a decision somebody made in Asana;
 * `status` is derived from ticket completion and is a health signal, not an
 * existence one. A project whose work is finished but which nobody has archived
 * is still a live engagement, and calling it inactive would hide it from the
 * screen that exists to show what is going on.
 */

/**
 * SQL for an active project.
 *
 * Written as a correlated lookup rather than a join, so a caller can drop it
 * into a WHERE or a scalar subquery without restructuring its own query. The
 * archived flag lives on the mirror, never copied onto the project, because a
 * copy is a second answer that goes stale the next time somebody archives
 * something in Asana.
 */
export function activeProject(alias = 'p'): string {
	return `NOT EXISTS (
    SELECT 1 FROM asana_project_links apl
    JOIN asana_projects ap ON ap.gid = apl.asana_gid
    WHERE apl.project_id = ${alias}.id AND ap.archived = 1
  )`;
}

/** SQL for a project Asana calls archived. The complement, spelled once. */
export function archivedProject(alias = 'p'): string {
	return `EXISTS (
    SELECT 1 FROM asana_project_links apl
    JOIN asana_projects ap ON ap.gid = apl.asana_gid
    WHERE apl.project_id = ${alias}.id AND ap.archived = 1
  )`;
}

/**
 * SQL for a project worth worrying about.
 *
 * At risk or blocked, and active: an archived project cannot be at risk, and
 * counting one would put work nobody is doing onto the screen that says what
 * needs attention.
 */
export function projectNeedsAttention(alias = 'p'): string {
	return `${alias}.status IN ('at_risk', 'blocked') AND ${activeProject(alias)}`;
}
