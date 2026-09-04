<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { STATUS_LABELS, formatUsd } from '$lib/types';
	import type { ActionItem } from '$lib/types';
	import { deadlineLabel, formatDay, formatDayShort } from '$lib/format';
	import { apiWrite } from '$lib/http';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import type { PageData } from './$types';
	import type { DashboardProject, DashboardThread, DashboardTicket, InvoiceAlert, TodayMeeting } from './+page';

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
	 *
	 * The redesign adds three cards, Projects, Open tickets and Mail needing
	 * you, and takes the tiles from four to six. Two things it draws are not
	 * built and are not faked:
	 *
	 *   The prototype shows a ticket reference like T-118. Tickets have no human
	 *   number in this schema, and a truncated uuid dressed up as one is noise
	 *   with a false promise attached, so the row leads with its title.
	 *
	 *   It shows an SLA countdown. There is no SLA clock stored anywhere. A due
	 *   date that has arrived is what "breaching" means here, and the date is
	 *   what the row shows. D27.
	 */

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');

	/**
	 * Overdue and due today, merged and capped as one card.
	 *
	 * The API caps each list separately, so concatenating them gave this card
	 * twice the rows of every other one, which is not a glance. Overdue comes
	 * first because it is worse, and the cap falls on whatever is left.
	 */
	const attention = $derived(
		[...data.overdue, ...data.due_today].slice(0, data.card_limit)
	);
	const attentionCount = $derived(
		data.counts.overdue_action_items + data.counts.due_today_action_items
	);

	/** The one sentence at the top. It has to be true on an empty day too. */
	const headline = $derived.by(() => {
		if (data.counts.tickets_overdue > 0) {
			return `${data.counts.tickets_overdue} overdue tickets. Start there, then the projects at risk.`;
		}
		if (data.counts.due_today_action_items > 0) {
			return `Nothing overdue. ${data.counts.due_today_action_items} action items due today.`;
		}
		if (data.counts.week > 0) {
			return `Nothing overdue, nothing due today. ${data.counts.week} due this week.`;
		}
		return 'Nothing overdue and nothing due. A clear board.';
	});

	/**
	 * The six numbers that answer "is anything on fire".
	 *
	 * Each carries a subline, because a number on its own says how much and the
	 * subline says how bad. Each is a link: a number you cannot act on is
	 * decoration.
	 */
	/*
	 * A zero with nothing behind it is not the same as a zero.
	 *
	 * "0 overdue" is good news. "0 overdue because no action item has ever been
	 * loaded" is a gap, and the tile said the same thing for both. On the real
	 * data right now three of these stores are empty and two are full, on one
	 * screen, with no way to tell which was which.
	 *
	 * So a tile whose source holds nothing says so instead of showing a number
	 * it cannot stand behind. D138 on a dashboard.
	 */
	const NOT_LOADED = 'no data yet';

	function tile(
		hasSource: boolean,
		value: string,
		sub: string
	): { value: string; sub: string; muted: boolean } {
		return hasSource ? { value, sub, muted: false } : { value: '—', sub: NOT_LOADED, muted: true };
	}

	const tiles = $derived([
		/*
		 * Two populations, two lines, two captions. D236 and D238.
		 *
		 * "Overdue items" counted action items only, and action items are empty
		 * until Paul accepts a proposal, so the tile read zero while 247 tickets
		 * were past due. A true figure over a population that cannot yet be
		 * non-empty, under a caption he reads as "your work".
		 *
		 * The action-items line stays, because zero accepted against a pending
		 * queue is exactly the number that says the queue has never been worked.
		 * It now says which population it counts.
		 */
		{
			label: 'Overdue tickets',
			...tile(
				data.sources.tickets,
				String(data.counts.tickets_overdue),
				`${data.counts.tickets_due_today} due today`
			),
			href: '/tickets?view=overdue',
			// Never alarm on a store this app has nothing from: an empty mirror
			// would otherwise raise a red zero. D214, and the guard caught this.
			alarm: data.sources.tickets && data.counts.tickets_overdue > 0
		},
		{
			label: 'Overdue action items',
			...tile(
				data.sources.action_items,
				String(data.counts.overdue_action_items),
				data.oldest_overdue ? `oldest ${formatDayShort(data.oldest_overdue)}` : 'none accepted yet'
			),
			href: '/actions?view=overdue',
			alarm: data.sources.action_items && data.counts.overdue_action_items > 0
		},
		{
			label: 'Action items due today',
			...tile(
				data.sources.action_items,
				String(data.counts.due_today_action_items),
				`${data.counts.done_due_today} done already`
			),
			href: '/actions?view=today',
			alarm: false
		},
		{
			label: 'Awaiting a decision',
			...tile(
				data.sources.action_items,
				String(data.counts.awaiting_decision),
				`${data.counts.stalled} stalled`
			),
			href: '/reports/slipping',
			alarm: false
		},
		{
			label: 'Projects at risk',
			// `projects_active` is the same expression the Projects page counts
			// with, so this tile and the page it links to cannot disagree. F15.
			...tile(
				data.sources.projects,
				String(data.counts.projects_at_risk),
				`of ${data.counts.projects_active} active`
			),
			href: '/projects',
			alarm: data.sources.projects && data.counts.projects_at_risk > 0
		},
		{
			label: 'Tickets breaching',
			...tile(
				data.sources.tickets,
				String(data.counts.tickets_breaching),
				`of ${data.counts.tickets_open} open`
			),
			href: '/projects',
			alarm: data.sources.tickets && data.counts.tickets_breaching > 0
		},
		{
			label: 'Past due',
			// "None" rather than 0.00. A zero formatted as money reads as an
			// amount at a glance, and on the one screen meant to be read at a
			// glance the difference between "no money is late" and "0.00 is late"
			// matters.
			...tile(
				data.sources.invoices,
				data.counts.past_due_cents > 0 ? formatUsd(data.counts.past_due_cents) : 'None',
				`${data.counts.invoice_alerts} invoices`
			),
			href: '/invoices',
			alarm: data.sources.invoices && data.counts.past_due_cents > 0
		}
	]);

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
		return `${formatUsd(inv.outstanding_cents)}, ${inv.days_overdue} day${inv.days_overdue === 1 ? '' : 's'} past due`;
	}

	/**
	 * Progress, counted from the items and never stored.
	 *
	 * A project with no items reports no progress rather than zero per cent.
	 * Those are different facts, and a bar sitting at zero says the work has not
	 * started when the truth is that nothing has been written down.
	 */
	function progress(p: DashboardProject): { pct: number | null; label: string } {
		if (p.all_items === 0) return { pct: null, label: 'no items yet' };
		const pct = Math.round((p.done_items / p.all_items) * 100);
		return { pct, label: `${pct}%` };
	}

	function projectTone(status: string) {
		if (status === 'blocked') return 'blocked' as const;
		if (status === 'at_risk') return 'atrisk' as const;
		if (status === 'done') return 'done' as const;
		return 'ontrack' as const;
	}

	function ticketTone(priority: string) {
		if (priority === 'urgent' || priority === 'high') return 'overdue' as const;
		if (priority === 'normal') return 'open' as const;
		return 'waiting' as const;
	}

	function ticketMeta(t: DashboardTicket): string {
		const bits = [t.project_name];
		if (t.assignee) bits.push(t.assignee);
		bits.push(t.due_date ? `due ${formatDayShort(t.due_date)}` : 'no due date');
		return bits.join(', ');
	}

	/** Paul's own correction wins over the model's, the same as on the mail screen. */
	function threadSeverity(t: DashboardThread): string {
		return t.severity_override ?? t.severity ?? 'untriaged';
	}

	function threadTone(severity: string) {
		if (severity === 'urgent') return 'overdue' as const;
		if (severity === 'important') return 'atrisk' as const;
		return 'open' as const;
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

<div class="tiles">
	{#each tiles as tile (tile.label)}
		<a class="tile" class:alarm={tile.alarm} class:unsourced={tile.muted} href={tile.href}>
			<span class="tile-value" class:mono={tile.value !== 'None'}>{tile.value}</span>
			<span class="tile-label">{tile.label}</span>
			<span class="tile-sub mono">{tile.sub}</span>
		</a>
	{/each}
</div>

<div class="bands">
	<!-- Projects spans the grid: it is a table, and a table in half a column is
	     a list with extra steps. -->
	<div class="wide">
		<Card
			title="Projects"
			subtitle={`${data.counts.projects_active} active, sorted by risk`}
			padded={false}
		>
			{#snippet actions()}
				<Button href="/projects" variant="ghost" size="sm">Open projects</Button>
			{/snippet}

			{#if data.projects.length === 0}
				<p class="empty">No project is open.</p>
			{:else}
				<div class="scroll-x">
					<table class="projects">
						<thead>
							<tr>
								<th scope="col" class="label-mono">Project</th>
								<th scope="col" class="label-mono">Client</th>
								<th scope="col" class="label-mono">Target</th>
								<th scope="col" class="label-mono">Progress</th>
								<th scope="col" class="label-mono num">Open</th>
								<th scope="col" class="label-mono num">Tickets</th>
								<th scope="col" class="label-mono">Status</th>
							</tr>
						</thead>
						<tbody>
							{#each data.projects as p (p.id)}
								{@const prog = progress(p)}
								<tr>
									<td>
										<a class="pname" href="/projects/{p.id}">{p.name}</a>
										{#if p.next_milestone}
											<span class="meta mono">Next: {p.next_milestone}</span>
										{/if}
									</td>
									<td class="muted">{p.client_name ?? 'No client'}</td>
									<td class="mono nowrap" class:late={p.late === 1}>
										{p.target_close ? formatDayShort(p.target_close) : 'None'}
									</td>
									<td>
										{#if prog.pct === null}
											<span class="meta mono">{prog.label}</span>
										{:else}
											<span class="bar" aria-hidden="true">
												<span
													class="bar-fill tone-{projectTone(p.status)}"
													style="width: {prog.pct}%"
												></span>
											</span>
											<span class="meta mono">{prog.label}</span>
										{/if}
									</td>
									<td class="mono num">{p.open_items}</td>
									<td class="mono num" class:muted={p.open_tickets === 0}>{p.open_tickets}</td>
									<td>
										<StatusChip
											tone={projectTone(p.status)}
											label={p.status === 'at_risk'
												? 'At risk'
												: p.status.charAt(0).toUpperCase() + p.status.slice(1)}
											size="sm"
										/>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</Card>
	</div>

	<Card
		title="Needs you now"
		subtitle={attentionCount > attention.length
			? `${attention.length} of ${attentionCount}`
			: undefined}
		padded={false}
	>
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

	<Card
		title="Open tickets"
		subtitle={data.counts.tickets_open > 0
			? `${data.counts.tickets_open} open, ${data.counts.tickets_breaching} breaching`
			: undefined}
		padded={false}
	>
		{#snippet actions()}
			<Button href="/projects" variant="ghost" size="sm">Open projects</Button>
		{/snippet}

		{#if data.tickets.length === 0}
			<p class="empty">No ticket is open.</p>
		{:else}
			<ul class="rows">
				{#each data.tickets as t (t.id)}
					<li class="row" class:flag={t.breaching === 1}>
						<a class="body indent" href="/tickets/{t.id}">
							<span class="title">{t.title}</span>
							<span class="meta mono">{ticketMeta(t)}</span>
						</a>
						{#if t.breaching === 1}
							<StatusChip tone="overdue" label="Breaching" size="sm" />
						{:else}
							<StatusChip tone={ticketTone(t.priority)} label={t.priority} size="sm" />
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</Card>

	<Card
		title="The week ahead"
		subtitle={data.counts.week > data.week.length
			? `${data.week.length} of ${data.counts.week}`
			: undefined}
		padded={false}
	>
		{#snippet actions()}
			<Button href="/calendar" variant="ghost" size="sm">Calendar</Button>
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
		title="Money"
		subtitle={data.counts.invoice_alerts > 0
			? `${formatUsd(data.counts.past_due_cents)} past due, USD`
			: 'USD'}
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

	<!--
		Mail needing you.

		Scoped to one account and labelled with it. A card of somebody's mail
		with nothing saying whose is worse than no card, because two clients'
		correspondence looks identical. D111.
	-->
	<Card
		title="Mail needing you"
		subtitle={data.mail.connected && data.mail.inbox_total > 0
			? `${data.mail.needs_you} of ${data.mail.inbox_total} in the inbox`
			: undefined}
		padded={false}
	>
		{#snippet actions()}
			<Button href="/mail" variant="ghost" size="sm">Open mail</Button>
		{/snippet}

		{#if !data.mail.connected}
			<p class="empty">No mailbox is connected. Connect one in Settings.</p>
		{:else if data.mail.failed}
			<p class="empty">
				That mailbox did not answer. Everything else on this screen is your own data and is
				unaffected.
			</p>
		{:else if data.mail.threads.length === 0}
			<p class="empty">Nothing is waiting on a reply.</p>
		{:else}
			<ul class="rows">
				{#each data.mail.threads as t (t.id)}
					{@const severity = threadSeverity(t)}
					<li class="row" class:flag={severity === 'urgent'}>
						<a class="body indent" href="/mail/{t.id}?account={data.mail.account}">
							<span class="title">{t.subject ?? 'No subject'}</span>
							<span class="meta mono">{formatDayShort(t.last_at.slice(0, 10))}</span>
						</a>
						<StatusChip tone={threadTone(severity)} label={severity} size="sm" />
					</li>
				{/each}
			</ul>
		{/if}

		{#if data.mail.connected && data.mail.account_email}
			<p class="attribution mono">{data.mail.account_email}</p>
		{/if}
	</Card>

	<Card title="What will slip" subtitle="unassigned or stalled" padded={false}>
		{#snippet actions()}
			<Button href="/reports/slipping" variant="ghost" size="sm">Full report</Button>
		{/snippet}

		{#if data.slipping.length === 0}
			<p class="empty">Nothing is stalled, blocked or waiting on a decision.</p>
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
			grid-template-columns: repeat(3, 1fr);
		}
	}

	@media (min-width: 1100px) {
		.tiles {
			grid-template-columns: repeat(6, 1fr);
		}
	}

	.tile {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		padding: var(--space-4);
		border: 1px solid var(--border-thin);
		border-left: 3px solid var(--border-strong);
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
		border-left-color: var(--gold);
	}

	/**
	 * The value, sized so the widest one fits.
	 *
	 * Six columns at 1440 leaves about 150px a tile, and the past due figure is
	 * thirteen mono characters. At the larger step it broke inside its own
	 * number, which reads as two numbers. Found by rendering it, D128.
	 */
	.tile-value {
		font-size: var(--text-md);
		font-weight: var(--weight-semibold);
		line-height: 1.15;
		overflow-wrap: anywhere;
	}

	.tile-label {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.tile-sub {
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

		.wide {
			grid-column: 1 / -1;
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

	/* The projects table. Wide on a phone, so it scrolls in its own box rather
	   than the page. D22. */
	.scroll-x {
		overflow-x: auto;
		padding: 0 var(--space-2) var(--space-2);
	}

	.projects {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}

	.projects th {
		padding: var(--space-2);
		text-align: left;
		white-space: nowrap;
	}

	.projects td {
		padding: var(--space-2);
		border-top: 1px solid var(--border-thin);
		vertical-align: top;
	}

	.projects th.num,
	.projects td.num {
		text-align: right;
	}

	.pname {
		color: var(--text-link);
		text-decoration: none;
	}

	.pname:hover {
		text-decoration: underline;
	}

	.late {
		color: var(--text-warn);
	}

	.bar {
		display: block;
		width: 90px;
		height: 6px;
		border-radius: var(--radius-pill);
		background: var(--surface-row-alt);
		overflow: hidden;
	}

	.bar-fill {
		display: block;
		height: 100%;
	}

	.bar-fill.tone-ontrack {
		background: var(--green);
	}

	.bar-fill.tone-atrisk {
		background: var(--gold-600);
	}

	.bar-fill.tone-blocked {
		background: var(--red);
	}

	.bar-fill.tone-done {
		background: var(--green);
	}

	/*
	 * A tile with nothing behind it, drawn quieter than one reporting zero.
	 *
	 * Not hidden: the tile still says what it would measure, and still links to
	 * the page that would fill it. Hiding it would answer "why is this missing"
	 * with silence, which is the failure one step further along.
	 */
	.tile.unsourced {
		opacity: 0.55;
	}

	.tile.unsourced .tile-value {
		color: var(--text-secondary);
	}

	.muted {
		color: var(--text-secondary);
	}

	.nowrap {
		white-space: nowrap;
	}

	.empty {
		margin: 0;
		padding: var(--space-4);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.attribution {
		margin: 0;
		padding: 0 var(--space-4) var(--space-3);
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.footnote {
		margin-top: var(--space-5);
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
</style>
