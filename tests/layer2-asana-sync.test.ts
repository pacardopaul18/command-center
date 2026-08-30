import { describe, expect, it } from 'vitest';
import { planUpdate, type SyncableItem } from '../src/lib/server/asana-sync';
import type { AsanaTask } from '../src/lib/server/asana';

/**
 * The reconciler's decisions, tested directly.
 *
 * Everything the sync judges lives in `planUpdate`. The rest of the module is
 * fetching and writing, which the API tests cover. Pulling the decision out as
 * a pure function is what makes it testable without an Asana token, and the
 * cases below are the ones that would be expensive to discover in production:
 * a sync that quietly undoes local state, or overwrites a title with no record
 * of what it replaced.
 */

function item(over: Partial<SyncableItem> = {}): SyncableItem {
	return { title: 'Draft the scope note', status: 'open', deadline: '2026-09-04', owner: 'Paul', ...over };
}

function task(over: Partial<AsanaTask> = {}): AsanaTask {
	return {
		gid: '123',
		name: 'Draft the scope note',
		completed: false,
		completed_at: null,
		due_on: '2026-09-04',
		modified_at: '2026-08-30T10:00:00.000Z',
		assignee_name: 'Paul',
		permalink_url: null,
		...over
	};
}

describe('layer 2: the Asana reconciler', () => {
	it('writes nothing when the two already agree', () => {
		const plan = planUpdate(item(), task());
		expect(Object.keys(plan.sets)).toHaveLength(0);
		expect(plan.notes).toHaveLength(0);
	});

	it('pulls a completion back and records when it happened', () => {
		const plan = planUpdate(item(), task({ completed: true, completed_at: '2026-08-29T21:00:00.000Z' }));
		expect(plan.sets.status).toBe('done');
		expect(plan.sets.completed_at).toBe('2026-08-29T21:00:00.000Z');
		expect(plan.notes.join(' ')).toMatch(/marked done in Asana/);
	});

	it('reopens locally when Asana reopens, and clears the completion time', () => {
		const plan = planUpdate(item({ status: 'done' }), task({ completed: false }));
		expect(plan.sets.status).toBe('open');
		expect(plan.sets.completed_at).toBeNull();
	});

	it('leaves in_progress alone, because Asana cannot express it', () => {
		// The failure this prevents: Asana knows only done and not-done, so
		// mapping not-done to 'open' would reset Paul's in_progress on every
		// single poll. Nobody would report that as a bug; they would just stop
		// trusting the status field.
		const plan = planUpdate(item({ status: 'in_progress' }), task({ completed: false }));
		expect(plan.sets.status).toBeUndefined();
	});

	it('carries a due date change and says what it was', () => {
		const plan = planUpdate(item(), task({ due_on: '2026-09-11' }));
		expect(plan.sets.deadline).toBe('2026-09-11');
		expect(plan.notes.join(' ')).toContain('2026-09-04');
	});

	it('carries a cleared due date, which is a real change and not a missing field', () => {
		const plan = planUpdate(item(), task({ due_on: null }));
		expect(plan.sets.deadline).toBeNull();
		expect(plan.notes.join(' ')).toMatch(/cleared/);
	});

	it('keeps the old wording when a rename overwrites it', () => {
		const plan = planUpdate(item(), task({ name: 'Draft the scope note v2' }));
		expect(plan.sets.title).toBe('Draft the scope note v2');
		// A sync may overwrite. It may not overwrite silently.
		expect(plan.notes.join(' ')).toContain('Draft the scope note');
	});

	it('ignores an empty name rather than blanking the title', () => {
		// An absent opt_field comes back empty, which is indistinguishable from a
		// cleared one. Asana will not accept a task with no name, so empty here
		// always means "not returned", and treating it as a value would erase
		// the title over a query mistake.
		const plan = planUpdate(item(), task({ name: '' }));
		expect(plan.sets.title).toBeUndefined();
	});

	it('carries an assignee change and says who it was', () => {
		const plan = planUpdate(item(), task({ assignee_name: 'Sam' }));
		expect(plan.sets.owner).toBe('Sam');
		expect(plan.notes.join(' ')).toContain('Paul');
	});

	it('does not unassign locally when Asana returns no assignee', () => {
		const plan = planUpdate(item(), task({ assignee_name: null }));
		expect(plan.sets.owner).toBeUndefined();
	});

	it('reports several changes at once, each in its own words', () => {
		const plan = planUpdate(
			item(),
			task({ completed: true, completed_at: '2026-08-30T00:00:00.000Z', due_on: '2026-09-20', assignee_name: 'Sam' })
		);
		expect(Object.keys(plan.sets).sort()).toEqual(['completed_at', 'deadline', 'owner', 'status']);
		expect(plan.notes).toHaveLength(3);
	});
});
