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
	import type { ProjectPhase, ProjectStatus, Ticket } from '$lib/types';
	import { deadlineLabel, formatDay, formatDayShort } from '$lib/format';
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
			const result = await apiWrite(`/api/projects/${project.id}`, 'PATCH', body);
			if (!result.ok) {
				errorMessage = result.error ?? 'The update failed.';
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

	const openTickets = $derived(liveTickets.length);

	/**
	 * Overdue is open and past due, measured against the working day.
	 *
	 * The same definition the API uses, because a row shown in red here and
	 * counted as fine there would be two answers to one question.
	 */
	const overdueTickets = $derived(
		liveTickets.filter((t) => t.due_date && t.due_date < data.today).length
	);

	/**
	 * Advancing the phase, with the consequence stated before it happens.
	 *
	 * A confirm rather than a disabled button. Work legitimately carries across a
	 * phase boundary, and an app that refuses is an app somebody stops using;
	 * what it must not do is move the phase while quietly leaving open work
	 * behind the reader's back.
	 */
	async function advance(to: string) {
		if (openTickets > 0) {
			const late = overdueTickets > 0 ? `, ${overdueTickets} of them overdue` : '';
			const ok = confirm(
				`${openTickets} ${openTickets === 1 ? 'ticket is' : 'tickets are'} still open on this project${late}.

` +
					`Move to ${PHASE_LABELS[to as ProjectPhase]} anyway?`
			);
			if (!ok) return;
		}
		await patch({ phase: to }, `Advanced to ${PHASE_LABELS[to as ProjectPhase]}.`);
	}

	/** A ticket is late when it is still open and its due date has passed. */
	function isOverdue(t: { status: string; due_date: string | null }): boolean {
		return (
			t.status !== 'done' &&
			t.status !== 'cancelled' &&
			Boolean(t.due_date) &&
			(t.due_date as string) < data.today
		);
	}

	/** The first line of a description, for scanning without opening. */
	function snippet(text: string): string {
		const flat = text.replace(/\s+/g, ' ').trim();
		return flat.length > 140 ? `${flat.slice(0, 139)}…` : flat;
	}

	const TICKET_FILTERS = [
		{ key: 'open', label: 'Open' },
		{ key: 'overdue', label: 'Overdue' },
		{ key: 'unassigned', label: 'Unassigned' },
		{ key: 'done', label: 'Done' },
		{ key: 'all', label: 'All' }
	] as const;

	type TicketFilter = (typeof TICKET_FILTERS)[number]['key'];

	let ticketFilter = $state<TicketFilter>('open');

	function matches(t: Ticket, key: TicketFilter): boolean {
		if (key === 'all') return true;
		if (key === 'open') return t.status !== 'done' && t.status !== 'cancelled';
		if (key === 'done') return t.status === 'done' || t.status === 'cancelled';
		if (key === 'overdue') return isOverdue(t);
		return !t.assignee;
	}

	/** How many each filter would show, so a chip that leads nowhere says zero. D27. */
	function countFor(key: TicketFilter): number {
		return data.tickets.filter((t) => matches(t, key)).length;
	}

	const shownTickets = $derived(
		[...liveTickets, ...closedTickets].filter((t) => matches(t, ticketFilter))
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

	/* ---------------------------------------------------------------------
	 * Milestones
	 * ------------------------------------------------------------------ */

	const milestonesDone = $derived(data.milestones.filter((m) => m.done_at).length);

	let milestoneDraft = $state({ title: '', due_date: '' });

	async function addMilestone(event: SubmitEvent) {
		event.preventDefault();
		if (!milestoneDraft.title.trim()) {
			errorMessage = 'Give the milestone a name.';
			return;
		}
		busy = true;
		errorMessage = '';
		const res = await apiWrite(`/api/projects/${project.id}/milestones`, 'POST', {
			title: milestoneDraft.title,
			due_date: milestoneDraft.due_date || null
		});
		busy = false;
		if (res.ok) {
			milestoneDraft = { title: '', due_date: '' };
			await invalidateAll();
		} else {
			errorMessage = res.error ?? 'Could not add that milestone.';
		}
	}

	async function setMilestone(id: string, done: boolean) {
		busy = true;
		const res = await apiWrite(`/api/projects/${project.id}/milestones/${id}`, 'PATCH', { done });
		busy = false;
		if (res.ok) await invalidateAll();
		else errorMessage = res.error ?? 'Could not change that milestone.';
	}

	async function removeMilestone(id: string) {
		busy = true;
		const res = await apiWrite(`/api/projects/${project.id}/milestones/${id}`, 'DELETE', null);
		busy = false;
		if (res.ok) await invalidateAll();
		else errorMessage = res.error ?? 'Could not remove that milestone.';
	}

	/* ---------------------------------------------------------------------
	 * Files
	 * ------------------------------------------------------------------ */

	let fileInput = $state<HTMLInputElement | null>(null);
	let uploading = $state(false);
	let dragging = $state(false);

	const kb = (bytes: number) =>
		bytes >= 1_048_576
			? `${(bytes / 1_048_576).toFixed(1)} MB`
			: `${Math.max(1, Math.round(bytes / 1024))} KB`;

	/**
	 * One request per file, and every failure named.
	 *
	 * A single multipart body carrying five files fails as one thing, and the
	 * reader is told the upload failed with no way to know four were fine.
	 */
	async function sendFiles(files: File[]) {
		if (files.length === 0) return;
		uploading = true;
		errorMessage = '';
		const failed: string[] = [];

		for (const file of files) {
			const form = new FormData();
			form.set('file', file);
			const res = await fetch(`/api/projects/${project.id}/files`, {
				method: 'POST',
				body: form
			}).catch(() => null);

			if (!res || !res.ok) {
				const body = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : null;
				failed.push(`${file.name}: ${body?.error ?? 'could not be uploaded'}`);
			}
		}

		uploading = false;
		if (failed.length > 0) errorMessage = failed.join('. ');
		await invalidateAll();
	}

	async function uploadFiles(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		await sendFiles([...(input.files ?? [])]);
		// Cleared so choosing the same file twice in a row still fires a change.
		input.value = '';
	}

	async function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		await sendFiles([...(event.dataTransfer?.files ?? [])]);
	}

	async function removeFile(id: string, filename: string) {
		busy = true;
		const res = await apiWrite(`/api/projects/${project.id}/files/${id}`, 'DELETE', null);
		busy = false;
		if (res.ok) {
			notice = `Removed ${filename}.`;
			await invalidateAll();
		} else {
			errorMessage = res.error ?? 'Could not remove that file.';
		}
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
				<!--
					Advancing with work still open is possible and is not silent.

					Disabling it outright would be wrong: a phase can legitimately move
					on while tickets stay open, and an app that refuses is an app
					somebody works around. So the button asks, names the number, and
					makes the person say yes. D27's other half: an affordance that
					exists should work, and one with a consequence should say what it
					is before it happens.
				-->
				<Button
					variant="secondary"
					disabled={busy}
					onclick={() => advance(upcoming)}
				>
					Advance to {PHASE_LABELS[upcoming]}
				</Button>
				{#if openTickets > 0}
					<p class="note warn">
						{openTickets}
						{openTickets === 1 ? 'ticket is' : 'tickets are'} still open on this project{overdueTickets >
						0
							? `, ${overdueTickets} of them overdue`
							: ''}.
					</p>
				{/if}
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

<div class="two-up">
	<!--
		The plan, and how much of it has landed.

		`projects.next_milestone` is a free-text column somebody types, and it
		stays: it is what every existing project has. Once a project has real
		milestones the earliest undone one is the honest answer, so the read
		prefers these rows and the column is the fallback.
	-->
	<Card title="Milestones" subtitle="{milestonesDone} of {data.milestones.length} done">
		{#if data.milestones.length === 0}
			<p class="empty">
				No milestones yet. Add the ones this project is actually measured against and the
				progress figure starts counting them instead of its action items.
			</p>
		{/if}

		<ul class="plan">
			{#each data.milestones as milestone (milestone.id)}
				<li class:done={milestone.done_at}>
					<label class="tick">
						<input
							type="checkbox"
							checked={Boolean(milestone.done_at)}
							disabled={busy}
							onchange={(e) =>
								setMilestone(milestone.id, (e.currentTarget as HTMLInputElement).checked)}
						/>
						<span class="plan-title">{milestone.title}</span>
					</label>
					<span class="plan-when mono">
						{#if milestone.due_date}{formatDayShort(milestone.due_date)}{:else}No date{/if}
					</span>
					<button
						type="button"
						class="ghost"
						disabled={busy}
						onclick={() => removeMilestone(milestone.id)}
						aria-label="Remove {milestone.title}"
					>
						Remove
					</button>
				</li>
			{/each}
		</ul>

		<form class="add-row" onsubmit={addMilestone}>
			<Input bind:value={milestoneDraft.title} placeholder="What has to land" maxlength={300} />
			<Input bind:value={milestoneDraft.due_date} type="date" aria-label="Due date" />
			<Button type="submit" variant="secondary" disabled={busy}>Add</Button>
		</form>
	</Card>

	<!--
		Whatever the work produced. Unlike contracts and receipts there is no type
		allowlist: a project file is a spreadsheet, an export, an archive, a design
		somebody sent, and refusing the next legitimate format would teach people
		to put files somewhere else. The read route always serves them as a
		download, never inline, so a file is a file.
	-->
<!--
	The client's Dropbox, on the project page.

	Separate from the uploads card below and deliberately: those are files
	somebody put here on purpose, this is a view of where the client's work
	actually lives. Merging them would make one list where nothing says which of
	the two a row is, and only one of them can be deleted from this page.
-->
{#if data.dropbox.total > 0}
	<div class="block">
		<Card
			title="Client files in Dropbox"
			subtitle="{data.dropbox.total.toLocaleString()} in this client's folder"
		>
			{#snippet actions()}
				{#if project.client_id}
					<Button variant="ghost" size="sm" href="/files?client_id={project.client_id}">
						See all
					</Button>
				{/if}
			{/snippet}

			<ul class="mirror-files">
				{#each data.dropbox.files.slice(0, 8) as file (file.path)}
					<li>
						<span class="mf-name">{file.name}</span>
						<span class="mf-meta">
							{file.modified_at ? file.modified_at.slice(0, 10) : 'unknown'}
						</span>
					</li>
				{/each}
			</ul>
			<p class="mirror-note">
				Names and dates only, mirrored from Dropbox. Dropbox is the source of truth and
				nothing here changes it.
			</p>
		</Card>
	</div>
{/if}

	<Card title="Files" subtitle="{data.files.length} uploaded here">
		{#snippet actions()}
			<Button variant="ghost" size="sm" disabled={uploading} onclick={() => fileInput?.click()}>
				{uploading ? 'Uploading' : 'Upload'}
			</Button>
		{/snippet}

		<input
			bind:this={fileInput}
			class="hidden-input"
			type="file"
			multiple
			onchange={uploadFiles}
		/>

		<div
			class="drop"
			class:over={dragging}
			role="button"
			tabindex="0"
			aria-label="Upload files to this project"
			ondragover={(e) => {
				e.preventDefault();
				dragging = true;
			}}
			ondragleave={() => (dragging = false)}
			ondrop={onDrop}
			onclick={() => fileInput?.click()}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					fileInput?.click();
				}
			}}
		>
			Drop files here or press to browse. Several at once is fine, up to 25 MB each.
		</div>

		{#if data.files.length === 0}
			<p class="empty">Nothing attached yet.</p>
		{:else}
			<ul class="files">
				{#each data.files as file (file.id)}
					<li>
						<a class="file-name" href="/api/projects/{project.id}/files/{file.id}">
							{file.filename}
						</a>
						<span class="file-meta mono">
							{kb(file.size_bytes)} · {formatDayShort(file.uploaded_at.slice(0, 10))}
						</span>
						<button
							type="button"
							class="ghost"
							disabled={busy}
							onclick={() => removeFile(file.id, file.filename)}
							aria-label="Remove {file.filename}"
						>
							Remove
						</button>
					</li>
				{/each}
			</ul>
		{/if}
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

	<!--
		Quick filters, because a project with 56 tickets is unusable as one list.

		In component state rather than the URL: unlike the Projects views these
		are a momentary narrowing of a list on a page somebody is already reading,
		not a view worth sending to anybody.
	-->
	{#if data.tickets.length > 0}
		<div class="ticket-filters">
			{#each TICKET_FILTERS as f (f.key)}
				<button
					type="button"
					class="chip-filter"
					class:on={ticketFilter === f.key}
					aria-pressed={ticketFilter === f.key}
					onclick={() => (ticketFilter = f.key)}
				>
					{f.label}
					<span class="chip-n">{countFor(f.key)}</span>
				</button>
			{/each}
		</div>
	{/if}

	{#if data.tickets.length === 0}
		<p class="empty">No tickets on this project yet.</p>
	{:else if shownTickets.length === 0}
		<p class="empty">No tickets match that filter.</p>
	{:else}
		<ul class="ticket-rows">
			{#each shownTickets as ticket (ticket.id)}
				{@const variance = estimateVariance(ticket.estimate_hours, ticket.actual_hours)}
				{@const late = isOverdue(ticket)}
				<li
					class="ticket-row"
					class:closed={ticket.status === 'done' || ticket.status === 'cancelled'}
					class:late
				>
					<a class="ticket-body" href="/tickets/{ticket.id}">
						<span class="ticket-title">
							{ticket.title}
							{#if late}<span class="late-flag">Overdue</span>{/if}
						</span>

						<!--
							The middle of the row was empty and the useful facts were in a
							single grey line. A person scanning 56 tickets needs to see who
							has it, when it is due and what it is about without opening
							each one.
						-->
						{#if ticket.description}
							<span class="ticket-snippet">{snippet(ticket.description)}</span>
						{/if}

						<span class="ticket-meta mono">
							<span class:unassigned={!ticket.assignee}>
								{ticket.assignee ?? 'Unassigned'}
							</span>
							{#if ticket.due_date}
								<span class:late>due {formatDay(ticket.due_date)}</span>
							{/if}
							{#if ticket.asana_section}<span class="sect">{ticket.asana_section}</span>{/if}
							{#if ticket.estimate_hours}
								<span>{ticket.actual_hours ?? 0} of {ticket.estimate_hours}h</span>
							{/if}
							{#if variance}<span>{variance.text}</span>{/if}
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
	.mirror-files {
		list-style: none;
		margin: 0 0 var(--space-3);
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}

	.mirror-files li {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		align-items: baseline;
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--border-thin);
	}

	.mf-name {
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.mf-meta {
		color: var(--text-secondary);
		font-size: 0.8125rem;
		white-space: nowrap;
	}

	.mirror-note {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.8125rem;
	}

	.ticket-filters {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4) 0;
	}

	.chip-filter {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		/* D22: 44px tap floor. */
		min-height: 44px;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-2);
		background: var(--surface-card);
		color: var(--text-secondary);
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
	}

	.chip-filter.on {
		background: var(--navy);
		border-color: var(--navy);
		color: var(--text-inverse);
	}

	.chip-n {
		font-variant-numeric: tabular-nums;
		opacity: 0.75;
	}

	.ticket-snippet {
		display: block;
		color: var(--text-secondary);
		font-size: 0.8125rem;
		line-height: 1.5;
		margin-top: 2px;
	}

	/*
	 * Overdue is red, and never red alone.
	 *
	 * The word "Overdue" carries it for anyone who cannot separate the colours,
	 * and the left border carries it at a glance down a list of fifty. D20 keeps
	 * --red for overdue and nothing else.
	 */
	.ticket-row.late {
		border-left: 3px solid var(--red);
		padding-left: calc(var(--space-4) - 3px);
	}

	.late-flag {
		display: inline-block;
		margin-left: var(--space-2);
		padding: 1px var(--space-2);
		border-radius: var(--radius-1, 4px);
		background: var(--red-100);
		color: var(--red);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}

	.ticket-meta .late {
		color: var(--red);
		font-weight: 700;
	}

	.ticket-meta .unassigned {
		font-style: italic;
	}

	.ticket-meta .sect {
		color: var(--text-secondary);
	}

	.ticket-meta > span + span::before {
		content: ' · ';
		color: var(--border-strong);
	}


	.two-up {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		margin-top: var(--space-4);
		align-items: start;
	}

	@media (min-width: 900px) {
		.two-up {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.plan,
	.files {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.plan li,
	.files li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 44px;
		padding: var(--space-2) 0;
	}

	.plan li + li,
	.files li + li {
		border-top: 1px solid var(--border-hairline);
	}

	.tick {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: 1;
		min-width: 0;
		cursor: pointer;
	}

	.tick input {
		width: 18px;
		height: 18px;
		accent-color: var(--navy-600);
		flex: none;
	}

	.plan-title {
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}

	.plan li.done .plan-title {
		color: var(--text-muted);
		text-decoration: line-through;
	}

	.plan-when,
	.file-meta {
		font-size: var(--text-xs);
		color: var(--text-muted);
		flex: none;
	}

	.file-name {
		flex: 1;
		min-width: 0;
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}

	.add-row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex-wrap: wrap;
		margin-top: var(--space-3);
	}

	.add-row :global(input) {
		flex: 1;
		min-width: 120px;
	}

	.hidden-input {
		display: none;
	}

	.drop {
		margin: var(--space-3) 0;
		padding: var(--space-4);
		border: 1px dashed var(--border-thin);
		border-radius: var(--radius-md);
		text-align: center;
		font-size: var(--text-sm);
		color: var(--text-muted);
		cursor: pointer;
		min-height: 44px;
	}

	.drop:hover,
	.drop:focus-visible,
	.drop.over {
		border-color: var(--navy-600);
		color: var(--text-body);
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
		cursor: pointer;
		flex: none;
	}

	.ghost:hover:not(:disabled) {
		color: var(--text-body);
		border-color: var(--navy-600);
	}
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
