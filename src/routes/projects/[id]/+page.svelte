<script lang="ts">
	import { apiWrite } from '$lib/http';
	import {
		TICKET_PRIORITIES,
		TICKET_PRIORITY_LABELS,
		TICKET_STATUS_LABELS,
		TICKET_STATUS_TONE,
		estimateVariance
	} from '$lib/types';
	import { invalidateAll } from '$app/navigation';
	import {
		PHASE_LABELS,
		PROJECT_PHASES,
		PROJECT_STATUS_LABELS,
		PROJECT_STATUS_TONE,
		PROJECT_STATUSES,
		STATUS_LABELS,
		nextPhase
	} from '$lib/types';
	import type { ProjectPhase, ProjectStatus } from '$lib/types';
	import { deadlineLabel, formatDay } from '$lib/format';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import FormField from '$lib/components/FormField.svelte';
	import Input from '$lib/components/Input.svelte';
	import Select from '$lib/components/Select.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import Textarea from '$lib/components/Textarea.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');
	let editing = $state(false);
	let edit = $state<Record<string, string>>({});

	const project = $derived(data.project);
	const upcoming = $derived(nextPhase(project.phase));
	const openItems = $derived(data.action_items.filter((i) => i.status !== 'done'));
	const doneItems = $derived(data.action_items.filter((i) => i.status === 'done'));

	async function patch(body: Record<string, unknown>, message: string) {
		busy = true;
		errorMessage = '';
		try {
			const res = await fetch(`/api/projects/${project.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			const payload = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				errorMessage = payload.error ?? 'The update failed.';
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

	function startEdit() {
		editing = true;
		errorMessage = '';
		edit = {
			name: project.name,
			client_id: project.client_id ?? '',
			next_milestone: project.next_milestone ?? '',
			start_date: project.start_date ?? '',
			target_close: project.target_close ?? '',
			description: project.description ?? ''
		};
	}

	async function saveEdit(event: SubmitEvent) {
		event.preventDefault();
		if (await patch({ ...edit }, 'Project updated.')) editing = false;
	}

	const summary = $derived.by(() => {
		const bits: string[] = [];
		if (project.client_name) bits.push(project.client_name);
		bits.push(`${PHASE_LABELS[project.phase]} phase`);
		if (project.next_milestone) bits.push(`next milestone ${project.next_milestone}`);
		if (project.target_close) bits.push(`target close ${formatDay(project.target_close)}`);
		return bits.join(' · ');
	});

	/**
	 * Tickets under this project.
	 *
	 * Live work first, finished at the bottom, because the list is read to find
	 * what to do next rather than to audit what happened.
	 */
	const liveTickets = $derived(
		data.tickets.filter((t) => t.status !== 'done' && t.status !== 'cancelled')
	);
	const closedTickets = $derived(
		data.tickets.filter((t) => t.status === 'done' || t.status === 'cancelled')
	);

	let showTicketForm = $state(false);
	let ticketDraft = $state({
		title: '',
		description: '',
		start_date: '',
		due_date: '',
		estimate_hours: '',
		priority: 'normal',
		assignee: ''
	});

	async function createTicket(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		errorMessage = '';
		const result = await apiWrite('/api/tickets', 'POST', {
			...ticketDraft,
			project_id: project.id,
			estimate_hours: ticketDraft.estimate_hours === '' ? null : ticketDraft.estimate_hours
		});
		if (!result.ok) {
			errorMessage = result.error ?? 'Could not create the ticket.';
		} else {
			ticketDraft = {
				title: '',
				description: '',
				start_date: '',
				due_date: '',
				estimate_hours: '',
				priority: 'normal',
				assignee: ''
			};
			showTicketForm = false;
			await invalidateAll();
		}
		busy = false;
	}
</script>

<svelte:head>
	<title>{project.name} | Command Center</title>
</svelte:head>

<nav class="crumbs mono" aria-label="Breadcrumb">
	<a href="/projects">Projects</a>
	<span aria-hidden="true">/</span>
	<span>{project.name}</span>
</nav>

<header class="head">
	<div class="titles">
		<h1>{project.name}</h1>
		<StatusChip
			tone={PROJECT_STATUS_TONE[project.status]}
			label={PROJECT_STATUS_LABELS[project.status]}
		/>
	</div>
	<Button variant="secondary" onclick={() => (editing ? (editing = false) : startEdit())}>
		{editing ? 'Cancel' : 'Edit'}
	</Button>
</header>

<p class="sub">{summary}</p>

<p class="status-line" role="status" aria-live="polite">{notice}</p>

{#if errorMessage}
	<p class="error-banner" role="alert">{errorMessage}</p>
{/if}

{#if editing}
	<div class="block">
		<Card title="Edit project">
			<form onsubmit={saveEdit}>
				<div class="grid">
					<div class="span-all">
						<FormField label="Name">
							<Input bind:value={edit.name} maxlength={200} required />
						</FormField>
					</div>
					<div class="span-all">
						<FormField label="Client">
							<Select bind:value={edit.client_id}>
								<option value="">No client</option>
								{#each data.clients as client (client.id)}
									<option value={client.id}>{client.name}</option>
								{/each}
							</Select>
						</FormField>
					</div>
					<FormField label="Start date">
						<Input type="date" bind:value={edit.start_date} mono />
					</FormField>
					<FormField label="Target close">
						<Input type="date" bind:value={edit.target_close} mono />
					</FormField>
					<div class="span-all">
						<FormField label="Next milestone">
							<Input bind:value={edit.next_milestone} maxlength={300} />
						</FormField>
					</div>
					<div class="span-all">
						<FormField label="Description">
							<Textarea bind:value={edit.description} />
						</FormField>
					</div>
				</div>
				<div class="row-actions">
					<Button type="submit" disabled={busy}>Save</Button>
				</div>
			</form>
		</Card>
	</div>
{/if}

<div class="block">
	<Card title="Lifecycle">
		<ol class="rail">
			{#each PROJECT_PHASES as phase, i (phase)}
				{@const current = PROJECT_PHASES.indexOf(project.phase)}
				<li class="step" class:done={i < current} class:now={i === current}>
					<span class="dot" aria-hidden="true"></span>
					<span class="step-label">{PHASE_LABELS[phase]}</span>
					{#if i === current}<span class="visually-hidden">, current phase</span>{/if}
				</li>
			{/each}
		</ol>

		<div class="controls">
			{#if upcoming}
				<Button
					variant="secondary"
					disabled={busy}
					onclick={() => patch({ phase: upcoming }, `Advanced to ${PHASE_LABELS[upcoming]}.`)}
				>
					Advance to {PHASE_LABELS[upcoming]}
				</Button>
			{:else}
				<p class="note">Closing is the final phase.</p>
			{/if}

			<div class="status-control">
				<FormField label="Status">
					<Select
						value={project.status}
						disabled={busy}
						onchange={(event) => {
							const value = (event.currentTarget as HTMLSelectElement).value as ProjectStatus;
							patch({ status: value }, `Status set to ${PROJECT_STATUS_LABELS[value]}.`);
						}}
					>
						{#each PROJECT_STATUSES as status (status)}
							<option value={status}>{PROJECT_STATUS_LABELS[status]}</option>
						{/each}
					</Select>
				</FormField>
			</div>
		</div>
	</Card>
</div>

<div class="block">
	<Card title="Action items" subtitle="{openItems.length} open, {doneItems.length} done" padded={false}>
		{#snippet actions()}
			<Button href="/actions?view=all&project_id={project.id}" variant="ghost" size="sm">
				Open in tracker
			</Button>
		{/snippet}

		{#if data.action_items.length === 0}
			<p class="empty">
				No action items linked yet. Create one in the tracker and set its project to
				{project.name}.
			</p>
		{:else}
			<ul class="items">
				{#each data.action_items as item (item.id)}
					{@const due = deadlineLabel(item.deadline, data.today, item.status)}
					<li class="item" class:flag={due.tone === 'overdue'}>
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

<Card
	title="Tickets"
	subtitle="{liveTickets.length} open, {closedTickets.length} closed"
	padded={false}
>
	{#snippet actions()}
		<Button variant="secondary" size="sm" onclick={() => (showTicketForm = !showTicketForm)}>
			{showTicketForm ? 'Cancel' : 'New ticket'}
		</Button>
	{/snippet}

	{#if showTicketForm}
		<form class="ticket-form" onsubmit={createTicket}>
			<div class="grid">
				<div class="span-all">
					<FormField label="Title">
						<Input bind:value={ticketDraft.title} maxlength={300} required />
					</FormField>
				</div>
				<FormField label="Assignee">
					<Select bind:value={ticketDraft.assignee}>
						<option value="">Unassigned</option>
						{#each data.owners as name (name)}
							<option value={name}>{name}</option>
						{/each}
					</Select>
				</FormField>
				<FormField label="Priority">
					<Select bind:value={ticketDraft.priority}>
						{#each TICKET_PRIORITIES as p (p)}
							<option value={p}>{TICKET_PRIORITY_LABELS[p]}</option>
						{/each}
					</Select>
				</FormField>
				<FormField label="Start">
					<Input type="date" bind:value={ticketDraft.start_date} mono />
				</FormField>
				<FormField label="Due">
					<Input type="date" bind:value={ticketDraft.due_date} mono />
				</FormField>
				<FormField label="Estimate, hours" hint="Optional. Actual is summed from time entries.">
					<Input type="number" step="0.25" min="0.25" bind:value={ticketDraft.estimate_hours} mono />
				</FormField>
				<div class="span-all">
					<FormField label="Description">
						<Textarea bind:value={ticketDraft.description} rows={3} maxlength={8000} />
					</FormField>
				</div>
			</div>
			<div class="form-actions">
				<Button type="submit" disabled={busy}>Create ticket</Button>
			</div>
		</form>
	{/if}

	{#if data.tickets.length === 0}
		<p class="empty">No tickets on this project yet.</p>
	{:else}
		<ul class="ticket-rows">
			{#each [...liveTickets, ...closedTickets] as ticket (ticket.id)}
				{@const variance = estimateVariance(ticket.estimate_hours, ticket.actual_hours)}
				<li class="ticket-row" class:closed={ticket.status === 'done' || ticket.status === 'cancelled'}>
					<a class="ticket-body" href="/tickets/{ticket.id}">
						<span class="ticket-title">{ticket.title}</span>
						<span class="ticket-meta mono">
							{ticket.assignee ?? 'Unassigned'}{ticket.due_date
								? `, due ${formatDay(ticket.due_date)}`
								: ''}{ticket.estimate_hours
								? `, ${ticket.actual_hours ?? 0} of ${ticket.estimate_hours}h`
								: ''}{variance ? `, ${variance.text}` : ''}
						</span>
					</a>
					{#if ticket.priority === 'urgent' || ticket.priority === 'high'}
						<StatusChip
							tone={ticket.priority === 'urgent' ? 'overdue' : 'atrisk'}
							label={TICKET_PRIORITY_LABELS[ticket.priority]}
							size="sm"
						/>
					{/if}
					<StatusChip
						tone={TICKET_STATUS_TONE[ticket.status]}
						label={TICKET_STATUS_LABELS[ticket.status]}
						size="sm"
					/>
				</li>
			{/each}
		</ul>
	{/if}
</Card>

{#if project.description}
	<div class="block">
		<Card title="Description">
			<p class="description">{project.description}</p>
		</Card>
	</div>
{/if}

<style>
	.ticket-form {
		padding: var(--space-4);
		border-bottom: 1px solid var(--border-thin);
	}

	.ticket-rows {
		list-style: none;
		margin: 0;
		padding: var(--space-2);
	}

	.ticket-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2);
		border-radius: var(--radius-sm);
	}

	.ticket-row.closed .ticket-title {
		color: var(--text-secondary);
	}

	.ticket-body {
		flex: 1;
		min-width: 0;
		display: block;
		color: inherit;
		text-decoration: none;
	}

	.ticket-title {
		display: block;
		overflow-wrap: anywhere;
	}

	.ticket-meta {
		display: block;
		margin-top: 2px;
		font-size: var(--text-xs);
		color: var(--text-secondary);
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
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}

	.sub {
		margin-top: var(--space-2);
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

	.row-actions {
		margin-top: var(--space-4);
	}

	/* Phase rail. Stacked at 412px, horizontal from 720px. Never colour only:
	   the current phase is also announced to assistive tech. */
	.rail {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		counter-reset: step;
	}

	.step {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.dot {
		flex: none;
		width: 10px;
		height: 10px;
		border-radius: 999px;
		border: 2px solid var(--border-control);
		background: var(--surface-card);
	}

	.step.done .dot {
		background: var(--green);
		border-color: var(--green);
	}

	.step.now .dot {
		background: var(--navy);
		border-color: var(--navy);
	}

	.step.now .step-label {
		color: var(--navy);
		font-weight: var(--weight-medium);
	}

	.step.done .step-label {
		color: var(--text-secondary);
	}

	.controls {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-top: var(--space-4);
		padding-top: var(--space-4);
		border-top: 1px solid var(--border-thin);
	}

	.status-control {
		max-width: 240px;
	}

	.note {
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.items {
		list-style: none;
		margin: 0;
		padding: var(--space-2);
	}

	.item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-left: 2px solid transparent;
		border-radius: var(--radius-sm);
	}

	.item.flag {
		border-left-color: var(--gold);
	}

	.item-body {
		min-width: 0;
	}

	.item-title {
		display: block;
		overflow-wrap: anywhere;
	}

	.item-meta {
		display: block;
		margin-top: 2px;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.empty {
		padding: var(--space-5) var(--space-4);
		text-align: center;
		color: var(--text-secondary);
	}

	.description {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	@media (min-width: 720px) {
		.grid {
			grid-template-columns: 1fr 1fr;
		}

		.span-all {
			grid-column: 1 / -1;
		}

		.rail {
			flex-direction: row;
			flex-wrap: wrap;
			gap: var(--space-4);
		}

		.controls {
			flex-direction: row;
			align-items: flex-end;
			justify-content: space-between;
		}
	}
</style>
