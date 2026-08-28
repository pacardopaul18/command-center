<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import {
		PHASE_LABELS,
		PROJECT_PHASES,
		PROJECT_STATUS_LABELS,
		PROJECT_STATUS_TONE,
		PROJECT_STATUSES
	} from '$lib/types';
	import type { ProjectPhase } from '$lib/types';
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
			name: '',
			client_id: '',
			phase: 'initiating' as ProjectPhase,
			status: 'on_track',
			next_milestone: '',
			target_close: ''
		};
	}

	let draft = $state(blankDraft());

	const byPhase = $derived(
		PROJECT_PHASES.map((phase) => ({
			phase,
			rows: data.projects.filter((p) => p.phase === phase)
		}))
	);

	async function create(event: SubmitEvent) {
		event.preventDefault();
		if (!draft.name.trim()) {
			errorMessage = 'Give the project a name.';
			return;
		}
		busy = true;
		errorMessage = '';
		try {
			const res = await fetch('/api/projects', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(draft)
			});
			const payload = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				errorMessage = payload.error ?? 'Could not create the project.';
				return;
			}
			await invalidateAll();
			draft = blankDraft();
			showForm = false;
			notice = 'Project created.';
		} catch {
			errorMessage = 'Could not reach the server.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Projects | Command Center</title>
</svelte:head>

<header class="head">
	<div>
		<h1>Projects</h1>
		<p class="sub">Engagements from initiation to closing.</p>
	</div>
	<Button onclick={() => (showForm = !showForm)}>
		{showForm ? 'Cancel' : 'New project'}
	</Button>
</header>

<p class="status-line" role="status" aria-live="polite">{notice}</p>

{#if errorMessage}
	<p class="error-banner" role="alert">{errorMessage}</p>
{/if}

{#if showForm}
	<div class="form-wrap">
		<Card title="New project">
			<form onsubmit={create}>
				<div class="grid">
					<div class="span-all">
						<FormField label="Name">
							<Input bind:value={draft.name} placeholder="What the engagement is" maxlength={200} required />
						</FormField>
					</div>
					<FormField label="Client">
						<Select bind:value={draft.client_id}>
							<option value="">No client</option>
							{#each data.clients as client (client.id)}
								<option value={client.id}>{client.name}</option>
							{/each}
						</Select>
					</FormField>
					<FormField label="Phase">
						<Select bind:value={draft.phase}>
							{#each PROJECT_PHASES as phase (phase)}
								<option value={phase}>{PHASE_LABELS[phase]}</option>
							{/each}
						</Select>
					</FormField>
					<FormField label="Status">
						<Select bind:value={draft.status}>
							{#each PROJECT_STATUSES as status (status)}
								<option value={status}>{PROJECT_STATUS_LABELS[status]}</option>
							{/each}
						</Select>
					</FormField>
					<FormField label="Next milestone">
						<Input bind:value={draft.next_milestone} placeholder="What has to land next" />
					</FormField>
					<FormField label="Target close">
						<Input type="date" bind:value={draft.target_close} mono />
					</FormField>
				</div>
				<div class="form-actions">
					<Button type="submit" disabled={busy}>Create project</Button>
				</div>
			</form>
		</Card>
	</div>
{/if}

{#if data.projects.length === 0 && !showForm}
	<p class="empty">No projects yet. Create the first one to link action items to it.</p>
{:else}
	{#each byPhase as group (group.phase)}
		<section class="phase">
			<h2 class="label-mono">{PHASE_LABELS[group.phase]} ({group.rows.length})</h2>
			{#if group.rows.length === 0}
				<p class="phase-empty">Nothing in this phase.</p>
			{:else}
				<ul class="rows">
					{#each group.rows as project (project.id)}
						<li>
							<a class="row" href="/projects/{project.id}">
								<span class="name">
									{project.name}
									{#if project.client_name}<span class="client">{project.client_name}</span>{/if}
								</span>
								<span class="milestone mono">
									{#if project.next_milestone}
										{project.next_milestone}
									{:else}
										No milestone set
									{/if}
									{#if project.target_close}
										<span class="sep">·</span>{formatDay(project.target_close)}
									{/if}
								</span>
								<span class="counts mono">
									{#if (project.overdue_action_items ?? 0) > 0}
										<span class="overdue">{project.overdue_action_items} overdue</span>
									{:else}
										{project.open_action_items ?? 0} open
									{/if}
								</span>
								<StatusChip
									tone={PROJECT_STATUS_TONE[project.status]}
									label={PROJECT_STATUS_LABELS[project.status]}
									size="sm"
								/>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/each}
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

	.form-wrap {
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

	.empty {
		margin-top: var(--space-5);
		padding: var(--space-7) var(--space-4);
		text-align: center;
		color: var(--text-secondary);
		background: var(--surface-card);
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-md);
	}

	.phase {
		margin-top: var(--space-5);
	}

	.phase h2 {
		font-size: var(--text-xs);
		margin-bottom: var(--space-2);
	}

	.phase-empty {
		padding-left: var(--space-3);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	/* Mobile first: the row stacks at 412px and becomes a grid at 720px. */
	.row {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-2);
		align-items: start;
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

	.row:hover .name {
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.name {
		font-weight: var(--weight-medium);
		overflow-wrap: anywhere;
	}

	.client {
		display: block;
		margin-top: 2px;
		font-size: var(--text-xs);
		font-weight: var(--weight-regular);
		color: var(--text-secondary);
	}

	.milestone,
	.counts {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.sep {
		margin: 0 var(--space-1);
	}

	.overdue {
		color: var(--red);
		font-weight: var(--weight-medium);
	}

	@media (min-width: 720px) {
		.grid {
			grid-template-columns: 1fr 1fr;
		}

		.span-all {
			grid-column: 1 / -1;
		}

		.row {
			grid-template-columns: 2fr 1.6fr auto auto;
			gap: var(--space-4);
			align-items: center;
		}
	}
</style>
