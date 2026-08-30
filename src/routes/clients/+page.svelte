<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import type { Client } from '$lib/types';
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
	<Button onclick={() => (showForm = !showForm)}>{showForm ? 'Cancel' : 'New client'}</Button>
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
	<ul class="rows">
		{#each data.clients as client (client.id)}
			<li class="row">
				{#if editingId === client.id}
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
				{:else}
					<div class="line">
						<div class="body">
							<p class="name"><a href="/clients/{client.id}">{client.name}</a></p>
							<p class="meta mono">
								{client.billing_terms || 'No terms set'}
								<span class="sep">·</span>{client.project_count ?? 0}
								project{(client.project_count ?? 0) === 1 ? '' : 's'}
							</p>
							{#if client.notes}<p class="notes">{client.notes}</p>{/if}
						</div>
						{#if client.status === 'archived'}
							<StatusChip tone="waiting" label="Archived" size="sm" />
						{/if}
						<div class="actions">
							<Button variant="ghost" size="sm" onclick={() => startEdit(client)}>Edit</Button>
							{#if client.status === 'archived'}
								<Button variant="ghost" size="sm" disabled={busy} onclick={() => setStatus(client, 'active')}>
									Restore
								</Button>
							{:else}
								<Button variant="ghost" size="sm" disabled={busy} onclick={() => setStatus(client, 'archived')}>
									Archive
								</Button>
							{/if}
						</div>
					</div>
				{/if}
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
	.rows {
		list-style: none;
		margin: var(--space-4) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.row {
		padding: var(--space-3) var(--space-4);
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
	}
	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: var(--space-3);
	}
	.body {
		flex: 1;
		min-width: 0;
	}
	.name {
		font-weight: var(--weight-medium);
		overflow-wrap: anywhere;
	}
	.meta {
		margin-top: 2px;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.notes {
		margin-top: var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-secondary);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.sep {
		margin: 0 var(--space-1);
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
