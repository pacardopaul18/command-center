<script lang="ts">
	import { formatMoment } from '$lib/format';
	import Button from './Button.svelte';

	/**
	 * The calendars this account can see, each switched on one at a time.
	 *
	 * Nothing syncs by default. The list Google returns includes holidays, week
	 * numbers and anything anyone has ever shared, and pulling all of it would
	 * fill Paul's day view with things he did not ask to watch.
	 *
	 * A calendar someone shared with him appears here with an access role that
	 * is not owner, and that is the whole mechanism for watching a colleague's
	 * diary: they share it in Google, it shows up, he turns it on. No new
	 * permission, no request from this app.
	 */

	export interface CalendarRow {
		id: string;
		summary: string | null;
		description: string | null;
		access_role: string | null;
		is_primary: number;
		sync_enabled: number;
		last_synced_at: string | null;
		event_count: number;
	}

	let {
		calendars,
		busy = false,
		onRefresh,
		onToggle
	}: {
		calendars: CalendarRow[];
		busy?: boolean;
		onRefresh: () => void;
		onToggle: (calendar: CalendarRow, on: boolean) => void;
	} = $props();

	const mine = $derived(calendars.filter((c) => c.access_role === 'owner'));
	const shared = $derived(calendars.filter((c) => c.access_role !== 'owner'));
</script>

<div class="actions">
	<Button variant="secondary" size="sm" onclick={onRefresh} disabled={busy}>
		{busy ? 'Working...' : 'Find calendars'}
	</Button>
</div>

{#if calendars.length === 0}
	<p class="hint">No calendars found yet. Press Find calendars.</p>
{:else}
	{#each [{ title: 'Yours', rows: mine }, { title: 'Shared with you', rows: shared }] as group (group.title)}
		{#if group.rows.length > 0}
			<h3 class="sub-head">{group.title}</h3>
			<ul class="cals">
				{#each group.rows as cal (cal.id)}
					<li>
						<label>
							<input
								type="checkbox"
								checked={cal.sync_enabled === 1}
								disabled={busy}
								onchange={(e) => onToggle(cal, (e.currentTarget as HTMLInputElement).checked)}
							/>
							<span class="name">
								{cal.summary ?? 'Unnamed calendar'}
								{#if cal.is_primary === 1}<span class="tag">main</span>{/if}
								{#if cal.access_role && cal.access_role !== 'owner'}
									<span class="tag">{cal.access_role}</span>
								{/if}
							</span>
						</label>
						<span class="meta mono">
							{#if cal.sync_enabled === 1}
								{cal.event_count} event{cal.event_count === 1 ? '' : 's'}
								{#if cal.last_synced_at} &middot; read {formatMoment(cal.last_synced_at)}{/if}
							{:else}
								not synced
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	{/each}

	<p class="hint">
		Anyone who shares a calendar with you in Google appears here, and no extra permission
		is needed for it. Turning one off removes the events it put here, so nothing lingers
		in your day view that you stopped watching.
	</p>
{/if}

<style>
	.actions {
		margin-bottom: var(--space-3);
	}

	.sub-head {
		font-size: var(--text-sm);
		margin: var(--space-3) 0 var(--space-2);
	}

	.cals {
		list-style: none;
		margin: 0 0 var(--space-3);
		padding: 0;
	}

	.cals li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: baseline;
		justify-content: space-between;
		padding: var(--space-2) 0;
		border-top: 1px solid var(--border);
	}

	.cals label {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex: 1 1 200px;
		min-width: 0;
	}

	.name {
		overflow-wrap: anywhere;
	}

	.tag {
		display: inline-block;
		margin-left: var(--space-2);
		font-size: var(--text-xs);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0 6px;
		color: var(--text-secondary);
	}

	.meta {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		white-space: nowrap;
	}

	.hint {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		margin: 0 0 var(--space-3);
	}
</style>
