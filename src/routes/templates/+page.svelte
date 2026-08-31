<script lang="ts">
	import { apiWrite } from '$lib/http';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { TEMPLATE_TYPE_LABELS, TEMPLATE_TYPES } from '$lib/types';
	import type { Template } from '$lib/types';
	import { formatDayShort } from '$lib/format';
	import { fillTemplate, missingInputs, templateInputs } from '$lib/template-inputs';
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

	/* ---------------------------------------------------------------------
	 * The library: tabs, search and the fields a template asks for
	 * ------------------------------------------------------------------ */

	/**
	 * Search runs in the browser over the list already loaded.
	 *
	 * The route supports `q` and still does, so a link carrying a search lands
	 * where it says. But "filters as you type" through the server would be a
	 * request per keystroke against a table whose bodies are already on this
	 * page, and the answer would arrive after the next letter.
	 */
	let search = $state('');

	$effect(() => {
		search = data.q;
	});

	let typeFilter = $state<'all' | 'email' | 'doc'>('all');

	const visible = $derived.by(() => {
		const needle = search.trim().toLowerCase();
		return data.templates.filter((template) => {
			if (typeFilter !== 'all' && template.type !== typeFilter) return false;
			if (!needle) return true;
			return [template.name, template.scenario, template.body]
				.filter(Boolean)
				.some((text) => String(text).toLowerCase().includes(needle));
		});
	});

	/** Which row is open. One at a time: two open bodies is a wall of text. */
	let openId = $state<string | null>(null);

	function toggleOpen(template: Template) {
		openId = openId === template.id ? null : template.id;
		if (openId) {
			/**
			 * Seeded with a key per placeholder, empty.
			 *
			 * `bind:value` on a key that does not exist yet binds to undefined,
			 * which Svelte refuses outright on a component with a fallback value.
			 * The same defect as the Quick add box: the field exists in the DOM
			 * before anything has been typed into it.
			 */
			values = Object.fromEntries(templateInputs(template.body).map((i) => [i.key, '']));
			draft = '';
			draftModel = '';
			copied = false;
			errorMessage = '';
		}
	}

	/**
	 * The answers to a template's placeholders, keyed by placeholder.
	 *
	 * Cleared when a different template is opened rather than carried across:
	 * two templates that both ask for a client name are asking different
	 * questions at different moments, and silently reusing the last answer is
	 * how the wrong client's name goes into a letter.
	 */
	let values = $state<Record<string, string>>({});

	const openTemplate = $derived(data.templates.find((t) => t.id === openId) ?? null);
	const inputs = $derived(openTemplate ? templateInputs(openTemplate.body) : []);
	const filled = $derived(openTemplate ? fillTemplate(openTemplate.body, values) : '');
	const missing = $derived(openTemplate ? missingInputs(openTemplate.body, values) : []);

	/**
	 * Copying is a use, and is recorded as one.
	 *
	 * Without it the Most used tile answers a narrower question than it appears
	 * to: most drafted by the model, on a library whose common action is to copy
	 * the text and edit it by hand.
	 */
	async function copyFilled(template: Template) {
		try {
			await navigator.clipboard.writeText(filled);
			copied = true;
			notice = missing.length
				? `Copied, with ${missing.length} placeholder${missing.length === 1 ? '' : 's'} still in it.`
				: 'Copied.';
			await apiWrite(`/api/templates/${template.id}/used`, 'POST', {
				context: template.scenario ?? null
			});
			await invalidateAll();
		} catch {
			errorMessage = 'Could not reach the clipboard. Select the text and copy it.';
		}
	}

	const relativeDay = (value: string | null) =>
		value ? formatDayShort(value.slice(0, 10)) : 'Never';
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

<div class="tiles">
	<div class="tile">
		<span class="tile-label mono">Templates</span>
		<span class="tile-value">{data.counts.active}</span>
		<span class="tile-note mono">{data.counts.email} email, {data.counts.doc} document</span>
	</div>
	<div class="tile">
		<span class="tile-label mono">Drafts generated</span>
		<span class="tile-value">{data.drafted_this_month}</span>
		<span class="tile-note mono">this month</span>
	</div>
	<div class="tile">
		<span class="tile-label mono">Most used</span>
		<span class="tile-value small">{data.most_used?.name ?? 'None yet'}</span>
		<span class="tile-note mono">
			{#if data.most_used}{data.most_used.uses} uses{:else}nothing recorded{/if}
		</span>
	</div>
	<a class="tile" href={urlFor({ status: 'archived' })}>
		<span class="tile-label mono">Archived</span>
		<span class="tile-value">{data.counts.archived}</span>
		<span class="tile-note mono">recoverable</span>
	</a>
</div>

<div class="controls">
	<nav class="tabs" aria-label="Filter templates">
		<button
			type="button"
			class="tab"
			class:on={data.status !== 'archived' && typeFilter === 'all'}
			onclick={() => {
				typeFilter = 'all';
				if (data.status === 'archived') goto(urlFor({ status: 'active' }));
			}}
		>
			All <span class="count mono">{data.counts.active}</span>
		</button>
		{#each TEMPLATE_TYPES as type (type)}
			<button
				type="button"
				class="tab"
				class:on={data.status !== 'archived' && typeFilter === type}
				onclick={() => {
					typeFilter = type;
					if (data.status === 'archived') goto(urlFor({ status: 'active' }));
				}}
			>
				{TEMPLATE_TYPE_LABELS[type]}
				<span class="count mono">{type === 'email' ? data.counts.email : data.counts.doc}</span>
			</button>
		{/each}
		<a class="tab" class:on={data.status === 'archived'} href={urlFor({ status: 'archived' })}>
			Archived <span class="count mono">{data.counts.archived}</span>
		</a>
	</nav>

	<input
		class="search"
		type="search"
		bind:value={search}
		placeholder="Search names, scenarios and body text"
		aria-label="Search templates"
	/>
</div>

<!--
	The seven category tabs the prototype draws are not here. A category is a
	column on `templates` and no ALTER may touch an existing table before
	Thursday, so the tabs are the two types that exist. Drawing seven tabs that
	all filter on nothing would be worse than drawing three that work. D27.
-->

{#if visible.length === 0}
	<p class="empty">
		{#if search}
			No templates match that search.
		{:else if data.status === 'archived'}
			Nothing is archived.
		{:else}
			No templates yet. Paste in a reply you have actually sent and the drafts will
			sound like you.
		{/if}
	</p>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th scope="col">Template</th>
					<th scope="col">Output</th>
					<th scope="col" class="num">Used</th>
					<th scope="col">Last used</th>
					<th scope="col"><span class="sr">Actions</span></th>
				</tr>
			</thead>
			<tbody>
				{#each visible as template (template.id)}
					<tr class:open={openId === template.id}>
						<td>
							<button type="button" class="name" onclick={() => toggleOpen(template)}>
								{template.name}
							</button>
							{#if template.scenario}<span class="scenario">{template.scenario}</span>{/if}
						</td>
						<td class="mono">{TEMPLATE_TYPE_LABELS[template.type]}</td>
						<td class="num mono">{template.use_count ?? 0}</td>
						<td class="mono">{relativeDay(template.last_used_at ?? null)}</td>
						<td class="acts">
							<Button size="sm" onclick={() => toggleOpen(template)}>
								{openId === template.id ? 'Close' : 'Open'}
							</Button>
							<Button variant="ghost" size="sm" onclick={() => startEdit(template)}>Edit</Button>
							{#if template.status === 'archived'}
								<Button
									variant="ghost"
									size="sm"
									disabled={busy}
									onclick={() =>
										send(
											`/api/templates/${template.id}`,
											'PATCH',
											{ status: 'active' },
											'Template restored.'
										)}
								>
									Restore
								</Button>
							{:else}
								<Button
									variant="ghost"
									size="sm"
									disabled={busy}
									onclick={() =>
										send(
											`/api/templates/${template.id}`,
											'PATCH',
											{ status: 'archived' },
											'Template archived.'
										)}
								>
									Archive
								</Button>
							{/if}
						</td>
					</tr>

					{#if openId === template.id}
						<tr class="panel">
							<td colspan="5">
								<div class="cols">
									<div class="col">
										<h3>What it asks for</h3>
										{#if inputs.length === 0}
											<!--
												D27 again, in the small: a form with no fields is drawn
												as a sentence rather than as an empty box.
											-->
											<p class="fine">
												This template has no placeholders. Put
												<code>[like this]</code>
												in the body and they become fields here.
											</p>
										{:else}
											<div class="fields">
												{#each inputs as input (input.key)}
													<label class="field">
														<span>{input.label}</span>
														<Input bind:value={values[input.key]} />
													</label>
												{/each}
											</div>
											{#if missing.length > 0}
												<p class="fine">
													{missing.length} still empty. Anything left blank stays as
													<code>[placeholder]</code> in the text rather than becoming a
													gap you would not notice.
												</p>
											{/if}
										{/if}

										<h3>Draft it with Claude</h3>
										<form onsubmit={(e) => generate(e, template)}>
											<FormField
												label="Situation"
												hint="What happened and what needs saying. The draft uses only what you put here, so anything missing comes back as a bracketed placeholder rather than a guess."
											>
												<Textarea
													bind:value={situation}
													rows={4}
													placeholder="Meridian asked to push the phase review by two weeks because their sponsor is out."
												/>
											</FormField>
											<FormField label="Writing to" hint="Optional.">
												<Input bind:value={recipient} maxlength={200} placeholder="Dana at Meridian" />
											</FormField>
											<div class="form-actions">
												<Button type="submit" disabled={busy}>
													{busy ? 'Drafting' : 'Draft it'}
												</Button>
											</div>
										</form>
									</div>

									<div class="col">
										<h3>The template</h3>
										<pre class="body">{filled}</pre>
										<div class="form-actions">
											<Button size="sm" onclick={() => copyFilled(template)}>
												{copied ? 'Copied' : 'Copy'}
											</Button>
										</div>

										{#if draft}
											<h3>The draft</h3>
											<p class="unreviewed">
												Written by Claude from your template. Read every name, date and
												commitment in it before you send it. Bracketed placeholders are
												things it did not know.
											</p>
											<Markdown source={draft} />
											<div class="form-actions">
												<Button size="sm" onclick={copyDraft}>
													{copied ? 'Copied' : 'Copy draft'}
												</Button>
												{#if draftModel}<span class="model mono">{draftModel}</span>{/if}
											</div>
										{/if}
									</div>
								</div>
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>

	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
		gap: var(--space-3);
		margin: var(--space-4) 0;
	}

	.tile {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3);
		border: 1px solid var(--border-thin);
		border-left: 3px solid var(--navy-600);
		border-radius: var(--radius-md);
		background: var(--surface-card);
		text-decoration: none;
		min-height: 44px;
	}

	.tile-label {
		font-size: var(--text-xs);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.tile-value {
		font-size: var(--text-xl);
		color: var(--text-heading);
	}

	/* A name rather than a figure, so it takes the size a name can wrap at. */
	.tile-value.small {
		font-size: var(--text-md);
		overflow-wrap: anywhere;
	}

	.tile-note {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.controls {
		display: flex;
		gap: var(--space-3);
		align-items: center;
		flex-wrap: wrap;
		margin-bottom: var(--space-3);
	}

	.search {
		flex: 1;
		min-width: 200px;
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

	tr.open > td {
		border-bottom: none;
	}

	.num {
		text-align: right;
	}

	.name {
		display: block;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: var(--text-sm);
		color: var(--text-heading);
		text-align: left;
		cursor: pointer;
	}

	.name:hover {
		text-decoration: underline;
	}

	.scenario {
		display: block;
		margin-top: 2px;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		justify-content: flex-end;
	}

	.panel > td {
		background: var(--surface-page);
	}

	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
	}

	@media (min-width: 900px) {
		.cols {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.col h3 {
		margin: 0 0 var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-heading);
	}

	.col h3:not(:first-child) {
		margin-top: var(--space-4);
	}

	.fields {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: var(--space-3);
		margin-bottom: var(--space-2);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.field > span {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.fine {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.fine code {
		font-family: var(--font-mono);
	}

	/*
	 * Visible to a screen reader, never drawn, and deliberately not positioned:
	 * an absolutely positioned one inside a scrolling table escapes its
	 * container and makes the whole page scroll sideways.
	 */
	.sr {
		display: inline-block;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
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
	.tab.on {
		background: var(--navy-700);
		border-color: var(--navy-700);
		color: var(--surface-page);
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

	.unreviewed {
		margin-bottom: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--gold);
		border-radius: var(--radius-sm);
		background: var(--gold-50);
		color: var(--text-warn);
		font-size: var(--text-sm);
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
	}
</style>
