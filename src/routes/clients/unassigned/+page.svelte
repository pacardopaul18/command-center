<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import Select from '$lib/components/Select.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busy = $state('');
	let notice = $state('');
	let errorMessage = $state('');

	/*
	 * The client chosen for each row, held per subject key.
	 *
	 * Not one shared value: this screen is a list of independent decisions, and
	 * a single selection would mean answering one question changed the visible
	 * answer to all the others.
	 *
	 * Written on change rather than bound. `bind:value` needs the key to exist
	 * before the control is created, and on a key that is not there it throws
	 * `props_invalid_value` and aborts hydration part way through. The page that
	 * came out of that looked very nearly right: the server had rendered all
	 * sixteen archived chips, the half-hydrated page showed fifteen, and nothing
	 * on screen said anything had failed. Seeding the keys would have fixed this
	 * instance; not binding removes the whole hazard, and a select is a control
	 * whose value can simply be read when it changes.
	 */
	let choice = $state<Record<string, string>>({});

	function pick(key: string, event: Event) {
		choice[key] = (event.currentTarget as HTMLSelectElement).value;
	}

	function bytes(n: number): string {
		if (n < 1024) return `${n} B`;
		const units = ['KB', 'MB', 'GB', 'TB'];
		let value = n / 1024;
		let unit = 0;
		while (value >= 1024 && unit < units.length - 1) {
			value /= 1024;
			unit += 1;
		}
		return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
	}

	function day(value: string | null): string {
		return value ? value.slice(0, 10) : 'never';
	}

	async function file(kind: 'asana_project' | 'dropbox_folder', key: string, label: string) {
		const clientId = choice[key];
		if (!clientId) {
			errorMessage = `Choose a client for ${label} first.`;
			return;
		}

		busy = key;
		errorMessage = '';
		try {
			const res = await fetch('/api/unassigned', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ kind, subject_key: key, client_id: clientId })
			});
			const payload = (await res.json().catch(() => ({}))) as {
				error?: string;
				filed?: { client: string };
			};
			if (!res.ok) {
				errorMessage = payload.error ?? 'That could not be filed.';
				return;
			}
			notice = `${label} is now filed under ${payload.filed?.client}.`;
			await invalidateAll();
		} catch {
			errorMessage = 'Could not reach the server.';
		} finally {
			busy = '';
		}
	}
</script>

<svelte:head><title>Unassigned</title></svelte:head>

<header class="head">
	<div>
		<h1>Unassigned</h1>
		<p class="lede">
			Mirrored work the matching rules could not place. Nothing here is guessed: an Asana
			project or a Dropbox folder stays on this list until you say which client it belongs
			to. Filing one records your answer and re-files everything; it changes nothing in
			Asana or Dropbox.
		</p>
	</div>
	<div class="tally">
		<span><strong>{data.counts.projects}</strong> projects</span>
		<span><strong>{data.counts.folders}</strong> folders</span>
	</div>
</header>

{#if notice}<p class="notice" role="status">{notice}</p>{/if}
{#if errorMessage}<p class="bad" role="alert">{errorMessage}</p>{/if}

<Card>
	<h2>Asana projects</h2>
	{#if data.projects.length === 0}
		<p class="empty">Every mirrored project is filed against a client.</p>
	{:else}
		<div class="scroller">
			<table>
				<thead>
					<tr>
						<th scope="col">Project</th>
						<th scope="col" class="num">Tasks</th>
						<th scope="col" class="num">Open</th>
						<th scope="col">Changed</th>
						<th scope="col">File under</th>
						<th scope="col"><span class="sr">Action</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.projects as project (project.gid)}
						<tr>
							<th scope="row">
								{project.name}
								{#if project.archived}<StatusChip tone="done" label="archived" size="sm" />{/if}
							</th>
							<td class="num">{project.tasks}</td>
							<td class="num">{project.open_tasks}</td>
							<td>{day(project.modified_at)}</td>
							<td>
								<Select
									value={choice[project.gid] ?? ''}
									onchange={(e) => pick(project.gid, e)}
									aria-label={`Client for ${project.name}`}
								>
									<option value="">Choose a client</option>
									{#each data.clients as client (client.id)}
										<option value={client.id}>
											{client.name} ({client.projects} projects, {client.folders} folders)
										</option>
									{/each}
								</Select>
							</td>
							<td>
								<Button
									variant="secondary"
									disabled={busy === project.gid || !choice[project.gid]}
									onclick={() => file('asana_project', project.gid, project.name)}
								>
									{busy === project.gid ? 'Filing' : 'File'}
								</Button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</Card>

<Card>
	<h2>Dropbox folders</h2>
	{#if data.folders.length === 0}
		<p class="empty">Every client folder is filed against a client.</p>
	{:else}
		<div class="scroller">
			<table>
				<thead>
					<tr>
						<th scope="col">Folder</th>
						<th scope="col" class="num">Files</th>
						<th scope="col" class="num">Size</th>
						<th scope="col">Last activity</th>
						<th scope="col">File under</th>
						<th scope="col"><span class="sr">Action</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.folders as folder (folder.path)}
						<tr>
							<th scope="row">{folder.name}</th>
							<td class="num">{folder.file_count}</td>
							<td class="num">{bytes(folder.total_bytes)}</td>
							<td>{day(folder.last_activity)}</td>
							<td>
								<Select
									value={choice[folder.path] ?? ''}
									onchange={(e) => pick(folder.path, e)}
									aria-label={`Client for ${folder.name}`}
								>
									<option value="">Choose a client</option>
									{#each data.clients as client (client.id)}
										<option value={client.id}>
											{client.name} ({client.projects} projects, {client.folders} folders)
										</option>
									{/each}
								</Select>
							</td>
							<td>
								<Button
									variant="secondary"
									disabled={busy === folder.path || !choice[folder.path]}
									onclick={() => file('dropbox_folder', folder.path, folder.name)}
								>
									{busy === folder.path ? 'Filing' : 'File'}
								</Button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</Card>

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: var(--space-5);
	}

	h1 {
		margin: 0 0 var(--space-2);
	}

	.lede {
		margin: 0;
		max-width: 68ch;
		color: var(--muted);
	}

	.tally {
		display: flex;
		gap: var(--space-4);
		color: var(--muted);
		font-size: 0.875rem;
	}

	.tally strong {
		color: var(--ink);
		font-size: 1.25rem;
	}

	h2 {
		margin: 0 0 var(--space-4);
		font-size: 1rem;
	}

	.notice,
	.bad {
		margin: 0 0 var(--space-4);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-2);
	}

	.notice {
		background: var(--green-100);
		color: var(--green-700);
	}

	.bad {
		background: var(--red-100);
		color: var(--red);
	}

	.empty {
		margin: 0;
		color: var(--muted);
	}

	/* Wide content scrolls inside its own box; the page never scrolls sideways. */
	.scroller {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9375rem;
	}

	th,
	td {
		text-align: left;
		padding: var(--space-3);
		border-bottom: 1px solid var(--border-thin);
		vertical-align: middle;
	}

	thead th {
		font-size: 0.8125rem;
		color: var(--muted);
		font-weight: 600;
		white-space: nowrap;
	}

	tbody th {
		font-weight: 600;
		min-width: 16ch;
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	/*
	 * Clipped rather than positioned off-screen. An absolutely positioned
	 * label escapes a scrolling table and pushes the document wider than the
	 * viewport at 412px, which is how a phone ends up scrolling sideways.
	 */
	.sr {
		display: inline-block;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
