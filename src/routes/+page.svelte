<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { STATUS_LABELS, formatMoney } from '$lib/types';
	import type { ActionItem } from '$lib/types';
	import { deadlineLabel, formatDay } from '$lib/format';
	import { apiWrite } from '$lib/http';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import type { PageData } from './$types';
	import type { InvoiceAlert, TodayMeeting } from './+page';

	/**
	 * The dashboard.
	 *
	 * Designed for the week Paul actually starts with, which has almost nothing
	 * in it, rather than for the seed. A screen that only reads well once it is
	 * full is a screen that is wrong on day one and right on day ninety, and day
	 * one is the one that decides whether it gets opened again. So every card
	 * states what it would say when empty, and the empty state is a sentence
	 * rather than a blank.
	 *
	 * Cards show a few rows and name the true count beside them. A card is a
	 * glance; the module behind it owns the full list, and every card links
	 * there. The API caps its own rows for the same reason: the old cockpit
	 * returned all 816 overdue items to draw a list of five.
	 */

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');

	const attention = $derived([...data.overdue, ...data.due_today]);
	const attentionCount = $derived(data.counts.overdue + data.counts.due_today);

	/** The one sentence at the top. It has to be true on an empty day too. */
	const headline = $derived.by(() => {
		if (data.counts.overdue > 0) {
			return `${data.counts.overdue} overdue. Start there.`;
		}
		if (data.counts.due_today > 0) {
			return `Nothing overdue. ${data.counts.due_today} due today.`;
		}
		if (data.counts.week > 0) {
			return `Nothing overdue, nothing due today. ${data.counts.week} due this week.`;
		}
		return 'Nothing overdue and nothing due. A clear board.';
	});

	async function markDone(item: ActionItem) {
		busy = true;
		errorMessage = '';
		const result = await apiWrite(`/api/action-items/${item.id}`, 'PATCH', { status: 'done' });
		if (!result.ok) {
			errorMessage = result.error ?? 'Could not update the item.';
		} else {
			await invalidateAll();
			notice = 'Marked done.';
		}
		busy = false;
	}

	function meetingMeta(m: TodayMeeting): string {
		const bits = [m.client_name ?? 'No client'];
		if (m.pending_proposals > 0) {
			bits.push(`${m.pending_proposals} to review`);
		}
		if (m.open_follow_ups > 0) bits.push(`${m.open_follow_ups} open`);
		return bits.join(', ');
	}

	function invoiceMeta(inv: InvoiceAlert): string {
		return `${formatMoney(inv.outstanding_cents)}, ${inv.days_overdue} day${inv.days_overdue === 1 ? '' : 's'} past due`;
	}
</script>

<svelte:head><title>Dashboard | Command Center</title></svelte:head>

<header class="head">
	<div>
		<h1>Dashboard</h1>
		<p class="sub">{headline}</p>
	</div>
	<p class="date mono">{formatDay(data.today)}</p>
</header>

{#if notice}<p class="status-line" role="status" aria-live="polite">{notice}</p>{/if}
{#if errorMessage}<p class="error-banner" role="alert">{errorMessage}</p>{/if}

<!--
	Four numbers that answer "is anything on fire". Each is a link, because a
	number you cannot act on is decoration.
-->
<div class="tiles">
	<a class="tile" class:alarm={data.counts.overdue > 0} href="/actions?view=overdue">
		<span class="tile-value">{data.counts.overdue}</span>
		<span class="tile-label">Overdue</span>
	</a>
	<a class="tile" href="/actions?view=today">
		<span class="tile-value">{data.counts.due_today}</span>
		<span class="tile-label">Due today</span>
	</a>
	<a class="tile" href="/reports/slipping">
		<span class="tile-value">{data.counts.awaiting_decision}</span>
		<span class="tile-label">Awaiting a decision</span>
	</a>
	<a class="tile" class:alarm={data.counts.past_due_cents > 0} href="/invoices">
		<!--
			"None" rather than 0.00. A zero formatted as money reads as an amount
			at a glance, and on the one screen meant to be read at a glance the
			difference between "no money is late" and "0.00 is late" matters.
		-->
		<span class="tile-value" class:mono={data.counts.past_due_cents > 0}>
			{data.counts.past_due_cents > 0 ? formatMoney(data.counts.past_due_cents) : 'None'}
		</span>
		<span class="tile-label">Past due</span>
	</a>
</div>

<div class="bands">
	<Card title="Needs you now" subtitle={attentionCount > attention.length ? `Showing ${attention.length} of ${attentionCount}` : undefined} padded={false}>
		{#snippet actions()}
			<Button href="/actions?view=overdue" variant="ghost" size="sm">Open tracker</Button>
		{/snippet}

		{#if attention.length === 0}
			<p class="empty">Nothing is overdue and nothing is due today.</p>
		{:else}
			<ul class="rows">
				{#each attention as item (item.id)}
					{@const due = deadlineLabel(item.deadline, data.today, item.status)}
					<li class="row" class:flag={due.tone === 'overdue'}>
						<button
							type="button"
							class="check"
							onclick={() => markDone(item)}
							disabled={busy}
							title="Mark done"
						>
							<span class="box" aria-hidden="true"></span>
							<span class="visually-hidden">Mark done: {item.title}</span>
						</button>
						<a class="body" href="/actions?view=open&q={encodeURIComponent(item.title)}">
							<span class="title">{item.title}</span>
							<span class="meta mono">
								{due.date}{item.owner ? `, ${item.owner}` : ''}{item.project_name
									? `, ${item.project_name}`
									: ''}
							</span>
						</a>
						<StatusChip
							tone={due.tone === 'overdue' ? 'overdue' : item.status}
							label={due.tone === 'overdue' ? 'Overdue' : STATUS_LABELS[item.status]}
							size="sm"
						/>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>

	<Card title="Today's meetings" padded={false}>
		{#snippet actions()}
			<Button href="/meetings" variant="ghost" size="sm">Meetings log</Button>
		{/snippet}

		{#if data.meetings.length === 0}
			<p class="empty">No meetings are dated today.</p>
		{:else}
			<ul class="rows">
				{#each data.meetings as m (m.id)}
					<li class="row" class:flag={m.pending_proposals > 0}>
						<a class="body indent" href="/meetings/{m.id}">
							<span class="title">{m.title}</span>
							<span class="meta mono">{meetingMeta(m)}</span>
						</a>
						{#if m.pending_proposals > 0}
							<StatusChip tone="atrisk" label="To review" size="sm" />
						{:else if m.has_summary && !m.summary_reviewed_at}
							<StatusChip tone="waiting" label="Unreviewed" size="sm" />
						{:else if m.has_summary}
							<StatusChip tone="done" label="Reviewed" size="sm" />
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</Card>

	<Card
		title="The week ahead"
		subtitle={data.counts.week > data.week.length
			? `Showing ${data.week.length} of ${data.counts.week}`
			: undefined}
		padded={false}
	>
		{#snippet actions()}
			<Button href="/actions?view=open" variant="ghost" size="sm">Open tracker</Button>
		{/snippet}

		{#if data.week.length === 0}
			<p class="empty">Nothing falls due in the next {data.soon_days} days.</p>
		{:else}
			<ul class="rows">
				{#each data.week as item (item.id)}
					<li class="row">
						<a class="body indent" href="/actions?view=open&q={encodeURIComponent(item.title)}">
							<span class="title">{item.title}</span>
							<span class="meta mono">
								{formatDay(item.deadline!)}{item.owner ? `, ${item.owner}` : ''}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>

	<Card
		title="Money past due"
		subtitle={data.counts.invoice_alerts > data.invoice_alerts.length
			? `Showing ${data.invoice_alerts.length} of ${data.counts.invoice_alerts}`
			: undefined}
		padded={false}
	>
		{#snippet actions()}
			<Button href="/invoices" variant="ghost" size="sm">Invoicing</Button>
		{/snippet}

		{#if data.invoice_alerts.length === 0}
			<p class="empty">No invoice is past its due date.</p>
		{:else}
			<ul class="rows">
				{#each data.invoice_alerts as inv (inv.id)}
					<li class="row" class:flag={inv.aging_bucket !== 'b0_30'}>
						<a class="body indent" href="/invoices">
							<span class="title">{inv.client_name} {inv.invoice_number}</span>
							<span class="meta mono">{invoiceMeta(inv)}</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>

	<Card title="Finished today" padded={false}>
		{#if data.finished.length === 0}
			<p class="empty">Nothing closed yet today.</p>
		{:else}
			<ul class="rows">
				{#each data.finished as item (item.title)}
					<li class="row done">
						<span class="body indent">
							<span class="title">{item.title}</span>
							{#if item.project_name}<span class="meta mono">{item.project_name}</span>{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>

	<Card title="What will slip" padded={false}>
		{#snippet actions()}
			<Button href="/reports/slipping" variant="ghost" size="sm">Full report</Button>
		{/snippet}

		{#if data.slipping.length === 0}
			<p class="empty">
				Nothing is stalled, blocked or waiting on a decision.
			</p>
		{:else}
			<ul class="rows">
				{#each data.slipping as item (item.id)}
					<li class="row" class:flag={item.reason !== 'due_soon'}>
						<a class="body indent" href="/actions?view=open&q={encodeURIComponent(item.title)}">
							<span class="title">{item.title}</span>
							<span class="meta mono">{item.owner ?? 'Unassigned'}</span>
						</a>
						<StatusChip
							tone={item.reason === 'due_soon'
								? 'atrisk'
								: item.reason === 'stalled'
									? 'waiting'
									: item.reason}
							label={item.reason === 'due_soon'
								? 'Due soon'
								: item.reason === 'stalled'
									? 'Stalled'
									: item.reason === 'blocked'
										? 'Blocked'
										: 'Ambiguous'}
							size="sm"
						/>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>
</div>

<p class="footnote">
	{data.totals.open} open in total.
	{#if data.totals.done_today > 0}
		{data.totals.done_today} finished today.
	{/if}
	Stalled means a waiting item untouched for {data.stale_days} days.
</p>

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.head h1 {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: var(--weight-medium);
	}

	.sub {
		margin: var(--space-1) 0 0;
		color: var(--text-secondary);
		font-size: var(--text-sm);
	}

	.date {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.status-line,
	.error-banner {
		margin: var(--space-3) 0 0;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
	}

	.status-line {
		background: var(--green-100);
		color: var(--green-700);
	}

	.error-banner {
		background: var(--red-100);
		color: var(--red);
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-3);
		margin-top: var(--space-4);
	}

	@media (min-width: 720px) {
		.tiles {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	.tile {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		padding: var(--space-4);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		background: var(--surface-card);
		color: inherit;
		text-decoration: none;
	}

	.tile:hover {
		border-color: var(--border-strong);
		background: var(--surface-hover);
	}

	.tile:focus-visible {
		outline: 2px solid var(--navy);
		outline-offset: 2px;
	}

	.tile.alarm {
		border-color: var(--red-200);
		background: var(--red-100);
	}

	.tile-value {
		font-size: var(--text-xl);
		font-weight: var(--weight-semibold);
		line-height: 1.15;
		overflow-wrap: anywhere;
	}

	.tile-label {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.bands {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-4);
		margin-top: var(--space-4);
	}

	/* Grid tracks default to their content's width, which lets a long title drag
	   the page sideways. See the note in the cockpit's history. */
	.bands > :global(*) {
		min-width: 0;
	}

	@media (min-width: 960px) {
		.bands {
			grid-template-columns: 1fr 1fr;
			align-items: start;
		}
	}

	.rows {
		list-style: none;
		margin: 0;
		padding: var(--space-2);
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2);
		border-left: 2px solid transparent;
		border-radius: var(--radius-sm);
	}

	.row.flag {
		border-left-color: var(--gold);
		background: var(--gold-50);
	}

	.row.done .title {
		color: var(--text-secondary);
	}

	.check {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--tap);
		height: var(--tap);
		border: 0;
		background: none;
		cursor: pointer;
	}

	.box {
		width: 18px;
		height: 18px;
		border: 1.5px solid var(--border-control);
		border-radius: 4px;
	}

	.check:hover .box {
		border-color: var(--navy);
	}

	.check:focus-visible {
		outline: 2px solid var(--navy);
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}

	.body {
		flex: 1;
		min-width: 0;
		display: block;
		color: inherit;
		text-decoration: none;
	}

	.body.indent {
		padding-left: var(--space-2);
	}

	.title {
		display: block;
		overflow-wrap: anywhere;
	}

	.meta {
		display: block;
		margin-top: 2px;
		font-size: var(--text-xs);
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}

	@media (min-width: 720px) {
		.title,
		.meta {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}

	.empty {
		margin: 0;
		padding: var(--space-4);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.footnote {
		margin-top: var(--space-5);
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
</style>
