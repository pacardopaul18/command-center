<script lang="ts">
	import { formatDayShort } from '$lib/format';
	import Card from '$lib/components/Card.svelte';
	import Select from '$lib/components/Select.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import { TICKET_STATUS_LABELS, TICKET_STATUS_TONE } from '$lib/types';
	import { TICKET_VIEWS, type TicketView } from './views';
	import type { PageData } from './$types';

	/**
	 * The work that is late, and somewhere to do something about it.
	 *
	 * This page did not exist. `/tickets/[id]` did, so a ticket could be opened
	 * if you already knew which one, and nothing listed them. Two hundred and
	 * forty-seven open tickets were past due, correct in the Projects API and
	 * reaching no reader on any screen, which is why the app spent a session
	 * telling Paul that nothing needed his attention.
	 *
	 * A count with nowhere to go is not a capability. This is the somewhere.
	 */

	let { data }: { data: PageData } = $props();

	const VIEW_LABELS: Record<TicketView, string> = {
		overdue: 'Overdue',
		due_today: 'Due today',
		open: 'Open',
		all: 'Everything'
	};

	function urlFor(next: Record<string, string | null>) {
		const params = new URLSearchParams();
		const merged: Record<string, string | null> = {
			view: data.view,
			assignee: data.assignee,
			project: data.projectId,
			...next
		};
		for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
		return `/tickets?${params}`;
	}

	/**
	 * How late, in days, counted in the working zone.
	 *
	 * Both sides are Mountain calendar dates, so this is date arithmetic and not
	 * an instant comparison. A ticket due yesterday is one day late wherever the
	 * reader happens to be sitting.
	 */
	function daysLate(due: string | null): number | null {
		if (!due) return null;
		const ms = Date.parse(`${data.today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`);
		return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
	}

	function lateness(days: number | null): string {
		if (days === null) return '';
		if (days <= 0) return 'today';
		if (days === 1) return '1 day';
		if (days < 31) return `${days} days`;
		if (days < 365) return `${Math.round(days / 30)} months`;
		return `${(days / 365).toFixed(1)} years`;
	}
</script>

<svelte:head><title>Tickets</title></svelte:head>

<header class="head">
	<div>
		<h1>Tickets</h1>
		<p class="lede">
			Work mirrored from Asana. Overdue first, because that is the question this page exists
			to answer.
		</p>
	</div>
</header>

<!--
	The views carry their sizes, so a tab that leads nowhere says so before it is
	pressed rather than after. D214.
-->
<nav class="tabs" aria-label="Views">
	{#each TICKET_VIEWS as view (view)}
		<a class="tab" class:current={data.view === view} href={urlFor({ view })}>
			{VIEW_LABELS[view]}
			<span class="tab-count mono">{data.views[view as keyof typeof data.views]}</span>
		</a>
	{/each}
</nav>

<Card
	title={VIEW_LABELS[data.view]}
	subtitle="{data.tickets.length.toLocaleString()} shown{data.assignee ? `, assigned to ${data.assignee}` : ''}"
>
	{#snippet actions()}
		<!--
			Whose work. Matched on the assignee string, because the mirror carries
			Asana display names and this app has no user row for them.
		-->
		<Select
			value={data.assignee}
			aria-label="Assignee"
			onchange={(e) => {
				const value = (e.currentTarget as HTMLSelectElement).value;
				window.location.href = urlFor({ assignee: value || null });
			}}
		>
			<option value="">Everyone</option>
			{#each data.assignees as person (person.assignee)}
				<option value={person.assignee}>{person.assignee} ({person.n})</option>
			{/each}
		</Select>
	{/snippet}

	{#if data.tickets.length === 0}
		<p class="empty">
			{#if data.views.all === 0}
				<!--
					Nothing mirrored is a different fact from nothing overdue, and
					this page must not congratulate somebody on an empty database.
				-->
				No tickets have been mirrored yet, so there is nothing to be late.
			{:else if data.view === 'overdue'}
				Nothing is overdue{data.assignee ? ` for ${data.assignee}` : ''}. Measured against
				{data.views.all.toLocaleString()} tickets.
			{:else}
				Nothing here.
			{/if}
		</p>
	{:else}
		<div class="scroller">
			<table>
				<thead>
					<tr>
						<th scope="col">Ticket</th>
						<th scope="col">Client</th>
						<th scope="col">Project</th>
						<th scope="col">Assignee</th>
						<th scope="col" class="num">Due</th>
						<th scope="col" class="num">Late by</th>
						<th scope="col">Status</th>
					</tr>
				</thead>
				<tbody>
					{#each data.tickets as ticket (ticket.id)}
						{@const late = daysLate(ticket.due_date)}
						<tr>
							<th scope="row">
								<a href="/tickets/{ticket.id}">{ticket.title}</a>
								{#if ticket.asana_section}
									<span class="section mono">{ticket.asana_section}</span>
								{/if}
							</th>
							<td>{ticket.client_name ?? ''}</td>
							<td>{ticket.project_name ?? ''}</td>
							<td>{ticket.assignee ?? ''}</td>
							<td class="num mono">{ticket.due_date ? formatDayShort(ticket.due_date) : ''}</td>
							<td class="num mono" class:bad={late !== null && late > 30}>
								{late !== null && late > 0 ? lateness(late) : ''}
							</td>
							<td>
								<StatusChip
									label={TICKET_STATUS_LABELS[ticket.status] ?? ticket.status}
									tone={TICKET_STATUS_TONE[ticket.status]}
								/>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</Card>

<style>
	.head {
		margin-bottom: var(--space-4);
	}

	h1 {
		margin: 0 0 var(--space-2);
	}

	.lede {
		margin: 0;
		max-width: 70ch;
		color: var(--text-secondary);
	}

	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}

	.tab {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		/* D22: 44px tap floor, and Paul reads this at 412. */
		min-height: var(--tap);
		padding: 0 var(--space-3);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-2);
		text-decoration: none;
		color: inherit;
		background: var(--surface-card);
	}

	.tab.current {
		border-color: var(--navy);
		font-weight: 600;
	}

	.tab-count {
		color: var(--text-secondary);
		font-size: var(--text-sm);
	}

	.empty {
		margin: 0;
		color: var(--text-secondary);
		max-width: 70ch;
	}

	/* Wide content scrolls inside its own box; the page never scrolls sideways. */
	.scroller {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}

	th,
	td {
		text-align: left;
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--border-thin);
		vertical-align: top;
	}

	thead th {
		color: var(--text-secondary);
		font-weight: 600;
		white-space: nowrap;
		border-bottom-width: 2px;
	}

	tbody th {
		font-weight: 600;
		min-width: 22ch;
	}

	.section {
		display: block;
		font-size: 0.6875rem;
		font-weight: 400;
		color: var(--text-secondary);
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	/* Marked, and not by colour alone: the number itself says how late. D22. */
	.bad {
		font-weight: 600;
		color: var(--red);
	}
</style>
