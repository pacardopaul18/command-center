<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import FormField from '$lib/components/FormField.svelte';
	import Input from '$lib/components/Input.svelte';
	import Select from '$lib/components/Select.svelte';
	import { apiWrite } from '$lib/http';
	import { formatMoment } from '$lib/format';
	import { scopeLabel } from '$lib/types';
	import IngestProgress from '$lib/components/IngestProgress.svelte';
	import CalendarList from '$lib/components/CalendarList.svelte';
	import type { CalendarRow } from '$lib/components/CalendarList.svelte';
	import type { AsanaRef, AsanaSyncOutcome } from '$lib/types';
	import { page } from '$app/state';
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
	 *
	 * The sync is two-way as of workstream 2, but it is run by hand, not on a
	 * schedule. That is deliberate twice over: a pull changes Paul's own records
	 * from a system he only partly controls, so he asks for it and sees what it
	 * did; and the cron surface does not change without an evidence-window
	 * review, which this has not had.
	 */

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');

	let syncing = $state(false);
	let lastRun = $state<AsanaSyncOutcome | null>(null);

	/**
	 * Runs a sync now and reports what it did.
	 *
	 * `changes` is shown as sentences rather than a count. "3 items updated" is
	 * not something Paul can check; "Draft the scope note: marked done in Asana"
	 * is. Seeing what came back is the entire point of pulling.
	 */
	async function runSync() {
		syncing = true;
		notice = '';
		errorMessage = '';
		lastRun = null;

		const result = await apiWrite<{ outcome: AsanaSyncOutcome }>('/api/asana/sync', 'POST', {});
		if (!result.ok || !result.data) {
			errorMessage = result.error ?? 'The sync did not run.';
		} else {
			lastRun = result.data.outcome;
			notice =
				lastRun.updated === 0 && lastRun.ambiguous === 0
					? 'Sync ran. Nothing had changed in Asana.'
					: `Sync ran. ${lastRun.updated} updated, ${lastRun.ambiguous} needing a look.`;
			await invalidateAll();
		}
		syncing = false;
	}

	/** Clears an ambiguous marker once Paul has looked at it. */
	async function acknowledge(id: string) {
		syncing = true;
		errorMessage = '';
		const result = await apiWrite(`/api/asana/sync/acknowledge/${id}`, 'POST', {});
		if (!result.ok) {
			errorMessage = result.error ?? 'Could not clear that marker.';
		} else {
			notice = 'Marked as reviewed. The Asana link is still recorded.';
			await invalidateAll();
		}
		syncing = false;
	}

	/**
	 * The Google callback comes back as a page navigation carrying its outcome in
	 * the URL, because a redirect cannot return JSON to anybody who will read it.
	 */
	const googleNotice = $derived(page.url.searchParams.get('google'));

	/**
	 * Separate busy flags per panel.
	 *
	 * One shared flag drove Connections, the mail read and the summariser. When
	 * Settings auto-resumed a stalled ingest it set that flag, and the Connections
	 * buttons, which had nothing to do with it, sat on "Working..." indefinitely.
	 * A busy flag has to belong to the thing that is busy.
	 */
	let connecting = $state(false);
	let mailBusy = $state(false);
	let calBusy = $state(false);

	async function findCalendars() {
		calBusy = true;
		errorMessage = '';
		const result = await apiWrite<{ found: number }>(
			'/api/connections/google/calendars/refresh',
			'POST',
			{}
		);
		if (!result.ok) errorMessage = result.error ?? 'Could not read your calendars.';
		else {
			notice = `Found ${result.data?.found ?? 0} calendars.`;
			await invalidateAll();
		}
		calBusy = false;
	}

	/**
	 * Turning one off removes the events it put here, so nothing lingers in the
	 * day view from a calendar Paul stopped watching.
	 */
	async function toggleCalendar(calendar: CalendarRow, on: boolean) {
		calBusy = true;
		errorMessage = '';
		const result = await apiWrite(
			`/api/connections/google/calendars/${calendar.id}/toggle?on=${on}`,
			'POST',
			{}
		);
		if (!result.ok) errorMessage = result.error ?? 'Could not change that calendar.';
		else await invalidateAll();
		calBusy = false;
	}

	/**
	 * Runs batches until the ingest finishes, pauses or fails.
	 *
	 * The loop lives here rather than on the server because each batch is its own
	 * request, and that is the whole point: nothing depends on one long request
	 * surviving. Closing this page stops the loop and loses nothing, because the
	 * cursor is stored after every batch.
	 */
	async function runIngest() {
		mailBusy = true;
		errorMessage = '';
		for (let batch = 0; batch < 500; batch++) {
			const result = await apiWrite<{ status: string; fetched: number }>(
				'/api/email/ingest/step',
				'POST',
				{}
			);
			if (!result.ok || !result.data) {
				errorMessage = result.error ?? 'The mail read stopped.';
				break;
			}
			await invalidateAll();
			if (result.data.status !== 'running') break;
		}
		mailBusy = false;
	}

	/**
	 * Picks a stalled run back up when Settings is opened.
	 *
	 * The run is driven from this page, so navigating away stops it. That is a
	 * real constraint of doing the work client side, and the honest responses are
	 * to say so plainly, which the readout now does, and to resume automatically
	 * when the page comes back, which this does. Guarded so it fires once rather
	 * than on every reactive update: `runIngest` itself calls invalidateAll after
	 * every batch, and without the guard that would start a second loop each time.
	 */
	let resumeAttempted = false;
	$effect(() => {
		const status = data.mail?.state?.status;
		if (status === 'running' && !mailBusy && !resumeAttempted) {
			resumeAttempted = true;
			runIngest();
		}
	});

	async function startIngest(days: number) {
		mailBusy = true;
		errorMessage = '';
		const result = await apiWrite(`/api/email/ingest/start?days=${days}`, 'POST', {});
		mailBusy = false;
		if (!result.ok) {
			errorMessage = result.error ?? 'Could not start reading mail.';
			return;
		}
		notice = `Reading the last ${days} days.`;
		await runIngest();
	}

	/**
	 * Summarises threads in batches until none are left needing one.
	 *
	 * Batched here for the same reason ingestion is: each call is its own
	 * request, and closing the page loses nothing already written.
	 */
	async function summarise() {
		mailBusy = true;
		errorMessage = '';
		for (let batch = 0; batch < 200; batch++) {
			const result = await apiWrite<{ remaining: number; summarised: number }>(
				'/api/email/summarise',
				'POST',
				{}
			);
			if (!result.ok || !result.data) {
				errorMessage = result.error ?? 'Summarising stopped.';
				break;
			}
			await invalidateAll();
			if (result.data.remaining === 0 || result.data.summarised === 0) break;
		}
		mailBusy = false;
	}

	async function pauseIngest() {
		const result = await apiWrite('/api/email/ingest/pause', 'POST', {});
		if (!result.ok) errorMessage = result.error ?? 'Could not pause.';
		else await invalidateAll();
	}

	async function connectGoogle() {
		connecting = true;
		errorMessage = '';
		const result = await apiWrite<{ url: string }>('/api/connections/google/start', 'POST', {});
		if (!result.ok || !result.data) {
			errorMessage = result.error ?? 'Could not start the Google connection.';
			connecting = false;
			return;
		}
		// Leaving the page is the point: consent happens on Google's own screen.
		window.location.href = result.data.url;
	}

	async function disconnectGoogle() {
		if (!confirm('Disconnect this Google account?')) return;
		connecting = true;
		errorMessage = '';
		const result = await apiWrite('/api/connections/google/disconnect', 'POST', {});
		if (!result.ok) errorMessage = result.error ?? 'Could not disconnect.';
		else {
			notice = 'Disconnected. The stored credentials were removed.';
			await invalidateAll();
		}
		connecting = false;
	}

	async function refreshCalendar() {
		connecting = true;
		errorMessage = '';
		const result = await apiWrite<{ fetched: number; window_days: number }>(
			'/api/connections/google/calendar/refresh',
			'POST',
			{}
		);
		if (!result.ok || !result.data) {
			errorMessage = result.error ?? 'Could not read the calendar.';
		} else {
			notice = `Read ${result.data.fetched} event${result.data.fetched === 1 ? '' : 's'} from the next ${result.data.window_days} days.`;
			await invalidateAll();
		}
		connecting = false;
	}

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
			const result = await apiWrite('/api/asana', 'PUT', {
				workspace_gid: workspaceGid,
				workspace_name: workspaces.find((w) => w.gid === workspaceGid)?.name ?? null,
				project_gid: projectGid || null,
				project_name: projects.find((p) => p.gid === projectGid)?.name ?? null,
				assignee: assignee.trim() || null
			});
			if (!result.ok) {
				errorMessage = result.error ?? 'Could not save the Asana settings.';
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

<Card title="Asana" subtitle="Push on demand, and pull changes back by running a sync.">
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
			pick one, and save.
		</p>

		{#if data.asana.ready && !data.asana.settings.project_gid}
			<p class="warn">
				No default project is set. Pushed tasks will be assigned to you and will appear in My
				Tasks, but they will not sit in any project, which makes them harder to find later and
				invisible to anyone looking at a project board. Choosing one is recommended.
			</p>
		{/if}

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
						label="Default assignee"
							hint="An Asana user gid, an email address, or the word me. Left empty it uses me, which is whoever owns the token. Tasks are never created unassigned: Asana's My Tasks only lists what is assigned to you, so an unassigned task is invisible in normal use."
					>
						<Input bind:value={assignee} maxlength={200} placeholder="me" />
					</FormField>
				</div>
			</div>

			<div class="save">
				<Button type="submit" disabled={busy || !workspaceGid}>Save Asana settings</Button>
			</div>
		</form>
	{/if}
</Card>

<Card
	title="Asana sync"
	subtitle="Polling only. Run it when you want it; nothing runs on a schedule."
>
	{#if !data.sync}
		<p class="empty">Could not read the sync state. The rest of this page still works.</p>
	{:else}
		<div class="actions">
			<Button onclick={runSync} disabled={syncing || !data.asana.ready}>
				{syncing ? 'Syncing...' : 'Sync now'}
			</Button>
		</div>

		{#if !data.asana.ready}
			<p class="hint">{data.asana.blocked_because}</p>
		{/if}

		<dl class="facts">
			<div>
				<dt>Linked items</dt>
				<dd class="mono">{data.sync.linked}</dd>
			</div>
			<div>
				<dt>Last sync</dt>
				<dd class="mono">
					{data.sync.last_sync ? formatMoment(data.sync.last_sync) : 'Never'}
				</dd>
			</div>
			<div>
				<dt>Never reconciled</dt>
				<dd class="mono">{data.sync.never_synced}</dd>
			</div>
			<div>
				<dt>Needing a look</dt>
				<dd class="mono">{data.sync.ambiguous_count}</dd>
			</div>
		</dl>

		<p class="hint">
			A poll asks Asana what changed. It cannot report a task that is gone, so links
			Asana has not confirmed in {data.sync.stale_days} days are checked one by one.
		</p>

		{#if lastRun}
			<div class="run">
				<p class="run-head mono">
					{lastRun.polled} changed in Asana, {lastRun.matched} of them linked here,
					{lastRun.swept} re-checked directly.
				</p>
				{#if lastRun.changes.length === 0}
					<p class="hint">Nothing needed changing.</p>
				{:else}
					<ul class="changes">
						{#each lastRun.changes as line (line)}
							<li>{line}</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}

		{#if data.sync.ambiguous.length > 0}
			<h3 class="sub-head">Links needing a look</h3>
			<p class="hint">
				Their status and their Asana link were left exactly as they were. Nothing here
				has been changed for you.
			</p>
			<ul class="ambiguous">
				{#each data.sync.ambiguous as link (link.id)}
					<li>
						<div class="amb-main">
							<a href="/actions?view=all&q={encodeURIComponent(link.title)}">{link.title}</a>
							<p class="amb-note">{link.asana_sync_note}</p>
							<p class="amb-meta mono">
								gid {link.asana_task_gid}
								{#if link.asana_synced_at} &middot; found {formatMoment(link.asana_synced_at)}{/if}
							</p>
						</div>
						<Button variant="ghost" size="sm" disabled={syncing} onclick={() => acknowledge(link.id)}>
							Reviewed
						</Button>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</Card>

<Card title="Connections" subtitle="Google, read only. Paul's own account only.">
	{#if googleNotice}
		<p class="notice" role="status">{googleNotice}</p>
	{/if}

	{#if !data.connections}
		<p class="empty">Could not read the connection state.</p>
	{:else}
		{@const c = data.connections}

		<p class="hint">
			This reads a calendar and reads mail. It never writes anything: no sending, no
			replying, no drafts, no labels, no calendar changes. That is not a promise about
			how the code behaves, it is a consequence of which permissions were requested.
			The permission to send was never asked for, so it cannot be used by mistake.
		</p>

		<p class="hint">
			<strong>Your own account only.</strong> Connecting a partner or firm account is a
			conversation that has not happened yet, and this app is not the place to shortcut
			it. Do not sign in here with an account that is not yours.
		</p>

		{#if !c.client_id_present || !c.client_secret_present}
			<p class="hint">
				Not configured yet.
				{#if !c.client_id_present}<code>GOOGLE_CLIENT_ID</code> is missing from wrangler.toml.{/if}
				{#if !c.client_secret_present}<code>GOOGLE_CLIENT_SECRET</code> is not set on the Worker.{/if}
			</p>
		{/if}

		<div class="actions">
			{#if c.connection?.status === 'connected'}
				<Button variant="secondary" onclick={refreshCalendar} disabled={connecting}>
					{connecting ? 'Working...' : 'Read the calendar'}
				</Button>
				<Button variant="ghost" onclick={disconnectGoogle} disabled={connecting}>Disconnect</Button>
			{:else}
				<Button
					onclick={connectGoogle}
					disabled={connecting || !c.client_id_present || !c.client_secret_present}
				>
					{connecting ? 'Working...' : 'Connect Google'}
				</Button>
			{/if}
		</div>

		<dl class="facts">
			<div>
				<dt>Account</dt>
				<dd>{c.connection?.account_email ?? 'Not connected'}</dd>
			</div>
			<div>
				<dt>State</dt>
				<dd>
					{c.connection?.status === 'connected'
						? 'Connected'
						: c.connection?.status === 'needs_reauth'
							? 'Needs reconnecting'
							: 'Not connected'}
				</dd>
			</div>
			<div>
				<dt>Calendar last read</dt>
				<dd class="mono">
					{c.connection?.last_read_at ? formatMoment(c.connection.last_read_at) : 'Never'}
				</dd>
			</div>
			<div>
				<dt>Writes anything</dt>
				<dd>No</dd>
			</div>
		</dl>

		{#if c.connection?.status_note}
			<p class="hint">{c.connection.status_note}</p>
		{/if}

		<h3 class="sub-head">What it asks for</h3>
		<ul class="scopes">
			{#each c.scopes as scope (scope)}
				<li class="mono">{scopeLabel(scope)}</li>
			{/each}
		</ul>
		{#if c.granted_scopes}
			<p class="hint">
				Granted by Google: <span class="mono">{c.granted_scopes.split(' ').map(scopeLabel).join(', ')}</span>.
				What was granted can be narrower than what was asked for, so this is what
				actually applies.
			</p>
		{/if}

		<p class="hint">{c.testing_mode_note}</p>
	{/if}
</Card>

<Card title="Mail" subtitle="Reading only. Nothing is ever sent, drafted or labelled.">
	{#if !data.mail}
		<p class="empty">Connect a Google account to read mail.</p>
	{:else}
		<IngestProgress
			ingest={data.mail.state}
			stored={data.mail.stored}
			account={data.mail.account}
			busy={mailBusy}
			onStart={startIngest}
			onRun={runIngest}
			onPause={pauseIngest}
		/>
		<p class="hint">
			Bodies are stored in R2 and referenced, never in the database. The nightly backup
			copies every database table off-site, and a mailbox does not need copying every
			night to be recoverable.
		</p>
		<div class="actions">
			<Button variant="secondary" onclick={summarise} disabled={mailBusy}>
				{mailBusy ? 'Working...' : 'Summarise threads'}
			</Button>
			<a class="browse" href="/mail">Browse what has been read</a>
		</div>
		<p class="hint">
			These also run on their own, on the scheduled firings, so a read or a triage
			finishes whether or not this page is open. The buttons are for when you want it
			now rather than at the next firing.
		</p>
		<p class="hint">
			A summary says what a thread is about, what was decided and what is outstanding.
			It reports only what the messages say: a thread where nothing was decided is
			summarised as one where nothing was decided.
		</p>
	{/if}
</Card>


<Card title="Calendars" subtitle="Nothing syncs until you choose it.">
	<CalendarList
		calendars={data.calendars}
		busy={calBusy}
		onRefresh={findCalendars}
		onToggle={toggleCalendar}
	/>
	{#if data.connections?.connection?.status === 'connected'}
		<Button variant="secondary" onclick={refreshCalendar} disabled={connecting}>
			{connecting ? 'Working...' : 'Read events now'}
		</Button>
	{/if}
</Card>

<Card title="What the AI has spent" subtitle="Measured, not estimated.">
	{#if !data.spend}
		<p class="hint">Could not read usage.</p>
	{:else}
		<dl class="facts">
			<div>
				<dt>Calls, last 24h</dt>
				<dd class="mono">{data.spend.last_24h.calls}</dd>
			</div>
			<div>
				<dt>Input tokens, 24h</dt>
				<dd class="mono">{data.spend.last_24h.input_tokens.toLocaleString()}</dd>
			</div>
			<div>
				<dt>Output tokens, 24h</dt>
				<dd class="mono">{data.spend.last_24h.output_tokens.toLocaleString()}</dd>
			</div>
			<div>
				<dt>Threads triaged</dt>
				<dd class="mono">{data.spend.triaged} of {data.spend.threads}</dd>
			</div>
		</dl>

		{#if data.spend.usage.length > 0}
			<div class="table-scroll">
				<table>
					<thead>
						<tr>
							<th scope="col">Job</th>
							<th scope="col">Model</th>
							<th scope="col" class="right">Calls</th>
							<th scope="col" class="right">In</th>
							<th scope="col" class="right">Out</th>
						</tr>
					</thead>
					<tbody>
						{#each data.spend.usage as row (row.kind + row.model)}
							<tr>
								<td>{row.kind}</td>
								<td class="mono">{row.model}</td>
								<td class="right mono">{row.calls}</td>
								<td class="right mono">{row.input_tokens.toLocaleString()}</td>
								<td class="right mono">{row.output_tokens.toLocaleString()}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="hint">No calls recorded yet.</p>
		{/if}

		<p class="hint">
			Triage runs on the small fast model and reads only the subject and the opening.
			Summaries run on the larger one, and only for threads triage called urgent or
			important. Nothing is re-read for a thread whose newest message has not changed.
		</p>
		<p class="hint">
			Token counts come from what the API reported. No price is stored here, because a
			hardcoded rate goes stale quietly and then the meter is confidently wrong about
			money.
		</p>
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

	.warn {
		margin: 0 0 var(--space-4);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--gold-100);
		border-radius: var(--radius-sm);
		background: var(--gold-50);
		color: var(--text-body);
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

	.facts {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
		margin: 0 0 var(--space-4);
	}

	@media (min-width: 720px) {
		.facts {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.facts dt {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
		margin-bottom: 2px;
	}

	.facts dd {
		margin: 0;
		font-size: var(--text-lg);
		color: var(--text-primary);
	}

	.hint {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		margin: 0 0 var(--space-3);
	}

	.empty {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		margin: 0;
	}

	.run {
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		margin-bottom: var(--space-4);
	}

	.run-head {
		margin: 0 0 var(--space-2);
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.changes {
		margin: 0;
		padding-left: var(--space-4);
		font-size: var(--text-sm);
	}

	.changes li {
		margin-bottom: var(--space-1);
	}

	.sub-head {
		font-size: var(--text-sm);
		margin: var(--space-4) 0 var(--space-2);
	}

	.ambiguous {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.ambiguous li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: flex-start;
		justify-content: space-between;
		padding: var(--space-3) 0;
		border-top: 1px solid var(--border);
	}

	.amb-main {
		flex: 1 1 240px;
		min-width: 0;
	}

	.amb-note {
		margin: var(--space-1) 0 0;
		font-size: var(--text-sm);
		color: var(--text-primary);
	}

	.amb-meta {
		margin: 2px 0 0;
		font-size: var(--text-xs);
		color: var(--text-secondary);
		word-break: break-word;
	}

	.table-scroll {
		overflow-x: auto;
		margin-bottom: var(--space-3);
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
		padding: var(--space-2);
		white-space: nowrap;
	}

	td {
		padding: var(--space-2);
		border-bottom: 1px solid var(--border);
	}

	.right {
		text-align: right;
	}

	.browse {
		align-self: center;
		font-size: var(--text-sm);
	}

	.scopes {
		list-style: none;
		margin: 0 0 var(--space-3);
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.scopes li {
		font-size: var(--text-xs);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 2px 8px;
	}

	.save {
		margin-top: var(--space-4);
	}
</style>
