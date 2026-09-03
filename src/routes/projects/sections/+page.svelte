<script lang="ts">
	import { apiWrite } from '$lib/http';
	import { invalidateAll } from '$app/navigation';
	import { formatDay } from '$lib/format';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import Input from '$lib/components/Input.svelte';
	import Select from '$lib/components/Select.svelte';
	import { SECTION_MAPPINGS } from '$lib/section-status';
	import { TICKET_STATUS_LABELS } from '$lib/types';
	import type { PageData } from './$types';

	/**
	 * The section reconciliation.
	 *
	 * Asana's real vocabulary for where a task is, and the app's six statuses,
	 * with a person in between. Nothing on this page infers anything: every row
	 * is undecided until somebody rules on it, and the ruling is recorded with
	 * their name against it.
	 *
	 * MOST OF THESE ARE NOT STATUSES, and the page is built for that. Sales,
	 * Finance, Operations and Marketing hold 1,362 tasks between them and are
	 * business functions. "Carries no status" is therefore the most common right
	 * answer, and it is a decision the page records rather than a blank it
	 * leaves. A screen offering only the six would have no way to say it, and the
	 * reconciliation could never be finished.
	 */

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');

	/** Who is ruling. Typed once, kept for the session, never defaulted. */
	let decidedBy = $state('');
	let draft = $state<Record<string, string>>({});
	let notes = $state<Record<string, string>>({});
	let showDecided = $state(false);
	/**
	 * Which portfolio-wide rulings have been acknowledged.
	 *
	 * A name keyed by itself applies everywhere it appears. "Untitled section"
	 * appears in 60 projects and means nothing in any of them; "Finance" appears
	 * in 26 and is one firm-wide function. Those are different situations and
	 * only a person can tell them apart, so a ruling that reaches more than one
	 * project has to be acknowledged as reaching them before it is recorded.
	 * The per-section key already exists for the other case; nothing on the
	 * screen said when to reach for it.
	 */
	let acknowledged = $state<Record<string, boolean>>({});

	const undecided = $derived(data.sections.filter((s) => s.via === 'unmapped'));
	const decided = $derived(data.sections.filter((s) => s.via !== 'unmapped'));

	const label = (mapping: string) =>
		mapping === 'not_a_status'
			? 'Carries no status'
			: (TICKET_STATUS_LABELS[mapping as keyof typeof TICKET_STATUS_LABELS] ?? mapping);

	async function decide(name: string) {
		const status = draft[name];
		if (!status) {
			errorMessage = 'Choose what this section means before saving it.';
			return;
		}
		if (!decidedBy.trim()) {
			errorMessage = 'Put your name in first. A ruling with nobody against it is an inference.';
			return;
		}
		const row = data.sections.find((s) => s.section_name === name);
		if (row && row.projects > 1 && !acknowledged[name]) {
			errorMessage =
				`"${name}" appears in ${row.projects} projects, and this ruling applies to all of them. ` +
				'Tick the box to confirm that, or rule on one section at a time instead.';
			return;
		}
		busy = true;
		errorMessage = '';
		const res = await apiWrite('/api/sections', 'POST', {
			section_name: name,
			status,
			mapped_by: decidedBy.trim(),
			note: notes[name]?.trim() || null
		});
		busy = false;
		if (res.ok) {
			notice = `${name} recorded as ${label(status)}.`;
			delete draft[name];
			delete notes[name];
			await invalidateAll();
		} else {
			errorMessage = res.error ?? 'Could not record that.';
		}
	}

	async function unmap(name: string) {
		busy = true;
		errorMessage = '';
		const res = await apiWrite(
			`/api/sections?section_name=${encodeURIComponent(name)}`,
			'DELETE',
			undefined
		);
		busy = false;
		if (res.ok) {
			notice = `${name} is unmapped again.`;
			await invalidateAll();
		} else {
			errorMessage = res.error ?? 'Could not remove that mapping.';
		}
	}
</script>

<svelte:head><title>Section reconciliation</title></svelte:head>

<header class="head">
	<div>
		<h1>Sections</h1>
		<p class="lede">
			Asana's own words for where a task sits, and what each one means here. Nothing is
			guessed: a section means what somebody says it means, and until then it means nothing at
			all. Most of these turn out not to be statuses.
		</p>
		<p class="lede">
			A name is the firm's word, so ruling on it rules on every project that uses it. Twenty-two
			of these names appear in more than one project and "Untitled section" appears in sixty,
			where it is Asana's default and means nothing at all. Those need confirming before they
			are recorded.
		</p>
	</div>
</header>

{#if notice}<p class="notice" role="status">{notice}</p>{/if}
{#if errorMessage}<p class="error-banner" role="alert">{errorMessage}</p>{/if}

<!--
	Progress, stated as decided rather than as mapped.

	A section ruled "carries no status" is finished, not skipped. Counting only
	the ones that became a status would make the work look permanently unfinished
	when it is nearly all done. D214.
-->
<Card title="Where the reconciliation stands">
	<div class="tiles">
		<div class="tile">
			<span class="tile-label mono">Section names</span>
			<span class="tile-value">{data.progress.sections}</span>
		</div>
		<div class="tile">
			<span class="tile-label mono">Mapped to a status</span>
			<span class="tile-value">{data.progress.mapped_to_status}</span>
		</div>
		<div class="tile">
			<span class="tile-label mono">Carry no status</span>
			<span class="tile-value">{data.progress.marked_no_status}</span>
			<span class="tile-note">Decided, not skipped</span>
		</div>
		<div class="tile">
			<span class="tile-label mono">Still undecided</span>
			<span class="tile-value">{data.progress.unmapped}</span>
			<span class="tile-note">{data.tasks_under_unmapped.toLocaleString()} tasks under them</span>
		</div>
	</div>

	<p class="note">
		{#if data.progress.decided_share === null}
			No sections have been mirrored yet, so there is nothing to reconcile. That is not the same
			as nothing being decided.
		{:else}
			{Math.round(data.progress.decided_share * 100)}% of section names have been ruled on. A
			section that has not been is not a status of any kind: its tasks carry no section status at
			all, and the ticket's own status still means only what Asana reports, completed or not.
		{/if}
	</p>

	<div class="who">
		<label for="decided-by">Your name, recorded against every ruling you make</label>
		<Input id="decided-by" bind:value={decidedBy} maxlength={120} placeholder="Paul Pacardo" />
	</div>
</Card>

<Card
	title="Undecided"
	subtitle="{undecided.length} names, biggest first. The section with the most tasks is the one worth ruling on first."
>
	{#if undecided.length === 0}
		<p class="empty">Every section name has been ruled on.</p>
	{:else}
		<div class="scroller">
			<table>
				<thead>
					<tr>
						<th scope="col">Section, as Asana has it</th>
						<th scope="col" class="num">Tasks</th>
						<th scope="col" class="num">Open</th>
						<th scope="col" class="num">Projects</th>
						<th scope="col">What it means here</th>
						<th scope="col">Why, optional</th>
						<th scope="col"></th>
					</tr>
				</thead>
				<tbody>
					{#each undecided as row (row.section_name)}
						<tr>
							<th scope="row">{row.section_name}</th>
							<td class="num">{row.tasks.toLocaleString()}</td>
							<td class="num">{row.open_tasks.toLocaleString()}</td>
							<!--
								How far a name-keyed ruling reaches.

								One project is a local word and safe to rule on. More than
								one is a portfolio-wide decision, and the box below is what
								makes that visible before it is taken rather than after.
							-->
							<td class="num">
								{row.projects}
								{#if row.projects > 1}
									<label class="ack">
										<input type="checkbox" bind:checked={acknowledged[row.section_name]} />
										<span>all {row.projects}</span>
									</label>
								{/if}
							</td>
							<td>
								<Select bind:value={draft[row.section_name]} aria-label="Meaning of {row.section_name}">
									<option value="">Not decided</option>
									{#each SECTION_MAPPINGS as mapping (mapping)}
										<option value={mapping}>{label(mapping)}</option>
									{/each}
								</Select>
							</td>
							<td>
								<Input
									bind:value={notes[row.section_name]}
									maxlength={1000}
									placeholder="Business function, not a stage"
									aria-label="Note for {row.section_name}"
								/>
							</td>
							<td>
								<Button
									size="sm"
									disabled={busy}
									onclick={() => decide(row.section_name)}
								>
									Record
								</Button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</Card>

{#if decided.length > 0}
	<Card title="Decided" subtitle="{decided.length} names, with who ruled and when">
		{#snippet actions()}
			<Button variant="ghost" size="sm" onclick={() => (showDecided = !showDecided)}>
				{showDecided ? 'Hide' : 'Show'}
			</Button>
		{/snippet}

		{#if showDecided}
			<div class="scroller">
				<table>
					<thead>
						<tr>
							<th scope="col">Section</th>
							<th scope="col" class="num">Tasks</th>
							<th scope="col">Means</th>
							<th scope="col">Decided by</th>
							<th scope="col">When</th>
							<th scope="col">Why</th>
							<th scope="col"></th>
						</tr>
					</thead>
					<tbody>
						{#each decided as row (row.section_name)}
							<tr>
								<th scope="row">{row.section_name}</th>
								<td class="num">{row.tasks.toLocaleString()}</td>
								<td>{row.via === 'not_a_status' ? 'Carries no status' : label(row.status ?? '')}</td>
								<td>{row.mapped_by}</td>
								<td class="mono">{row.mapped_at ? formatDay(row.mapped_at) : ''}</td>
								<td class="why">{row.note ?? ''}</td>
								<td>
									<Button
										variant="ghost"
										size="sm"
										disabled={busy}
										onclick={() => unmap(row.section_name)}
									>
										Undo
									</Button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Card>
{/if}

{#if data.overrides.length > 0}
	<!--
		Per-section rulings, listed apart because they are the exception and they
		win. Burying them in the list above would hide the thing that overrides it.
	-->
	<Card
		title="Rulings on one section only"
		subtitle="These beat the name they carry, for that section alone"
	>
		<div class="scroller">
			<table>
				<thead>
					<tr>
						<th scope="col">Section</th>
						<th scope="col">In project</th>
						<th scope="col">Means</th>
						<th scope="col">Decided by</th>
					</tr>
				</thead>
				<tbody>
					{#each data.overrides as row (row.section_gid)}
						<tr>
							<th scope="row">{row.section_name ?? row.section_gid}</th>
							<td>{row.project_name ?? 'Unknown project'}</td>
							<td>{row.status === 'not_a_status' ? 'Carries no status' : label(row.status)}</td>
							<td>{row.mapped_by}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</Card>
{/if}

<style>
	.head {
		margin-bottom: var(--space-5);
	}

	h1 {
		margin: 0 0 var(--space-2);
	}

	.lede {
		margin: 0;
		max-width: 72ch;
		color: var(--text-secondary);
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}

	.tile {
		display: grid;
		gap: 2px;
		padding: var(--space-3);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-2);
		background: var(--surface-card);
	}

	.tile-label {
		font-size: 0.6875rem;
		color: var(--text-secondary);
	}

	.tile-value {
		font-size: 1.5rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.tile-note {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.note {
		margin: 0 0 var(--space-4);
		max-width: 74ch;
		color: var(--text-secondary);
		font-size: 0.9375rem;
	}

	.who {
		max-width: 26rem;
	}

	.who label {
		display: block;
		margin-bottom: var(--space-2);
		font-size: 0.875rem;
	}

	.notice {
		margin: 0 0 var(--space-4);
		padding: var(--space-3);
		border-radius: var(--radius-2);
		background: var(--surface-hover);
	}

	.error-banner {
		margin: 0 0 var(--space-4);
		padding: var(--space-3);
		border-radius: var(--radius-2);
		border: 1px solid var(--red);
		color: var(--red);
	}

	.empty {
		margin: 0;
		color: var(--text-secondary);
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
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--border-thin);
		vertical-align: middle;
	}

	thead th {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		font-weight: 600;
		white-space: nowrap;
		border-bottom-width: 2px;
	}

	tbody th {
		font-weight: 600;
		min-width: 18ch;
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.why {
		color: var(--text-secondary);
		max-width: 34ch;
	}

	/* The acknowledgement sits with the count it is about, not in a dialog: the
	   number is the reason for the question. D22: 44px tap floor. */
	.ack {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-1);
		min-height: var(--tap);
		font-size: 0.6875rem;
		font-weight: 400;
		color: var(--text-secondary);
		white-space: nowrap;
		cursor: pointer;
	}

	.ack input {
		width: 1rem;
		height: 1rem;
	}
</style>
