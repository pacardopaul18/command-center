<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { apiWrite } from '$lib/http';
	import { formatDay } from '$lib/format';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import FormField from '$lib/components/FormField.svelte';
	import Input from '$lib/components/Input.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import Select from '$lib/components/Select.svelte';
	import Textarea from '$lib/components/Textarea.svelte';
	import type { PageData } from './$types';
	import RichText from '$lib/components/RichText.svelte';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');
	let mode = $state<'read' | 'edit' | 'meta'>('read');
	/**
	 * A verification being logged.
	 *
	 * `verified_by` is typed rather than assumed to be Paul: the whole point of
	 * a deputy in the roles table is that somebody else runs the procedure, and
	 * a log that always says Paul cannot show that it happened.
	 */
	let logging = $state(false);
	let verification = $state({
		subject: '',
		step_number: '',
		verified_by: '',
		verified_at: '',
		outcome: 'pass',
		note: ''
	});

	let newBody = $state('');
	/* The version's plain body, so an older markdown version opens as itself. */
	let newBodyPlain = $state('');
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
		// Seeded from the version's HTML when it has any. A version written before
		// the editor shipped has only markdown, and the editor converts it on
		// open so the next version keeps the shape rather than flattening it.
		newBody = data.viewing?.body_html ?? '';
		newBodyPlain = data.viewing?.body ?? '';
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
			{ body_html: newBody, change_note: changeNote },
			'New version saved.'
		);
		if (ok) mode = 'read';
	}

	async function logVerification(event: SubmitEvent) {
		event.preventDefault();
		if (!verification.subject.trim() || !verification.verified_by.trim()) {
			errorMessage = 'A verification needs what was checked and who checked it.';
			return;
		}
		if (verification.outcome === 'fault' && !verification.note.trim()) {
			errorMessage = 'A fault needs a note saying what went wrong.';
			return;
		}
		const ok = await send(
			`/api/sops/${sop.id}/verifications`,
			'POST',
			verification,
			'Verification logged.'
		);
		if (ok) {
			verification = {
				subject: '',
				step_number: '',
				verified_by: verification.verified_by,
				verified_at: '',
				outcome: 'pass',
				note: ''
			};
			logging = false;
		}
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

	/* ---------------------------------------------------------------------
	 * Where this page lives
	 * ------------------------------------------------------------------ */

	/**
	 * The picker follows the URL rather than the value it was built with.
	 *
	 * Reading `data` once at construction looked right and was not: filing a
	 * page re-runs the loader without rebuilding the component, and the select
	 * would still show whatever was chosen before.
	 */
	let filing = $state('');

	$effect(() => {
		filing = data.placement?.chapter_id ?? '';
	});

	/**
	 * Files the page into a chapter, or moves it.
	 *
	 * One placement per page, so filing a page that is already filed moves it
	 * rather than adding a second home. A procedure appearing in two books would
	 * be two procedures that drift.
	 */
	async function fileIt() {
		if (!filing) return;
		busy = true;
		errorMessage = '';
		const res = await apiWrite(`/api/sops/${sop.id}/placement`, 'PUT', {
			chapter_id: filing
		});
		busy = false;
		if (res.ok) {
			notice = 'Filed.';
			await invalidateAll();
		} else {
			errorMessage = res.error ?? 'Could not file that page.';
		}
	}

	async function unfile() {
		busy = true;
		const res = await apiWrite(`/api/sops/${sop.id}/placement`, 'DELETE', null);
		busy = false;
		if (res.ok) {
			notice = 'Taken off the shelf. The page itself is unchanged.';
			await invalidateAll();
		} else {
			errorMessage = res.error ?? 'Could not unfile that page.';
		}
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


<div class="block">
	<Card title="Where this lives">
		{#if data.placement}
			<p class="placement">
				<a href="/sops/shelves/{data.placement.shelf_id}">{data.placement.shelf_name}</a>
				<span aria-hidden="true">/</span>
				<a href="/sops/books/{data.placement.book_id}">{data.placement.book_title}</a>
				<span aria-hidden="true">/</span>
				{data.placement.chapter_title}
			</p>
		{:else}
			<p class="empty">
				Not filed anywhere yet. Every page was in this state until the shelves arrived;
				filing it puts it in a chapter without changing a word of it.
			</p>
		{/if}

		<div class="file-row">
			<Select bind:value={filing} aria-label="Chapter to file into">
				<option value="">Choose a chapter</option>
				{#each data.chapters as chapter (chapter.id)}
					<option value={chapter.id}>
						{chapter.shelf_name} / {chapter.book_title} / {chapter.title}
					</option>
				{/each}
			</Select>
			<Button variant="secondary" disabled={busy || !filing} onclick={fileIt}>
				{data.placement ? 'Move it' : 'File it'}
			</Button>
			{#if data.placement}
				<Button variant="ghost" disabled={busy} onclick={unfile}>Take off the shelf</Button>
			{/if}
		</div>
	</Card>
</div>

<div class="layout">
	<div class="main">
		{#if mode === 'edit'}
			<Card title="New version" subtitle="Version {(sop.version_count ?? 0) + 1}. Nothing before it changes.">
				<form onsubmit={saveVersion}>
					<FormField label="Body">
						{#key mode}
							<RichTextEditor
								bind:value={newBody}
								plain={newBodyPlain}
								label="Body"
								rows={18}
							/>
						{/key}
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

				<!--
					A version written in the editor renders as its own HTML; one
					written before it renders as the markdown it has always been.
					Neither path constructs an HTML string: both parse into a tree
					and draw real elements. See D36 and rich-text.ts.
				-->
				{#if data.viewing.body_html}
					<RichText html={data.viewing.body_html} text={data.viewing.body} />
				{:else}
					<Markdown source={data.viewing.body} />
				{/if}
			</Card>
		{/if}
	</div>

	<!--
		The verification log.

		A SOP says what to check at each step, and until this there was nowhere
		to record that anybody did. Compliance was a claim and the fault rate was
		anecdotal, which is not a thing anyone can act on. Now both come off the
		same rows. Closes SOP-001's first open question.
	-->
	<div class="block">
		<Card
			title="Verification log"
			subtitle={data.verification.total === 0
				? 'Nothing logged yet'
				: `${data.verification.total} checks, ${data.verification.faults} found a fault`}
		>
			{#snippet actions()}
				<Button variant="ghost" size="sm" onclick={() => (logging = !logging)}>
					{logging ? 'Cancel' : 'Log a check'}
				</Button>
			{/snippet}

			<!--
				Fault rate, or the reason there isn't one.

				Zero would read as "this never fails", and "nobody has checked" is
				the opposite claim. Saying which is which is the whole point. D220.
			-->
			<p class="rate">
				{#if data.verification.fault_rate === null}
					No fault rate yet, because nothing has been verified. That is not the same as a
					procedure that has never failed.
				{:else}
					Fault rate <strong>{Math.round(data.verification.fault_rate * 100)}%</strong>
					across {data.verification.total} checks.
					{#if data.verification.last_verified_at}
						Last verified {formatDay(data.verification.last_verified_at.slice(0, 10))}.
					{/if}
				{/if}
			</p>

			{#if logging}
				<form onsubmit={logVerification} class="log-form">
					<FormField label="What was verified" hint="The meeting, the invoice, the record.">
						<Input
							bind:value={verification.subject}
							maxlength={300}
							placeholder="09-02 Workflow Automation"
							required
						/>
					</FormField>
					<div class="log-grid">
						<FormField label="Step" hint="Empty means the whole procedure.">
							<Input bind:value={verification.step_number} mono placeholder="3" />
						</FormField>
						<FormField label="Who verified it">
							<Input bind:value={verification.verified_by} maxlength={120} required />
						</FormField>
						<FormField label="Verified on" hint="Today if left empty.">
							<Input type="date" bind:value={verification.verified_at} mono />
						</FormField>
						<FormField label="Outcome">
							<Select bind:value={verification.outcome}>
								<option value="pass">Passed</option>
								<option value="fault">Found a fault</option>
							</Select>
						</FormField>
					</div>
					<FormField
						label="Note"
						hint={verification.outcome === 'fault'
							? 'Required. A fault with no description is a number with nothing behind it.'
							: 'Optional.'}
					>
						<Textarea bind:value={verification.note} rows={2} maxlength={2000} />
					</FormField>
					<div class="form-actions">
						<Button type="submit" disabled={busy}>Log it</Button>
					</div>
				</form>
			{/if}

			{#if data.verifications.length === 0}
				<p class="empty">
					No checks logged. The steps in this procedure each name something to verify; logging
					it here is what makes following the procedure visible afterwards.
				</p>
			{:else}
				<div class="scroller">
					<table>
						<thead>
							<tr>
								<th scope="col">When</th>
								<th scope="col">What</th>
								<th scope="col">Step</th>
								<th scope="col">Who</th>
								<th scope="col">Outcome</th>
							</tr>
						</thead>
						<tbody>
							{#each data.verifications as entry (entry.id)}
								<tr class:fault={entry.outcome === 'fault'}>
									<td class="mono">{formatDay(entry.verified_at.slice(0, 10))}</td>
									<th scope="row">
										{entry.subject}
										{#if entry.note}<span class="vnote">{entry.note}</span>{/if}
									</th>
									<td class="mono">{entry.step_number ?? 'All'}</td>
									<td>{entry.verified_by}</td>
									<td>{entry.outcome === 'fault' ? 'Fault' : 'Passed'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</Card>
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
	.rate {
		margin: 0 0 var(--space-3);
		color: var(--text-secondary);
		font-size: var(--text-sm);
		max-width: 70ch;
	}

	.rate strong {
		color: var(--ink);
	}

	.log-form {
		margin-bottom: var(--space-4);
		padding-bottom: var(--space-4);
		border-bottom: 1px solid var(--border-thin);
	}

	.log-grid {
		display: grid;
		gap: var(--space-3);
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		margin: var(--space-3) 0;
	}

	/* Wide content scrolls inside its own box; the page never scrolls sideways. */
	.scroller {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}

	th,
	td {
		text-align: left;
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--border-thin);
		vertical-align: top;
	}

	thead th {
		color: var(--text-secondary);
		font-weight: 600;
		white-space: nowrap;
		border-bottom-width: 2px;
	}

	tbody th {
		font-weight: 600;
	}

	/* A fault is marked, not coloured only: colour alone is not a state. D22. */
	tr.fault td:last-child {
		font-weight: 600;
		color: var(--red);
	}

	.vnote {
		display: block;
		font-weight: 400;
		color: var(--text-secondary);
		max-width: 60ch;
	}

	.placement {
		margin: 0;
		font-size: var(--text-sm);
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	.file-row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex-wrap: wrap;
		margin-top: var(--space-3);
	}

	.file-row :global(select) {
		flex: 1;
		min-width: 200px;
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
