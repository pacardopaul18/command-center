<script lang="ts">
	import { formatMoment } from '$lib/format';

	/**
	 * The next two weeks, as days rather than as a grid.
	 *
	 * A month grid is the wrong shape for what Paul actually asks a calendar:
	 * what is happening next, and is anything about to collide with the work he
	 * has planned. A list of days answers that at a glance and survives a phone,
	 * which a seven column grid does not.
	 *
	 * Times render in Mountain Time per D73: a calendar event is a real instant,
	 * unlike a deadline, which is a bare date and formats in UTC so the browser
	 * cannot shift it a day.
	 */

	export interface EventRow {
		id: string;
		summary: string | null;
		location: string | null;
		starts_at: string;
		ends_at: string | null;
		all_day: number;
		organizer: string | null;
		attendee_count: number | null;
		html_link: string | null;
		meeting_id: string | null;
		meeting_title: string | null;
	}

	let { events, lastReadAt = null }: { events: EventRow[]; lastReadAt?: string | null } = $props();

	const dayFormatter = new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/Denver',
		weekday: 'long',
		month: 'short',
		day: 'numeric'
	});

	const timeFormatter = new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/Denver',
		hour: 'numeric',
		minute: '2-digit'
	});

	/** The Mountain calendar day an instant falls on, as a sortable key. */
	function dayKey(iso: string): string {
		const at = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
		return new Intl.DateTimeFormat('en-CA', {
			timeZone: 'America/Denver',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(at);
	}

	function dayLabel(iso: string): string {
		return dayFormatter.format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));
	}

	function timeLabel(event: EventRow): string {
		if (event.all_day === 1) return 'All day';
		const start = timeFormatter.format(new Date(event.starts_at));
		if (!event.ends_at) return start;
		return `${start} to ${timeFormatter.format(new Date(event.ends_at))}`;
	}

	const days = $derived.by(() => {
		const grouped = new Map<string, EventRow[]>();
		for (const event of events) {
			const key = dayKey(event.starts_at);
			const list = grouped.get(key) ?? [];
			list.push(event);
			grouped.set(key, list);
		}
		return [...grouped.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([key, rows]) => ({
				key,
				label: dayLabel(rows[0].starts_at),
				// All-day items first, then by start, which is how a day reads.
				rows: rows.sort((a, b) =>
					a.all_day !== b.all_day
						? b.all_day - a.all_day
						: a.starts_at.localeCompare(b.starts_at)
				)
			}));
	});

	const todayKey = $derived(dayKey(new Date().toISOString()));
</script>

{#if events.length === 0}
	<p class="empty">
		No events held.
		{#if !lastReadAt}
			Choose which calendars to watch in Settings, then read them.
		{:else}
			Nothing scheduled in the window that was read.
		{/if}
	</p>
{:else}
	<ol class="days">
		{#each days as day (day.key)}
			<li>
				<h3 class:today={day.key === todayKey}>
					{day.label}
					{#if day.key === todayKey}<span class="tag">today</span>{/if}
				</h3>
				<ul class="events">
					{#each day.rows as event (event.id)}
						<li>
							<span class="when mono">{timeLabel(event)}</span>
							<span class="what">
								{event.summary ?? '(no title)'}
								{#if event.location}<span class="where">{event.location}</span>{/if}
								{#if event.meeting_id}
									<a class="linked" href="/meetings/{event.meeting_id}">
										{event.meeting_title ?? 'Linked meeting'}
									</a>
								{/if}
							</span>
						</li>
					{/each}
				</ul>
			</li>
		{/each}
	</ol>

	{#if lastReadAt}
		<p class="empty">Read from Google {formatMoment(lastReadAt)}. Nothing here is written back.</p>
	{/if}
{/if}

<style>
	.days {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.days > li {
		padding: var(--space-3) 0;
		border-top: 1px solid var(--border);
	}

	h3 {
		margin: 0 0 var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	h3.today {
		color: var(--text-primary);
		font-weight: 700;
	}

	.tag {
		margin-left: var(--space-2);
		font-size: var(--text-xs);
		border: 1px solid var(--gold);
		border-radius: 999px;
		padding: 0 6px;
	}

	.events {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.events li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-3);
		align-items: baseline;
		padding: 2px 0;
	}

	.when {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		white-space: nowrap;
		flex: 0 0 auto;
		/* Wide enough that titles line up, narrow enough to survive 412px. */
		min-width: 8.5rem;
	}

	.what {
		flex: 1 1 12rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.where,
	.linked {
		display: block;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.empty {
		margin: var(--space-3) 0 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
</style>
