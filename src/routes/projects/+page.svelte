<script lang="ts">
	import { apiWrite } from '$lib/http';
	import { invalidateAll } from '$app/navigation';
	import {
		PHASE_LABELS,
		PROJECT_PHASES,
		PROJECT_STATUS_LABELS,
		PROJECT_STATUS_TONE,
		PROJECT_STATUSES
	} from '$lib/types';
	import type { Project, ProjectPhase } from '$lib/types';
	import { formatDay, formatDayShort } from '$lib/format';
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
			const result = await apiWrite('/api/projects', 'POST', draft);
			if (!result.ok) {
				errorMessage = result.error ?? 'Could not create the project.';
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

	/* ---------------------------------------------------------------------
	 * Filtering the table
	 * ------------------------------------------------------------------ */

	let phaseFilter = $state<ProjectPhase | 'all'>('all');
	let search = $state('');

	const visible = $derived.by(() => {
		const needle = search.trim().toLowerCase();
		return data.projects.filter((project) => {
			if (phaseFilter !== 'all' && project.phase !== phaseFilter) return false;
			if (!needle) return true;
			return [project.name, project.client_name, project.next_milestone_shown]
				.filter(Boolean)
				.some((text) => String(text).toLowerCase().includes(needle));
		});
	});

	/**
	 * How far along a project is, counted rather than stored.
	 *
	 * Milestones win when a project has them, because a plan somebody wrote is a
	 * better measure of progress than a count of tasks. Items are the fallback.
	 * A project with neither returns null rather than zero: nothing to count is
	 * not the same as nothing done, and an empty bar says the second. D27.
	 */
	function progressOf(project: Project): number | null {
		const milestones = project.milestone_count ?? 0;
		if (milestones > 0) {
			return Math.round(((project.milestones_done ?? 0) / milestones) * 100);
		}
		const items = project.all_action_items ?? 0;
		if (items > 0) return Math.round(((project.done_action_items ?? 0) / items) * 100);
		return null;
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

<!--
	The archived view, offered only when there is one.

	24 of the 66 mirrored projects are archived, and mixing them into live work
	by default would make this a worse version of Asana. They are reachable
	rather than dropped: an archived project holds finished work somebody asks
	about, which is why it was pulled. D172, and D27 for showing the tab only
	when the count is not zero.
-->
{#if data.counts.archived > 0}
	<nav class="views" aria-label="Which projects to show">
		<a href="/projects" aria-current={data.archived === 'no' ? 'page' : undefined}>
			Live <span class="n">{data.counts.live}</span>
		</a>
		<a href="/projects?archived=only" aria-current={data.archived === 'only' ? 'page' : undefined}>
			Archived <span class="n">{data.counts.archived}</span>
		</a>
		<a href="/projects?archived=all" aria-current={data.archived === 'all' ? 'page' : undefined}>
			All <span class="n">{data.counts.live + data.counts.archived}</span>
		</a>
	</nav>
{/if}

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

<!--
	Phase tabs, and a table rather than five stacked lists.

	The lists were correct and unusable at 192 projects: five headings, each
	with dozens of rows, and no way to compare two projects in different phases.
	The redesign turns it into one table with the phase as a filter, which is
	what a person scanning for what needs attention actually does.
-->
<nav class="tabs" aria-label="Filter by phase">
	<button type="button" class="tab" class:on={phaseFilter === 'all'} onclick={() => (phaseFilter = 'all')}>
		All <span class="count mono">{data.projects.length}</span>
	</button>
	{#each PROJECT_PHASES as phase (phase)}
		<button
			type="button"
			class="tab"
			class:on={phaseFilter === phase}
			onclick={() => (phaseFilter = phase)}
		>
			{PHASE_LABELS[phase]}
			<span class="count mono">{data.projects.filter((p) => p.phase === phase).length}</span>
		</button>
	{/each}
</nav>

<div class="controls">
	<input
		class="search"
		type="search"
		bind:value={search}
		placeholder="Search projects and clients"
		aria-label="Search projects"
	/>
</div>

{#if visible.length === 0}
	<p class="empty">
		{#if search}
			No projects match that search.
		{:else if data.projects.length === 0}
			No projects yet. Create the first one to link action items to it.
		{:else}
			Nothing in this phase.
		{/if}
	</p>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th scope="col">Project</th>
					<th scope="col">Client</th>
					<th scope="col">Phase</th>
					<th scope="col">Progress</th>
					<th scope="col">Target</th>
					<th scope="col" class="num">Open</th>
					<th scope="col" class="num">Tickets</th>
					<th scope="col">Status</th>
				</tr>
			</thead>
			<tbody>
				{#each visible as project (project.id)}
					{@const done = progressOf(project)}
					<tr>
						<td>
							<a class="name" href="/projects/{project.id}">{project.name}</a>
							{#if project.next_milestone_shown}
								<span class="milestone">Next: {project.next_milestone_shown}</span>
							{/if}
						</td>
						<td>
							{#if project.client_id}
								<a href="/clients/{project.client_id}">{project.client_name}</a>
							{:else}
								<span class="dim">No client</span>
							{/if}
						</td>
						<td class="mono">{PHASE_LABELS[project.phase]}</td>
						<td>
							{#if done === null}
								<!--
									D27: nothing to count is not zero per cent. A project with
									no milestones and no items is untracked, and drawing an
									empty bar would say the work has not started.
								-->
								<span class="dim mono">Not tracked</span>
							{:else}
								<span class="progress">
									<span class="progress-bar" aria-hidden="true">
										<span class="progress-fill" style="width: {done}%"></span>
									</span>
									<span class="progress-text mono">{done}%</span>
								</span>
							{/if}
						</td>
						<td class="mono nowrap">
							{#if project.target_close}
								{formatDayShort(project.target_close)}
							{:else}
								<span class="dim">None</span>
							{/if}
						</td>
						<td class="num mono">
							{#if (project.overdue_action_items ?? 0) > 0}
								<span class="overdue">{project.open_action_items ?? 0}</span>
							{:else}
								{project.open_action_items ?? 0}
							{/if}
						</td>
						<td class="num mono">{project.open_tickets ?? 0}</td>
						<td>
							<StatusChip
								tone={PROJECT_STATUS_TONE[project.status]}
								label={PROJECT_STATUS_LABELS[project.status]}
								size="sm"
							/>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.views {
		display: flex;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
		flex-wrap: wrap;
	}

	.views a {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		/* D22: 44px tap floor. */
		min-height: 44px;
		padding: 0 var(--space-4);
		border-radius: var(--radius-2);
		border: 1px solid var(--border-thin);
		background: var(--surface-card);
		color: var(--text-secondary);
		text-decoration: none;
		font-size: 0.875rem;
		font-weight: 600;
	}

	.views a[aria-current='page'] {
		background: var(--navy);
		border-color: var(--navy);
		color: var(--text-inverse);
	}

	.views .n {
		font-variant-numeric: tabular-nums;
		opacity: 0.75;
	}


	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: var(--space-4) 0 var(--space-3);
	}

	.tab {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 44px;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-thin);
		border-radius: 999px;
		background: transparent;
		color: var(--text-muted);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}

	.tab.on {
		background: var(--navy-700);
		border-color: var(--navy-700);
		color: var(--surface-page);
	}

	.count {
		font-size: var(--text-xs);
		opacity: 0.75;
	}

	.controls {
		margin-bottom: var(--space-3);
	}

	.search {
		width: 100%;
		min-height: 44px;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-sm);
		font: inherit;
		font-size: var(--text-sm);
	}

	.table-wrap {
		overflow-x: auto;
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		background: var(--surface-card);
	}

	table {
		width: 100%;
		min-width: 900px;
		border-collapse: collapse;
	}

	th,
	td {
		padding: var(--space-3);
		text-align: left;
		vertical-align: top;
		border-bottom: 1px solid var(--border-hairline);
	}

	th {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
		font-weight: 400;
		white-space: nowrap;
	}

	tbody tr:last-child td {
		border-bottom: none;
	}

	.num {
		text-align: right;
	}

	.nowrap {
		white-space: nowrap;
	}

	.name {
		display: block;
		color: var(--text-heading);
		font-size: var(--text-sm);
	}

	.milestone {
		display: block;
		margin-top: 2px;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.progress {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.progress-bar {
		display: block;
		width: 64px;
		height: 4px;
		border-radius: 2px;
		background: var(--border-hairline);
		overflow: hidden;
		flex: none;
	}

	.progress-fill {
		display: block;
		height: 100%;
		background: var(--green-700, #2e7d5b);
	}

	.progress-text {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
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





	/* Mobile first: the row stacks at 412px and becomes a grid at 720px. */



	.name {
		font-weight: var(--weight-medium);
		overflow-wrap: anywhere;
	}

	/*
	 * The client column, shipped once Clients existed.
	 *
	 * It was previously tucked under the project name and hidden entirely when
	 * null, because at MVP there was no way to assign a client and every row
	 * would have read "no client". Assigning one is a real affordance now, so an
	 * unassigned project is a fact worth showing rather than an absence to hide.
	 * D27 read the other way round: the column is honest now that the feature
	 * behind it exists.
	 */


	.milestone,


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

	}
</style>
