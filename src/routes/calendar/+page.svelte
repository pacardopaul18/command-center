<script lang="ts">
	import { label } from '$lib/calendar-label';
	import { goto, invalidateAll } from '$app/navigation';
	import { apiWrite } from '$lib/http';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import Input from '$lib/components/Input.svelte';
	import MailboxPicker from '$lib/components/MailboxPicker.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Select from '$lib/components/Select.svelte';
	import Textarea from '$lib/components/Textarea.svelte';
	import { buildDraftInviteUrl, draftFits } from '$lib/calendar-draft';
	import { findSlots, type Interval, type Slot } from '$lib/free-slots';
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
	 * can write to Google, which is the same boundary Mail keeps. The redesign
	 * draws a New invite button whose own footnote said writes go through the
	 * Google Calendar API; it is Draft invite here, and it opens Google's event
	 * form with everything filled in. D148.
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

	/** A step is whatever the view shows, so Later means the next one of those. */
	const step = $derived(
		data.view === 'day' ? 1 : data.view === 'week' ? 7 : data.view === 'month' ? 30 : 21
	);

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
		/**
		 * The number of days is the window the loader asked for, not a constant
		 * per view. Hardcoding it meant the month grid drew 21 cells: a ragged
		 * three weeks that dropped most of the month and every event in it.
		 */
		const span = new Date(data.to).getTime() - start.getTime();
		const count = Math.max(1, Math.round(span / 86_400_000));
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

	/** The month the grid is about, so neighbouring days can be dimmed. */
	const anchorMonth = $derived(data.day.slice(0, 7));
	const inMonth = (key: string) => key.slice(0, 7) === anchorMonth;

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

	/* ---------------------------------------------------------------------
	 * The rail: calendars, and the people this app follows
	 * ------------------------------------------------------------------ */

	/** The address the rail belongs to, which every scoped call needs. */
	const accountEmail = $derived(
		data.roster.find((a) => a.id === data.railAccount)?.account_email ?? null
	);

	/**
	 * Turning a calendar off deletes the events it put here, which the route
	 * does deliberately. Reloading is therefore not a nicety: without it the
	 * grid keeps drawing rows the database no longer has.
	 */
	async function toggleCalendar(id: string, on: boolean) {
		busy = true;
		errorMessage = '';
		const res = await apiWrite(
			`/api/connections/google/calendars/${id}/toggle?on=${on}&account=${data.railAccount}`,
			'POST',
			{}
		);
		busy = false;
		if (res.ok) await invalidateAll();
		else errorMessage = res.error ?? 'Could not change that calendar.';
	}

	let followEmail = $state('');
	let followName = $state('');

	async function follow(event: SubmitEvent) {
		event.preventDefault();
		if (!followEmail.trim()) return;
		busy = true;
		errorMessage = '';
		const res = await apiWrite(
			`/api/connections/google/calendar/follows?account=${data.railAccount}`,
			'POST',
			{ email: followEmail, display_name: followName }
		);
		busy = false;
		if (res.ok) {
			followEmail = '';
			followName = '';
			await invalidateAll();
		} else {
			errorMessage = res.error ?? 'Could not follow that calendar.';
		}
	}

	async function unfollow(id: string) {
		busy = true;
		const res = await apiWrite(
			`/api/connections/google/calendar/follows/${id}?account=${data.railAccount}`,
			'DELETE',
			null
		);
		busy = false;
		if (res.ok) {
			picked.delete(id);
			picked = new Set(picked);
			await invalidateAll();
		} else {
			errorMessage = res.error ?? 'Could not unfollow that calendar.';
		}
	}

	/* ---------------------------------------------------------------------
	 * Find a time
	 * ------------------------------------------------------------------ */

	/**
	 * Who to match against. Keyed by follow id, with the account itself always
	 * included, because a slot that is free for everyone else and not for Paul
	 * is not a slot.
	 */
	let picked = $state(new Set<string>());

	function togglePicked(id: string) {
		if (picked.has(id)) picked.delete(id);
		else picked.add(id);
		picked = new Set(picked);
	}

	let slotMinutes = $state('30');
	let matching = $state(false);
	let slots = $state<Slot[]>([]);
	let matched = $state(false);
	let unreadable = $state<{ id: string; error: string | null }[]>([]);

	/**
	 * The working window a suggestion must fall inside, on the reader's clock.
	 *
	 * Nine to five, not configurable yet, and named here rather than buried in
	 * the call so the number a reader disagrees with is findable.
	 */
	const DAY_START_HOUR = 9;
	const DAY_END_HOUR = 17;

	/**
	 * Minutes to add to UTC to reach the zone the page is drawing in.
	 *
	 * Read in the browser, from the zone the page is on, because the toggle
	 * above can put it on firm time and nine to five then means nine to five in
	 * Denver. The server has no business guessing which clock a reader is on.
	 */
	function zoneOffsetMinutes(): number {
		const probe = new Date();
		const asUtc = new Date(probe.toLocaleString('en-US', { timeZone: 'UTC' }));
		const asZone = new Date(probe.toLocaleString('en-US', { timeZone: zone }));
		return Math.round((asZone.getTime() - asUtc.getTime()) / 60_000);
	}

	async function findTime() {
		matching = true;
		matched = false;
		errorMessage = '';
		slots = [];
		unreadable = [];

		const from = new Date();
		const to = new Date(from.getTime() + 14 * 86_400_000);

		const emails = [
			...(accountEmail ? [accountEmail] : []),
			...data.follows.filter((f) => picked.has(f.id)).map((f) => f.email)
		];

		if (emails.length === 0) {
			matching = false;
			errorMessage = 'This account has no email address on it to match against.';
			return;
		}

		const res = await apiWrite(
			`/api/connections/google/calendar/free-busy?account=${data.railAccount}`,
			'POST',
			{ emails, from: from.toISOString(), to: to.toISOString() }
		);
		matching = false;

		if (!res.ok) {
			errorMessage = res.error ?? 'Could not read free and busy from Google.';
			return;
		}

		const answer = res.data as unknown as {
			calendars: { id: string; busy: Interval[]; error: string | null }[];
			unreadable: { id: string; error: string | null }[];
		};

		unreadable = answer.unreadable ?? [];

		slots = findSlots(
			answer.calendars.flatMap((cal) => cal.busy),
			{
				minutes: Number(slotMinutes),
				from: from.toISOString(),
				to: to.toISOString(),
				dayStartHour: DAY_START_HOUR,
				dayEndHour: DAY_END_HOUR,
				zoneOffsetMinutes: zoneOffsetMinutes(),
				limit: 12,
				granularity: 15
			}
		);
		matched = true;
	}

	function slotLabel(slot: Slot): string {
		const start = new Date(slot.start);
		const end = new Date(slot.end);
		const day = start.toLocaleDateString('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			timeZone: zone
		});
		const fmt = (d: Date) =>
			d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone });
		return `${day}, ${fmt(start)} to ${fmt(end)}`;
	}

	/* ---------------------------------------------------------------------
	 * Draft invite
	 * ------------------------------------------------------------------ */

	let draftOpen = $state(false);
	let draft = $state({
		title: '',
		day: '',
		time: '10:00',
		minutes: '30',
		guests: '',
		location: '',
		description: ''
	});

	const DURATIONS = ['15', '30', '45', '60', '90', '120'];

	/**
	 * The next hour a person would actually put a meeting in.
	 *
	 * Opened with no slot, the dialog used the current hour, which at two in the
	 * morning offered two in the morning. That is precisely the suggestion
	 * `findSlots` refuses to make, and a default is a suggestion: the reader who
	 * does not change it has been given a bad time by the app rather than by
	 * themselves. Before the day starts it is nine today, after it ends it is
	 * nine tomorrow, and inside it it is the top of the next hour.
	 */
	function nextSensibleStart(): Date {
		const now = new Date();
		const start = new Date(now);
		start.setMinutes(0, 0, 0);
		start.setHours(start.getHours() + 1);

		if (start.getHours() < DAY_START_HOUR) start.setHours(DAY_START_HOUR);
		else if (start.getHours() >= DAY_END_HOUR) {
			start.setDate(start.getDate() + 1);
			start.setHours(DAY_START_HOUR);
		}
		return start;
	}

	function openDraft(slot?: Slot) {
		const start = slot ? new Date(slot.start) : nextSensibleStart();
		draft = {
			title: '',
			// A date and time input read the browser's local clock, which is the
			// one the reader picked the slot off the screen with.
			day: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
			time: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
			minutes: String(
				slot ? Math.round((new Date(slot.end).getTime() - start.getTime()) / 60_000) : 30
			),
			guests: data.follows
				.filter((f) => picked.has(f.id))
				.map((f) => f.email)
				.join(', '),
			location: '',
			description: ''
		};
		draftOpen = true;
	}

	/**
	 * The invite, as a link into Google's own form.
	 *
	 * Derived rather than built on submit, so the control is a plain anchor and
	 * the reader can see where it goes before pressing it. Nothing is created
	 * here and nothing is sent: Google's form opens with the fields filled and
	 * the person presses Save there. D148.
	 */
	const draftStart = $derived(new Date(`${draft.day}T${draft.time}`));

	const draftFields = $derived({
		authuser: accountEmail,
		title: draft.title.trim(),
		startsAt: draftStart,
		endsAt: new Date(draftStart.getTime() + Number(draft.minutes) * 60_000),
		guests: draft.guests
			.split(/[,;\s]+/)
			.map((g) => g.trim())
			.filter(Boolean),
		location: draft.location.trim(),
		description: draft.description.trim()
	});

	const draftReady = $derived(
		draft.title.trim().length > 0 && Number.isFinite(draftStart.getTime())
	);

	const draftUrl = $derived(draftReady ? buildDraftInviteUrl(draftFields) : '');
	const draftTooLong = $derived(draftReady && !draftFits(draftFields));

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
				Every calendar you own or follow, in one place. Read only: nothing here changes
				anything in Google Calendar, because this app has no permission to. Times shown in
				<strong>{zoneLabel}</strong>.
			</p>
			<label class="switch">
				<input type="checkbox" role="switch" checked={firmTime} onchange={toggleZone} />
				<span class="track" aria-hidden="true"><span class="knob"></span></span>
				<span>Show in firm time (Mountain)</span>
			</label>
		</div>
		<div class="head-actions">
			<MailboxPicker
				accounts={data.roster}
				active={data.account}
				busy={busy}
				onChange={switchAccount}
			/>
			<Button onclick={() => openDraft()}>Draft invite</Button>
		</div>
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
			<a href={urlFor({ view: 'day' })} class="tab" class:on={data.view === 'day'}>Day</a>
			<a href={urlFor({ view: 'week' })} class="tab" class:on={data.view === 'week'}>Week</a>
			<a href={urlFor({ view: 'month' })} class="tab" class:on={data.view === 'month'}>Month</a>
		</nav>

		<div class="nav">
			<button type="button" class="ghost" onclick={() => shift(-step)} aria-label="Earlier">
				Earlier
			</button>
			<a class="ghost" href={urlFor({ day: today })}>Today</a>
			<button type="button" class="ghost" onclick={() => shift(step)} aria-label="Later">
				Later
			</button>
			<span class="range mono">
				{new Date(data.from).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: zone })}
				to
				{new Date(data.to).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: zone })}
			</span>
		</div>
	</div>

	<div class="board">
		<aside class="rail">
			<!--
				The rail is about one account even when the grid is not. A list of
				calendars and followed people is an address book, and the union of
				two address books is two clients' contacts in one list with nothing
				able to label them apart.
			-->
			<Card title="Calendars">
				{#snippet actions()}
					<span class="count mono">{data.calendars.filter((c) => c.sync_enabled).length} shown</span>
				{/snippet}

				{#if data.scope === 'all'}
					<p class="fine">
						The grid is showing every account. This list belongs to
						<strong>{accountEmail ?? data.railAccount}</strong>.
					</p>
				{/if}

				{#if data.calendars.length === 0}
					<p class="fine">
						No calendars have been read yet. Refresh the calendar list in Settings.
					</p>
				{/if}

				<ul class="cals">
					{#each data.calendars as cal (cal.id)}
						<li>
							<label class="cal">
								<input
									type="checkbox"
									checked={cal.sync_enabled === 1}
									disabled={busy}
									onchange={(e) =>
										toggleCalendar(cal.id, (e.currentTarget as HTMLInputElement).checked)}
								/>
								<span
									class="swatch"
									style="background: {cal.background_color ?? 'var(--navy-500)'}"
									aria-hidden="true"
								></span>
								<span class="cal-text">
									<span class="cal-name">{cal.summary ?? cal.provider_calendar_id}</span>
									<span class="cal-note mono">
										{cal.is_primary ? 'yours, primary' : 'yours'}
										{#if cal.sync_enabled}, {cal.event_count} read{/if}
									</span>
								</span>
							</label>
						</li>
					{/each}

					{#each data.follows as person (person.id)}
						<li>
							<div class="cal follow">
								<input
									type="checkbox"
									checked={picked.has(person.id)}
									onchange={() => togglePicked(person.id)}
									aria-label="Match against {person.display_name ?? person.email}"
								/>
								<span
									class="swatch"
									style="background: {person.color ?? 'var(--navy-500)'}"
									aria-hidden="true"
								></span>
								<span class="cal-text">
									<span class="cal-name">{person.display_name ?? person.email}</span>
									<span class="cal-note mono">followed, busy only</span>
								</span>
								<button
									type="button"
									class="leave"
									disabled={busy}
									onclick={() => unfollow(person.id)}
									aria-label="Stop following {person.display_name ?? person.email}"
								>
									Leave
								</button>
							</div>
						</li>
					{/each}
				</ul>

				<form class="follow-form" onsubmit={follow}>
					<Input
						bind:value={followEmail}
						type="email"
						placeholder="name@company.com"
						aria-label="Calendar address to follow"
					/>
					<Input bind:value={followName} placeholder="Name, optional" aria-label="Their name" />
					<Button type="submit" variant="secondary" disabled={busy}>Follow</Button>
				</form>

				<p class="fine">
					Following is this app's own list. It shows their busy blocks when they have shared
					their free and busy, never their event details, and it changes nothing in anyone's
					Google account.
				</p>
			</Card>

			<Card title="Find a time">
				<p class="fine">
					Matches free space over the next fortnight, {DAY_START_HOUR}:00 to {DAY_END_HOUR}:00,
					against this account and everyone ticked above.
				</p>

				<div class="match">
					<Select bind:value={slotMinutes} aria-label="How long">
						{#each DURATIONS as minutes (minutes)}
							<option value={minutes}>{minutes} minutes</option>
						{/each}
					</Select>
					<Button disabled={matching} onclick={findTime}>
						{matching ? 'Matching' : 'Match'}
					</Button>
				</div>

				{#each unreadable as miss (miss.id)}
					<p class="fine warn">{miss.id}: {miss.error}</p>
				{/each}

				{#if matched && slots.length === 0}
					<p class="fine">
						Nothing free in the next fortnight at that length. Try a shorter meeting or fewer
						calendars.
					</p>
				{/if}

				<ul class="slots">
					{#each slots as slot (slot.start)}
						<li>
							<span class="slot-when">{slotLabel(slot)}</span>
							<button type="button" class="leave" onclick={() => openDraft(slot)}>
								Draft invite
							</button>
						</li>
					{/each}
				</ul>
			</Card>
		</aside>

		<div class="main">

{#snippet eventRow(event: CalendarEventRow)}
		<div class="row-wrap">
			<button
				type="button"
				class="row"
				aria-expanded={openEventId === event.id}
				style="border-left-color: {event.calendar_color ?? 'var(--navy-500)'}"
				onclick={() => openEvent(event)}
			>
				<span class="when mono">{timeLabel(event)}</span>
				<span class="what">{label(event)}</span>
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
						{#if event.location}
							<div><dt>Where</dt><dd>{event.location}</dd></div>
						{/if}
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
						{#if event.meeting_title && event.meeting_id}
							<div>
								<dt>Meeting record</dt>
								<dd><a href="/meetings/{event.meeting_id}">{event.meeting_title}</a></dd>
							</div>
						{:else if event.meeting_title}
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

					<!--
						The join link, first among the actions because it is the one
						thing anybody clicks on a calendar entry with two minutes to go.
						Owned events only: a partner's link is never stored, so there is
						never one here to show.
					-->
					{#if event.conference_url}
						<a
							class="join"
							href={event.conference_url}
							target="_blank"
							rel="noopener noreferrer"
						>
							Join the call
						</a>
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
{/snippet}

	{#if data.view === 'day'}
		<!--
			One day, in full. The same rows as the agenda, without the day
			headings, because a heading above a single day repeats the control
			that chose it.
		-->
		<div class="agenda">
			{#each days as day (day.key)}
				<section class="day today">
					<h2>{day.label}</h2>
					{#if day.events.length === 0}
						<p class="none">Nothing on this day.</p>
					{/if}
					{#each day.events as event (event.id)}
						{@render eventRow(event)}
					{/each}
				</section>
			{/each}
		</div>
	{:else if data.view === 'month'}
		<div class="month-wrap">
		<div class="month" role="grid" aria-label="Month">
			{#each ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as name (name)}
				<div class="month-head">{name}</div>
			{/each}
			{#each days as day (day.key)}
				<!--
					A month cell shows what fits and says how many more there are.
					Truncating silently would make a busy day look like a quiet one.
				-->
				<div class="cell" class:today={day.key === today} class:outside={!inMonth(day.key)}>
					<a class="cell-day" href={urlFor({ view: 'day', day: day.key })}>
						{Number(day.key.slice(8, 10))}
					</a>
					{#each day.events.slice(0, 3) as event (event.id)}
						<button
							type="button"
							class="pip"
							style="border-left-color: {event.calendar_color ?? 'var(--navy-500)'}"
							onclick={() => openEvent(event)}
							title={label(event)}
						>
							{label(event)}
						</button>
					{/each}
					{#if day.events.length > 3}
						<a class="more" href={urlFor({ view: 'day', day: day.key })}>
							{day.events.length - 3} more
						</a>
					{/if}
				</div>
			{/each}
		</div>
		</div>
	{:else if data.view === 'week'}
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
							<span class="what">{label(event)}</span>
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
						{@render eventRow(event)}
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
		</div>
	</div>

	<!--
		Draft invite, which is the redesign's New invite after the D148
		translation. Everything below builds a link into Google's own event form.
		No route here creates an event, and none ever can: the token holds
		calendar.readonly.
	-->
	<Modal bind:open={draftOpen} title="Draft invite">
		<div class="draft">
			<p class="fine">
				This fills in Google's own event form and opens it. Nothing is created or sent from
				here, and you press Save in Google.
			</p>

			<label class="field">
				<span>Title</span>
				<Input bind:value={draft.title} placeholder="What the meeting is for" />
			</label>

			<div class="three">
				<label class="field">
					<span>Day</span>
					<Input bind:value={draft.day} type="date" />
				</label>
				<label class="field">
					<span>Start</span>
					<Input bind:value={draft.time} type="time" />
				</label>
				<label class="field">
					<span>Duration</span>
					<Select bind:value={draft.minutes}>
						{#each DURATIONS as minutes (minutes)}
							<option value={minutes}>{minutes} minutes</option>
						{/each}
					</Select>
				</label>
			</div>

			<label class="field">
				<span>Guests</span>
				<Input bind:value={draft.guests} placeholder="Emails, comma separated" />
			</label>

			<label class="field">
				<span>Location</span>
				<Input bind:value={draft.location} placeholder="Optional, for in person" />
			</label>

			<label class="field">
				<span>Description</span>
				<Textarea bind:value={draft.description} rows={3} placeholder="Agenda and context." />
			</label>

			<!--
				Reminders, recurrence and a Meet link are drawn in the prototype and
				are not here. Google's event form takes none of them through a URL,
				and a control the reader fills that Google then ignores is worse
				than one that is absent. D27.
			-->
			<p class="fine">
				Set a reminder, a repeat or a Meet link in Google once the form opens. They cannot be
				filled in from here.
			</p>

			{#if draftTooLong}
				<p class="error" role="alert">
					That description is too long to hand to Google in a link and would arrive cut off.
					Shorten it, or paste it into the form yourself.
				</p>
			{/if}

			<div class="draft-actions">
				<Button
					href={draftReady && !draftTooLong ? draftUrl : undefined}
					target="_blank"
					rel="noopener noreferrer"
					disabled={!draftReady || draftTooLong}
					onclick={() => (draftOpen = false)}
				>
					Open in Google Calendar
				</Button>
				<Button variant="secondary" onclick={() => (draftOpen = false)}>Cancel</Button>
			</div>
		</div>
	</Modal>
{/if}

<style>
	/*
	 * The rail beside the grid, and gone below it on a phone.
	 *
	 * Two columns at a desk, one column stacked on a phone with the rail after
	 * the grid rather than before it: on 412px a reader opening the calendar
	 * wants today, not a list of which calendars are switched on. Source order
	 * puts the rail first because that is where it belongs in the reading order
	 * on a wide screen, and `order` moves it below on a narrow one.
	 */
	.board {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		align-items: start;
	}

	@media (min-width: 1100px) {
		.board {
			grid-template-columns: 300px minmax(0, 1fr);
		}
	}

	.rail {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		order: 2;
		min-width: 0;
	}

	.main {
		order: 1;
		min-width: 0;
	}

	@media (min-width: 1100px) {
		.rail {
			order: 0;
			position: sticky;
			top: var(--space-4);
		}
		.main {
			order: 0;
		}
	}

	.head-actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.count {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.cals {
		list-style: none;
		margin: 0 0 var(--space-3);
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.cals li + li {
		border-top: 1px solid var(--border-hairline);
	}

	.cal {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		/* 44px tap floor, D22, and the row is the target rather than the box. */
		min-height: 44px;
		padding: var(--space-2) 0;
		cursor: pointer;
	}

	.cal input[type='checkbox'] {
		width: 18px;
		height: 18px;
		accent-color: var(--navy-600);
		flex: none;
	}

	.swatch {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex: none;
	}

	.cal-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}

	.cal-name {
		font-size: var(--text-sm);
		color: var(--text-body);
		overflow-wrap: anywhere;
	}

	.cal-note {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.leave {
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-muted);
		font: inherit;
		font-size: var(--text-xs);
		/* 44px, D22. The row around it being 44 tall does not help a thumb. */
		min-height: 44px;
		padding: 0 var(--space-2);
		cursor: pointer;
		flex: none;
	}

	.leave:hover:not(:disabled) {
		color: var(--text-body);
		border-color: var(--navy-600);
	}

	.follow-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	.match {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		margin: var(--space-3) 0;
	}

	.match :global(select) {
		flex: 1;
	}

	.slots {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
	}

	.slots li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		min-height: 44px;
		padding: var(--space-2) 0;
		border-top: 1px solid var(--border-hairline);
	}

	.slot-when {
		font-size: var(--text-sm);
		color: var(--text-body);
	}

	.warn {
		color: var(--gold-700, var(--text-muted));
	}

	.draft {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: 0 var(--space-4) var(--space-4);
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

	.three {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-3);
	}

	@media (min-width: 560px) {
		.three {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	.draft-actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin-top: var(--space-2);
	}

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

	.month {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 2px;
		background: var(--border-thin);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.month-head {
		padding: 6px 8px;
		background: var(--surface-card);
		font-size: var(--text-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--text-secondary);
	}

	.cell {
		min-height: 5.5rem;
		padding: 4px;
		background: var(--surface-card);
	}

	/* Neighbouring months are present so the grid is a grid, and dimmed so they
	   do not read as part of this month. */
	.cell.outside {
		background: var(--surface-page);
	}

	.cell.outside .cell-day {
		opacity: 0.45;
	}

	.cell.today {
		box-shadow: inset 0 0 0 2px var(--navy);
	}

	.cell-day {
		display: inline-block;
		margin-bottom: 2px;
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
		text-decoration: none;
	}

	.pip {
		display: block;
		width: 100%;
		text-align: left;
		margin-bottom: 2px;
		padding: 2px 5px;
		background: var(--surface-page);
		border: 0;
		border-left: 3px solid var(--navy-500);
		border-radius: 3px;
		font: inherit;
		font-size: var(--text-xs);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: pointer;
	}

	.pip:hover {
		background: var(--surface-hover);
	}

	.more {
		display: block;
		padding: 0 5px;
		font-size: var(--text-xs);
		color: var(--text-secondary);
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

	.join {
		display: inline-flex;
		align-items: center;
		/* D22: 44px tap floor. */
		min-height: 44px;
		padding: 0 var(--space-4);
		margin-right: var(--space-2);
		border-radius: var(--radius-2);
		background: var(--navy);
		color: var(--text-inverse);
		font-weight: 600;
		font-size: 0.875rem;
		text-decoration: none;
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

		/* A month grid squeezed to 412px is unreadable rather than compact, so
		   it scrolls in its own box and keeps its shape. */
		.month {
			min-width: 46rem;
		}
	}

	.month-wrap {
		overflow-x: auto;
	}
</style>
