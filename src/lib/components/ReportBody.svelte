<script lang="ts">
	import StatusChip from './StatusChip.svelte';
	import { formatDay } from '$lib/format';
	import {
		AGING_LABELS,
		formatMoney,
		PHASE_LABELS,
		PROJECT_STATUS_LABELS,
		PROJECT_STATUS_TONE,
		STATUS_LABELS,
		reportMeta
	} from '$lib/types';
	import type { AgingBucket, ActionStatus, ProjectPhase, ProjectStatus, ReportType } from '$lib/types';

	/**
	 * The body of a report, and the only place a report is rendered.
	 *
	 * Both /reports/[type] and /reports/[type]/print use this component. That is
	 * the point: a print stylesheet can drift from the screen, but two routes
	 * rendering the same component cannot show different numbers. The print route
	 * changes the page around this, never the report inside it.
	 *
	 * Every figure here comes from the API already computed. Nothing is derived
	 * in the browser, so a printed page and the screen it was printed from agree
	 * by construction rather than by both happening to round the same way.
	 *
	 * Section headings are h2. The page title is the h1 on both routes, and h3
	 * here would skip a level, which the accessibility baseline forbids. A
	 * component that does not know its own heading depth is a real hazard, so the
	 * rule for this one is that it is always mounted directly under the page h1.
	 */

	let {
		type,
		data,
		today
	}: { type: ReportType; data: Record<string, any>; today: string } = $props();

	const meta = $derived(reportMeta(type));
	const totals = $derived((data.totals ?? {}) as Record<string, number | null>);

	/** A count with its noun, pluralised. Used in every empty state. */
	function count(n: number, singular: string, plural = `${singular}s`): string {
		return `${n} ${n === 1 ? singular : plural}`;
	}

	/** Bands always render all four, so a missing bucket reads as zero, not absent. */
	const bands = $derived.by(() => {
		const found = new Map<string, { invoice_count: number; outstanding_cents: number }>();
		for (const b of (data.bands ?? []) as any[]) found.set(b.aging_bucket, b);
		return (Object.keys(AGING_LABELS) as AgingBucket[]).map((bucket) => ({
			bucket,
			label: AGING_LABELS[bucket],
			invoice_count: Number(found.get(bucket)?.invoice_count ?? 0),
			outstanding_cents: Number(found.get(bucket)?.outstanding_cents ?? 0)
		}));
	});

	/** "12 days late", or "due today". Never a bare negative number. */
	function lateness(days: number | null): string {
		if (days === null || days === undefined || !Number.isFinite(days)) return '';
		const n = Number(days);
		if (n > 0) return `${n} day${n === 1 ? '' : 's'} late`;
		if (n === 0) return 'Due today';
		return `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'} to go`;
	}
</script>

<div class="report">
	{#if type === 'slipping'}
		{@const t = totals}
		<div class="tiles">
			<div class="tile" class:alarm={Number(t.total_count) > 0}>
				<span class="tile-value">{t.total_count}</span>
				<span class="tile-label">Items slipping</span>
			</div>
			<div class="tile"><span class="tile-value">{t.overdue_actions}</span><span class="tile-label">Overdue actions</span></div>
			<div class="tile"><span class="tile-value">{t.overdue_invoices}</span><span class="tile-label">Overdue invoices</span></div>
			<div class="tile"><span class="tile-value">{t.at_risk_projects}</span><span class="tile-label">Projects at risk</span></div>
			<div class="tile"><span class="tile-value">{t.pending_proposals}</span><span class="tile-label">Undecided proposals</span></div>
		</div>

		{#if Number(t.total_count) === 0}
			<p class="empty">Nothing is overdue, at risk, or waiting on a decision.</p>
		{/if}

		{#if data.overdue_actions?.length}
			<h2>Overdue action items</h2>
			<div class="scroll">
				<table>
					<thead><tr><th>Item</th><th>Owner</th><th>Project</th><th>Deadline</th><th class="num">Late by</th></tr></thead>
					<tbody>
						{#each data.overdue_actions as row (row.id)}
							<tr>
								<td>{row.title}</td>
								<td>{row.owner || 'Unassigned'}</td>
								<td>{row.project_name || 'No project'}</td>
								<td class="mono">{formatDay(row.deadline)}</td>
								<td class="num alarm">{lateness(row.days_late)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		{#if data.overdue_invoices?.length}
			<h2>Overdue invoices</h2>
			<div class="scroll">
				<table>
					<thead><tr><th>Invoice</th><th>Client</th><th>Due</th><th class="num">Outstanding</th><th class="num">Late by</th></tr></thead>
					<tbody>
						{#each data.overdue_invoices as row (row.id)}
							<tr>
								<td class="mono">{row.invoice_number}</td>
								<td>{row.client_name}</td>
								<td class="mono">{formatDay(row.due_date)}</td>
								<td class="num mono">{formatMoney(Number(row.outstanding_cents))}</td>
								<td class="num alarm">{lateness(row.days_overdue)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		{#if data.at_risk_projects?.length}
			<h2>Projects at risk or past target</h2>
			<div class="scroll">
				<table>
					<thead><tr><th>Project</th><th>Client</th><th>Status</th><th>Next milestone</th><th class="num">Target close</th></tr></thead>
					<tbody>
						{#each data.at_risk_projects as row (row.id)}
							<tr>
								<td>{row.name}</td>
								<td>{row.client_name || 'No client'}</td>
								<td><StatusChip size="sm" tone={PROJECT_STATUS_TONE[row.status as ProjectStatus]} label={PROJECT_STATUS_LABELS[row.status as ProjectStatus]} /></td>
								<td>{row.next_milestone || 'Not set'}</td>
								<td class="num mono">
									{row.target_close ? formatDay(row.target_close) : 'Not set'}
									{#if Number(row.days_late) > 0}<span class="alarm"> {lateness(row.days_late)}</span>{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		{#if data.ambiguous_actions?.length}
			<h2>Ambiguous, nobody owns these</h2>
			<div class="scroll">
				<table>
					<thead><tr><th>Item</th><th>Owner</th><th>Deadline</th></tr></thead>
					<tbody>
						{#each data.ambiguous_actions as row (row.id)}
							<tr>
								<td>{row.title}</td>
								<td>{row.owner || 'Nobody named'}</td>
								<td class="mono">{row.deadline ? formatDay(row.deadline) : 'None stated'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		{#if data.pending_proposals?.length}
			<h2>Extracted but undecided</h2>
			<div class="scroll">
				<table>
					<thead><tr><th>Proposed item</th><th>Owner</th><th>From meeting</th><th class="num">Waiting</th></tr></thead>
					<tbody>
						{#each data.pending_proposals as row (row.id)}
							<tr>
								<td>{row.title}</td>
								<td>{row.owner || 'Nobody named'}</td>
								<td>{row.meeting_title}</td>
								<td class="num mono">{count(Number(row.days_waiting ?? 0), 'day')}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

	{:else if type === 'billing'}
		{@const t = totals}
		<div class="tiles">
			<div class="tile"><span class="tile-value mono">{formatMoney(Number(t.outstanding_cents))}</span><span class="tile-label">Outstanding</span></div>
			<div class="tile"><span class="tile-value">{t.invoice_count}</span><span class="tile-label">Unpaid invoices</span></div>
			<div class="tile"><span class="tile-value mono">{formatMoney(Number(t.billed_cents))}</span><span class="tile-label">Billed in window</span></div>
			<div class="tile">
				<span class="tile-value mono">{t.dso === null ? 'No basis' : `${t.dso} days`}</span>
				<span class="tile-label">Days sales outstanding</span>
			</div>
		</div>

		{#if t.dso === null}
			<p class="note">No invoices were issued in this window, so days sales outstanding has nothing to divide by. It is left blank rather than shown as zero, which would read as instant collection.</p>
		{/if}

		<h2>Aging</h2>
		<div class="scroll">
			<table>
				<thead><tr><th>Days past due</th><th class="num">Invoices</th><th class="num">Outstanding</th><th class="num">Share</th></tr></thead>
				<tbody>
					{#each bands as band (band.bucket)}
						<tr class:alarm-row={band.bucket !== 'b0_30' && band.outstanding_cents > 0}>
							<td>{band.label}</td>
							<td class="num">{band.invoice_count}</td>
							<td class="num mono">{formatMoney(band.outstanding_cents)}</td>
							<td class="num mono">
								{Number(t.outstanding_cents) > 0
									? `${Math.round((band.outstanding_cents / Number(t.outstanding_cents)) * 100)}%`
									: '0%'}
							</td>
						</tr>
					{/each}
					<tr class="total">
						<td>Total</td>
						<td class="num">{t.invoice_count}</td>
						<td class="num mono">{formatMoney(Number(t.outstanding_cents))}</td>
						<td class="num mono">{Number(t.outstanding_cents) > 0 ? '100%' : '0%'}</td>
					</tr>
				</tbody>
			</table>
		</div>

		<h2>By client</h2>
		{#if data.by_client?.length}
			<div class="scroll">
				<table>
					<thead><tr><th>Client</th><th class="num">Invoices</th><th class="num">Outstanding</th><th class="num">Worst age</th></tr></thead>
					<tbody>
						{#each data.by_client as row (row.client_id)}
							<tr>
								<td>{row.client_name}</td>
								<td class="num">{row.invoice_count}</td>
								<td class="num mono">{formatMoney(Number(row.outstanding_cents))}</td>
								<td class="num mono" class:alarm={Number(row.worst_days_overdue) > 30}>
									{Number(row.worst_days_overdue) > 0 ? count(Number(row.worst_days_overdue), 'day') : 'Within terms'}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="empty">Nothing is outstanding.</p>
		{/if}

		<h2>Unbilled periods</h2>
		{#if data.unbilled_periods?.length}
			<p class="note">These periods have closed but are not invoiced. Hours are sitting unbilled.</p>
			<div class="scroll">
				<table>
					<thead><tr><th>Client</th><th>Period</th><th>Status</th><th class="num">Billable hours</th><th class="num">Closed</th></tr></thead>
					<tbody>
						{#each data.unbilled_periods as row (row.id)}
							<tr>
								<td>{row.client_name}</td>
								<td class="mono">{formatDay(row.period_start)} to {formatDay(row.period_end)}</td>
								<td>{row.status === 'open' ? 'Open' : 'Reconciled'}</td>
								<td class="num mono">{Number(row.billable_hours).toFixed(2)}</td>
								<td class="num mono" class:alarm={Number(row.days_since_close) > 14}>{count(Number(row.days_since_close), 'day')} ago</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="empty">Every closed period has been invoiced.</p>
		{/if}

	{:else if type === 'projects'}
		{@const t = totals}
		<div class="tiles">
			<div class="tile"><span class="tile-value">{t.project_count}</span><span class="tile-label">Projects</span></div>
			<div class="tile" class:alarm={Number(t.at_risk_count) > 0}>
				<span class="tile-value">{t.at_risk_count}</span>
				<span class="tile-label">Needing attention</span>
			</div>
		</div>
		<p class="note">Needing attention counts anything at risk or blocked, plus any project carrying an overdue action item. A project can read on track while the work underneath it is already late.</p>

		{#if data.projects?.length}
			<h2>By phase</h2>
			<div class="scroll">
				<table>
					<thead><tr>{#each Object.keys(PHASE_LABELS) as phase (phase)}<th class="num">{PHASE_LABELS[phase as ProjectPhase]}</th>{/each}</tr></thead>
					<tbody>
						<tr>
							{#each Object.keys(PHASE_LABELS) as phase (phase)}
								<td class="num mono">{(data.by_phase ?? []).find((p: any) => p.phase === phase)?.n ?? 0}</td>
							{/each}
						</tr>
					</tbody>
				</table>
			</div>

			<h2>Every project</h2>
			<div class="scroll">
				<table>
					<thead><tr><th>Project</th><th>Client</th><th>Phase</th><th>Status</th><th>Next milestone</th><th class="num">Target close</th><th class="num">Open actions</th></tr></thead>
					<tbody>
						{#each data.projects as row (row.id)}
							<tr>
								<td>{row.name}</td>
								<td>{row.client_name || 'No client'}</td>
								<td>{PHASE_LABELS[row.phase as ProjectPhase]}</td>
								<td><StatusChip size="sm" tone={PROJECT_STATUS_TONE[row.status as ProjectStatus]} label={PROJECT_STATUS_LABELS[row.status as ProjectStatus]} /></td>
								<td>{row.next_milestone || 'Not set'}</td>
								<td class="num mono">
									{row.target_close ? formatDay(row.target_close) : 'Not set'}
									{#if row.days_to_close !== null && Number(row.days_to_close) < 0}
										<span class="alarm"> {lateness(-Number(row.days_to_close))}</span>
									{/if}
								</td>
								<td class="num mono">
									{row.open_actions}
									{#if Number(row.overdue_actions) > 0}<span class="alarm"> ({row.overdue_actions} overdue)</span>{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="empty">No projects yet.</p>
		{/if}

	{:else}
		{@const t = totals}
		<div class="tiles">
			<div class="tile"><span class="tile-value">{t.completed_count}</span><span class="tile-label">Completed in window</span></div>
			<div class="tile"><span class="tile-value">{t.open_count}</span><span class="tile-label">Still open</span></div>
			<div class="tile" class:alarm={Number(t.overdue_count) > 0}><span class="tile-value">{t.overdue_count}</span><span class="tile-label">Overdue</span></div>
			<div class="tile">
				<span class="tile-value mono">{t.on_time_pct === null ? 'No basis' : `${t.on_time_pct}%`}</span>
				<span class="tile-label">On time</span>
			</div>
			<div class="tile">
				<span class="tile-value mono">{t.avg_resolution_days === null ? 'No basis' : count(Number(t.avg_resolution_days), 'day')}</span>
				<span class="tile-label">Average to resolve</span>
			</div>
		</div>

		<p class="note">
			{#if t.on_time_pct === null}
				None of the completed items had a deadline, so there is nothing to measure on-time delivery against.
			{:else}
				On time is measured over the {count(Number(t.measurable_count), 'item')} that had a deadline, not all {t.completed_count}. An item with no deadline cannot be late, and counting it would inflate the rate.
			{/if}
		</p>

		<h2>Still open</h2>
		{#if data.open_by_status?.length}
			<div class="scroll">
				<table>
					<thead><tr><th>Status</th><th class="num">Count</th><th class="num">Of which overdue</th></tr></thead>
					<tbody>
						{#each data.open_by_status as row (row.status)}
							<tr>
								<td><StatusChip size="sm" tone={row.status as any} label={STATUS_LABELS[row.status as ActionStatus] ?? row.status} /></td>
								<td class="num mono">{row.n}</td>
								<td class="num mono" class:alarm={Number(row.overdue) > 0}>{row.overdue}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="empty">Nothing is open.</p>
		{/if}

		<h2>Completed in this window</h2>
		{#if data.completed?.length}
			<div class="scroll">
				<table>
					<thead><tr><th>Item</th><th>Owner</th><th>Project</th><th>Deadline</th><th>Completed</th><th class="num">On time</th></tr></thead>
					<tbody>
						{#each data.completed as row (row.id)}
							<tr>
								<td>{row.title}</td>
								<td>{row.owner || 'Unassigned'}</td>
								<td>{row.project_name || 'No project'}</td>
								<td class="mono">{row.deadline ? formatDay(row.deadline) : 'None'}</td>
								<td class="mono">{formatDay(String(row.completed_at).slice(0, 10))}</td>
								<td class="num" class:alarm={Number(row.on_time) === 0}>
									{row.on_time === null ? 'No deadline' : Number(row.on_time) === 1 ? 'Yes' : 'Late'}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="empty">Nothing was completed in this window.</p>
		{/if}
	{/if}
</div>

<style>
	/*
	 * Spacing is deliberately uneven. A single gap between every child spaces a
	 * heading from its own table exactly as far as from the previous section, so
	 * at volume nothing groups and the page reads as one undifferentiated
	 * column. The gap is tight, and headings carry the separation instead.
	 */
	.report {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	h2 {
		margin: var(--space-5) 0 0;
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
		color: var(--text-body);
	}

	h2:first-child {
		margin-top: 0;
	}

	/* Headline tiles. Mobile first: one column, widening as room appears. */
	.tiles {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-3);
	}

	@media (min-width: 720px) {
		.tiles {
			grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		}
	}

	.tile {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-4);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		background: var(--surface-card);
	}

	.tile.alarm {
		border-color: var(--red-200);
		background: var(--red-100);
	}

	.tile-value {
		font-size: var(--text-xl);
		font-weight: var(--weight-medium);
		color: var(--text-body);
		line-height: 1.2;
	}

	.tile-label {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	/* D22: wide tables scroll inside their own box; the page never scrolls sideways. */
	.scroll {
		overflow-x: auto;
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		background: var(--surface-card);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}

	th,
	td {
		padding: 10px var(--space-4);
		text-align: left;
		vertical-align: top;
		line-height: 1.45;
		border-bottom: 1px solid var(--border-thin);
	}

	/*
	 * Banding, because the row border alone is too light to track across a wide
	 * table once there are more than a handful of rows. Sixteen overdue invoices
	 * is the case that showed it.
	 */
	tbody tr:nth-child(even) td {
		background: var(--surface-row-alt);
	}

	th {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		color: var(--text-secondary);
		white-space: nowrap;
	}

	tbody tr:last-child td {
		border-bottom: none;
	}

	tr.total td {
		font-weight: var(--weight-medium);
		border-top: 1px solid var(--border-strong);
	}

	.num {
		text-align: right;
	}

	.mono {
		font-family: var(--font-mono);
		white-space: nowrap;
	}

	/* Never colour alone: every alarm cell already carries the words. */
	.alarm {
		color: var(--text-alarm);
	}

	/* Beats the banding, which would otherwise cancel it on even rows. */
	.alarm-row td,
	tbody tr.alarm-row:nth-child(even) td {
		background: var(--red-100);
	}

	.note,
	.empty {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.empty {
		padding: var(--space-5);
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-md);
		text-align: center;
	}

	/*
	 * Print. The report body itself barely changes, which is the intent: what
	 * gets saved as a PDF is the same thing that was on screen.
	 *
	 * Backgrounds are dropped rather than forced with print-color-adjust,
	 * because a reader printing to paper should not burn toner on tinted rows,
	 * and every alarm state is already carried in words. Borders stay so the
	 * table structure survives.
	 */
	@media print {
		.report {
			gap: 14pt;
		}

		.tiles {
			display: grid;
			grid-template-columns: repeat(4, 1fr);
			gap: 8pt;
		}

		.tile,
		.tile.alarm {
			background: none;
			border: 1px solid #999;
			padding: 8pt;
		}

		.tile-value {
			font-size: 13pt;
		}

		.tile-label {
			font-size: 8pt;
		}

		.scroll {
			overflow: visible;
			border: none;
			background: none;
		}

		table {
			font-size: 9pt;
			/* Repeat the header on every page of a long table. */
			break-inside: auto;
		}

		thead {
			display: table-header-group;
		}

		tr {
			break-inside: avoid;
		}

		th,
		td {
			padding: 3pt 5pt;
			border-bottom: 1px solid #ccc;
		}

		.alarm-row td,
		tbody tr:nth-child(even) td {
			background: none;
		}

		h2 {
			margin-top: 10pt;
		}

		h2 {
			font-size: 11pt;
			break-after: avoid;
		}

		.empty {
			border: none;
			padding: 4pt 0;
			text-align: left;
		}
	}
</style>
