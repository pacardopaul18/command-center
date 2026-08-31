<script lang="ts">
	import { PERIOD_STATUS_LABELS, PERIOD_STATUS_TONE, nextPeriodStatus } from '$lib/types';
	import type { BillingPeriod, TimeEntry } from '$lib/types';
	import { formatDay, formatDayShort } from '$lib/format';
	import Button from './Button.svelte';
	import StatusChip from './StatusChip.svelte';

	/**
	 * One client's billing periods, and the hours inside them.
	 *
	 * The invoicing screen was rebuilt around the client and this moved into it
	 * rather than being deleted with the old page. Periods and time entries are
	 * the input to an invoice: deleting working software to match a mock is not a
	 * redesign. D144.
	 *
	 * Entries load when a period is opened rather than shipping with the list.
	 * At the volume the seed carries that is 3,200 entries across 320 periods,
	 * which would put the whole timesheet into every page load to save a request
	 * nobody makes until they ask.
	 */
	let {
		periods,
		entries,
		expanded,
		error = '',
		busy = false,
		onToggle,
		onAdvance
	}: {
		periods: BillingPeriod[];
		entries: Record<string, TimeEntry[]>;
		expanded: string | null;
		error?: string;
		busy?: boolean;
		onToggle: (periodId: string) => void;
		onAdvance: (period: BillingPeriod) => void;
	} = $props();
</script>

{#if periods.length === 0}
	<p class="empty">No billing periods for this client yet.</p>
{:else}
	<ul class="periods">
		{#each periods as period (period.id)}
			{@const next = nextPeriodStatus(period.status)}
			<li class="period">
				<div class="period-head">
					<div>
						<p class="period-dates mono">
							{formatDay(period.period_start)} to {formatDay(period.period_end)}
							{#if period.note}<span class="sep">·</span>{period.note}{/if}
						</p>
						<p class="period-stats mono">
							{period.entry_count ?? 0} entr{(period.entry_count ?? 0) === 1 ? 'y' : 'ies'}
							<span class="sep">·</span>{(period.billable_hours ?? 0).toFixed(2)} billable h
							<span class="sep">·</span>{(period.total_hours ?? 0).toFixed(2)} total h
							{#if period.invoice_number}
								<span class="sep">·</span>{period.invoice_number}
							{/if}
						</p>
					</div>
					<StatusChip
						tone={PERIOD_STATUS_TONE[period.status]}
						label={PERIOD_STATUS_LABELS[period.status]}
						size="sm"
					/>
				</div>

				<div class="period-actions">
					{#if (period.entry_count ?? 0) > 0}
						<Button
							variant="ghost"
							size="sm"
							aria-expanded={expanded === period.id}
							onclick={() => onToggle(period.id)}
						>
							{expanded === period.id
								? 'Hide time'
								: `Show ${period.entry_count} entr${(period.entry_count ?? 0) === 1 ? 'y' : 'ies'}`}
						</Button>
					{/if}
					{#if next}
						<Button variant="ghost" size="sm" disabled={busy} onclick={() => onAdvance(period)}>
							Mark {PERIOD_STATUS_LABELS[next].toLowerCase()}
						</Button>
					{/if}
				</div>

				{#if expanded === period.id}
					<div class="entries">
						{#if error}
							<p class="entries-note error" role="alert">{error}</p>
						{:else if (entries[period.id] ?? []).length === 0}
							<p class="entries-note">Loading time entries.</p>
						{:else}
							<!-- Wide on a phone, so it scrolls in its own box rather than
							     the page. D22. -->
							<div class="scroll-x">
								<table>
									<thead>
										<tr>
											<th scope="col">Date</th>
											<th scope="col">Description</th>
											<th scope="col">Project</th>
											<th scope="col" class="num">Hours</th>
											<th scope="col">Billable</th>
										</tr>
									</thead>
									<tbody>
										{#each entries[period.id] as entry (entry.id)}
											<tr>
												<td class="mono nowrap">{formatDayShort(entry.entry_date)}</td>
												<td>{entry.description ?? 'No description'}</td>
												<td class="muted">{entry.project_name ?? 'No project'}</td>
												<td class="num mono">{entry.hours.toFixed(2)}</td>
												<td>{entry.billable ? 'Billable' : 'Not billable'}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.periods {
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.period {
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
	}
	.period-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.period-dates,
	.period-stats {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.period-stats {
		margin-top: var(--space-1);
	}
	.period-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin-top: var(--space-2);
	}
	.entries {
		margin-top: var(--space-3);
		padding-top: var(--space-3);
		border-top: 1px solid var(--border-thin);
	}
	.entries-note {
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.entries-note.error {
		color: var(--text-alarm);
	}
	.scroll-x {
		overflow-x: auto;
	}
	.entries table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}
	.entries th,
	.entries td {
		padding: var(--space-2) var(--space-3);
		text-align: left;
		border-bottom: 1px solid var(--border-thin);
	}
	.empty {
		margin-top: var(--space-3);
		padding: var(--space-5) var(--space-4);
		text-align: center;
		color: var(--text-secondary);
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-md);
	}
	.sep {
		margin: 0 var(--space-1);
	}
	.muted {
		color: var(--text-secondary);
	}
	.num {
		text-align: right;
	}
	.nowrap {
		white-space: nowrap;
	}
</style>
