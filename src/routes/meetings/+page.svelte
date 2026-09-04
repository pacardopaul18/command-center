<script lang="ts">
	import { label } from '$lib/calendar-label';
	import CalendarGrid from '$lib/components/CalendarGrid.svelte';
	import { apiWrite } from '$lib/http';
	import { goto, invalidateAll } from '$app/navigation';
	import { formatDay } from '$lib/format';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import FormField from '$lib/components/FormField.svelte';
	import Input from '$lib/components/Input.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Pager from '$lib/components/Pager.svelte';
	import Select from '$lib/components/Select.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import type { PageData } from './$types';
	import type { Meeting } from '$lib/types';
	import {
		MEETING_VIEWS,
		MEETING_VIEW_LABELS,
		type MeetingView,
		type UpcomingEvent
	} from '$lib/meetings';

	/**
	 * The meetings log, beside what is coming up.
	 *
	 * Putting the two lists side by side only pays if they can see each other,
	 * which is what `calendar_events.meeting_id` is for: every upcoming call
	 * says whether it already has a record, and one press files a record against
	 * one that does not. Without that the two columns are a coincidence of
	 * layout and the reader matches them by title, badly.
	 *
	 * Nothing here writes to Google. New meeting creates a record in this app,
	 * the prototype's own footnote says so, and the conflict notice offers a
	 * link to the event rather than a button that moves it. D152.
	 */

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');
	let showForm = $state(false);

	function blankDraft() {
		return {
			title: '',
			meeting_date: data.today,
			client_id: '',
			project_id: '',
			attendees: '',
			recording_url: ''
		};
	}

	let draft = $state(blankDraft());

	/** Set when the form was opened from a call, so the record can be filed against it. */
	let draftEventId = $state<string | null>(null);

	async function create(event: SubmitEvent) {
		event.preventDefault();
		if (!draft.title.trim()) {
			errorMessage = 'Give the meeting a title.';
			return;
		}
		busy = true;
		errorMessage = '';
		try {
			const result = await apiWrite<{ meeting?: { id: string } }>('/api/meetings', 'POST', draft);
			if (!result.ok) {
				errorMessage = result.error ?? 'Could not create the meeting.';
				return;
			}
			const created = (result.data ?? {}).meeting;

			/**
			 * The link is made after the record exists, and a failure to link is
			 * reported without losing the record. The alternative is a create
			 * that rolls back because a calendar was unreachable, which would
			 * throw away typing to protect a cross reference.
			 */
			if (created && draftEventId) {
				const linked = await apiWrite(
					`/api/meetings/${created.id}/link?account=${data.account}`,
					'POST',
					{ event_id: draftEventId }
				);
				if (!linked.ok) {
					errorMessage = `The meeting was created but not filed against the call: ${linked.error}`;
				}
			}

			draft = blankDraft();
			draftEventId = null;
			showForm = false;
			notice = 'Meeting created.';
			await invalidateAll();
			// Straight to the detail screen, because the next thing is always the
			// transcript and there is nothing else to do on the list.
			if (created && !errorMessage) goto(`/meetings/${created.id}`);
		} catch {
			errorMessage = 'Could not reach the server.';
		} finally {
			busy = false;
		}
	}

	/** Opens the form already filled in from a call on the calendar. */
	function fileAgainst(event: UpcomingEvent) {
		draft = {
			...blankDraft(),
			// Through the shared label, so a partner's block reads as busy rather
			// than as a call whose name failed to load. D206.
			title: label(event),
			meeting_date: event.starts_at.slice(0, 10),
			attendees: ''
		};
		draftEventId = event.id;
		showForm = true;
	}

	function openBlankForm() {
		draft = blankDraft();
		draftEventId = null;
		showForm = true;
	}

	/* ---------------------------------------------------------------------
	 * Filters
	 * ------------------------------------------------------------------ */

	/** Every filter goes through the URL, so a filtered log is a link. */
	function urlFor(next: { view?: MeetingView; q?: string }) {
		const params = new URLSearchParams();
		const view = next.view ?? data.view;
		const q = next.q ?? data.q;
		if (view !== 'all') params.set('view', view);
		if (q) params.set('q', q);
		const query = params.toString();
		return query ? `/meetings?${query}` : '/meetings';
	}

	let search = $state('');

	/**
	 * The box follows the URL.
	 *
	 * Seeding it once at construction looked right and was not: pressing a tab,
	 * or arriving from a link that carries a search, re-runs the loader without
	 * rebuilding the component, and the box would still show whatever was typed
	 * before. Reading `data.q` in an effect keeps the control and the list
	 * describing the same query.
	 */
	$effect(() => {
		search = data.q;
	});

	function applySearch(event: SubmitEvent) {
		event.preventDefault();
		goto(urlFor({ q: search }), { keepFocus: true });
	}

	/* ---------------------------------------------------------------------
	 * The log
	 * ------------------------------------------------------------------ */

	type LogState = 'needs_transcript' | 'to_review' | 'reviewed';

	/**
	 * The same reading of the same two columns the route makes, restated here
	 * because the row has to draw the chip. Two readings that could disagree
	 * would be worse; they cannot, because there is nothing else to read.
	 */
	function stateOf(meeting: Meeting): LogState {
		if (meeting.summary_reviewed_at) return 'reviewed';
		return meeting.summary ? 'to_review' : 'needs_transcript';
	}

	/**
	 * The third bucket holds everything with nothing to read yet, and its chip
	 * says which kind. "No transcript" on a meeting that has one and was never
	 * summarised would be a straightforwardly false label on a true bucket.
	 */
	function stateLabel(meeting: Meeting & { transcript_chars?: number }): string {
		const state = stateOf(meeting);
		if (state === 'reviewed') return 'Reviewed';
		if (state === 'to_review') return 'To review';
		return meeting.transcript_chars ? 'Not summarised' : 'No transcript';
	}

	/**
	 * Chip tones from the shared set, not new ones.
	 *
	 * A meeting with no transcript is waiting on something; one with a drafted
	 * summary is open work; a reviewed one is done. Reusing the vocabulary means
	 * the same colour means the same thing on this screen as on the tracker,
	 * rather than a second palette that happens to look similar.
	 */
	const STATE_TONE: Record<LogState, 'waiting' | 'open' | 'done'> = {
		needs_transcript: 'waiting',
		to_review: 'open',
		reviewed: 'done'
	};

	/* ---------------------------------------------------------------------
	 * Coming up
	 * ------------------------------------------------------------------ */

	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

	function dayKey(value: string): string {
		if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
		return new Intl.DateTimeFormat('en-CA', {
			timeZone: zone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(new Date(value));
	}

	function timeLabel(event: UpcomingEvent): string {
		if (event.all_day === 1) return 'All day';
		const fmt = (value: string) =>
			new Date(value).toLocaleTimeString('en-US', {
				hour: 'numeric',
				minute: '2-digit',
				timeZone: zone
			});
		return event.ends_at ? `${fmt(event.starts_at)} to ${fmt(event.ends_at)}` : fmt(event.starts_at);
	}

	const today = $derived(dayKey(new Date().toISOString()));

	/** Calls grouped by the day they fall on, in the reader's own zone. */
	const upcomingDays = $derived.by(() => {
		const groups = new Map<string, UpcomingEvent[]>();
		for (const event of data.calendar.events) {
			const key = dayKey(event.starts_at);
			const list = groups.get(key);
			if (list) list.push(event);
			else groups.set(key, [event]);
		}
		return [...groups.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([key, events]) => ({
				key,
				label: new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', {
					weekday: 'long',
					month: 'short',
					day: 'numeric'
				}),
				events
			}));
	});

	/**
	 * Two calls that overlap.
	 *
	 * The prototype puts a scheduling assistant here that offers to move one of
	 * them. Moving an event is a write to Google, which this app cannot do and
	 * will never be able to, so what is left is the useful half: saying that the
	 * clash exists, on the screen where the week is being read, with a link to
	 * the event in Google where it can actually be moved. D152.
	 */
	const clashes = $derived.by(() => {
		const timed = data.calendar.events
			.filter((e) => e.all_day !== 1 && e.ends_at)
			.sort((a, b) => a.starts_at.localeCompare(b.starts_at));

		const out: { a: UpcomingEvent; b: UpcomingEvent }[] = [];
		for (let i = 0; i < timed.length; i++) {
			for (let j = i + 1; j < timed.length; j++) {
				// Sorted by start, so once one starts after this one ends, so does
				// every later one.
				if (timed[j].starts_at >= (timed[i].ends_at as string)) break;
				out.push({ a: timed[i], b: timed[j] });
			}
		}
		return out;
	});

	function clashLabel(pair: { a: UpcomingEvent; b: UpcomingEvent }): string {
		const day = new Date(pair.a.starts_at).toLocaleDateString('en-US', {
			weekday: 'long',
			month: 'short',
			day: 'numeric',
			timeZone: zone
		});
		return `${day}: ${label(pair.a)} overlaps ${label(pair.b)}.`;
	}
</script>

<svelte:head>
	<title>Meetings | Command Center</title>
</svelte:head>

<header class="head">
	<div>
		<h1>Meetings</h1>
		<p class="sub">Every client call, its transcript, and what came out of it.</p>
	</div>
	<Button onclick={openBlankForm}>New meeting</Button>
</header>

<div class="tiles">
	<a class="tile" href={urlFor({ view: 'all' })}>
		<span class="tile-label mono">This week</span>
		<span class="tile-value">{data.counts.this_week}</span>
		<span class="tile-note mono">{data.counts.today} today</span>
	</a>
	<a class="tile warn" href={urlFor({ view: 'needs_transcript' })}>
		<span class="tile-label mono">Needs a transcript</span>
		<span class="tile-value">{data.counts.needs_transcript}</span>
		<span class="tile-note mono">import to extract</span>
	</a>
	<!--
		This said "Awaiting your review" and counted unreviewed AI summaries,
		while the Action items page said 27 were waiting for a decision. Both
		numbers were right and a reader hears one question. The heading now says
		which thing it counts. F15.
	-->
	<a class="tile warn" href={urlFor({ view: 'to_review' })}>
		<span class="tile-label mono">Summaries to check</span>
		<span class="tile-value">{data.counts.to_review}</span>
		<span class="tile-note mono">drafted by AI, unread</span>
	</a>
	<a class="tile good" href="/actions?view=all&source=meeting">
		<span class="tile-label mono">Items from meetings</span>
		<span class="tile-value">{data.counts.items_from_meetings}</span>
		<span class="tile-note mono">this week</span>
	</a>
	<!--
		The queue, from the one expression every page that mentions it reads.
		Absent from this page entirely before, which is how it could disagree
		with Action items without either number being wrong.
	-->
	<a class="tile warn" href="/actions">
		<span class="tile-label mono">Proposals waiting on you</span>
		<span class="tile-value">{data.counts.proposals_pending}</span>
		<span class="tile-note mono">mail and meetings</span>
	</a>
</div>

<p class="status-line" role="status" aria-live="polite">{notice}</p>

{#if errorMessage}
	<p class="error-banner" role="alert">{errorMessage}</p>
{/if}

<div class="board">
	<div class="log">
		<Card title="Meetings log">
			{#snippet actions()}
				<span class="count mono">{data.paging.total} in this view</span>
			{/snippet}

			<nav class="tabs" aria-label="Filter the log">
				{#each MEETING_VIEWS as view (view)}
					<a class="tab" class:on={data.view === view} href={urlFor({ view })}>
						{MEETING_VIEW_LABELS[view]}
						<span class="tab-count mono">{data.counts[view]}</span>
					</a>
				{/each}
			</nav>

			<form class="filters" onsubmit={applySearch}>
				<Input
					bind:value={search}
					name="q"
					type="search"
					placeholder="Search titles, attendees and transcripts"
					aria-label="Search meetings"
				/>
				<Button variant="secondary" type="submit">Search</Button>
			</form>

			{#if data.meetings.length === 0}
				<p class="empty">
					{#if data.q}
						No meetings match that search.
					{:else if data.view !== 'all'}
						Nothing in {MEETING_VIEW_LABELS[data.view].toLowerCase()}.
					{:else}
						No meetings yet. Create one, then import its transcript.
					{/if}
				</p>
			{:else}
				<ul class="rows">
					{#each data.meetings as meeting (meeting.id)}
						{@const state = stateOf(meeting)}
						<li>
							<a class="row" href="/meetings/{meeting.id}">
								<span class="row-main">
									<span class="row-title">{meeting.title}</span>
									<span class="row-meta mono">
										{formatDay(meeting.meeting_date)}
										· {meeting.client_name ?? 'No client'}
										· {meeting.project_name ?? 'No project'}
										{#if meeting.attendees}· {meeting.attendees}{/if}
									</span>
								</span>
								<span class="row-side">
									<!--
										Accepted items and waiting proposals are different
										facts. "0 items" against a transcript that produced
										fourteen proposals is true about action items and
										reads as nothing came out of this meeting. D214.
									-->
									<span class="items mono">
										{#if meeting.pending_proposal_count}
											<!--
												A marker, not a link: the row is already one, and
												an anchor inside an anchor is invalid and gets
												rearranged by the browser. The tile above carries
												the link to the queue.
											-->
											<span class="waiting">
												{meeting.pending_proposal_count} waiting
											</span>
										{/if}
										{meeting.action_item_count}
										{meeting.action_item_count === 1 ? 'item' : 'items'}
									</span>
									<StatusChip label={stateLabel(meeting)} tone={STATE_TONE[state]} />
								</span>
							</a>
						</li>
					{/each}
				</ul>
				<Pager paging={data.paging} label="meetings" />
			{/if}
		</Card>
	</div>

	<div class="upcoming">
		<Card title="Coming up" subtitle="The next two weeks, from the calendars you chose.">
			{#if data.accountEmail}
				<p class="scope mono">Showing {data.accountEmail}</p>
			{/if}

			{#if data.calendarError}
				<p class="error-banner" role="alert">{data.calendarError}</p>
			{:else if !data.calendarConnected}
				<p class="empty">Connect a Google account in Settings to see what is coming up.</p>
			{:else}
				<!--
					The week against the clock, above the list.

					The two answer different questions and both are worth asking. The
					grid answers "where is there an hour on Thursday", which a list
					cannot: five blocks in a list say nothing about the gaps between
					them, and the gaps are the whole question when somebody is placing
					a call. The list below answers "what do I do about this", which the
					grid cannot, because a block that size has no room for an action.
				-->
				<CalendarGrid events={data.calendar.events} />

				{#each clashes as pair (pair.a.id + pair.b.id)}
					<div class="clash">
						<p class="clash-label mono">Two calls overlap</p>
						<p>{clashLabel(pair)}</p>
						<p class="fine">
							Moving a call happens in Google. This app reads calendars and never changes
							them.
						</p>
						{#if pair.b.html_link}
							<a class="ghost" href={pair.b.html_link} target="_blank" rel="noopener noreferrer">
								Open {label(pair.b)} in Google Calendar
							</a>
						{/if}
					</div>
				{/each}

				{#if upcomingDays.length === 0}
					<p class="empty">
						Nothing in the next fortnight. Calendars are read when you refresh them in Settings.
					</p>
				{/if}

				{#each upcomingDays as day (day.key)}
					<section class="day">
						<h3>
							{day.label}
							{#if day.key === today}<span class="today mono">Today</span>{/if}
						</h3>
						<ul class="events">
							{#each day.events as event (event.id)}
								<li>
									<span class="when mono">{timeLabel(event)}</span>
									<span class="what">{label(event)}</span>
									{#if event.meeting_id}
										<a class="ghost" href="/meetings/{event.meeting_id}">Open record</a>
									{:else}
										<button type="button" class="ghost" onclick={() => fileAgainst(event)}>
											File a record
										</button>
									{/if}
								</li>
							{/each}
						</ul>
					</section>
				{/each}

				<p class="fine">
					Meetings created here are records in this app. Nothing is pushed to your calendar.
				</p>
			{/if}
		</Card>
	</div>
</div>

<Modal bind:open={showForm} title="New meeting">
	<form class="new" onsubmit={create}>
		{#if draftEventId}
			<p class="fine">This will be filed against the call you picked.</p>
		{/if}

		<FormField label="Title">
			<Input bind:value={draft.title} placeholder="What the call was" maxlength={300} required />
		</FormField>

		<div class="pair">
			<FormField label="Date">
				<Input type="date" bind:value={draft.meeting_date} mono required />
			</FormField>
			<FormField label="Client">
				<Select bind:value={draft.client_id}>
					<option value="">No client</option>
					{#each data.clients as client (client.id)}
						<option value={client.id}>{client.name}</option>
					{/each}
				</Select>
			</FormField>
		</div>

		<div class="pair">
			<FormField label="Project">
				<Select bind:value={draft.project_id}>
					<option value="">No project</option>
					{#each data.projects as project (project.id)}
						<option value={project.id}>{project.name}</option>
					{/each}
				</Select>
			</FormField>
			<FormField label="Attendees">
				<Input bind:value={draft.attendees} placeholder="Who was on the call" maxlength={1000} />
			</FormField>
		</div>

		<FormField label="Recording link" hint="Optional. The transcript is imported separately.">
			<Input bind:value={draft.recording_url} maxlength={1000} />
		</FormField>

		<div class="form-actions">
			<Button type="submit" disabled={busy}>Create meeting</Button>
			<Button variant="secondary" onclick={() => (showForm = false)}>Cancel</Button>
		</div>
	</form>
</Modal>

<style>
	/* Waiting proposals read as a claim on the reader, so they are marked
	   rather than sitting in the same grey as the accepted count. */
	.waiting {
		color: var(--ink);
		font-weight: 600;
	}

	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
		flex-wrap: wrap;
		margin-bottom: var(--space-4);
	}

	h1 {
		margin: 0;
		font-size: var(--text-2xl);
		color: var(--text-heading);
	}

	.sub {
		margin: var(--space-1) 0 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	/*
	 * Tiles are context, not content.
	 *
	 * Five tiles reading 2, 2, 0, 0 held the full width while the week grid,
	 * which is the only thing on the page carrying real information, was squeezed
	 * into a column narrow enough to truncate every entry to "Call w... 7:00".
	 * The trivial thing was large and the informative thing was cramped. A page
	 * is ordered by what the reader came to do. D233.
	 *
	 * They keep their numbers and lose their bulk: a row of small facts rather
	 * than a wall of large ones.
	 */
	.tiles {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}

	.tiles .tile {
		flex: 1 1 auto;
		min-width: 9rem;
		flex-direction: row;
		align-items: baseline;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
	}

	.tiles .tile :global(.tile-value) {
		font-size: 1.125rem;
	}

	.tiles .tile :global(.tile-note) {
		/* The sub-line is the first thing to go when a tile is a row. */
		display: none;
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

	.tile:hover {
		border-color: var(--navy-600);
	}

	.tile.warn {
		border-left-color: var(--gold-600, #c9a84c);
	}

	.tile.good {
		border-left-color: var(--green-600, #2e7d5b);
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

	.tile-note {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.status-line {
		margin: 0 0 var(--space-2);
		min-height: 1.2em;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	.error-banner {
		margin: 0 0 var(--space-3);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--danger-border, #c05b4d);
		border-radius: var(--radius-sm);
		color: var(--danger-text, #8a2f22);
		font-size: var(--text-sm);
	}

	/*
	 * The log and the calendar, side by side at a desk and stacked on a phone
	 * with the log first: a reader opening this page wants the meeting they are
	 * looking for, and the fortnight ahead is context.
	 */
	.board {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		align-items: start;
	}

	/*
	 * The week grid gets the room. It was at 2fr against the log's 3fr, which
	 * left it too narrow to render a title beside a time, so every entry
	 * truncated and the panel carried no information at all.
	 */
	@media (min-width: 1100px) {
		.board {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
	}

	@media (min-width: 1500px) {
		.board {
			grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
		}
	}

	.log,
	.upcoming {
		min-width: 0;
	}

	.count,
	.scope {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}

	.tab {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 44px;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-thin);
		border-radius: 999px;
		font-size: var(--text-sm);
		color: var(--text-muted);
		text-decoration: none;
	}

	.tab.on {
		background: var(--navy-700);
		border-color: var(--navy-700);
		color: var(--surface-page);
	}

	.tab-count {
		font-size: var(--text-xs);
		opacity: 0.75;
	}

	.filters {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		margin-bottom: var(--space-3);
	}

	.filters :global(input) {
		flex: 1;
	}

	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.rows li + li {
		border-top: 1px solid var(--border-hairline);
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) 0;
		min-height: 44px;
		text-decoration: none;
		flex-wrap: wrap;
	}

	.row:hover .row-title {
		text-decoration: underline;
	}

	.row-main {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		flex: 1;
	}

	.row-title {
		color: var(--text-heading);
		font-size: var(--text-md);
		overflow-wrap: anywhere;
	}

	.row-meta {
		font-size: var(--text-xs);
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}

	.row-side {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex: none;
	}

	.items {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.empty,
	.fine {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.fine {
		font-size: var(--text-xs);
	}

	.clash {
		margin-bottom: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--gold-600, #c9a84c);
		border-radius: var(--radius-sm);
		background: var(--surface-raised, transparent);
	}

	.clash p {
		margin: 0 0 var(--space-1);
		font-size: var(--text-sm);
	}

	.clash-label {
		font-size: var(--text-xs);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.day {
		margin-top: var(--space-3);
	}

	.day h3 {
		margin: 0 0 var(--space-1);
		font-size: var(--text-sm);
		color: var(--text-heading);
	}

	.today {
		margin-left: var(--space-2);
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.events {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.events li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 44px;
		padding: var(--space-1) 0;
		border-top: 1px solid var(--border-hairline);
		flex-wrap: wrap;
	}

	.when {
		font-size: var(--text-xs);
		color: var(--text-muted);
		flex: none;
	}

	.what {
		flex: 1;
		min-width: 0;
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}

	.ghost {
		display: inline-flex;
		align-items: center;
		/* 44px, D22. The row around it being 44 tall does not help a thumb. */
		min-height: 44px;
		padding: 0 var(--space-2);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-muted);
		font: inherit;
		font-size: var(--text-xs);
		text-decoration: none;
		cursor: pointer;
		flex: none;
	}

	.ghost:hover {
		color: var(--text-body);
		border-color: var(--navy-600);
	}

	.new {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: 0 var(--space-4) var(--space-4);
	}

	.pair {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-3);
	}

	@media (min-width: 560px) {
		.pair {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.form-actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
</style>
