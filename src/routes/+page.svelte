<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { STATUS_LABELS } from '$lib/types';
	import type { ActionItem } from '$lib/types';
	import { deadlineLabel, formatDay } from '$lib/format';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import type { PageData } from './$types';
	import type { SlipReason } from './+page';

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');

	const attention = $derived([...data.overdue, ...data.due_today]);

	async function markDone(item: ActionItem) {
		busy = true;
		errorMessage = '';
		try {
			const res = await fetch(`/api/action-items/${item.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ status: 'done' })
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				errorMessage = body.error ?? 'Could not update the item.';
				return;
			}
			await invalidateAll();
			notice = 'Marked done.';
		} catch {
			errorMessage = 'Could not reach the server.';
		} finally {
			busy = false;
		}
	}

	const REASON_LABELS: Record<SlipReason, string> = {
		ambiguous: 'Needs clarification',
		blocked: 'Blocked',
		stalled: 'No movement',
		due_soon: 'Due soon'
	};

	/** Days since an item was last touched, for the stalled rows. */
	function daysSince(timestamp: string): number {
		const then = Date.parse(timestamp);
		if (Number.isNaN(then)) return 0;
		return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
	}

	function slipMeta(item: PageData['slipping'][number]): string {
		const bits: string[] = [];
		if (item.reason === 'stalled') {
			const n = daysSince(item.updated_at);
			bits.push(`No movement for ${n} day${n === 1 ? '' : 's'}`);
		} else if (item.deadline) {
			bits.push(`Due ${formatDay(item.deadline)}`);
		}
		if (item.owner) bits.push(item.owner);
		if (item.project_name) bits.push(item.project_name);
		return bits.join(' · ');
	}

	function attentionMeta(item: ActionItem): string {
		const due = deadlineLabel(item.deadline, data.today, item.status);
		const bits: string[] = [due.text];
		if (item.owner) bits.push(item.owner);
		if (item.project_name) bits.push(item.project_name);
		return bits.join(' · ');
	}

	/** One plain line describing the day. No hype, no exclamation points. */
	const summary = $derived.by(() => {
		const need = attention.length;
		const slip = data.slipping.length;
		if (need === 0 && slip === 0) {
			return data.totals.open === 0
				? 'Nothing is open.'
				: 'Nothing is overdue and nothing is due today.';
		}
		const parts: string[] = [];
		if (need > 0) {
			parts.push(`${need} item${need === 1 ? '' : 's'} need${need === 1 ? 's' : ''} attention now`);
		}
		if (slip > 0) {
			parts.push(`${slip} more could slip`);
		}
		return `${parts.join('. ')}.`;
	});
</script>

<svelte:head>
	<title>Today | Command Center</title>
</svelte:head>

<header class="head">
	<div>
		<h1>Today</h1>
		<p class="sub">{summary}</p>
	</div>
	<p class="date mono">{formatDay(data.today)}</p>
</header>

<p class="status-line" role="status" aria-live="polite">{notice}</p>

{#if errorMessage}
	<p class="error-banner" role="alert">{errorMessage}</p>
{/if}

<div class="bands">
	<Card title="Overdue and due today" padded={false}>
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
							<span class="meta mono">{attentionMeta(item)}</span>
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

	<Card title="What will slip" padded={false}>
		{#snippet actions()}
			<Button href="/actions?view=open" variant="ghost" size="sm">Open tracker</Button>
		{/snippet}

		{#if data.slipping.length === 0}
			<p class="empty">
				Nothing is stalled, blocked or due in the next {data.soon_days} days.
			</p>
		{:else}
			<ul class="rows">
				{#each data.slipping as item (item.id)}
					<li class="row" class:flag={item.reason !== 'due_soon'}>
						<a class="body indent" href="/actions?view=open&q={encodeURIComponent(item.title)}">
							<span class="title">{item.title}</span>
							<span class="meta mono">{slipMeta(item)}</span>
						</a>
						<StatusChip
							tone={item.reason === 'due_soon' ? 'atrisk' : item.reason === 'stalled' ? 'waiting' : item.reason}
							label={REASON_LABELS[item.reason]}
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

	.sub {
		margin-top: var(--space-1);
		color: var(--text-secondary);
	}

	.date {
		color: var(--text-secondary);
		font-size: var(--text-sm);
	}

	.status-line {
		min-height: 1.25rem;
		margin-top: var(--space-2);
		font-size: var(--text-sm);
		color: var(--green-700);
	}

	.error-banner {
		margin-top: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--red-200);
		border-radius: var(--radius-sm);
		background: var(--red-100);
		color: var(--red);
	}

	/* One column at 412px. Two from 960px, matching D22's shell breakpoint,
	   because these cards sit beside the sidebar. */
	.bands {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-4);
		margin-top: var(--space-4);
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

	.row:hover {
		background: var(--surface-hover);
	}

	.row.flag {
		border-left-color: var(--gold);
	}

	.check {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--tap);
		height: var(--tap);
		margin: 0 0 0 calc(var(--space-3) * -1);
		background: none;
		border: none;
		cursor: pointer;
	}

	.box {
		width: 20px;
		height: 20px;
		border: 2px solid var(--border-control);
		border-radius: var(--radius-sm);
	}

	.check:hover .box {
		border-color: var(--navy);
	}

	.body {
		flex: 1;
		min-width: 0;
		display: block;
		color: inherit;
		text-decoration: none;
	}

	.body:hover {
		color: inherit;
		text-decoration: none;
	}

	.body:hover .title {
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.indent {
		padding-left: var(--space-2);
	}

	.title {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meta {
		display: block;
		margin-top: 2px;
		font-size: var(--text-xs);
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.empty {
		padding: var(--space-5) var(--space-4);
		text-align: center;
		color: var(--text-secondary);
	}

	.footnote {
		margin-top: var(--space-5);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	@media (min-width: 960px) {
		.bands {
			grid-template-columns: 1fr 1fr;
			align-items: start;
		}
	}
</style>
