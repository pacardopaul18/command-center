<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { formatUsd, type Client } from '$lib/types';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import FormField from '$lib/components/FormField.svelte';
	import Input from '$lib/components/Input.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import Textarea from '$lib/components/Textarea.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');
	let showForm = $state(false);
	let editingId = $state<string | null>(null);

	let draft = $state({ name: '', billing_terms: '', notes: '' });
	let edit = $state<Record<string, string>>({});

	async function send(path: string, method: string, body: unknown, message: string) {
		busy = true;
		errorMessage = '';
		try {
			const res = await fetch(path, {
				method,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
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

	async function create(event: SubmitEvent) {
		event.preventDefault();
		if (!draft.name.trim()) {
			errorMessage = 'Give the client a name.';
			return;
		}
		if (await send('/api/clients', 'POST', draft, 'Client created.')) {
			draft = { name: '', billing_terms: '', notes: '' };
			showForm = false;
		}
	}

	function startEdit(client: Client) {
		editingId = client.id;
		errorMessage = '';
		edit = {
			name: client.name,
			billing_terms: client.billing_terms ?? '',
			notes: client.notes ?? ''
		};
	}

	async function saveEdit(event: SubmitEvent) {
		event.preventDefault();
		if (!editingId) return;
		if (await send(`/api/clients/${editingId}`, 'PATCH', edit, 'Client updated.')) editingId = null;
	}

	async function setStatus(client: Client, status: 'active' | 'archived') {
		await send(
			`/api/clients/${client.id}`,
			'PATCH',
			{ status },
			status === 'archived' ? 'Client archived.' : 'Client restored to active.'
		);
	}

	function urlFor(status: string) {
		const params = new URLSearchParams(page.url.searchParams);
		if (status && status !== 'active') params.set('status', status);
		else params.delete('status');
		const query = params.toString();
		return query ? `/clients?${query}` : '/clients';
	}
</script>

<svelte:head>
	<title>Clients | Command Center</title>
</svelte:head>

<header class="head">
	<div>
		<h1>Clients</h1>
		<p class="sub">Who the work is for, and on what terms.</p>
	</div>
	<div class="head-actions">
		<!--
			Shown only when there is something to resolve. D27: an affordance that
			leads to an empty screen is a promise the app cannot keep, and a
			permanent link here would train Paul to ignore it on the day it
			matters.
		-->
		{#if data.pending && data.pending.projects + data.pending.folders > 0}
			<a class="pending" href="/clients/unassigned">
				{data.pending.projects + data.pending.folders} unfiled
			</a>
		{/if}
		<Button onclick={() => (showForm = !showForm)}>{showForm ? 'Cancel' : 'New client'}</Button>
	</div>
</header>

<p class="status-line" role="status" aria-live="polite">{notice}</p>

{#if errorMessage}
	<p class="error-banner" role="alert">{errorMessage}</p>
{/if}

{#if showForm}
	<div class="block">
		<Card title="New client">
			<form onsubmit={create}>
				<div class="grid">
					<FormField label="Name">
						<Input bind:value={draft.name} placeholder="Client name" maxlength={200} required />
					</FormField>
					<FormField label="Billing terms" hint="For example net-30.">
						<Input bind:value={draft.billing_terms} maxlength={120} />
					</FormField>
					<div class="span-all">
						<FormField label="Notes">
							<Textarea bind:value={draft.notes} />
						</FormField>
					</div>
				</div>
				<div class="form-actions"><Button type="submit" disabled={busy}>Create client</Button></div>
			</form>
		</Card>
	</div>
{/if}

<nav class="tabs" aria-label="Filter clients">
	<a href={urlFor('active')} class="tab" aria-current={data.status === 'active' ? 'page' : undefined}>
		Active <span class="count mono">{data.counts.active}</span>
	</a>
	<a href={urlFor('archived')} class="tab" aria-current={data.status === 'archived' ? 'page' : undefined}>
		Archived <span class="count mono">{data.counts.archived}</span>
	</a>
	<a href={urlFor('all')} class="tab" aria-current={data.status === 'all' ? 'page' : undefined}>
		All <span class="count mono">{data.counts.active + data.counts.archived}</span>
	</a>
</nav>

{#if data.clients.length === 0}
	<p class="empty">
		{#if data.status === 'archived'}
			Nothing is archived.
		{:else}
			No clients yet. Add the first one so projects and invoices have somewhere to hang.
		{/if}
	</p>
{:else}
	<!--
		A table, because the redesign turned this into one and the reason is
		right: six facts per client read as columns and do not read as a
		paragraph. It scrolls inside its own box so the page never scrolls
		sideways, D22.
	-->
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th scope="col">Client</th>
					<th scope="col">Primary contact</th>
					<th scope="col">Terms</th>
					<th scope="col" class="num">Projects</th>
					<th scope="col" class="num">Open balance</th>
					<th scope="col">Status</th>
					<th scope="col"><span class="sr">Actions</span></th>
				</tr>
			</thead>
			<tbody>
				{#each data.clients as client (client.id)}
					<tr>
						{#if editingId === client.id}
							<td colspan="7">
								<form class="edit" onsubmit={saveEdit}>
									<div class="grid">
										<FormField label="Name">
											<Input bind:value={edit.name} maxlength={200} required />
										</FormField>
										<FormField label="Billing terms">
											<Input bind:value={edit.billing_terms} maxlength={120} />
										</FormField>
										<div class="span-all">
											<FormField label="Notes">
												<Textarea bind:value={edit.notes} />
											</FormField>
										</div>
									</div>
									<div class="form-actions">
										<Button type="submit" disabled={busy}>Save</Button>
										<Button variant="secondary" onclick={() => (editingId = null)} disabled={busy}>
											Cancel
										</Button>
									</div>
								</form>
							</td>
						{:else}
							<td>
								<a class="name" href="/clients/{client.id}">{client.name}</a>
								{#if client.notes}<span class="notes">{client.notes}</span>{/if}
							</td>
							<td>
								{#if client.primary_contact_name}
									<span class="contact">{client.primary_contact_name}</span>
									{#if client.primary_contact_email}
										<a class="contact-email mono" href="mailto:{client.primary_contact_email}">
											{client.primary_contact_email}
										</a>
									{/if}
								{:else}
									<span class="none mono">None on file</span>
								{/if}
							</td>
							<td class="mono">{client.billing_terms || 'Not set'}</td>
							<td class="num mono">{client.project_count ?? 0}</td>
							<!--
								The balance is filtered the way Invoicing filters it, so this
								column cannot disagree with the invoice screen about what is
								owed. Overdue money is coloured; money not yet due is not,
								because a client who has simply not reached their due date is
								not a problem.
							-->
							<td class="num mono" class:owing={(client.overdue_cents ?? 0) > 0}>
								{formatUsd(client.outstanding_cents ?? 0)}
							</td>
							<td>
								{#if client.status === 'archived'}
									<StatusChip tone="waiting" label="Archived" size="sm" />
								{:else if (client.overdue_cents ?? 0) > 0}
									<StatusChip tone="overdue" label="Overdue" size="sm" />
								{:else}
									<StatusChip tone="ontrack" label="Active" size="sm" />
								{/if}
							</td>
							<td class="actions">
								<Button variant="ghost" size="sm" onclick={() => startEdit(client)}>Edit</Button>
								{#if client.status === 'archived'}
									<Button
										variant="ghost"
										size="sm"
										disabled={busy}
										onclick={() => setStatus(client, 'active')}
									>
										Restore
									</Button>
								{:else}
									<Button
										variant="ghost"
										size="sm"
										disabled={busy}
										onclick={() => setStatus(client, 'archived')}
									>
										Archive
									</Button>
								{/if}
							</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.head-actions {
		display: flex;
		gap: var(--space-3);
		align-items: center;
	}

	.pending {
		display: inline-flex;
		align-items: center;
		/* D22: 44px tap floor. */
		min-height: 44px;
		padding: 0 var(--space-4);
		border-radius: var(--radius-2);
		background: var(--gold-100);
		color: var(--gold-600);
		font-weight: 600;
		font-size: 0.875rem;
		text-decoration: none;
		white-space: nowrap;
	}

	.pending:hover {
		background: var(--gold-50);
	}


	.table-wrap {
		margin-top: var(--space-3);
		overflow-x: auto;
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		background: var(--surface-card);
	}

	table {
		width: 100%;
		min-width: 720px;
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

	.name {
		display: block;
		color: var(--text-heading);
		font-size: var(--text-sm);
	}

	.notes {
		display: block;
		margin-top: 2px;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.contact {
		display: block;
		font-size: var(--text-sm);
	}

	.contact-email {
		display: block;
		margin-top: 2px;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.none {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.owing {
		color: var(--red, #8a2f22);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		justify-content: flex-end;
	}

	/*
	 * Visible to a screen reader, never drawn, and deliberately not positioned.
	 *
	 * The usual visually-hidden recipe uses `position: absolute`, and inside a
	 * horizontally scrolling table that is a trap: the span has no positioned
	 * ancestor, so it resolves against the initial containing block, escapes the
	 * scroll container, and lands at the table's full unscrolled width. This one
	 * pushed the document to 757px at a 412px viewport, and the page scrolled
	 * sideways because of a label nobody can see. Clipping a one-pixel inline
	 * box does the same job and cannot leave its parent.
	 */
	.sr {
		display: inline-block;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.empty {
		margin-top: var(--space-4);
		color: var(--text-secondary);
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
	.block {
		margin-top: var(--space-4);
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-3);
	}
	.form-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin-top: var(--space-5);
		border-bottom: 1px solid var(--border-thin);
	}
	.tab {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--tap);
		padding: 0 var(--space-3);
		margin-bottom: -1px;
		border-bottom: 2px solid transparent;
		color: var(--text-secondary);
		text-decoration: none;
	}
	.tab:hover {
		color: var(--ink);
		text-decoration: none;
	}
	.tab[aria-current='page'] {
		color: var(--navy);
		border-bottom-color: var(--navy);
		font-weight: var(--weight-medium);
	}
	.count {
		font-size: var(--text-xs);
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
	.name {
		font-weight: var(--weight-medium);
		overflow-wrap: anywhere;
	}
	.notes {
		margin-top: var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-secondary);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
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
