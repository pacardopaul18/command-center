<script lang="ts">
	import { apiWrite } from '$lib/http';
	import { invalidateAll } from '$app/navigation';
	import { STATUS_LABELS } from '$lib/types';
	import type { Proposal } from '$lib/types';
	import { deadlineLabel, formatDay } from '$lib/format';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import FormField from '$lib/components/FormField.svelte';
	import Input from '$lib/components/Input.svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import Textarea from '$lib/components/Textarea.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');
	let showImport = $state(false);
	let transcriptDraft = $state('');
	let editingProposal = $state<string | null>(null);
	let edit = $state<Record<string, string>>({});

	const meeting = $derived(data.meeting);
	const pending = $derived(data.proposals.filter((p) => p.status === 'pending'));
	const reviewed = $derived(data.proposals.filter((p) => p.status !== 'pending'));
	const hasTranscript = $derived((meeting.transcript_chars ?? 0) > 0);

	async function send(path: string, method: string, body: unknown, message: string) {
		busy = true;
		errorMessage = '';
		try {
			const res = await fetch(path, {
				method,
				headers: body === undefined ? undefined : { 'content-type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body)
			});
			const payload = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				errorMessage = payload.error ?? 'The request failed.';
				return false;
			}
			await invalidateAll();
			notice = message;
			return true;
		} catch {
			errorMessage = 'Could not reach the server.';
			return false;
		} finally {
			busy = false;
		}
	}

	async function importTranscript(event: SubmitEvent) {
		event.preventDefault();
		if (!transcriptDraft.trim()) {
			errorMessage = 'Paste the transcript first.';
			return;
		}
		busy = true;
		errorMessage = '';
		try {
			// The one raw-body write. It goes through the same guard as every
			// other, because the guard is about the response and a transcript
			// upload can fail silently exactly like anything else.
			const result = await apiWrite(
				`/api/meetings/${meeting.id}/transcript`,
				'PUT',
				transcriptDraft,
				'text/plain'
			);
			if (!result.ok) {
				errorMessage = result.error ?? 'Could not import the transcript.';
				return;
			}
			await invalidateAll();
			transcriptDraft = '';
			showImport = false;
			notice = 'Transcript imported.';
		} catch {
			errorMessage = 'Could not reach the server.';
		} finally {
			busy = false;
		}
	}

	function startEdit(proposal: Proposal) {
		editingProposal = proposal.id;
		errorMessage = '';
		edit = {
			title: proposal.title,
			context: proposal.context ?? '',
			owner: proposal.owner ?? '',
			deadline: proposal.deadline ?? ''
		};
	}

	async function accept(proposal: Proposal, corrected: boolean) {
		const body = corrected ? { ...edit } : {};
		const ok = await send(
			`/api/meetings/${meeting.id}/proposals/${proposal.id}/accept`,
			'POST',
			body,
			'Action item created.'
		);
		if (ok) editingProposal = null;
	}
</script>

<svelte:head>
	<title>{meeting.title} | Command Center</title>
</svelte:head>

<nav class="crumbs mono" aria-label="Breadcrumb">
	<a href="/meetings">Meetings</a>
	<span aria-hidden="true">/</span>
	<span>{meeting.title}</span>
</nav>

<header class="head">
	<div class="titles">
		<h1>{meeting.title}</h1>
	</div>
	<div class="head-actions">
		{#if hasTranscript}
			<Button
				variant="secondary"
				disabled={busy}
				onclick={() => send(`/api/meetings/${meeting.id}/summarize`, 'POST', {}, 'Summary generated. Review it before trusting it.')}
			>
				{meeting.summary ? 'Regenerate summary' : 'Summarise'}
			</Button>
			<Button
				disabled={busy}
				onclick={() => send(`/api/meetings/${meeting.id}/extract`, 'POST', {}, 'Extraction finished. Review each proposal.')}
			>
				Extract action items
			</Button>
		{/if}
	</div>
</header>

<p class="sub">
	{formatDay(meeting.meeting_date)}
	{#if meeting.client_name}<span class="sep">·</span>{meeting.client_name}{/if}
	{#if meeting.project_name}<span class="sep">·</span>{meeting.project_name}{/if}
	{#if meeting.attendees}<span class="sep">·</span>{meeting.attendees}{/if}
</p>

<p class="status-line" role="status" aria-live="polite">{notice}</p>

{#if errorMessage}
	<p class="error-banner" role="alert">{errorMessage}</p>
{/if}

<!-- Transcript -->
<div class="block">
	<Card
		title="Transcript"
		subtitle={hasTranscript
			? `${(meeting.transcript_chars ?? 0).toLocaleString('en-US')} characters, stored in R2 and searchable`
			: 'Nothing imported yet'}
	>
		{#snippet actions()}
			<Button variant="ghost" size="sm" onclick={() => (showImport = !showImport)}>
				{showImport ? 'Cancel' : hasTranscript ? 'Replace' : 'Import'}
			</Button>
		{/snippet}

		{#if showImport}
			<form onsubmit={importTranscript}>
				<FormField
					label="Transcript"
					hint="Paste the whole transcript. For a very long call, split it by agenda topic and import each part as its own meeting."
				>
					<Textarea bind:value={transcriptDraft} rows={14} placeholder="Speaker 1: ..." />
				</FormField>
				<div class="form-actions">
					<Button type="submit" disabled={busy}>Import transcript</Button>
				</div>
			</form>
		{:else if !hasTranscript}
			<p class="empty">Import the transcript to unlock the summary and extraction.</p>
		{:else}
			<p class="note">
				Imported. Summarising and extracting both read from it, and search finds it.
			</p>
		{/if}
	</Card>
</div>

<!-- Summary -->
{#if meeting.summary}
	<div class="block">
		<Card
			title="Summary"
			subtitle={meeting.summary_reviewed_at
				? `Reviewed ${formatDay(meeting.summary_reviewed_at.slice(0, 10))}`
				: 'Written by Claude and not yet reviewed'}
		>
			{#snippet actions()}
				{#if !meeting.summary_reviewed_at}
					<Button
						variant="ghost"
						size="sm"
						disabled={busy}
						onclick={() => send(`/api/meetings/${meeting.id}/summary/review`, 'POST', {}, 'Summary marked reviewed.')}
					>
						Mark reviewed
					</Button>
				{/if}
			{/snippet}

			{#if !meeting.summary_reviewed_at}
				<p class="unreviewed">
					This summary has not been checked by a person. Read it against the transcript before
					relying on any name, date or figure in it.
				</p>
			{/if}

			<Markdown source={meeting.summary} />
		</Card>
	</div>
{/if}

<!-- Proposals: the review step -->
{#if pending.length > 0}
	<div class="block">
		<Card
			title="Proposed action items"
			subtitle="{pending.length} waiting on review. Nothing here is tracked until you accept it."
			padded={false}
		>
			<ul class="proposals">
				{#each pending as proposal (proposal.id)}
					<li class="proposal" class:flag={proposal.ambiguous === 1}>
						{#if editingProposal === proposal.id}
							<div class="grid">
								<div class="span-all">
									<FormField label="Title">
										<Input bind:value={edit.title} maxlength={300} required />
									</FormField>
								</div>
								<FormField label="Owner">
									<Input bind:value={edit.owner} placeholder="Who committed" />
								</FormField>
								<FormField label="Deadline">
									<Input type="date" bind:value={edit.deadline} mono />
								</FormField>
								<div class="span-all">
									<FormField label="Context">
										<Textarea bind:value={edit.context} rows={3} />
									</FormField>
								</div>
							</div>
							<div class="form-actions">
								<Button disabled={busy} onclick={() => accept(proposal, true)}>
									Accept with corrections
								</Button>
								<Button variant="secondary" onclick={() => (editingProposal = null)} disabled={busy}>
									Cancel
								</Button>
							</div>
						{:else}
							<p class="proposal-title">{proposal.title}</p>

							<ul class="proposal-meta">
								<li>
									<StatusChip
										tone={proposal.ambiguous === 1 ? 'ambiguous' : 'open'}
										label={proposal.ambiguous === 1 ? 'Needs clarification' : 'Clear'}
										size="sm"
									/>
								</li>
								<li class="meta-text">{proposal.owner || 'No owner named'}</li>
								<li class="meta-text mono">
									{proposal.deadline ? formatDay(proposal.deadline) : 'No deadline'}
								</li>
							</ul>

							{#if proposal.ambiguous === 1 && proposal.ambiguity_note}
								<p class="ambiguity">{proposal.ambiguity_note}</p>
							{/if}

							{#if proposal.context}
								<p class="proposal-context">{proposal.context}</p>
							{/if}

							{#if proposal.evidence}
								<blockquote class="evidence">
									{proposal.evidence}
									<span class="evidence-label label-mono">From the transcript</span>
								</blockquote>
							{/if}

							<div class="proposal-actions">
								<Button size="sm" disabled={busy} onclick={() => accept(proposal, false)}>
									Accept as is
								</Button>
								<Button variant="secondary" size="sm" onclick={() => startEdit(proposal)}>
									Correct and accept
								</Button>
								<Button
									variant="danger"
									size="sm"
									disabled={busy}
									onclick={() => send(`/api/meetings/${meeting.id}/proposals/${proposal.id}/reject`, 'POST', {}, 'Proposal rejected.')}
								>
									Reject
								</Button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</Card>
	</div>
{/if}

<!-- Linked action items -->
<div class="block">
	<Card
		title="Action items"
		subtitle="{data.action_items.length} tracked from this meeting"
		padded={false}
	>
		{#snippet actions()}
			<Button href="/actions?view=all" variant="ghost" size="sm">Open tracker</Button>
		{/snippet}

		{#if data.action_items.length === 0}
			<p class="empty">
				Nothing tracked from this meeting yet. Extract, then accept what is real.
			</p>
		{:else}
			<ul class="items">
				{#each data.action_items as item (item.id)}
					{@const due = deadlineLabel(item.deadline, data.today, item.status)}
					<li class="item">
						<span class="item-body">
							<span class="item-title">{item.title}</span>
							<span class="item-meta mono">
								{#if item.deadline}{due.text} · {due.date}{:else}No deadline{/if}
								{#if item.owner} · {item.owner}{/if}
							</span>
						</span>
						<StatusChip
							tone={due.tone === 'overdue' && item.status !== 'done' ? 'overdue' : item.status}
							label={due.tone === 'overdue' && item.status !== 'done'
								? 'Overdue'
								: STATUS_LABELS[item.status]}
							size="sm"
						/>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>
</div>

<!-- Review history -->
{#if reviewed.length > 0}
	<div class="block">
		<Card
			title="Review history"
			subtitle="What Claude proposed and what you decided"
			padded={false}
		>
			<ul class="history">
				{#each reviewed as proposal (proposal.id)}
					<li class="history-row">
						<span class="history-body">
							<span class="history-title" class:struck={proposal.status === 'rejected'}>
								{proposal.title}
							</span>
							{#if proposal.model}
								<span class="history-meta mono">{proposal.model}</span>
							{/if}
						</span>
						<StatusChip
							tone={proposal.status === 'accepted' ? 'done' : 'waiting'}
							label={proposal.status === 'accepted' ? 'Accepted' : 'Rejected'}
							size="sm"
						/>
					</li>
				{/each}
			</ul>
		</Card>
	</div>
{/if}

<style>
	.crumbs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		margin-top: var(--space-3);
	}
	.titles {
		min-width: 0;
	}
	.head-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.sub {
		margin-top: var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.sep {
		margin: 0 var(--space-1);
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
	.block {
		margin-top: var(--space-4);
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-3);
	}
	.form-actions,
	.proposal-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
	.empty {
		padding: var(--space-5) var(--space-4);
		text-align: center;
		color: var(--text-secondary);
	}
	.note {
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	/* The unreviewed banner is deliberately loud. An AI summary nobody has
	   checked is the one thing on this screen most likely to be wrong. */
	.unreviewed {
		margin-bottom: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--gold);
		border-radius: var(--radius-sm);
		background: var(--gold-50);
		color: var(--text-warn);
		font-size: var(--text-sm);
	}

	.proposals {
		list-style: none;
		margin: 0;
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.proposal {
		padding: var(--space-3);
		border: 1px solid var(--border-thin);
		border-left: 3px solid var(--border-strong);
		border-radius: var(--radius-sm);
	}
	.proposal.flag {
		border-left-color: var(--gold);
		background: var(--gold-50);
	}
	.proposal-title {
		font-weight: var(--weight-medium);
		overflow-wrap: anywhere;
	}
	.proposal-meta {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin: var(--space-2) 0 0;
		padding: 0;
	}
	.meta-text {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.ambiguity {
		margin-top: var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-warn);
	}
	.proposal-context {
		margin-top: var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}
	.evidence {
		margin: var(--space-3) 0 0;
		padding-left: var(--space-3);
		border-left: 2px solid var(--border-strong);
		font-size: var(--text-sm);
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}
	.evidence-label {
		display: block;
		margin-top: var(--space-1);
	}

	.items,
	.history {
		list-style: none;
		margin: 0;
		padding: var(--space-2);
	}
	.item,
	.history-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--border-thin);
	}
	.item:last-child,
	.history-row:last-child {
		border-bottom: none;
	}
	.item-body,
	.history-body {
		min-width: 0;
	}
	.item-title,
	.history-title {
		display: block;
		overflow-wrap: anywhere;
	}
	.struck {
		text-decoration: line-through;
		color: var(--text-secondary);
	}
	.item-meta,
	.history-meta {
		display: block;
		margin-top: 2px;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	@media (min-width: 720px) {
		.grid {
			grid-template-columns: 1fr 1fr;
		}
		.span-all {
			grid-column: 1 / -1;
		}
	}
</style>
