<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { formatDay } from '$lib/format';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import FormField from '$lib/components/FormField.svelte';
	import Input from '$lib/components/Input.svelte';
	import Select from '$lib/components/Select.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');
	let showForm = $state(false);

	function blankDraft() {
		return {
			title: '',
			meeting_date: data.today,
			client_id: '',
			project_id: '',
			attendees: '',
			recording_url: ''
		};
	}

	let draft = $state(blankDraft());

	async function create(event: SubmitEvent) {
		event.preventDefault();
		if (!draft.title.trim()) {
			errorMessage = 'Give the meeting a title.';
			return;
		}
		busy = true;
		errorMessage = '';
		try {
			const res = await fetch('/api/meetings', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(draft)
			});
			const payload = (await res.json().catch(() => ({}))) as {
				error?: string;
				meeting?: { id: string };
			};
			if (!res.ok) {
				errorMessage = payload.error ?? 'Could not create the meeting.';
				return;
			}
			draft = blankDraft();
			showForm = false;
			notice = 'Meeting created.';
			await invalidateAll();
			// Straight to the detail screen, because the next thing is always the
			// transcript and there is nothing else to do on the list.
			if (payload.meeting) goto(`/meetings/${payload.meeting.id}`);
		} catch {
			errorMessage = 'Could not reach the server.';
		} finally {
			busy = false;
		}
	}

	function applySearch(event: SubmitEvent) {
		event.preventDefault();
		const values = new FormData(event.currentTarget as HTMLFormElement);
		const q = String(values.get('q') ?? '');
		goto(q ? `/meetings?q=${encodeURIComponent(q)}` : '/meetings', { keepFocus: true });
	}
</script>

<svelte:head>
	<title>Meetings | Command Center</title>
</svelte:head>

<header class="head">
	<div>
		<h1>Meetings</h1>
		<p class="sub">Every client call, its transcript, and what came out of it.</p>
	</div>
	<Button onclick={() => (showForm = !showForm)}>{showForm ? 'Cancel' : 'New meeting'}</Button>
</header>

<p class="status-line" role="status" aria-live="polite">{notice}</p>

{#if errorMessage}
	<p class="error-banner" role="alert">{errorMessage}</p>
{/if}

{#if showForm}
	<div class="block">
		<Card title="New meeting">
			<form onsubmit={create}>
				<div class="grid">
					<div class="span-all">
						<FormField label="Title">
							<Input bind:value={draft.title} placeholder="What the call was" maxlength={300} required />
						</FormField>
					</div>
					<FormField label="Date">
						<Input type="date" bind:value={draft.meeting_date} mono required />
					</FormField>
					<FormField label="Client">
						<Select bind:value={draft.client_id}>
							<option value="">No client</option>
							{#each data.clients as client (client.id)}
								<option value={client.id}>{client.name}</option>
							{/each}
						</Select>
					</FormField>
					<FormField label="Project">
						<Select bind:value={draft.project_id}>
							<option value="">No project</option>
							{#each data.projects as project (project.id)}
								<option value={project.id}>{project.name}</option>
							{/each}
						</Select>
					</FormField>
					<FormField label="Attendees">
						<Input bind:value={draft.attendees} placeholder="Who was on the call" maxlength={1000} />
					</FormField>
					<div class="span-all">
						<FormField label="Recording link" hint="Optional. The transcript is imported separately.">
							<Input bind:value={draft.recording_url} maxlength={1000} />
						</FormField>
					</div>
				</div>
				<div class="form-actions"><Button type="submit" disabled={busy}>Create meeting</Button></div>
			</form>
		</Card>
	</div>
{/if}

<form class="filters" onsubmit={applySearch}>
	<FormField label="Search">
		<Input name="q" type="search" value={data.q} placeholder="Anything said on a call" />
	</FormField>
	<Button variant="secondary" type="submit">Search</Button>
</form>
<!--
	The hint sits under the form rather than inside the field. Inside, it made
	that grid cell taller than the button's cell, and `align-items: end` then
	aligned the button to the bottom of the hint instead of to the input.
-->
<p class="filter-hint">Searches titles, attendees and transcript text.</p>

{#if data.meetings.length === 0}
	<p class="empty">
		{#if data.q}
			No meetings match that search.
		{:else}
			No meetings yet. Create one, then import its transcript.
		{/if}
	</p>
{:else}
	<ul class="rows">
		{#each data.meetings as meeting (meeting.id)}
			<li>
				<a class="row" href="/meetings/{meeting.id}">
					<span class="body">
						<span class="title">{meeting.title}</span>
						<span class="meta mono">
							{formatDay(meeting.meeting_date)}
							{#if meeting.client_name}<span class="sep">·</span>{meeting.client_name}{/if}
							{#if meeting.project_name}<span class="sep">·</span>{meeting.project_name}{/if}
							{#if meeting.attendees}<span class="sep">·</span>{meeting.attendees}{/if}
						</span>
					</span>

					<span class="marks">
						{#if !meeting.transcript_chars}
							<StatusChip tone="waiting" label="No transcript" size="sm" />
						{:else if !meeting.summary}
							<StatusChip tone="open" label="Not summarised" size="sm" />
						{:else if !meeting.summary_reviewed_at}
							<StatusChip tone="atrisk" label="Needs review" size="sm" />
						{:else}
							<StatusChip tone="done" label="Reviewed" size="sm" />
						{/if}
						<span class="count mono">
							{meeting.action_item_count ?? 0} item{(meeting.action_item_count ?? 0) === 1 ? '' : 's'}
						</span>
					</span>
				</a>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.sub {
		margin-top: var(--space-1);
		color: var(--text-secondary);
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
	.form-actions {
		margin-top: var(--space-4);
	}
	.filter-hint {
		margin: var(--space-2) 0 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.filters {
		display: grid;
		grid-template-columns: 1fr;
		align-items: end;
		gap: var(--space-3);
		margin-top: var(--space-5);
	}
	.empty {
		margin-top: var(--space-5);
		padding: var(--space-7) var(--space-4);
		text-align: center;
		color: var(--text-secondary);
		background: var(--surface-card);
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-md);
	}
	.rows {
		list-style: none;
		margin: var(--space-4) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.row {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		color: inherit;
		text-decoration: none;
	}
	.row:hover {
		background: var(--surface-hover);
		color: inherit;
		text-decoration: none;
	}
	.row:hover .title {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.body {
		min-width: 0;
	}
	.title {
		display: block;
		font-weight: var(--weight-medium);
		overflow-wrap: anywhere;
	}
	.meta {
		display: block;
		margin-top: 2px;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.sep {
		margin: 0 var(--space-1);
	}
	.marks {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.count {
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
		.filters {
			grid-template-columns: 1fr auto;
		}
		.row {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			gap: var(--space-4);
		}
	}
</style>
