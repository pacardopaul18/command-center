import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import type { AsanaSettings, AsanaTask } from './asana';
import { AsanaError, fetchTask, listChangedTasks, readSettings } from './asana';
import { nowUtc } from './dates';

/**
 * Two-way Asana sync, by polling.
 *
 * D68 excludes webhooks from lean entirely, so there is no callback surface and
 * nothing to authenticate. A poll asks Asana what changed and reconciles it.
 *
 * The whole design turns on one property of `modified_since`: it reports
 * presence, never absence. A task Asana no longer has does not appear in a
 * changed-tasks list, and neither does a task nobody touched. So a poll can
 * learn that something changed, and can never learn that something is gone.
 * That is why there are two passes here rather than one, and why the expensive
 * one does not run on every poll.
 */

/** KV key holding the moment the last poll covered up to. */
export const CURSOR_KEY = 'asana:sync:cursor';

/**
 * How long a link may go unconfirmed before the sweep re-checks it directly.
 *
 * A poll confirms a task only when it changed. A task nobody edits is never
 * confirmed by polling at all, so without this a deleted task could stay
 * silently linked forever.
 */
export const STALE_DAYS = 7;

/** The first poll looks back this far rather than over all of history. */
const FIRST_POLL_DAYS = 30;

export interface SyncOutcome {
	polled: number;
	matched: number;
	updated: number;
	ambiguous: number;
	swept: number;
	/** One line per item actually changed, in words rather than field names. */
	changes: string[];
	cursor: string;
}

interface LinkedItem {
	id: string;
	title: string;
	status: string;
	deadline: string | null;
	owner: string | null;
	asana_task_gid: string;
	asana_synced_at: string | null;
	updated_at: string;
}

function daysAgo(days: number): string {
	return new Date(Date.now() - days * 86_400_000).toISOString();
}

export interface Diff {
	/** Columns to write, empty when Asana and the item already agree. */
	sets: Record<string, string | null>;
	/** Why, in words, for the note and for the run report. */
	notes: string[];
}

/** The subset of an action item the reconciler needs to make its decision. */
export interface SyncableItem {
	title: string;
	status: string;
	deadline: string | null;
	owner: string | null;
}

/**
 * What a pulled task would change locally.
 *
 * Only genuine differences are returned, so an unchanged task writes nothing
 * and `updated_at` keeps meaning something.
 */
export function planUpdate(item: SyncableItem, task: AsanaTask): Diff {
	const sets: Record<string, string | null> = {};
	const notes: string[] = [];

	// Only completion crosses back, and only when it disagrees. An item can be
	// in_progress locally while Asana knows nothing but done and not-done, so
	// mapping not-done to 'open' unconditionally would undo Paul's own state on
	// every single run.
	if (task.completed && item.status !== 'done') {
		sets.status = 'done';
		sets.completed_at = task.completed_at ?? nowUtc();
		notes.push('marked done in Asana');
	} else if (!task.completed && item.status === 'done') {
		sets.status = 'open';
		sets.completed_at = null;
		notes.push('reopened in Asana');
	}

	if (task.due_on !== item.deadline) {
		sets.deadline = task.due_on;
		notes.push(
			task.due_on
				? 'due date now ' + task.due_on + (item.deadline ? ', was ' + item.deadline : '')
				: 'due date cleared, was ' + item.deadline
		);
	}

	if (task.name && task.name !== item.title) {
		// The old wording goes into the note rather than being dropped. A sync
		// that overwrites without saying what it overwrote is destroying work
		// quietly, which is the one thing it must never do.
		sets.title = task.name;
		notes.push('renamed in Asana, was "' + item.title + '"');
	}

	if (task.assignee_name && task.assignee_name !== item.owner) {
		sets.owner = task.assignee_name;
		notes.push('assigned to ' + task.assignee_name + (item.owner ? ', was ' + item.owner : ''));
	}

	return { sets, notes };
}

/** Records that Asana confirmed the link and the two agree. */
async function markConfirmed(db: D1Database, id: string, at: string): Promise<void> {
	await db
		.prepare(
			`UPDATE action_items
       SET asana_sync_state = 'ok', asana_sync_note = NULL, asana_synced_at = ?
       WHERE id = ?`
		)
		.bind(at, id)
		.run();
}

async function applyDiff(
	db: D1Database,
	item: LinkedItem,
	changes: Diff,
	at: string
): Promise<void> {
	const columns = Object.keys(changes.sets);
	const assignments = [
		...columns.map((c) => c + ' = ?'),
		'asana_sync_state = ?',
		'asana_sync_note = ?',
		'asana_synced_at = ?',
		'updated_at = ?'
	];
	await db
		.prepare(`UPDATE action_items SET ${assignments.join(', ')} WHERE id = ?`)
		.bind(...columns.map((c) => changes.sets[c]), 'ok', changes.notes.join('; '), at, at, item.id)
		.run();
}

/**
 * Marks a link ambiguous, per D69.
 *
 * Status is not touched and the gid is not cleared. Both are also enforced by
 * the database in migration 0009, so this function agreeing with the rule is a
 * convenience rather than the guarantee.
 */
async function markAmbiguous(
	db: D1Database,
	item: LinkedItem,
	why: string,
	at: string
): Promise<void> {
	await db
		.prepare(
			`UPDATE action_items
       SET asana_sync_state = 'ambiguous', asana_sync_note = ?, asana_synced_at = ?
       WHERE id = ?`
		)
		.bind(why, at, item.id)
		.run();
}

async function linkedItems(db: D1Database): Promise<LinkedItem[]> {
	const { results } = await db
		.prepare(
			`SELECT id, title, status, deadline, owner, asana_task_gid, asana_synced_at, updated_at
       FROM action_items WHERE asana_task_gid IS NOT NULL`
		)
		.all<LinkedItem>();
	return results ?? [];
}

/**
 * One sync run.
 *
 * Pass one polls what changed and reconciles it. Pass two sweeps links Asana
 * has not confirmed in `STALE_DAYS`, fetching each directly, because only a
 * direct fetch can tell a deleted task from an untouched one.
 *
 * The cursor advances only on success. A failed run leaves it where it was, so
 * the next run covers the same window again rather than stepping over changes
 * nobody saw. Same rule the digests follow with their sent marker: the record
 * of having done a thing is written after the thing succeeded.
 */
export async function syncFromAsana(
	db: D1Database,
	kv: KVNamespace,
	token: string,
	options: { sweep?: boolean } = {}
): Promise<SyncOutcome> {
	const settings: AsanaSettings = await readSettings(kv);
	if (!settings.workspace_gid) {
		throw new AsanaError(400, 'Choose an Asana workspace in Settings before syncing.');
	}

	const at = nowUtc();
	const since = (await kv.get(CURSOR_KEY)) ?? daysAgo(FIRST_POLL_DAYS);
	const items = await linkedItems(db);
	const byGid = new Map(items.map((i) => [i.asana_task_gid, i]));

	const outcome: SyncOutcome = {
		polled: 0,
		matched: 0,
		updated: 0,
		ambiguous: 0,
		swept: 0,
		changes: [],
		cursor: since
	};

	const tasks = await listChangedTasks(token, settings, since);
	outcome.polled = tasks.length;

	const confirmed = new Set<string>();
	for (const task of tasks) {
		const item = byGid.get(task.gid);
		// A task that changed in Asana but was never pushed from here is not an
		// error and not our business. Asana is a shared system and most of what
		// moves in it has nothing to do with this app.
		if (!item) continue;

		outcome.matched += 1;
		confirmed.add(task.gid);

		const changes = planUpdate(item, task);
		if (Object.keys(changes.sets).length === 0) {
			await markConfirmed(db, item.id, at);
			continue;
		}

		await applyDiff(db, item, changes, at);
		outcome.updated += 1;
		outcome.changes.push(item.title + ': ' + changes.notes.join('; '));
	}

	// Pass two. Only links Asana has not confirmed recently, so an ordinary poll
	// stays a single request.
	if (options.sweep !== false) {
		const cutoff = daysAgo(STALE_DAYS);
		const stale = items.filter(
			(i) => !confirmed.has(i.asana_task_gid) && (!i.asana_synced_at || i.asana_synced_at < cutoff)
		);

		for (const item of stale) {
			outcome.swept += 1;
			const task = await fetchTask(token, item.asana_task_gid);

			if (!task) {
				await markAmbiguous(
					db,
					item,
					'Asana no longer has task ' +
						item.asana_task_gid +
						'. It may have been deleted. This item, its status and its link are untouched.',
					at
				);
				outcome.ambiguous += 1;
				outcome.changes.push(item.title + ': marked ambiguous, Asana no longer has the task');
				continue;
			}

			const changes = planUpdate(item, task);
			if (Object.keys(changes.sets).length === 0) {
				await markConfirmed(db, item.id, at);
				continue;
			}
			await applyDiff(db, item, changes, at);
			outcome.updated += 1;
			outcome.changes.push(item.title + ': ' + changes.notes.join('; '));
		}
	}

	await kv.put(CURSOR_KEY, at);
	outcome.cursor = at;
	return outcome;
}
