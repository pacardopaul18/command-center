<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { apiWrite } from '$lib/http';
	import { formatDay, formatDayShort, formatMoment } from '$lib/format';
	import {
		TICKET_PRIORITIES,
		TICKET_PRIORITY_LABELS,
		TICKET_STATUSES,
		TICKET_STATUS_LABELS,
		TICKET_STATUS_TONE,
		estimateVariance,
		formatMoney
	} from '$lib/types';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import FormField from '$lib/components/FormField.svelte';
	import Input from '$lib/components/Input.svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import Select from '$lib/components/Select.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import Textarea from '$lib/components/Textarea.svelte';
	import type { PageData } from './$types';

	/**
	 * One ticket.
	 *
	 * Estimate against actual is the number this page exists to show, and the
	 * actual is summed from the time booked to the ticket rather than typed. A
	 * variance against no estimate is not a small variance, it is an absent one,
	 * so it says nothing rather than zero.
	 */

	let { data }: { data: PageData } = $props();

	const ticket = $derived(data.ticket);
	const variance = $derived(estimateVariance(ticket.estimate_hours, ticket.actual_hours));

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');
	let editing = $state(false);

	let edit = $state<Record<string, string>>({});

	function startEdit() {
		edit = {
			title: ticket.title,
			start_date: ticket.start_date ?? '',
			due_date: ticket.due_date ?? '',
			estimate_hours: ticket.estimate_hours == null ? '' : String(ticket.estimate_hours),
			priority: ticket.priority,
			assignee: ticket.assignee ?? '',
			reporter: ticket.reporter ?? ''
		};
		editing = true;
	}

	async function patch(body: Record<string, unknown>, message: string) {
		busy = true;
		errorMessage = '';
		const result = await apiWrite(`/api/tickets/${ticket.id}`, 'PATCH', body);
		if (!result.ok) {
			errorMessage = result.error ?? 'Could not update the ticket.';
		} else {
			await invalidateAll();
			notice = message;
			editing = false;
		}
		busy = false;
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		await patch(
			{ ...edit, estimate_hours: edit.estimate_hours === '' ? null : edit.estimate_hours },
			'Changes saved.'
		);
	}

	/** The owner picker adds the stored value if the roster does not have it. */
	function ownerOptions(current: string | null): string[] {
		const list = [...data.owners];
		const value = (current ?? '').trim();
		if (value && !list.some((o) => o.toLowerCase() === value.toLowerCase())) list.unshift(value);
		return list;
	}

	/* ---------------------------------------------------------------------
	 * Activity, effort and links
	 * ------------------------------------------------------------------ */

	let commentDraft = $state('');
	let effortDraft = $state({ hours: '', note: '', logged_on: '' });

	let editingDescription = $state(false);
	let descriptionDraft = $state('');

	async function saveDescription(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		errorMessage = '';
		const res = await apiWrite(`/api/tickets/${ticket.id}`, 'PATCH', {
			// The HTML is the value. The server derives the plain column from it,
			// in one place, so the two cannot say different things.
			description_html: descriptionDraft.trim() || null
		});
		busy = false;
		if (res.ok) {
			editingDescription = false;
			await invalidateAll();
		} else {
			errorMessage = res.error ?? 'Could not save the description.';
		}
	}
	let linkDraft = $state({ kind: 'relates', to: '' });

	/** Hours, from minutes, with no trailing zeroes on a whole number. */
	const hoursOf = (minutes: number) =>
		`${(minutes / 60).toFixed(2).replace(/\.?0+$/, '')}h`;

	const effortLabel = $derived(
		data.effort.total_minutes > 0 ? `${hoursOf(data.effort.total_minutes)} in total` : 'None yet'
	);

	/** Tickets already linked cannot be linked again, so they leave the picker. */
	const linkable = $derived(
		data.siblings.filter((s) => !data.links.some((l) => l.other_id === s.id))
	);

	async function addComment(event: SubmitEvent) {
		event.preventDefault();
		if (!commentDraft.trim()) return;
		busy = true;
		errorMessage = '';
		const res = await apiWrite(`/api/tickets/${ticket.id}/events`, 'POST', {
			detail: commentDraft,
			author: ticket.assignee ?? null
		});
		busy = false;
		if (res.ok) {
			commentDraft = '';
			await invalidateAll();
		} else {
			errorMessage = res.error ?? 'Could not add that comment.';
		}
	}

	async function logEffort(event: SubmitEvent) {
		event.preventDefault();
		if (!effortDraft.hours.trim()) {
			errorMessage = 'How many hours?';
			return;
		}
		busy = true;
		errorMessage = '';
		const res = await apiWrite(`/api/tickets/${ticket.id}/time`, 'POST', {
			hours: effortDraft.hours,
			note: effortDraft.note || null,
			who: ticket.assignee ?? null,
			// Empty means today, which the API decides. Sending the browser's idea
			// of today would put a laptop in another timezone a day out.
			logged_on: effortDraft.logged_on || null
		});
		busy = false;
		if (res.ok) {
			effortDraft = { hours: '', note: '', logged_on: '' };
			await invalidateAll();
		} else {
			errorMessage = res.error ?? 'Could not log that time.';
		}
	}

	async function removeEffort(id: string) {
		busy = true;
		const res = await apiWrite(`/api/tickets/${ticket.id}/time/${id}`, 'DELETE', null);
		busy = false;
		if (res.ok) await invalidateAll();
		else errorMessage = res.error ?? 'Could not remove that entry.';
	}

	async function addLink(event: SubmitEvent) {
		event.preventDefault();
		if (!linkDraft.to) return;
		busy = true;
		errorMessage = '';
		const res = await apiWrite(`/api/tickets/${ticket.id}/links`, 'POST', {
			to_ticket_id: linkDraft.to,
			kind: linkDraft.kind
		});
		busy = false;
		if (res.ok) {
			linkDraft = { kind: 'relates', to: '' };
			await invalidateAll();
		} else {
			errorMessage = res.error ?? 'Could not link those tickets.';
		}
	}

	async function removeLink(id: string) {
		busy = true;
		const res = await apiWrite(`/api/tickets/${ticket.id}/links/${id}`, 'DELETE', null);
		busy = false;
		if (res.ok) await invalidateAll();
		else errorMessage = res.error ?? 'Could not remove that link.';
	}
</script>

<svelte:head><title>{ticket.title}</title></svelte:head>

<header class="head">
	<p class="crumb">
		<a href="/projects/{ticket.project_id}">{ticket.project_name}</a>
		{#if ticket.client_name}
			<span class="sep">·</span>{ticket.client_name}
		{/if}
	</p>
	<div class="title-row">
		<h1>{ticket.title}</h1>
		<div class="chips">
			{#if ticket.priority !== 'normal'}
				<StatusChip
					tone={ticket.priority === 'urgent'
						? 'overdue'
						: ticket.priority === 'high'
							? 'atrisk'
							: 'waiting'}
					label={TICKET_PRIORITY_LABELS[ticket.priority]}
				/>
			{/if}
			<StatusChip
				tone={TICKET_STATUS_TONE[ticket.status]}
				label={TICKET_STATUS_LABELS[ticket.status]}
			/>
		</div>
	</div>
</header>

{#if notice}<p class="status-line" role="status" aria-live="polite">{notice}</p>{/if}
{#if errorMessage}<p class="error-banner" role="alert">{errorMessage}</p>{/if}

<div class="controls">
	<label class="quick">
		<span>Status</span>
		<Select
			value={ticket.status}
			disabled={busy}
			onchange={(e) => patch({ status: e.currentTarget.value }, 'Status updated.')}
		>
			{#each TICKET_STATUSES as s (s)}
				<option value={s}>{TICKET_STATUS_LABELS[s]}</option>
			{/each}
		</Select>
	</label>
	<Button variant="secondary" onclick={startEdit} disabled={busy}>Edit details</Button>
</div>

<dl class="facts">
	<div>
		<dt>Assignee</dt>
		<dd>{ticket.assignee ?? 'Unassigned'}</dd>
	</div>
	<div>
		<dt>Reporter</dt>
		<dd>{ticket.reporter ?? 'Not recorded'}</dd>
	</div>
	<div>
		<dt>Start</dt>
		<dd class="mono">{ticket.start_date ? formatDay(ticket.start_date) : 'Not set'}</dd>
	</div>
	<div>
		<dt>Due</dt>
		<dd class="mono">{ticket.due_date ? formatDay(ticket.due_date) : 'Not set'}</dd>
	</div>
	{#if ticket.completed_at}
		<div>
			<dt>Finished</dt>
			<dd class="mono">{formatMoment(ticket.completed_at)}</dd>
		</div>
	{/if}

	<div>
		<dt>Estimate</dt>
		<dd class="mono">{ticket.estimate_hours ? `${ticket.estimate_hours}h` : 'None'}</dd>
	</div>
	<div>
		<dt>Actual</dt>
		<dd class="mono">
			{ticket.actual_hours ?? 0}h
			{#if variance}
				<span class="variance" class:over={variance.over}>{variance.text}</span>
			{/if}
		</dd>
	</div>
</dl>

{#if editing}
	<Card title="Edit ticket">
		<form onsubmit={save}>
			<div class="grid">
				<div class="span-all">
					<FormField label="Title">
						<Input bind:value={edit.title} maxlength={300} required />
					</FormField>
				</div>
				<FormField label="Assignee">
					<Select bind:value={edit.assignee}>
						<option value="">Unassigned</option>
						{#each ownerOptions(edit.assignee) as name (name)}
							<option value={name}>{name}</option>
						{/each}
					</Select>
				</FormField>
				<FormField label="Reporter">
					<Select bind:value={edit.reporter}>
						<option value="">Not recorded</option>
						{#each ownerOptions(edit.reporter) as name (name)}
							<option value={name}>{name}</option>
						{/each}
					</Select>
				</FormField>
				<FormField label="Priority">
					<Select bind:value={edit.priority}>
						{#each TICKET_PRIORITIES as p (p)}
							<option value={p}>{TICKET_PRIORITY_LABELS[p]}</option>
						{/each}
					</Select>
				</FormField>
				<FormField label="Estimate, hours" hint="Actual is summed from time entries, never typed.">
					<Input type="number" step="0.25" min="0.25" bind:value={edit.estimate_hours} mono />
				</FormField>
				<FormField label="Start">
					<Input type="date" bind:value={edit.start_date} mono />
				</FormField>
				<FormField label="Due">
					<Input type="date" bind:value={edit.due_date} mono />
				</FormField>
				<!--
					No description here.

					It has its own card below with the editor in it, and two boxes
					for one field is how the two get different content: the last
					form saved wins, and which one that was depends on which the
					reader happened to open.
				-->
			</div>
			<div class="form-actions">
				<Button type="submit" disabled={busy}>Save changes</Button>
				<Button variant="secondary" onclick={() => (editing = false)} disabled={busy}>Cancel</Button>
			</div>
		</form>
	</Card>
{/if}

<!--
	Always rendered, never conditional on having content.

	The card used to disappear when the description was empty, which meant a
	ticket with nothing written on it offered no way to write anything: the only
	route in was the Edit form, and nothing on the page said so. An empty card
	that invites the first sentence is the point of an empty card.
-->
<Card title="Description">
	{#snippet actions()}
		<Button
			variant="ghost"
			size="sm"
			disabled={busy}
			onclick={() => {
				descriptionDraft = ticket.description_html ?? '';
				editingDescription = !editingDescription;
			}}
		>
			{editingDescription ? 'Cancel' : ticket.description ? 'Edit' : 'Add'}
		</Button>
	{/snippet}

	{#if editingDescription}
		<form onsubmit={saveDescription}>
			<!--
				Seeded from the HTML when there is any, and from the plain column
				when there is not. A ticket written before the editor existed opens
				as the paragraphs it was typed as rather than as one run-on block.
			-->
			{#key editingDescription}
				<RichTextEditor
					bind:value={descriptionDraft}
					plain={ticket.description}
					label="Description"
					rows={8}
					placeholder="What this ticket is, and anything the next person needs."
				/>
			{/key}
			<div class="form-actions">
				<Button type="submit" disabled={busy}>Save description</Button>
			</div>
		</form>
	{:else}
		<RichText
			html={ticket.description_html}
			text={ticket.description}
			empty="No description yet."
		/>
	{/if}
</Card>

<div class="two-up">
	<!--
		The history: a person's comment and the app's own note about a change, in
		one list because on screen it is one list read in one order. Two tables
		would mean merging by timestamp in the Worker to rebuild what the reader
		was always going to see.

		Append only. Nothing edits or deletes a line, because a history that can
		be edited is not a history.
	-->
	<!--
		Asana's own history, when this ticket came from Asana.

		Separate from the app's Activity card below rather than merged into it.
		The two are different things: one is what people did in Asana, the other
		is what has happened to this ticket here, and interleaving them would
		make a single list where nothing says which system a line came from. The
		mirror is read only, so nothing on this card can be edited.
	-->
	{#if data.mirrored}
		<Card
			title="Asana activity"
			subtitle="{data.activity.length} from the mirror{data.activity.length === 200
				? ', most recent'
				: ''}"
		>
			{#if data.source}
				<dl class="source">
					<div>
						<dt>Open in Asana</dt>
						<dd>
							{#if ticket.asana_url}
								<a href={ticket.asana_url} target="_blank" rel="noreferrer">Asana task</a>
							{:else}
								Not linked
							{/if}
						</dd>
					</div>
					<div>
						<dt>Section in Asana</dt>
						<dd>{data.source.section_name ?? 'None'}</dd>
					</div>
					<div>
						<dt>Asana assignee</dt>
						<dd>{data.source.asana_assignee ?? 'Nobody'}</dd>
					</div>
					<div>
						<dt>Mirrored</dt>
						<dd>{formatMoment(data.source.linked_at)}</dd>
					</div>
				</dl>
				<p class="note">
					Asana is the source of truth for this ticket. The section above is what Asana
					calls its status, kept exactly as written; the status on this page is the app's
					own and is deliberately coarse until the status models are reconciled. Editing
					here does not change anything in Asana.
				</p>
			{/if}

			<!--
				Everything migration 0038 gave a home to.

				These were reported as dropped by the first projection because the
				app had no columns for them. Carrying them and then not showing them
				would be the same loss with extra steps.
			-->
			{#if data.tags.length > 0 || data.followers.length > 0 || data.custom_values.length > 0}
				<div class="fidelity">
					{#if data.custom_values.length > 0}
						<dl class="source">
							{#each data.custom_values as field (field.field_gid)}
								<div>
									<dt>{field.field_name}</dt>
									<dd>{field.display_value}</dd>
								</div>
							{/each}
						</dl>
					{/if}

					{#if data.tags.length > 0}
						<p class="chips">
							<span class="chips-label">Tags</span>
							{#each data.tags as t (t.tag)}<span class="chip-tag">{t.tag}</span>{/each}
						</p>
					{/if}

					{#if data.followers.length > 0}
						<p class="chips">
							<span class="chips-label">Followers</span>
							{#each data.followers as f (f.name)}<span class="chip-tag">{f.name}</span>{/each}
						</p>
					{/if}
				</div>
			{/if}

			{#if data.activity.length === 0}
				<p class="empty">No comments or changes in Asana.</p>
			{:else}
				<ul class="feed">
					{#each data.activity as story (story.gid)}
						<li class:system={story.type !== 'comment_added'}>
							<span class="feed-when mono">{formatMoment(story.created_at ?? '')}</span>
							<span class="feed-body">
								<!--
									The author is shown only on a comment. Asana writes a system
									story's text with the actor already in it, so printing the
									name beside it reads "John McHugh John McHugh changed the due
									date". A comment's text is the person's words and does need
									attributing.
								-->
								{#if story.author && story.type === 'comment_added'}
									<span class="feed-who">{story.author}</span>
								{/if}
								{story.text ?? story.type ?? 'Change recorded'}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>
	{/if}

	{#if data.parent || data.subtasks.length > 0}
		<Card
			title="Subtasks"
			subtitle={data.subtasks.length > 0 ? `${data.subtasks.length} under this` : 'Part of another ticket'}
		>
			{#if data.parent}
				<p class="note">
					Part of <a href="/tickets/{data.parent.id}">{data.parent.title}</a>.
				</p>
			{/if}
			{#if data.subtasks.length > 0}
				<ul class="subtasks">
					{#each data.subtasks as sub (sub.id)}
						<li>
							<a href="/tickets/{sub.id}">{sub.title}</a>
							<span class="sub-meta">{sub.status}{sub.due_date ? ` - due ${sub.due_date}` : ''}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>
	{/if}

	<Card title="Activity" subtitle="{data.events.length} recorded">
		{#if data.events.length === 0}
			<p class="empty">Nothing recorded yet.</p>
		{:else}
			<ul class="feed">
				{#each data.events as event (event.id)}
					<li class:system={event.kind !== 'comment'}>
						<span class="feed-when mono">{formatMoment(event.created_at)}</span>
						<span class="feed-body">
							{#if event.author}<span class="feed-who">{event.author}</span>{/if}
							{event.detail}
						</span>
					</li>
				{/each}
			</ul>
		{/if}

		<form class="add-row" onsubmit={addComment}>
			<Input bind:value={commentDraft} placeholder="Add a comment" maxlength={4000} />
			<Button type="submit" variant="secondary" disabled={busy || !commentDraft.trim()}>
				Comment
			</Button>
		</form>
	</Card>

	<div class="stack">
		<!--
			Effort, which is not the billable time below it. This answers what the
			work actually took; that answers what gets invoiced. Merging them would
			mean every logged hour needing a client and a rate before anyone could
			record that a bug took an afternoon.
		-->
		<Card title="Effort logged" subtitle={effortLabel}>
			{#if data.effort.entries.length === 0}
				<p class="empty">No effort logged against this ticket.</p>
			{:else}
				<ul class="effort">
					{#each data.effort.entries as entry (entry.id)}
						<li>
							<span class="effort-when mono">{formatDayShort(entry.logged_on)}</span>
							<span class="effort-what">
								{hoursOf(entry.minutes)}
								{#if entry.who}· {entry.who}{/if}
								{#if entry.note}· {entry.note}{/if}
							</span>
							<button
								type="button"
								class="ghost"
								disabled={busy}
								onclick={() => removeEffort(entry.id)}
								aria-label="Remove this entry"
							>
								Remove
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			<!--
				The date is editable and defaults to today.

				People log time days after doing it, and a form that can only say
				"now" makes them either lie about when or not log it at all. The API
				has always accepted `logged_on`; the form simply never sent one.
			-->
			<form class="add-row effort-form" onsubmit={logEffort}>
				<Input
					bind:value={effortDraft.hours}
					placeholder="1.5"
					inputmode="decimal"
					aria-label="Hours"
				/>
				<Input
					type="date"
					bind:value={effortDraft.logged_on}
					aria-label="Date worked"
					max={data.today}
				/>
				<Input bind:value={effortDraft.note} placeholder="What on" aria-label="Note" />
				<Button type="submit" variant="secondary" disabled={busy}>Log</Button>
			</form>
		</Card>

		<!--
			Links are stored once per pair and read in both directions, so the
			relation shown here is already the right way round for this ticket: the
			other end reads "is blocked by" without a second row existing.
		-->
		<Card title="Linked tickets" subtitle="{data.links.length} linked">
			{#if data.links.length === 0}
				<p class="empty">Nothing linked.</p>
			{:else}
				<ul class="links">
					{#each data.links as link (link.id)}
						<li>
							<span class="link-kind mono">{link.relation}</span>
							<a class="link-title" href="/tickets/{link.other_id}">{link.title}</a>
							<button
								type="button"
								class="ghost"
								disabled={busy}
								onclick={() => removeLink(link.id)}
								aria-label="Unlink {link.title}"
							>
								Unlink
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			<form class="add-row" onsubmit={addLink}>
				<Select bind:value={linkDraft.kind} aria-label="Relationship">
					<option value="relates">relates to</option>
					<option value="blocks">blocks</option>
					<option value="duplicates">duplicates</option>
				</Select>
				<Select bind:value={linkDraft.to} aria-label="Ticket to link">
					<option value="">Choose a ticket</option>
					{#each linkable as option (option.id)}
						<option value={option.id}>{option.title}</option>
					{/each}
				</Select>
				<Button type="submit" variant="secondary" disabled={busy || !linkDraft.to}>Link</Button>
			</form>
		</Card>
	</div>
</div>

<Card
	title="Time booked"
	subtitle={ticket.entry_count
		? `${ticket.entry_count} entr${ticket.entry_count === 1 ? 'y' : 'ies'}`
		: undefined}
	padded={false}
>
	{#if data.entries.length === 0}
		<p class="empty">
			No time booked to this ticket. Book it against the billing period, choosing this ticket.
		</p>
	{:else}
		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th scope="col">Date</th>
						<th scope="col">Description</th>
						<th scope="col" class="num">Hours</th>
						<th scope="col" class="num">Rate</th>
						<th scope="col" class="num">Value</th>
					</tr>
				</thead>
				<tbody>
					{#each data.entries as entry (entry.id)}
						<tr>
							<td class="mono nowrap">{formatDay(entry.entry_date)}</td>
							<td>{entry.description ?? 'No description'}</td>
							<td class="num mono">{entry.hours.toFixed(2)}</td>
							<td class="num mono">
								{entry.rate_cents != null ? formatMoney(entry.rate_cents) : 'No rate'}
							</td>
							<td class="num mono">
								{entry.rate_cents != null
									? formatMoney(Math.round(entry.hours * entry.rate_cents))
									: '-'}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if (ticket.computed_value_cents ?? 0) > 0}
			<p class="value-note">
				{formatMoney(ticket.computed_value_cents ?? 0)} at the rates recorded on these entries. This
				is a computation, not an invoiced amount.
			</p>
		{/if}
	{/if}
</Card>

{#if ticket.converted_from_action_item_id}
	<p class="footnote">
		Converted from an action item. The original capture is still in
		<a href="/actions?view=all&q={encodeURIComponent(ticket.title)}">Action items</a>.
	</p>
{/if}

<style>
	.fidelity {
		margin: 0 0 var(--space-4);
		padding-bottom: var(--space-3);
		border-bottom: 1px solid var(--border-thin);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin: 0 0 var(--space-2);
	}

	.chips-label {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.chip-tag {
		padding: 2px var(--space-2);
		border-radius: var(--radius-1, 4px);
		background: var(--surface-hover);
		font-size: 0.75rem;
	}

	.source {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14ch, 1fr));
		gap: var(--space-3);
		margin: 0 0 var(--space-4);
	}

	.source dt {
		font-size: 0.75rem;
		color: var(--text-secondary);
		margin-bottom: var(--space-1);
	}

	.source dd {
		margin: 0;
		font-weight: 600;
	}

	.note {
		margin: 0 0 var(--space-4);
		color: var(--text-secondary);
		font-size: 0.875rem;
		max-width: 70ch;
	}

	.subtasks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}

	.subtasks li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-3);
		align-items: baseline;
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--border-thin);
	}

	.sub-meta {
		color: var(--text-secondary);
		font-size: 0.8125rem;
	}


	.two-up {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		margin: var(--space-4) 0;
		align-items: start;
	}

	@media (min-width: 1000px) {
		.two-up {
			grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
		}
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
	}

	.feed,
	.effort,
	.links {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.feed li {
		display: flex;
		gap: var(--space-3);
		align-items: baseline;
		padding: var(--space-2) 0;
	}

	.feed li + li,
	.effort li + li,
	.links li + li {
		border-top: 1px solid var(--border-hairline);
	}

	.feed-when,
	.effort-when {
		flex: none;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.feed-body {
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}

	.feed-who {
		font-weight: 600;
	}

	/* A line the app wrote about itself reads quieter than a person's comment. */
	.feed li.system .feed-body {
		color: var(--text-muted);
	}

	.effort li,
	.links li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 44px;
		padding: var(--space-2) 0;
	}

	.effort-what,
	.link-title {
		flex: 1;
		min-width: 0;
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}

	.link-kind {
		flex: none;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.add-row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex-wrap: wrap;
		margin-top: var(--space-3);
	}

	.add-row :global(input),
	.add-row :global(select) {
		flex: 1;
		min-width: 110px;
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
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}

	.crumb {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.crumb a {
		color: var(--text-link);
	}

	.sep {
		margin: 0 var(--space-2);
	}

	.title-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	h1 {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: var(--weight-medium);
		overflow-wrap: anywhere;
	}

	.chips {
		display: flex;
		gap: var(--space-2);
	}

	.status-line,
	.error-banner {
		margin: 0 0 var(--space-3);
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

	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}

	.quick {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.facts {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
		margin: 0 0 var(--space-4);
		padding: var(--space-4);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		background: var(--surface-card);
	}

	@media (min-width: 720px) {
		.facts {
			grid-template-columns: repeat(6, 1fr);
		}
	}

	.facts dt {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		color: var(--text-secondary);
	}

	.facts dd {
		margin: 2px 0 0;
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}

	/* Never colour alone: the words say over or under too. */
	.variance {
		display: block;
		font-size: var(--text-xs);
		color: var(--text-positive);
	}

	.variance.over {
		color: var(--text-alarm);
	}

	.scroll {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}

	th,
	td {
		padding: var(--space-2) var(--space-3);
		text-align: left;
		border-bottom: 1px solid var(--border-thin);
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

	.value-note {
		margin: 0;
		padding: var(--space-3) var(--space-4);
		border-top: 1px solid var(--border-thin);
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.empty {
		margin: 0;
		padding: var(--space-4);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.footnote {
		margin-top: var(--space-4);
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-4);
	}

	@media (min-width: 720px) {
		.grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.span-all {
			grid-column: 1 / -1;
		}
	}

	.form-actions {
		display: flex;
		gap: var(--space-3);
		margin-top: var(--space-4);
	}
</style>
