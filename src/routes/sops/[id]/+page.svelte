<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { formatDay } from '$lib/format';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import FormField from '$lib/components/FormField.svelte';
	import Input from '$lib/components/Input.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import Textarea from '$lib/components/Textarea.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');
	let mode = $state<'read' | 'edit' | 'meta'>('read');
	let newBody = $state('');
	let changeNote = $state('');
	let meta = $state<Record<string, string>>({});

	const sop = $derived(data.sop);
	const archived = $derived(sop.status === 'archived');

	async function send(path: string, method: string, body: unknown, message: string) {
		busy = true;
		errorMessage = '';
		try {
			const res = await fetch(path, {
				method,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body ?? {})
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

	function startEdit() {
		mode = 'edit';
		errorMessage = '';
		newBody = data.viewing?.body ?? '';
		changeNote = '';
	}

	function startMeta() {
		mode = 'meta';
		errorMessage = '';
		meta = {
			title: sop.title,
			category: sop.category ?? '',
			review_due: sop.review_due ?? ''
		};
	}

	async function saveVersion(event: SubmitEvent) {
		event.preventDefault();
		if (!newBody.trim()) {
			errorMessage = 'The body cannot be empty.';
			return;
		}
		const ok = await send(
			`/api/sops/${sop.id}/versions`,
			'POST',
			{ body: newBody, change_note: changeNote },
			'New version saved.'
		);
		if (ok) mode = 'read';
	}

	async function saveMeta(event: SubmitEvent) {
		event.preventDefault();
		if (await send(`/api/sops/${sop.id}`, 'PATCH', { ...meta }, 'Details updated.')) mode = 'read';
	}

	async function setStatus(status: 'active' | 'archived') {
		await send(
			`/api/sops/${sop.id}`,
			'PATCH',
			{ status },
			status === 'archived' ? 'SOP archived.' : 'SOP restored to active.'
		);
	}

	async function restore(versionId: string, versionNumber: number) {
		await send(
			`/api/sops/${sop.id}/versions/${versionId}/restore`,
			'POST',
			{},
			`Version ${versionNumber} carried forward as a new version.`
		);
	}
</script>

<svelte:head>
	<title>{sop.title} | Command Center</title>
</svelte:head>

<nav class="crumbs mono" aria-label="Breadcrumb">
	<a href="/sops">SOPs</a>
	<span aria-hidden="true">/</span>
	<span>{sop.title}</span>
</nav>

<header class="head">
	<div class="titles">
		<h1>{sop.title}</h1>
		{#if archived}
			<StatusChip tone="waiting" label="Archived" />
		{/if}
	</div>
	<div class="head-actions">
		{#if !archived}
			<Button variant="secondary" onclick={() => (mode === 'edit' ? (mode = 'read') : startEdit())}>
				{mode === 'edit' ? 'Cancel' : 'Edit'}
			</Button>
		{/if}
		<Button variant="secondary" onclick={() => (mode === 'meta' ? (mode = 'read') : startMeta())}>
			{mode === 'meta' ? 'Cancel' : 'Details'}
		</Button>
		{#if archived}
			<Button onclick={() => setStatus('active')} disabled={busy}>Restore to active</Button>
		{:else}
			<Button variant="ghost" onclick={() => setStatus('archived')} disabled={busy}>Archive</Button>
		{/if}
	</div>
</header>

<p class="sub">
	{sop.category || 'Uncategorised'}
	<span class="sep">·</span>{sop.version_count ?? 1} version{(sop.version_count ?? 1) === 1 ? '' : 's'}
	{#if sop.review_due}
		<span class="sep">·</span>review due {formatDay(sop.review_due)}
	{/if}
</p>

<p class="status-line" role="status" aria-live="polite">{notice}</p>

{#if errorMessage}
	<p class="error-banner" role="alert">{errorMessage}</p>
{/if}

{#if archived}
	<p class="archived-note">
		This SOP is archived. It stays readable and its history is intact. Restore it to active
		before editing.
	</p>
{/if}

{#if mode === 'meta'}
	<div class="block">
		<Card title="Details">
			<form onsubmit={saveMeta}>
				<div class="grid">
					<div class="span-all">
						<FormField label="Title">
							<Input bind:value={meta.title} maxlength={300} required />
						</FormField>
					</div>
					<FormField label="Category">
						<Input bind:value={meta.category} maxlength={120} />
					</FormField>
					<FormField label="Review due">
						<Input type="date" bind:value={meta.review_due} mono />
					</FormField>
				</div>
				<div class="form-actions">
					<Button type="submit" disabled={busy}>Save details</Button>
				</div>
			</form>
		</Card>
	</div>
{/if}

<div class="layout">
	<div class="main">
		{#if mode === 'edit'}
			<Card title="New version" subtitle="Version {(sop.version_count ?? 0) + 1}. Nothing before it changes.">
				<form onsubmit={saveVersion}>
					<FormField label="Body">
						<Textarea bind:value={newBody} rows={18} />
					</FormField>
					<div class="note-field">
						<FormField label="Change note" hint="What changed and why. This is the audit trail.">
							<Input bind:value={changeNote} maxlength={500} placeholder="Added the 60 day escalation step" />
						</FormField>
					</div>
					<div class="form-actions">
						<Button type="submit" disabled={busy}>Save as new version</Button>
						<Button variant="secondary" onclick={() => (mode = 'read')} disabled={busy}>Cancel</Button>
					</div>
				</form>
			</Card>
		{:else if data.viewing}
			<Card
				title={data.isCurrent ? 'Current version' : `Version ${data.viewing.version_number}`}
				subtitle="v{data.viewing.version_number} · {formatDay(data.viewing.created_at.slice(0, 10))}{data.viewing.change_note ? ` · ${data.viewing.change_note}` : ''}"
			>
				{#snippet actions()}
					{#if !data.isCurrent}
						<Button href="/sops/{sop.id}" variant="ghost" size="sm">Back to current</Button>
					{/if}
				{/snippet}

				{#if !data.isCurrent}
					<p class="old-warning">
						This is an older version, kept for the audit trail. It is not the procedure in force.
					</p>
				{/if}

				<!-- Rendered through the one markdown component, which never produces
				     an HTML string. See D36 and the Markdown component's own note. -->
				<Markdown source={data.viewing.body} />
			</Card>
		{/if}
	</div>

	<aside class="side">
		<Card title="Version history" subtitle="Immutable. Nothing here is ever edited or removed." padded={false}>
			<ol class="history">
				{#each data.versions as version (version.id)}
					{@const isCurrent = version.id === sop.current_version_id}
					{@const isViewing = version.id === data.viewing?.id}
					<li class="entry" class:viewing={isViewing}>
						<div class="entry-head mono">
							<a href="/sops/{sop.id}?version={version.version_number}" class="vnum">
								v{version.version_number}{#if isCurrent}<span class="current"> · current</span>{/if}
							</a>
							<span class="vdate">{formatDay(version.created_at.slice(0, 10))}</span>
						</div>
						{#if version.change_note}
							<p class="vnote">{version.change_note}</p>
						{/if}
						{#if !isCurrent && !archived}
							<Button
								variant="ghost"
								size="sm"
								disabled={busy}
								onclick={() => restore(version.id, version.version_number)}
							>
								Carry forward
							</Button>
						{/if}
					</li>
				{/each}
			</ol>
		</Card>
	</aside>
</div>

<style>
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

	.head-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.sub {
		margin-top: var(--space-2);
		color: var(--text-secondary);
		font-size: var(--text-sm);
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

	.error-banner,
	.archived-note,
	.old-warning {
		margin-top: var(--space-2);
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
	}

	.error-banner {
		border: 1px solid var(--red-200);
		background: var(--red-100);
		color: var(--red);
	}

	.archived-note {
		border: 1px solid var(--border-strong);
		background: var(--surface-callout);
		color: var(--text-secondary);
	}

	.old-warning {
		margin: 0 0 var(--space-3);
		border: 1px solid var(--gold);
		background: var(--gold-50);
		color: var(--text-warn);
	}

	.block {
		margin-top: var(--space-4);
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-3);
	}

	.note-field {
		margin-top: var(--space-3);
	}

	.form-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}

	.layout {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-4);
		margin-top: var(--space-4);
		align-items: start;
	}

	.history {
		list-style: none;
		margin: 0;
		padding: var(--space-2);
	}

	.entry {
		padding: var(--space-3) var(--space-3);
		border-bottom: 1px solid var(--border-thin);
	}

	.entry:last-child {
		border-bottom: none;
	}

	.entry.viewing {
		background: var(--navy-50);
		border-radius: var(--radius-sm);
	}

	.entry-head {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		font-size: var(--text-xs);
	}

	.vnum {
		color: var(--ink);
		text-decoration: none;
	}

	.vnum:hover {
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.current {
		color: var(--green-700);
	}

	.vdate {
		color: var(--text-secondary);
	}

	.vnote {
		margin-top: var(--space-1);
		font-size: var(--text-sm);
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

	@media (min-width: 960px) {
		.layout {
			grid-template-columns: 1fr 300px;
		}
	}
</style>
