<script lang="ts">
	import { apiWrite } from '$lib/http';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { TEMPLATE_TYPE_LABELS, TEMPLATE_TYPES } from '$lib/types';
	import type { Template } from '$lib/types';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import FormField from '$lib/components/FormField.svelte';
	import Input from '$lib/components/Input.svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import Select from '$lib/components/Select.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import Textarea from '$lib/components/Textarea.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');
	let showForm = $state(false);
	let editingId = $state<string | null>(null);

	// Drafting state. A draft is never stored, so it lives here and nowhere else.
	let draftingId = $state<string | null>(null);
	let situation = $state('');
	let recipient = $state('');
	let draft = $state('');
	let draftModel = $state('');
	let copied = $state(false);

	function blankTemplate() {
		return { name: '', scenario: '', body: '', type: 'email' };
	}

	let form = $state(blankTemplate());

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

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!form.name.trim() || !form.body.trim()) {
			errorMessage = 'A template needs a name and a body.';
			return;
		}
		const ok = editingId
			? await send(`/api/templates/${editingId}`, 'PATCH', form, 'Template updated.')
			: await send('/api/templates', 'POST', form, 'Template created.');
		if (ok) {
			form = blankTemplate();
			editingId = null;
			showForm = false;
		}
	}

	function startEdit(template: Template) {
		editingId = template.id;
		showForm = true;
		draftingId = null;
		errorMessage = '';
		form = {
			name: template.name,
			scenario: template.scenario ?? '',
			body: template.body,
			type: template.type
		};
	}

	function startDraft(template: Template) {
		draftingId = draftingId === template.id ? null : template.id;
		showForm = false;
		editingId = null;
		situation = '';
		recipient = '';
		draft = '';
		draftModel = '';
		copied = false;
		errorMessage = '';
	}

	async function generate(event: SubmitEvent, template: Template) {
		event.preventDefault();
		if (!situation.trim()) {
			errorMessage = 'Describe the situation to respond to.';
			return;
		}
		busy = true;
		errorMessage = '';
		draft = '';
		copied = false;
		try {
			const result = await apiWrite<{ draft?: string; model?: string }>(
				`/api/templates/${template.id}/draft`,
				'POST',
				{ situation, recipient }
			);
			if (!result.ok) {
				errorMessage = result.error ?? 'Could not draft a reply.';
				return;
			}
			draft = result.data?.draft ?? '';
			draftModel = result.data?.model ?? '';
			notice = 'Draft ready. Read it before you send it.';
		} catch {
			errorMessage = 'Could not reach the server.';
		} finally {
			busy = false;
		}
	}

	async function copyDraft() {
		try {
			await navigator.clipboard.writeText(draft);
			copied = true;
		} catch {
			errorMessage = 'Could not reach the clipboard. Select the text and copy it.';
		}
	}

	function urlFor(patch: Record<string, string>) {
		const params = new URLSearchParams(page.url.searchParams);
		for (const [key, value] of Object.entries(patch)) {
			if (value && !(key === 'status' && value === 'active')) params.set(key, value);
			else params.delete(key);
		}
		const query = params.toString();
		return query ? `/templates?${query}` : '/templates';
	}

	function applySearch(event: SubmitEvent) {
		event.preventDefault();
		const values = new FormData(event.currentTarget as HTMLFormElement);
		goto(urlFor({ q: String(values.get('q') ?? '') }), { keepFocus: true });
	}
</script>

<svelte:head>
	<title>Templates | Command Center</title>
</svelte:head>

<header class="head">
	<div>
		<h1>Templates</h1>
		<p class="sub">Reply patterns and recurring documents, in the partner's voice.</p>
	</div>
	<Button
		onclick={() => {
			showForm = !showForm;
			editingId = null;
			form = blankTemplate();
		}}
	>
		{showForm ? 'Cancel' : 'New template'}
	</Button>
</header>

<p class="status-line" role="status" aria-live="polite">{notice}</p>

{#if errorMessage}
	<p class="error-banner" role="alert">{errorMessage}</p>
{/if}

{#if showForm}
	<div class="block">
		<Card title={editingId ? 'Edit template' : 'New template'}>
			<form onsubmit={save}>
				<div class="grid">
					<FormField label="Name">
						<Input bind:value={form.name} placeholder="What this template is for" maxlength={200} required />
					</FormField>
					<FormField label="Kind">
						<Select bind:value={form.type}>
							{#each TEMPLATE_TYPES as value (value)}
								<option {value}>{TEMPLATE_TYPE_LABELS[value]}</option>
							{/each}
						</Select>
					</FormField>
					<div class="span-all">
						<FormField
							label="Used when"
							hint="When to reach for this one. The AI reads this too, so write it plainly."
						>
							<Input bind:value={form.scenario} maxlength={500} placeholder="A client asks to move a deadline" />
						</FormField>
					</div>
					<div class="span-all">
						<FormField
							label="Body"
							hint="Real writing, not a fill-in-the-blanks skeleton. The AI matches this voice, so the closer it is to something actually sent, the better the draft."
						>
							<Textarea bind:value={form.body} rows={12} />
						</FormField>
					</div>
				</div>
				<div class="form-actions">
					<Button type="submit" disabled={busy}>{editingId ? 'Save template' : 'Create template'}</Button>
				</div>
			</form>
		</Card>
	</div>
{/if}

<nav class="tabs" aria-label="Filter templates">
	<a href={urlFor({ status: 'active' })} class="tab" aria-current={data.status === 'active' ? 'page' : undefined}>
		Active <span class="count mono">{data.counts.active}</span>
	</a>
	<a href={urlFor({ status: 'archived' })} class="tab" aria-current={data.status === 'archived' ? 'page' : undefined}>
		Archived <span class="count mono">{data.counts.archived}</span>
	</a>
	<a href={urlFor({ status: 'all' })} class="tab" aria-current={data.status === 'all' ? 'page' : undefined}>
		All <span class="count mono">{data.counts.active + data.counts.archived}</span>
	</a>
</nav>

<form class="filters" onsubmit={applySearch}>
	<FormField label="Search">
		<Input name="q" type="search" value={data.q} placeholder="Name, scenario or body text" />
	</FormField>
	<Button variant="secondary" type="submit">Search</Button>
</form>

{#if data.templates.length === 0}
	<p class="empty">
		{#if data.q}
			No templates match that search.
		{:else if data.status === 'archived'}
			Nothing is archived.
		{:else}
			No templates yet. Paste in a reply you have actually sent and the drafts will
			sound like you.
		{/if}
	</p>
{:else}
	<ul class="rows">
		{#each data.templates as template (template.id)}
			<li class="row">
				<div class="row-head">
					<div class="titles">
						<p class="name">{template.name}</p>
						<p class="meta mono">
							{TEMPLATE_TYPE_LABELS[template.type]}
							{#if template.scenario}<span class="sep">·</span>{template.scenario}{/if}
						</p>
					</div>
					<div class="row-actions">
						{#if template.status === 'active'}
							<Button size="sm" onclick={() => startDraft(template)}>
								{draftingId === template.id ? 'Close' : 'Draft a reply'}
							</Button>
						{/if}
						<Button variant="ghost" size="sm" onclick={() => startEdit(template)}>Edit</Button>
						{#if template.status === 'archived'}
							<Button
								variant="ghost"
								size="sm"
								disabled={busy}
								onclick={() => send(`/api/templates/${template.id}`, 'PATCH', { status: 'active' }, 'Template restored.')}
							>
								Restore
							</Button>
						{:else}
							<Button
								variant="ghost"
								size="sm"
								disabled={busy}
								onclick={() => send(`/api/templates/${template.id}`, 'PATCH', { status: 'archived' }, 'Template archived.')}
							>
								Archive
							</Button>
						{/if}
					</div>
				</div>

				{#if template.status === 'archived'}
					<StatusChip tone="waiting" label="Archived" size="sm" />
				{/if}

				<pre class="body">{template.body}</pre>

				{#if draftingId === template.id}
					<div class="drafting">
						<form onsubmit={(e) => generate(e, template)}>
							<div class="grid">
								<div class="span-all">
									<FormField
										label="Situation"
										hint="What happened and what needs saying. The draft uses only what you put here, so anything missing comes back as a bracketed placeholder rather than a guess."
									>
										<Textarea bind:value={situation} rows={5} placeholder="Meridian asked to push the phase review by two weeks because their sponsor is out." />
									</FormField>
								</div>
								<FormField label="Writing to" hint="Optional.">
									<Input bind:value={recipient} maxlength={200} placeholder="Dana at Meridian" />
								</FormField>
							</div>
							<div class="form-actions">
								<Button type="submit" disabled={busy}>{busy ? 'Drafting' : 'Draft it'}</Button>
							</div>
						</form>

						{#if draft}
							<div class="draft-out">
								<p class="unreviewed">
									Written by Claude from your template. Read every name, date and commitment in
									it before you send it. Bracketed placeholders are things it did not know.
								</p>
								<Markdown source={draft} />
								<div class="draft-actions">
									<Button size="sm" onclick={copyDraft}>{copied ? 'Copied' : 'Copy draft'}</Button>
									{#if draftModel}<span class="model mono">{draftModel}</span>{/if}
								</div>
							</div>
						{/if}
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
		margin-top: var(--space-3);
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
	.filters {
		display: grid;
		grid-template-columns: 1fr;
		align-items: end;
		gap: var(--space-3);
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
	.row-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.titles {
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
	.sep {
		margin: 0 var(--space-1);
	}
	.row-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	/* The template body is shown verbatim, not rendered. It is the exemplar, and
	   seeing exactly what the AI is matching is the point. */
	.body {
		margin: var(--space-3) 0 0;
		padding: var(--space-3);
		background: var(--surface-hover);
		border-radius: var(--radius-sm);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		line-height: 1.6;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.drafting {
		margin-top: var(--space-4);
		padding-top: var(--space-4);
		border-top: 1px solid var(--border-thin);
	}
	.draft-out {
		margin-top: var(--space-4);
		padding: var(--space-3);
		border: 1px solid var(--border-thin);
		border-left: 3px solid var(--gold);
		border-radius: var(--radius-sm);
	}
	.unreviewed {
		margin-bottom: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--gold);
		border-radius: var(--radius-sm);
		background: var(--gold-50);
		color: var(--text-warn);
		font-size: var(--text-sm);
	}
	.draft-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin-top: var(--space-3);
	}
	.model {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	@media (min-width: 720px) {
		.grid {
			grid-template-columns: 1fr 1fr;
		}
		.span-all {
			grid-column: 1 / -1;
		}
		.filters {
			grid-template-columns: 1fr auto;
		}
	}
</style>
