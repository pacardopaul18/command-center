<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import FormField from '$lib/components/FormField.svelte';
	import Input from '$lib/components/Input.svelte';
	import Select from '$lib/components/Select.svelte';
	import type { AsanaRef } from '$lib/types';
	import type { PageData } from './$types';

	/**
	 * Settings.
	 *
	 * Asana is the only thing here today. The token is a Worker secret and never
	 * appears on this screen; all this page knows is whether one exists.
	 *
	 * Asana requires a workspace on task creation, so a workspace has to be
	 * chosen before anything can be pushed. Rather than ask Paul to dig a gid out
	 * of an Asana URL, the workspaces the token can see are listed on demand and
	 * he picks from them. The project is optional, because a task can be created
	 * in a workspace without one.
	 */

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');

	let workspaces = $state<AsanaRef[]>([]);
	let projects = $state<AsanaRef[]>([]);
	let loadedFor = $state<string | null>(null);

	/**
	 * The form is seeded once from the saved settings and then owned by the user.
	 * It is deliberately not resynced on navigation: after a save the fields
	 * already hold what was just written, and the saved state is shown separately
	 * above, so resyncing would only risk overwriting an in-progress edit.
	 */
	const saved = untrack(() => data.asana.settings);

	let workspaceGid = $state(saved.workspace_gid ?? '');
	let projectGid = $state(saved.project_gid ?? '');
	let assignee = $state(saved.assignee ?? '');

	async function readError(res: Response, fallback: string): Promise<string> {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		return body.error ?? fallback;
	}

	async function loadWorkspaces() {
		busy = true;
		notice = '';
		errorMessage = '';
		try {
			const res = await fetch('/api/asana/workspaces');
			if (!res.ok) {
				errorMessage = await readError(res, 'Could not list Asana workspaces.');
				return;
			}
			workspaces = ((await res.json()) as { workspaces: AsanaRef[] }).workspaces;
			if (workspaces.length === 0) {
				errorMessage = 'The token can see no workspaces. Check it belongs to the right account.';
			}
		} catch {
			errorMessage = 'Could not reach the server.';
		} finally {
			busy = false;
		}
	}

	async function loadProjects() {
		if (!workspaceGid) return;
		busy = true;
		errorMessage = '';
		try {
			const res = await fetch(`/api/asana/projects?workspace=${encodeURIComponent(workspaceGid)}`);
			if (!res.ok) {
				errorMessage = await readError(res, 'Could not list Asana projects.');
				return;
			}
			projects = ((await res.json()) as { projects: AsanaRef[] }).projects;
			loadedFor = workspaceGid;
		} catch {
			errorMessage = 'Could not reach the server.';
		} finally {
			busy = false;
		}
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		notice = '';
		errorMessage = '';
		try {
			// Names are sent alongside the gids so the screen can show a label
			// without calling Asana on every load. The gid is what identifies.
			const res = await fetch('/api/asana', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					workspace_gid: workspaceGid,
					workspace_name: workspaces.find((w) => w.gid === workspaceGid)?.name ?? null,
					project_gid: projectGid || null,
					project_name: projects.find((p) => p.gid === projectGid)?.name ?? null,
					assignee: assignee.trim() || null
				})
			});
			if (!res.ok) {
				errorMessage = await readError(res, 'Could not save the Asana settings.');
				return;
			}
			notice = 'Saved. Action items can be pushed to Asana now.';
			await invalidateAll();
		} catch {
			errorMessage = 'Could not reach the server.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Settings</title></svelte:head>

<header class="head">
	<h1>Settings</h1>
	<p>Configuration that lives outside the code.</p>
</header>

{#if notice}<p class="notice" role="status">{notice}</p>{/if}
{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}

<Card title="Asana" subtitle="One-way push. Nothing is read back from Asana.">
	<dl class="state">
		<div>
			<dt>Token</dt>
			<dd>{data.asana.token_present ? 'Set as a Worker secret' : 'Not set'}</dd>
		</div>
		<div>
			<dt>Workspace</dt>
			<dd>
				{data.asana.settings.workspace_name ?? data.asana.settings.workspace_gid ?? 'Not chosen'}
			</dd>
		</div>
		<div>
			<dt>Project</dt>
			<dd>{data.asana.settings.project_name ?? data.asana.settings.project_gid ?? 'None'}</dd>
		</div>
		<div>
			<dt>Pushing</dt>
			<dd>{data.asana.ready ? 'Available' : 'Unavailable'}</dd>
		</div>
	</dl>

	{#if !data.asana.token_present}
		<p class="blocked">
			No Asana token is configured. Set one with
			<code>wrangler secret put ASANA_TOKEN</code>, redeploy, then reload this page. Everything
			else in the app works without it; only the push is unavailable.
		</p>
	{:else}
		<p class="hint">
			Asana needs a workspace before it can create a task. Load the workspaces this token can see,
			pick one, and save. A project is optional.
		</p>

		<div class="actions">
			<Button variant="secondary" disabled={busy} onclick={loadWorkspaces}>
				Load workspaces
			</Button>
			{#if workspaceGid && loadedFor !== workspaceGid}
				<Button variant="secondary" disabled={busy} onclick={loadProjects}>
					Load projects in this workspace
				</Button>
			{/if}
		</div>

		<form onsubmit={save}>
			<div class="grid">
				<FormField label="Workspace">
					{#if workspaces.length > 0}
						<Select bind:value={workspaceGid}>
							<option value="">Choose a workspace</option>
							{#each workspaces as w (w.gid)}
								<option value={w.gid}>{w.name}</option>
							{/each}
						</Select>
					{:else}
						<Input bind:value={workspaceGid} placeholder="Load workspaces, or paste a gid" />
					{/if}
				</FormField>

				<FormField label="Project, optional">
					{#if projects.length > 0}
						<Select bind:value={projectGid}>
							<option value="">No project</option>
							{#each projects as p (p.gid)}
								<option value={p.gid}>{p.name}</option>
							{/each}
						</Select>
					{:else}
						<Input bind:value={projectGid} placeholder="Load projects, or leave empty" />
					{/if}
				</FormField>

				<div class="span-all">
					<FormField
						label="Default assignee, optional"
						hint="An Asana user gid, an email address, or the word me. Leave empty to create tasks unassigned."
					>
						<Input bind:value={assignee} maxlength={200} />
					</FormField>
				</div>
			</div>

			<div class="save">
				<Button type="submit" disabled={busy || !workspaceGid}>Save Asana settings</Button>
			</div>
		</form>
	{/if}
</Card>

<style>
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-bottom: var(--space-5);
	}

	.head h1 {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: var(--weight-medium);
	}

	.head p {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.notice,
	.error {
		margin: 0 0 var(--space-4);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
	}

	.notice {
		background: var(--green-100);
		color: var(--green-700);
	}

	.error {
		background: var(--red-100);
		color: var(--red);
	}

	.state {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-3);
		margin: 0 0 var(--space-4);
		padding-bottom: var(--space-4);
		border-bottom: 1px solid var(--border-thin);
	}

	@media (min-width: 720px) {
		.state {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	.state dt {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		color: var(--text-secondary);
	}

	.state dd {
		margin: 2px 0 0;
		font-size: var(--text-sm);
	}

	.blocked,
	.hint {
		margin: 0 0 var(--space-4);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	code {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		padding: 1px 4px;
		border-radius: 4px;
		background: var(--surface-hover);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
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

	.save {
		margin-top: var(--space-4);
	}
</style>
