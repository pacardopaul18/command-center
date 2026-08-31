<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { apiWrite } from '$lib/http';
	import Card from '$lib/components/Card.svelte';
	import MailboxPicker from '$lib/components/MailboxPicker.svelte';
	import { reauthNotice } from '$lib/mailbox-warning';
	import type { PageData } from './$types';
	import type { CalendarEventRow } from './+page';

	/**
	 * Calendar, built to convention rather than to a design.
	 *
	 * A calendar is the most settled screen in software: agenda and week views
	 * have conventions people already know, and inventing here would buy
	 * nothing. It uses Mail's tokens, cards, account picker and sticky header,
	 * so it belongs to the same app without needing its own prototype.
	 *
	 * Read only, and it says so. The app holds calendar.readonly and no route
	 * can write to Google, which is the same boundary Mail keeps.
	 */

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let errorMessage = $state('');
	let openEventId = $state<string | null>(null);

	/**
	 * Which clock the times are drawn on.
	 *
	 * Local by default, because that is what the person looking at the screen
	 * experiences and what Google Calendar shows them. The firm runs on Mountain
	 * time and the digests and cron are anchored there, so a toggle offers it,
	 * remembered per browser.
	 *
	 * Never UTC. It was UTC before this, which is a clock nobody in this firm
	 * lives on: a 9am meeting rendered as 9am to no one, and looked right.
	 */
	const FIRM_ZONE = 'America/Denver';
	let firmTime = $state(false);

	$effect(() => {
		try {
			firmTime = localStorage.getItem('calendar:firm-time') === 'true';
		} catch {
			// A browser refusing storage still renders, just without the memory.
		}
	});

	function toggleZone() {
		firmTime = !firmTime;
		try {
			localStorage.setItem('calendar:firm-time', String(firmTime));
		} catch {
			// Same.
		}
	}

	const zone = $derived(
		firmTime ? FIRM_ZONE : Intl.DateTimeFormat().resolvedOptions().timeZone
	);

	/** Said once in the header, so no time on the page is ambiguous. */
	const zoneLabel = $derived.by(() => {
		const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
			.formatToParts(new Date())
			.find((part) => part.type === 'timeZoneName')?.value;
		return `${zone.replace(/_/g, ' ')}${name ? ` (${name})` : ''}`;
	});
	let attendees = $state<
		{ email: string | null; display_name: string | null; response_status: string | null; is_organizer: number }[]
	>([]);

	function urlFor(next: Record<string, string | null>) {
		const params = new URLSearchParams();
		const merged: Record<string, string | null> = {
			account: data.account,
			view: data.view,
			day: data.day,
			...next
		};
		for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
		return `/calendar?${params}`;
	}

	function shift(days: number) {
		const d = new Date(`${data.day}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() + days);
		goto(urlFor({ day: d.toISOString().slice(0, 10) }), { keepFocus: true });
	}

	async function switchAccount(account: string) {
		busy = true;
		await apiWrite('/api/connections/active-account', 'PUT', { account });
		busy = false;
		goto(urlFor({ account }), { keepFocus: true });
	}

	async function openEvent(event: CalendarEventRow) {
		if (openEventId === event.id) {
			openEventId = null;
			return;
		}
		openEventId = event.id;
		attendees = [];
		const res = await fetch(
			`/api/connections/google/calendar/events/${event.id}?account=${event.account_id}`
		);
		if (res.ok) {
			attendees = ((await res.json()) as { attendees: typeof attendees }).attendees;
		} else {
			errorMessage = 'Could not read that event.';
		}
	}

	/**
	 * Which calendar day an instant falls on, in the zone being displayed.
	 *
	 * Not a substring of the ISO string. That is the UTC day, and once times are
	 * drawn locally an 11pm meeting in one zone is the next morning in another,
	 * so slicing the timestamp files events under a day they are not on. The
	 * event would still be listed, under the wrong heading, which is the kind of
	 * wrong that looks fine.
	 */
	function dayKeyIn(value: string, tz: string): string {
		// An all-day event arrives as a plain date and has no instant to convert.
		if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
		const parts = new Intl.DateTimeFormat('en-CA', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(new Date(value));
		return parts;
	}

	/** Days in the drawn window, so an empty day still appears as a day. */
	const days = $derived.by(() => {
		const out: { key: string; label: string; events: CalendarEventRow[] }[] = [];
		const start = new Date(data.from);
		const count = data.view === 'week' ? 7 : 21;
		for (let i = 0; i < count; i++) {
			const d = new Date(start);
			d.setUTCDate(d.getUTCDate() + i);
			const key = dayKeyIn(d.toISOString(), zone);
			out.push({
				key,
				label: d.toLocaleDateString('en-US', {
					weekday: 'short',
					month: 'short',
					day: 'numeric',
					timeZone: zone
				}),
				events: data.events.filter((e) => dayKeyIn(e.starts_at ?? '', zone) === key)
			});
		}
		return out;
	});

	/** Agenda hides empty days; a week view must keep them or it is not a week. */
	const agendaDays = $derived(days.filter((d) => d.events.length > 0));

	const today = $derived(dayKeyIn(new Date().toISOString(), zone));

	function timeLabel(event: CalendarEventRow): string {
		if (event.all_day === 1) return 'All day';
		const start = new Date(event.starts_at);
		const end = event.ends_at ? new Date(event.ends_at) : null;
		const fmt = (d: Date) =>
			d.toLocaleTimeString('en-US', {
				hour: 'numeric',
				minute: '2-digit',
				timeZone: zone
			});
		return end ? `${fmt(start)} to ${fmt(end)}` : fmt(start);
	}

	const RESPONSE_LABEL: Record<string, string> = {
		accepted: 'Going',
		declined: 'Not going',
		tentative: 'Maybe',
		needsAction: 'No answer yet'
	};
</script>

<svelte:head><title>Calendar</title></svelte:head>

{#if data.noAccount}
	<Card title="No account connected">
		<p class="empty">Connect a Google account in Settings to see your calendar here.</p>
	</Card>
{:else}
	<header class="head">
		<div>
			<h1>Calendar</h1>
			<p class="sub">
				Read only. Nothing here changes anything in Google Calendar, because this app has no
				permission to. Times shown in <strong>{zoneLabel}</strong>.
			</p>
			<label class="switch">
				<input type="checkbox" role="switch" checked={firmTime} onchange={toggleZone} />
				<span class="track" aria-hidden="true"><span class="knob"></span></span>
				<span>Show in firm time (Mountain)</span>
			</label>
		</div>
		<MailboxPicker
			accounts={data.roster}
			active={data.account}
			busy={busy}
			onChange={switchAccount}
		/>
	</header>

	{#each data.roster as account (account.id)}
		{@const notice = reauthNotice(account)}
		{#if notice}<p class="reauth" role="status">{notice}</p>{/if}
	{/each}

	{#if data.error}<p class="error" role="alert">{data.error}</p>{/if}
	{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}

	<div class="sticky">
		<nav class="views" aria-label="Calendar view">
			<a href={urlFor({ view: 'agenda' })} class="tab" class:on={data.view === 'agenda'}>Agenda</a>
			<a href={urlFor({ view: 'week' })} class="tab" class:on={data.view === 'week'}>Week</a>
		</nav>

		<div class="nav">
			<button type="button" class="ghost" onclick={() => shift(data.view === 'week' ? -7 : -21)}>
				Earlier
			</button>
			<a class="ghost" href={urlFor({ day: today })}>Today</a>
			<button type="button" class="ghost" onclick={() => shift(data.view === 'week' ? 7 : 21)}>
				Later
			</button>
			<span class="range mono">
				{new Date(data.from).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: zone })}
				to
				{new Date(data.to).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: zone })}
			</span>
		</div>
	</div>

	{#if data.view === 'week'}
		<div class="week">
			{#each days as day (day.key)}
				<section class="col" class:today={day.key === today}>
					<h2>{day.label}</h2>
					{#if day.events.length === 0}
						<p class="none">Nothing</p>
					{/if}
					{#each day.events as event (event.id)}
						<button
							type="button"
							class="chip-event"
							style="border-left-color: {event.calendar_color ?? 'var(--navy-500)'}"
							onclick={() => openEvent(event)}
						>
							<span class="when mono">{timeLabel(event)}</span>
							<span class="what">{event.summary ?? '(no title)'}</span>
							{#if data.scope === 'all'}
								<span class="acct mono">{event.account_email}</span>
							{/if}
						</button>
					{/each}
				</section>
			{/each}
		</div>
	{:else}
		<div class="agenda">
			{#each agendaDays as day (day.key)}
				<section class="day" class:today={day.key === today}>
					<h2>{day.label}</h2>
					{#each day.events as event (event.id)}
						<div class="row-wrap">
							<button
								type="button"
								class="row"
								aria-expanded={openEventId === event.id}
								style="border-left-color: {event.calendar_color ?? 'var(--navy-500)'}"
								onclick={() => openEvent(event)}
							>
								<span class="when mono">{timeLabel(event)}</span>
								<span class="what">{event.summary ?? '(no title)'}</span>
								{#if event.location}<span class="where">{event.location}</span>{/if}
								{#if event.own_response && event.own_response !== 'accepted'}
									<span class="resp">{RESPONSE_LABEL[event.own_response] ?? event.own_response}</span>
								{/if}
								{#if (event.attendee_count ?? 0) > 0}
									<span class="n mono">{event.attendee_count}</span>
								{/if}
								{#if data.scope === 'all'}
									<span class="acct mono">{event.account_email}</span>
								{/if}
							</button>

							{#if openEventId === event.id}
								<div class="detail">
									{#if event.description}<p class="prose">{event.description}</p>{/if}
									<dl class="facts">
										{#if event.calendar_name}
											<div><dt>Calendar</dt><dd>{event.calendar_name}</dd></div>
										{/if}
										{#if event.organizer}
											<div><dt>Organiser</dt><dd>{event.organizer}</dd></div>
										{/if}
										{#if event.own_response}
											<div>
												<dt>You</dt>
												<dd>{RESPONSE_LABEL[event.own_response] ?? event.own_response}</dd>
											</div>
										{/if}
										{#if event.meeting_title}
											<div><dt>Meeting record</dt><dd>{event.meeting_title}</dd></div>
										{/if}
									</dl>

									{#if attendees.length > 0}
										<h3>Who is coming</h3>
										<ul class="people">
											{#each attendees as person (person.email ?? person.display_name)}
												<li>
													{person.display_name ?? person.email}
													{#if person.is_organizer}<span class="tag">Organiser</span>{/if}
													{#if person.response_status}
														<span class="tag">
															{RESPONSE_LABEL[person.response_status] ?? person.response_status}
														</span>
													{/if}
												</li>
											{/each}
										</ul>
									{:else if (event.attendee_count ?? 0) > 0}
										<p class="fine">
											{event.attendee_count} people are on this, and their names have not been
											read yet. Refresh the calendar in Settings to fetch them.
										</p>
									{/if}

									{#if event.html_link}
										<a
											class="ghost"
											href={event.html_link}
											target="_blank"
											rel="noopener noreferrer"
										>
											Open in Google Calendar
										</a>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</section>
			{/each}

			{#if agendaDays.length === 0}
				<p class="none">
					Nothing in this window. Calendars are read when you refresh them in Settings.
				</p>
			{/if}
		</div>
	{/if}
{/if}

<style>
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-4);
		flex-wrap: wrap;
	}

	h1 {
		font-size: var(--text-2xl);
		font-weight: 700;
		margin: 0 0 6px;
	}

	.sub {
		margin: 0;
		max-width: 60ch;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.switch {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-2);
		font-size: var(--text-sm);
		cursor: pointer;
	}

	.switch input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		opacity: 0;
		cursor: pointer;
		z-index: 1;
	}

	.track {
		position: relative;
		display: inline-block;
		width: 34px;
		height: 20px;
		border-radius: var(--radius-pill);
		background: var(--border-strong);
		transition: background-color var(--transition-fast);
	}

	.knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: #fff;
		transition: transform var(--transition-fast);
	}

	.switch input:checked + .track {
		background: var(--navy);
	}

	.switch input:checked + .track .knob {
		transform: translateX(14px);
	}

	.switch input:focus-visible + .track {
		outline: 2px solid var(--navy);
		outline-offset: 2px;
	}

	.reauth,
	.error {
		margin: var(--space-3) 0 0;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--gold);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
	}

	/* Same behaviour as Mail: the controls stay while the days move under them. */
	.sticky {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) 0;
		margin: var(--space-3) 0;
		background: var(--surface-page);
		border-bottom: 1px solid var(--border-thin);
	}

	.views {
		display: inline-flex;
		gap: 4px;
		padding: 4px;
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-pill);
	}

	.tab {
		padding: 6px 14px;
		border-radius: var(--radius-pill);
		text-decoration: none;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.tab.on {
		background: var(--navy);
		color: #fff;
		font-weight: 600;
	}

	.nav {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.ghost {
		display: inline-flex;
		align-items: center;
		padding: 6px 12px;
		background: var(--surface-card);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		font: inherit;
		font-size: var(--text-sm);
		color: var(--ink);
		text-decoration: none;
		cursor: pointer;
	}

	.ghost:hover {
		background: var(--surface-hover);
	}

	.range {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.week {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: var(--space-2);
	}

	.col {
		min-width: 0;
		padding: var(--space-2);
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
	}

	.col.today,
	.day.today {
		border-color: var(--navy);
	}

	h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--text-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--text-secondary);
	}

	h3 {
		margin: var(--space-3) 0 var(--space-2);
		font-size: var(--text-sm);
	}

	.chip-event {
		display: block;
		width: 100%;
		text-align: left;
		margin-bottom: 4px;
		padding: 6px 8px;
		background: var(--surface-page);
		border: 1px solid var(--border-thin);
		border-left: 3px solid var(--navy-500);
		border-radius: var(--radius-sm);
		font: inherit;
		font-size: var(--text-xs);
		cursor: pointer;
	}

	.chip-event:hover,
	.row:hover {
		background: var(--surface-hover);
	}

	.chip-event .what {
		display: block;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.agenda {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.day {
		padding: var(--space-3);
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-lg);
	}

	.row {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		width: 100%;
		text-align: left;
		padding: 8px 10px;
		background: none;
		border: 0;
		border-left: 3px solid var(--navy-500);
		border-radius: var(--radius-sm);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}

	.when {
		flex: none;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.what {
		font-weight: 600;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.where,
	.acct,
	.resp,
	.n {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.resp {
		padding: 1px 8px;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
	}

	.detail {
		padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
		border-left: 3px solid var(--border-thin);
	}

	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: var(--space-2);
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
	}

	dt {
		font-size: var(--text-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--text-secondary);
	}

	dd {
		margin: 2px 0 0;
	}

	.people {
		margin: 0 0 var(--space-3);
		padding-left: var(--space-4);
		font-size: var(--text-sm);
	}

	.tag {
		margin-left: 6px;
		padding: 1px 6px;
		font-size: var(--text-xs);
		background: var(--navy-50);
		color: var(--navy-500);
		border-radius: var(--radius-pill);
	}

	.prose {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		max-width: 68ch;
	}

	.none,
	.empty,
	.fine {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	/* Seven columns do not fit a phone. The week becomes a list of days, which
	   is what a week is anyway once it cannot be a grid. */
	@media (max-width: 900px) {
		.week {
			grid-template-columns: 1fr;
		}
	}
</style>
