<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { apiWrite } from '$lib/http';
	import { formatDay, formatDayShort } from '$lib/format';
	import {
		CONTRACT_STATUSES,
		CONTRACT_STATUS_LABELS,
		CONTRACT_STATUS_TONE,
		INVOICE_STATUS_LABELS,
		PROJECT_STATUS_LABELS,
		TICKET_STATUS_LABELS,
		formatMoney,
		formatUsd
	} from '$lib/types';
	import type { Contact, Contract } from '$lib/types';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import FormField from '$lib/components/FormField.svelte';
	import Input from '$lib/components/Input.svelte';
	import Select from '$lib/components/Select.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import Textarea from '$lib/components/Textarea.svelte';
	import type { PageData } from './$types';

	/**
	 * One client, everything about them.
	 *
	 * Most of this page is existing lists filtered by client. The money is not
	 * recomputed here: the server reads it through the same expression the
	 * Invoicing screen uses, so the two cannot disagree about what is owed.
	 *
	 * Contracts and invoices sit side by side and are deliberately not added
	 * together. Nothing in the schema links an invoice to a contract, so any
	 * "percent fulfilled" figure would be invented. Showing both lets Paul make
	 * the comparison himself, which is the honest version until there is a real
	 * link to compute from.
	 */

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');

	let showContact = $state(false);
	let editingContact = $state<string | null>(null);
	let contactDraft = $state({ name: '', email: '', phone: '', role: '', is_primary: false });

	let showContract = $state(false);
	let editingContract = $state<string | null>(null);
	let contractDraft = $state({
		title: '',
		start_date: '',
		end_date: '',
		value: '',
		fulfillment_status: 'not_started',
		notes: ''
	});

	const openInvoices = $derived(
		data.invoices.filter((i) => (i.outstanding_cents ?? 0) > 0)
	);

	function resetContact() {
		contactDraft = { name: '', email: '', phone: '', role: '', is_primary: false };
		editingContact = null;
		showContact = false;
	}

	function startContact(contact: Contact) {
		contactDraft = {
			name: contact.name,
			email: contact.email ?? '',
			phone: contact.phone ?? '',
			role: contact.role ?? '',
			is_primary: contact.is_primary === 1
		};
		editingContact = contact.id;
		showContact = true;
	}

	async function saveContact(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		notice = '';
		errorMessage = '';

		const result = editingContact
			? await apiWrite(`/api/contacts/${editingContact}`, 'PATCH', contactDraft)
			: await apiWrite('/api/contacts', 'POST', { ...contactDraft, client_id: data.client.id });

		if (!result.ok) {
			errorMessage = result.error ?? 'Could not save that contact.';
		} else {
			notice = editingContact ? 'Contact updated.' : 'Contact added.';
			resetContact();
			await invalidateAll();
		}
		busy = false;
	}

	async function removeContact(contact: Contact) {
		if (!confirm(`Remove ${contact.name}?`)) return;
		busy = true;
		errorMessage = '';
		const result = await apiWrite(`/api/contacts/${contact.id}`, 'DELETE', {});
		if (!result.ok) errorMessage = result.error ?? 'Could not remove that contact.';
		else {
			notice = 'Contact removed.';
			await invalidateAll();
		}
		busy = false;
	}

	function resetContract() {
		contractDraft = {
			title: '',
			start_date: '',
			end_date: '',
			value: '',
			fulfillment_status: 'not_started',
			notes: ''
		};
		editingContract = null;
		showContract = false;
	}

	function startContract(contract: Contract) {
		contractDraft = {
			title: contract.title,
			start_date: contract.start_date ?? '',
			end_date: contract.end_date ?? '',
			value: contract.value_cents === null ? '' : String(contract.value_cents / 100),
			fulfillment_status: contract.fulfillment_status,
			notes: contract.notes ?? ''
		};
		editingContract = contract.id;
		showContract = true;
	}

	async function saveContract(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		notice = '';
		errorMessage = '';

		const result = editingContract
			? await apiWrite(`/api/contracts/${editingContract}`, 'PATCH', contractDraft)
			: await apiWrite('/api/contracts', 'POST', { ...contractDraft, client_id: data.client.id });

		if (!result.ok) {
			errorMessage = result.error ?? 'Could not save that contract.';
		} else {
			notice = editingContract ? 'Contract updated.' : 'Contract added.';
			resetContract();
			await invalidateAll();
		}
		busy = false;
	}

	/* ---------------------------------------------------------------------
	 * Signed contract files
	 * ------------------------------------------------------------------ */

	let fileInput = $state<HTMLInputElement | null>(null);
	let uploading = $state(false);
	let dragging = $state(false);

	const kb = (bytes: number) =>
		bytes >= 1_048_576
			? `${(bytes / 1_048_576).toFixed(1)} MB`
			: `${Math.max(1, Math.round(bytes / 1024))} KB`;

	/**
	 * Uploads each file as its own request and reports each failure by name.
	 *
	 * One request per file is the point. A single multipart body carrying five
	 * files fails as one thing, and the reader is told "the upload failed" with
	 * no way to know that four of them were fine and the fifth was a .exe.
	 */
	async function sendFiles(files: File[]) {
		if (files.length === 0) return;
		uploading = true;
		errorMessage = '';
		const failed: string[] = [];

		for (const file of files) {
			const form = new FormData();
			form.set('file', file);
			const res = await fetch(`/api/clients/${data.client.id}/files`, {
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
		notice = failed.length < files.length ? 'Filed.' : '';
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
		const res = await apiWrite(`/api/clients/${data.client.id}/files/${id}`, 'DELETE', null);
		busy = false;
		if (res.ok) {
			notice = `Removed ${filename}.`;
			await invalidateAll();
		} else {
			errorMessage = res.error ?? 'Could not remove that file.';
		}
	}
</script>

<svelte:head><title>{data.client.name}</title></svelte:head>

<nav class="crumbs mono" aria-label="Breadcrumb">
	<a href="/clients">Clients</a> <span aria-hidden="true">/</span>
	<span>{data.client.name}</span>
</nav>

<header class="head">
	<h1>{data.client.name}</h1>
	<div class="head-meta">
		<StatusChip
			tone={data.client.status === 'active' ? 'open' : 'blocked'}
			label={data.client.status === 'active' ? 'Active' : 'Archived'}
		/>
		{#if data.client.billing_terms}
			<span class="muted">{data.client.billing_terms}</span>
		{/if}
		{#if data.client.default_rate_cents !== null}
			<span class="muted mono">{formatMoney(data.client.default_rate_cents)}/h default</span>
		{/if}
	</div>
</header>

{#if notice}<p class="notice" role="status">{notice}</p>{/if}
{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}

<dl class="money">
	<div>
		<dt>Invoiced</dt>
		<dd class="mono">{formatUsd(data.money.invoiced_cents)}</dd>
	</div>
	<div>
		<dt>Outstanding</dt>
		<dd class="mono">{formatUsd(data.money.outstanding_cents)}</dd>
	</div>
	<div class:alarm={data.money.overdue_cents > 0}>
		<dt>Past due</dt>
		<dd class="mono">
			{data.money.overdue_cents > 0 ? formatUsd(data.money.overdue_cents) : 'None'}
		</dd>
	</div>
	<div>
		<dt>Overdue invoices</dt>
		<dd class="mono">{data.money.overdue_count}</dd>
	</div>
</dl>

<div class="cols">
	<Card title="Contacts" subtitle="{data.contacts.length} on file">
		{#snippet actions()}
			<Button
				variant="secondary"
				size="sm"
				onclick={() => (showContact ? resetContact() : (showContact = true))}
			>
				{showContact ? 'Cancel' : 'Add contact'}
			</Button>
		{/snippet}

		{#if showContact}
			<form onsubmit={saveContact}>
				<FormField label="Name">
					<Input bind:value={contactDraft.name} maxlength={200} required />
				</FormField>
				<FormField label="Email">
					<Input type="email" bind:value={contactDraft.email} maxlength={320} />
				</FormField>
				<FormField label="Phone">
					<Input bind:value={contactDraft.phone} maxlength={60} />
				</FormField>
				<FormField label="Role">
					<Input bind:value={contactDraft.role} maxlength={120} />
				</FormField>
				<label class="check">
					<input type="checkbox" bind:checked={contactDraft.is_primary} />
					<span>Primary contact</span>
				</label>
				<div class="form-actions">
					<Button type="submit" disabled={busy}>
						{editingContact ? 'Save contact' : 'Add contact'}
					</Button>
				</div>
			</form>
		{/if}

		{#if data.contacts.length === 0}
			<p class="empty">No contacts yet.</p>
		{:else}
			<ul class="rows">
				{#each data.contacts as contact (contact.id)}
					<li>
						<div class="row-main">
							<p class="row-title">
								{contact.name}
								{#if contact.is_primary === 1}<span class="primary">Primary</span>{/if}
							</p>
							<p class="row-meta">
								{contact.role ?? 'No role recorded'}
								{#if contact.email}
									&middot; <a href="mailto:{contact.email}">{contact.email}</a>
								{/if}
								{#if contact.phone} &middot; <span class="mono">{contact.phone}</span>{/if}
							</p>
						</div>
						<div class="row-actions">
							<Button variant="ghost" size="sm" onclick={() => startContact(contact)}>
								Edit<span class="visually-hidden"> {contact.name}</span>
							</Button>
							<Button variant="ghost" size="sm" onclick={() => removeContact(contact)}>
								Remove<span class="visually-hidden"> {contact.name}</span>
							</Button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>

	<Card title="Contracts" subtitle="{data.contracts.length} on file">
		{#snippet actions()}
			<Button
				variant="secondary"
				size="sm"
				onclick={() => (showContract ? resetContract() : (showContract = true))}
			>
				{showContract ? 'Cancel' : 'Add contract'}
			</Button>
		{/snippet}

		{#if showContract}
			<form onsubmit={saveContract}>
				<FormField label="Title">
					<Input bind:value={contractDraft.title} maxlength={300} required />
				</FormField>
				<div class="pair">
					<FormField label="Start">
						<Input type="date" bind:value={contractDraft.start_date} mono />
					</FormField>
					<FormField label="End">
						<Input type="date" bind:value={contractDraft.end_date} mono />
					</FormField>
				</div>
				<FormField label="Value" hint="An amount such as 50000 or 50000.00.">
					<Input bind:value={contractDraft.value} mono />
				</FormField>
				<FormField
					label="Fulfillment"
					hint="Set by hand. Nothing computes this from invoices or hours."
				>
					<Select bind:value={contractDraft.fulfillment_status}>
						{#each CONTRACT_STATUSES as status (status)}
							<option value={status}>{CONTRACT_STATUS_LABELS[status]}</option>
						{/each}
					</Select>
				</FormField>
				<FormField label="Notes">
					<Textarea bind:value={contractDraft.notes} rows={3} maxlength={4000} />
				</FormField>
				<div class="form-actions">
					<Button type="submit" disabled={busy}>
						{editingContract ? 'Save contract' : 'Add contract'}
					</Button>
				</div>
			</form>
		{/if}

		{#if data.contracts.length === 0}
			<p class="empty">No contracts recorded.</p>
		{:else}
			<ul class="rows">
				{#each data.contracts as contract (contract.id)}
					<li>
						<div class="row-main">
							<p class="row-title">{contract.title}</p>
							<p class="row-meta">
								{#if contract.value_cents !== null}
									<span class="mono">{formatMoney(contract.value_cents)}</span> &middot;
								{/if}
								{contract.start_date ? formatDay(contract.start_date) : 'No start'} to
								{contract.end_date ? formatDay(contract.end_date) : 'no end'}
							</p>
						</div>
						<div class="row-actions">
							<StatusChip
								tone={CONTRACT_STATUS_TONE[contract.fulfillment_status]}
								label={CONTRACT_STATUS_LABELS[contract.fulfillment_status]}
								size="sm"
							/>
							<Button variant="ghost" size="sm" onclick={() => startContract(contract)}>
								Edit<span class="visually-hidden"> {contract.title}</span>
							</Button>
						</div>
					</li>
				{/each}
			</ul>
			<p class="footnote">
				Fulfillment is set by hand. Invoices for this client are listed below so the two can be
				compared; nothing adds them together, because no invoice is recorded against a contract.
			</p>
		{/if}
	</Card>
</div>

<Card title="Projects" subtitle="{data.projects.length} for this client" padded={false}>
	{#if data.projects.length === 0}
		<p class="empty pad">No projects yet.</p>
	{:else}
		<ul class="rows pad">
			{#each data.projects as project (project.id)}
				<li>
					<div class="row-main">
						<p class="row-title"><a href="/projects/{project.id}">{project.name}</a></p>
						<p class="row-meta">
							{PROJECT_STATUS_LABELS[project.status]}
							&middot; {project.open_items} open item{project.open_items === 1 ? '' : 's'}
							&middot; {project.open_tickets} open ticket{project.open_tickets === 1 ? '' : 's'}
						</p>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</Card>

{#if data.tickets.length > 0}
	<Card title="Open tickets" subtitle="Soonest due first" padded={false}>
		<ul class="rows pad">
			{#each data.tickets as ticket (ticket.id)}
				<li>
					<div class="row-main">
						<p class="row-title"><a href="/tickets/{ticket.id}">{ticket.title}</a></p>
						<p class="row-meta">
							{ticket.project_name} &middot; {TICKET_STATUS_LABELS[ticket.status]}
							{#if ticket.due_date} &middot; due {formatDay(ticket.due_date)}{/if}
						</p>
					</div>
				</li>
			{/each}
		</ul>
	</Card>
{/if}

<Card
	title="Invoices"
	subtitle="{openInvoices.length} unpaid of {data.invoices.length}"
	padded={false}
>
	{#if data.invoices.length === 0}
		<p class="empty pad">No invoices for this client.</p>
	{:else}
		<div class="table-scroll">
			<table>
				<thead>
					<tr>
						<th scope="col">Invoice</th>
						<th scope="col">Due</th>
						<th scope="col" class="right">Amount</th>
						<th scope="col" class="right">Outstanding</th>
						<th scope="col">Status</th>
					</tr>
				</thead>
				<tbody>
					{#each data.invoices as invoice (invoice.id)}
						<tr>
							<td class="mono">{invoice.invoice_number}</td>
							<td class="mono nowrap">
								{formatDay(invoice.due_date)}
								{#if invoice.is_overdue === 1}
									<span class="overdue">{invoice.days_overdue}d past due</span>
								{/if}
							</td>
							<td class="right mono">{formatMoney(invoice.amount_cents)}</td>
							<td class="right mono">{formatMoney(invoice.outstanding_cents ?? 0)}</td>
							<td>{INVOICE_STATUS_LABELS[invoice.status]}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</Card>

{#if data.meetings.length > 0}
	<Card title="Recent meetings" subtitle="Last five" padded={false}>
		<ul class="rows pad">
			{#each data.meetings as meeting (meeting.id)}
				<li>
					<div class="row-main">
						<p class="row-title"><a href="/meetings/{meeting.id}">{meeting.title}</a></p>
						<p class="row-meta mono">{formatDay(meeting.meeting_date)}</p>
					</div>
				</li>
			{/each}
		</ul>
	</Card>
{/if}

<div class="cols">
	<!--
		Signed files, beside the terms they are evidence for.

		Uploads only. The prototype's own copy settles the design question in one
		line: "Upload signed files as they are, several at once. Nothing is
		authored in here." Authoring a contract would mean a template engine, a
		version history, and eventually somebody relying in a dispute on a
		document this app generated. Filing the signed PDF where the client's
		other facts live costs nothing and answers the question that gets asked.
	-->
	<!--
		Dropbox, read from the mirror.

		Separate from the signed files above and deliberately so. Those are
		documents somebody filed here on purpose; this is a view of the client's
		folder in Dropbox, which the app mirrors and does not own. Merging them
		would make one list where nothing says which of the two a row is, and only
		one of them can be deleted from this page.
	-->
	{#if data.dropbox.total > 0}
		<Card
			title="Dropbox"
			subtitle="{data.dropbox.total.toLocaleString()} files in this client's folder"
		>
			{#snippet actions()}
				<Button variant="ghost" size="sm" href="/files?client_id={data.client.id}">
					See all
				</Button>
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
	{/if}

	<Card title="Signed files" subtitle="{data.files.length} on file">
		{#snippet actions()}
			<Button variant="ghost" size="sm" disabled={uploading} onclick={() => fileInput?.click()}>
				{uploading ? 'Uploading' : 'Upload'}
			</Button>
		{/snippet}

		<p class="muted small">
			Upload signed files as they are, several at once. Nothing is authored in here.
		</p>

		<!--
			One request per file, not one request with several files. Batching them
			would mean one failure losing the whole batch with nothing to say which
			file was the problem.
		-->
		<input
			bind:this={fileInput}
			class="hidden-input"
			type="file"
			multiple
			accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.heic"
			onchange={uploadFiles}
		/>

		<div
			class="drop"
			class:over={dragging}
			role="button"
			tabindex="0"
			aria-label="Upload signed contract files"
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
			Drop files here or press to browse. PDF, Word and images, up to 25 MB each.
		</div>

		{#if data.files.length === 0}
			<p class="muted small">No signed files yet.</p>
		{:else}
			<ul class="rows">
				{#each data.files as file (file.id)}
					<li>
						<div class="row-main">
							<p class="row-title">
								<a href="/api/clients/{data.client.id}/files/{file.id}" target="_blank" rel="noopener">
									{file.filename}
								</a>
							</p>
							<p class="row-meta mono">
								{formatDay(file.uploaded_at.slice(0, 10))} · {kb(file.size_bytes)}
								{#if file.contract_title}· {file.contract_title}{/if}
							</p>
						</div>
						<Button
							variant="ghost"
							size="sm"
							disabled={busy}
							onclick={() => removeFile(file.id, file.filename)}
						>
							Remove
						</Button>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>

	<!--
		Derived, never logged. An activity table would be a second place every one
		of these facts lives, and the two would drift the first time something was
		created without remembering to write the log line. Everything here is read
		back out of the records themselves, so it cannot be stale and cannot be
		missing an entry.
	-->
	<Card title="Recent activity" subtitle="From the records themselves">
		{#if data.activity.length === 0}
			<p class="muted small">Nothing recorded against this client yet.</p>
		{:else}
			<ul class="feed">
				{#each data.activity as event (event.kind + event.ref + event.at)}
					<li>
						<span class="feed-when mono">{formatDayShort(event.at)}</span>
						<span class="feed-what">{event.detail}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>
</div>

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
		/* Comfortably past the 44px floor, D22, because it is also a drop zone. */
		min-height: 44px;
	}

	.drop:hover,
	.drop:focus-visible,
	.drop.over {
		border-color: var(--navy-600);
		color: var(--text-body);
	}

	.small {
		font-size: var(--text-xs);
	}

	.feed {
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

	.feed li + li {
		border-top: 1px solid var(--border-hairline);
	}

	.feed-when {
		flex: none;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.feed-what {
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}

	.crumbs {
		font-size: var(--text-xs);
		margin-bottom: var(--space-3);
		color: var(--text-secondary);
	}

	.head {
		margin-bottom: var(--space-4);
	}

	h1 {
		margin: 0 0 var(--space-2);
		/* Long client names wrap rather than push the page sideways at 412px. */
		overflow-wrap: anywhere;
	}

	.head-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}

	.muted {
		color: var(--text-secondary);
	}

	.money {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
		margin: 0 0 var(--space-5);
	}

	@media (min-width: 720px) {
		.money {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.money div {
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		background: var(--surface);
	}

	.money div.alarm {
		border-color: var(--gold);
	}

	.money dt {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
		margin-bottom: 2px;
	}

	.money dd {
		margin: 0;
		font-size: var(--text-lg);
	}

	.cols {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-4);
		margin-bottom: var(--space-4);
	}

	@media (min-width: 900px) {
		.cols {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.pair {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
	}

	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.rows.pad {
		padding: 0 var(--space-4) var(--space-3);
	}

	.rows li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: flex-start;
		justify-content: space-between;
		padding: var(--space-3) 0;
		border-top: 1px solid var(--border);
	}

	.row-main {
		flex: 1 1 200px;
		min-width: 0;
	}

	.row-title {
		margin: 0;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.row-meta {
		margin: 2px 0 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}

	.row-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.primary {
		display: inline-block;
		margin-left: var(--space-2);
		font-size: var(--text-xs);
		padding: 1px 6px;
		border-radius: 999px;
		border: 1px solid var(--gold);
	}

	.check {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		margin-bottom: var(--space-3);
	}

	.form-actions {
		margin: var(--space-3) 0 var(--space-4);
	}

	.empty {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		margin: 0;
	}

	.empty.pad {
		padding: 0 var(--space-4) var(--space-4);
	}

	.footnote {
		margin: var(--space-3) 0 0;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.table-scroll {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}

	th {
		text-align: left;
		font-weight: 700;
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
		border-bottom: 1px solid var(--border);
		padding: var(--space-2) var(--space-3);
		white-space: nowrap;
	}

	td {
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--border);
	}

	.right {
		text-align: right;
	}

	.nowrap {
		white-space: nowrap;
	}

	.overdue {
		display: inline-block;
		margin-left: var(--space-2);
		font-size: var(--text-xs);
		color: var(--text-primary);
		border: 1px solid var(--gold);
		border-radius: 999px;
		padding: 0 6px;
	}
</style>
