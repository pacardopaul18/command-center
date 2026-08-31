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
		today,
		/** Print renders every section, because a filtered document is a lie. */
		filterable = true
	}: { type: ReportType; data: Record<string, any>; today: string; filterable?: boolean } = $props();

	/**
	 * Which section the reader has narrowed to, or null for all of them.
	 *
	 * Client side and deliberately not in the URL. The figures are already
	 * loaded, so this is a way of reading what is on screen rather than a
	 * different query, and putting it in the URL would imply the print view and
	 * a shared link inherit it. They do not: `filterable` is false there and
	 * every section renders.
	 */
	let active = $state<string | null>(null);

	function toggle(key: string) {
		if (!filterable) return;
		active = active === key ? null : key;
	}

	/** True when a section should render under the current selection. */
	function shown(key: string): boolean {
		return !filterable || active === null || active === key;
	}

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
			<!--
				A button only where it does something. On the print route the tiles
				are figures in a document, and a document should not contain
				controls: they would be announced as pressable to a screen reader
				and mean nothing on paper.
			-->
			<svelte:element
				this={filterable ? 'button' : 'div'}
				type={filterable ? 'button' : undefined}
				role={filterable ? 'button' : undefined}
				class="tile"
				class:alarm={Number(t.total_count) > 0}
				class:inert={!filterable}
				aria-pressed={filterable ? active === null : undefined}
				onclick={filterable ? () => (active = null) : undefined}
			>
				<span class="tile-value">{t.total_count}</span>
				<span class="tile-label">Items slipping</span>
			</svelte:element>
			{#each [['overdue_actions', 'Overdue actions'], ['overdue_invoices', 'Overdue invoices'], ['at_risk_projects', 'Projects at risk'], ['pending_proposals', 'Undecided proposals']] as [key, label] (key)}
				<svelte:element
					this={filterable ? 'button' : 'div'}
					type={filterable ? 'button' : undefined}
					role={filterable ? 'button' : undefined}
					class="tile"
					class:selected={active === key}
					class:inert={!filterable}
					aria-pressed={filterable ? active === key : undefined}
					onclick={filterable ? () => toggle(key) : undefined}
				>
					<span class="tile-value">{t[key]}</span>
					<span class="tile-label">{label}</span>
				</svelte:element>
			{/each}
		</div>

		{#if filterable && active}
			<p class="filtered" role="status">
				Showing one section. <button type="button" class="link" onclick={() => (active = null)}>
					Show everything
				</button>
			</p>
		{/if}

		{#if Number(t.total_count) === 0}
			<p class="empty">Nothing is overdue, at risk, or waiting on a decision.</p>
		{/if}

		{#if data.overdue_actions?.length && shown('overdue_actions')}
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

		{#if data.overdue_invoices?.length && shown('overdue_invoices')}
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

		{#if data.at_risk_projects?.length && shown('at_risk_projects')}
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

		{#if data.ambiguous_actions?.length && active === null}
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

		{#if data.pending_proposals?.length && shown('pending_proposals')}
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

	{:else if type === 'actions'}
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

	{:else if type === 'pnl'}
		{#if data.currencies?.length}
			<!--
				One block per currency, and no total across them. Adding dollars to
				pesos gives a number that looks finished and means nothing. D124.
			-->
			{#each data.currencies as c (c.currency)}
				<h2>{c.currency}</h2>
				<div class="scroll">
					<table>
						<tbody>
							<tr><th scope="row">Money in</th><td class="num mono">{formatMoney(c.income_cents)}</td></tr>
							<tr><th scope="row">Costs</th><td class="num mono">{formatMoney(c.expense_cents)}</td></tr>
							<tr><th scope="row">Overhead</th><td class="num mono">{formatMoney(c.overhead_cents)}</td></tr>
							<tr class="total">
								<th scope="row">Net</th>
								<td class="num mono" class:alarm={c.net_cents < 0}>{formatMoney(c.net_cents)}</td>
							</tr>
						</tbody>
					</table>
				</div>
				<p class="note">{c.entries} entries. Counted when money moved, not when invoiced.</p>
			{/each}
			{#if data.currencies.length > 1}
				<p class="note">
					Two currencies, so there is no single net. Each stands alone until this app
					knows a conversion rate, which it does not.
				</p>
			{/if}
		{:else}
			<p class="empty">
				{#if data.ledger_rows_total > 0}
					Nothing was recorded in this window. The ledger has {data.ledger_rows_total} entries
					outside it.
				{:else}
					The ledger has no entries yet. Add one from the Ledger page.
				{/if}
			</p>
		{/if}

	{:else if type === 'expenses'}
		{#if data.lines?.length}
			{#each data.totals as t (t.currency)}
				<h2>{t.currency} &middot; {formatMoney(t.amount_cents)}</h2>
				<div class="scroll">
					<table>
						<thead>
							<tr><th>Group</th><th>Category</th><th>Kind</th><th class="num">Amount</th><th class="num">Entries</th></tr>
						</thead>
						<tbody>
							{#each data.lines.filter((l: { currency: string }) => l.currency === t.currency) as line, i (line.group_name + line.category_name + i)}
								<tr>
									<td>{line.group_name}</td>
									<td>{line.category_name === line.group_name ? '' : line.category_name}</td>
									<td>{line.kind}</td>
									<td class="num mono">{formatMoney(line.amount_cents)}</td>
									<td class="num mono">{line.entries}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/each}
		{:else}
			<p class="empty">
				{#if data.ledger_rows_total > 0}
					No expenses in this window. The ledger has {data.ledger_rows_total} entries outside it.
				{:else}
					The ledger has no entries yet.
				{/if}
			</p>
		{/if}

	{:else if type === 'profitability'}
		<!--
			The gap is stated before the figures, not after. Labour is the largest
			cost in a services firm and it is not in these numbers, so a margin
			read without that caveat is read wrong.
		-->
		{#if data.labour?.no_rates_set}
			<p class="warn" role="status">
				Labour is not costed. No rate is set on any time entry or client, so the hours
				worked cannot be priced and are missing from every margin below. That is unknown,
				not zero. Set a default rate on a client to change it.
				{#if data.labour.uncosted_hours > 0}
					{data.labour.uncosted_hours} billable hours in this window are affected, across
					{data.labour.clients_affected} clients.
				{/if}
			</p>
		{:else if data.labour?.uncosted_entries > 0}
			<p class="warn" role="status">
				{data.labour.uncosted_hours} billable hours in this window have no rate, so they are
				missing from the margins below.
			</p>
		{/if}

		{#if data.lines?.length}
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th>Client</th><th>Currency</th>
							<th class="num">Received</th><th class="num">Costs booked</th><th class="num">Margin</th>
						</tr>
					</thead>
					<tbody>
						{#each data.lines as line, i (line.client_id + line.currency + i)}
							<tr>
								<td>{line.client_name}</td>
								<td class="mono">{line.currency}</td>
								<td class="num mono">{formatMoney(line.revenue_cents)}</td>
								<td class="num mono">{formatMoney(line.cost_cents)}</td>
								<td class="num mono" class:alarm={line.margin_cents < 0}>
									{formatMoney(line.margin_cents)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="note">
				Revenue is money received, not invoiced. Overhead is excluded: it belongs to the
				firm rather than to any one client.
			</p>
		{:else}
			<p class="empty">No client had ledger activity in this window.</p>
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
	.warn {
		margin: 0;
		padding: var(--space-3);
		border: 1px solid var(--gold);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
	}

	.note {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	tr.total th,
	tr.total td {
		font-weight: 700;
		border-top: 2px solid var(--border-strong);
	}

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

	/*
	 * Tiles are buttons that narrow the page to their own section. They stay
	 * visually tiles rather than becoming obvious controls, because the summary
	 * is the primary thing and the filtering is a convenience on top of it.
	 * `inert` is the print view, where they are neither pressable nor styled as
	 * though they were.
	 */
	.tile {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-4);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		background: var(--surface-card);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.tile.inert {
		cursor: default;
	}

	.tile:not(.inert):hover {
		border-color: var(--border-strong);
		background: var(--surface-hover);
	}

	.tile:focus-visible {
		outline: 2px solid var(--navy);
		outline-offset: 2px;
	}

	/* Selection is a border and a marker, never colour alone. D28. */
	.tile.selected {
		border-color: var(--navy);
		box-shadow: inset 3px 0 0 var(--navy);
	}

	.filtered {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.link {
		border: 0;
		padding: 0;
		background: none;
		font: inherit;
		color: var(--text-link);
		text-decoration: underline;
		cursor: pointer;
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
		font-weight: var(--weight-semibold);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		color: var(--text-body);
		white-space: nowrap;
		border-bottom: 2px solid var(--border-strong);
		background: var(--surface-row-alt);
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
		.tile.alarm,
		.tile.selected {
			background: none;
			border: 1px solid #999;
			box-shadow: none;
			padding: 8pt;
		}

		.filtered {
			display: none;
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
