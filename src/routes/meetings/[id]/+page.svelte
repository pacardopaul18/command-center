<script lang="ts">
	import { label } from '$lib/calendar-label';
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
	import RichText from '$lib/components/RichText.svelte';

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

	/* ---------------------------------------------------------------------
	 * The call this record is filed against
	 * ------------------------------------------------------------------ */

	const RESPONSE_LABEL: Record<string, string> = {
		accepted: 'Going',
		declined: 'Not going',
		tentative: 'Maybe',
		needsAction: 'No answer yet'
	};

	/** The clock the call ran on, from the event rather than from the date field. */
	const callTime = $derived.by(() => {
		if (!data.call) return '';
		if (data.call.all_day === 1) return 'All day';
		const fmt = (value: string) =>
			new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
		return data.call.ends_at
			? `${fmt(data.call.starts_at)} to ${fmt(data.call.ends_at)}`
			: fmt(data.call.starts_at);
	});

	/**
	 * The guest list count, taken from the list actually shown.
	 *
	 * `attendee_count` on the event is what Google reported and can be larger
	 * than the names read so far, so showing it above a shorter list would have
	 * the panel contradict itself.
	 */
	const attendeeCount = $derived(
		data.attendees.length > 0 ? String(data.attendees.length) : meeting.attendees ? 'typed' : '0'
	);

	async function unlink() {
		busy = true;
		const res = await apiWrite(`/api/meetings/${meeting.id}/link`, 'DELETE', null);
		busy = false;
		if (res.ok) {
			notice = 'Unfiled from that call.';
			await invalidateAll();
		} else {
			errorMessage = res.error ?? 'Could not unfile that call.';
		}
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

<div class="board">
	<div class="main">

<!--
	Notes.

	What was typed when the meeting was captured, before there was a transcript
	or a summary to read. Quick Add writes the agenda here, so leaving it off the
	page would have made the box on that form a place where words go to die.
	Shown above the transcript because for a meeting that has not happened yet it
	is the only thing on the page with anything in it.
-->
{#if meeting.notes || meeting.notes_html}
	<div class="block">
		<Card title="Notes" subtitle="Written by hand, not generated">
			<RichText html={meeting.notes_html} text={meeting.notes} />
		</Card>
	</div>
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

	</div>

	<aside class="side">
		<Card title="Details">
			<dl class="facts">
				<div><dt>Date</dt><dd>{formatDay(meeting.meeting_date)}</dd></div>
				{#if data.call}
					<div><dt>Time</dt><dd>{callTime}</dd></div>
				{/if}
				<div>
					<dt>Client</dt>
					<dd>
						{#if meeting.client_id}
							<a href="/clients/{meeting.client_id}">{meeting.client_name}</a>
						{:else}
							No client
						{/if}
					</dd>
				</div>
				<div>
					<dt>Project</dt>
					<dd>
						{#if meeting.project_id}
							<a href="/projects/{meeting.project_id}">{meeting.project_name}</a>
						{:else}
							No project
						{/if}
					</dd>
				</div>
				<div>
					<dt>Transcript</dt>
					<dd>
						{#if hasTranscript}
							{(meeting.transcript_chars ?? 0).toLocaleString('en-US')} characters
						{:else}
							Not imported yet
						{/if}
					</dd>
				</div>
				<div>
					<dt>Summary</dt>
					<dd>
						{#if meeting.summary_reviewed_at}
							Reviewed {formatDay(meeting.summary_reviewed_at.slice(0, 10))}
						{:else if meeting.summary}
							Drafted, not reviewed
						{:else}
							None
						{/if}
					</dd>
				</div>
			</dl>
		</Card>

		<!--
			The call, when this record is filed against one.
			`calendar_events.meeting_id` has existed since 0011 for exactly this and
			nothing set it until now. Nothing here changes the event: the only
			control is a link into Google, where a call can actually be moved. D152.
		-->
		<Card title="The call">
			{#if data.call}
				<p class="call-name">{label(data.call)}</p>
				<p class="fine mono">{data.call.account_email ?? data.call.account_id}</p>
				{#if data.call.location}<p class="fine">{data.call.location}</p>{/if}
				<div class="call-actions">
					{#if data.call.html_link}
						<a
							class="ghost"
							href={data.call.html_link}
							target="_blank"
							rel="noopener noreferrer"
						>
							Open in Google Calendar
						</a>
					{/if}
					<button type="button" class="ghost" disabled={busy} onclick={unlink}>
						Unfile from this call
					</button>
				</div>
			{:else}
				<p class="fine">
					Not filed against a calendar entry. File one from the Meetings page, beside the
					call in Coming up.
				</p>
			{/if}
		</Card>

		<Card title="Attendees">
			{#snippet actions()}
				<span class="fine mono">{attendeeCount}</span>
			{/snippet}

			{#if data.attendees.length > 0}
				<!--
					From the calendar's guest list, which knows who organised it and who
					accepted. Shown instead of the typed line rather than merged with
					it: "five people" from a guest list and "five people" from a
					sentence somebody typed are not the same claim.
				-->
				<ul class="people">
					{#each data.attendees as person (person.email ?? person.display_name)}
						<li>
							<span class="person-name">{person.display_name ?? person.email}</span>
							<span class="person-note mono">
								{#if person.is_self}You{:else if person.is_organizer}Organiser{/if}
								{#if person.response_status}
									{person.is_self || person.is_organizer ? ', ' : ''}{RESPONSE_LABEL[
										person.response_status
									] ?? person.response_status}
								{/if}
							</span>
						</li>
					{/each}
				</ul>
				<p class="fine">From the calendar entry.</p>
			{:else if meeting.attendees}
				<p>{meeting.attendees}</p>
				<p class="fine">As typed on the record. File this against a call to read the guest list.</p>
			{:else}
				<p class="fine">Nobody recorded.</p>
			{/if}
		</Card>

		{#if meeting.recording_url}
			<Card title="Recording">
				<a
					class="recording mono"
					href={meeting.recording_url}
					target="_blank"
					rel="noopener noreferrer"
				>
					{meeting.recording_url.replace(/^https?:\/\//, '')}
				</a>
			</Card>
		{/if}
	</aside>

</div>

<style>

	/*
	 * The record and its facts, side by side at a desk and stacked on a phone
	 * with the record first: a reader opening a meeting wants the summary and
	 * the transcript, and who was on it is context.
	 */
	.board {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		align-items: start;
		margin-top: var(--space-4);
	}

	@media (min-width: 1100px) {
		.board {
			grid-template-columns: minmax(0, 5fr) minmax(0, 2fr);
		}
	}

	.main,
	.side {
		min-width: 0;
	}

	.side {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.facts {
		margin: 0;
		display: flex;
		flex-direction: column;
	}

	.facts > div {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) 0;
	}

	.facts > div + div {
		border-top: 1px solid var(--border-hairline);
	}

	.facts dt {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.facts dd {
		margin: 0;
		font-size: var(--text-sm);
		text-align: right;
		overflow-wrap: anywhere;
	}

	.call-name {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-heading);
	}

	.fine {
		margin: var(--space-1) 0 0;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.call-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}

	.ghost {
		display: inline-flex;
		align-items: center;
		/* 44px, D22. */
		min-height: 44px;
		padding: 0 var(--space-2);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-muted);
		font: inherit;
		font-size: var(--text-xs);
		text-decoration: none;
		cursor: pointer;
	}

	.ghost:hover:not(:disabled) {
		color: var(--text-body);
		border-color: var(--navy-600);
	}

	.people {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.people li {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-2) 0;
		min-height: 44px;
		align-items: center;
	}

	.people li + li {
		border-top: 1px solid var(--border-hairline);
	}

	.person-name {
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}

	.person-note {
		font-size: var(--text-xs);
		color: var(--text-muted);
		flex: none;
	}

	.recording {
		font-size: var(--text-xs);
		overflow-wrap: anywhere;
	}
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
