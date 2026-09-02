<script lang="ts">
	import { label } from '$lib/calendar-label';
	import { packLanes } from '$lib/calendar-layout';

	/**
	 * A week, laid out against the clock.
	 *
	 * The day-list this sits beside answers "what is coming up". It cannot answer
	 * "where is there an hour on Thursday", because a list of five blocks tells
	 * you nothing about the gaps between them, and the gaps are the whole
	 * question when somebody is trying to place a call.
	 *
	 * So: seven columns, hours down the side, blocks positioned and sized by
	 * their real times, concurrent blocks side by side. A meeting that overlaps
	 * two others has to look like it overlaps two others.
	 *
	 * NON-OWNED CALENDARS SHOW AS BUSY. Every block goes through the shared
	 * label, so a partner's meeting reads as busy with the calendar's name and
	 * never as an event whose title failed to load. D205, D206.
	 *
	 * Times are Mountain, per D73: an event is a real instant, and rendering it
	 * in the browser's zone would put a 4pm call on the wrong side of a boundary
	 * for anybody travelling.
	 */

	export interface GridEvent {
		id: string;
		summary: string | null;
		starts_at: string;
		ends_at: string | null;
		all_day: number;
		calendar_name?: string | null;
		calendar_color?: string | null;
		free_busy_only?: number | null;
		html_link?: string | null;
	}

	let {
		events,
		days = 7,
		from
	}: { events: GridEvent[]; days?: number; from?: string } = $props();

	const ZONE = 'America/Denver';

	const dayName = new Intl.DateTimeFormat('en-US', {
		timeZone: ZONE,
		weekday: 'short',
		day: 'numeric'
	});
	const hourName = new Intl.DateTimeFormat('en-US', {
		timeZone: ZONE,
		hour: 'numeric'
	});
	const clock = new Intl.DateTimeFormat('en-US', {
		timeZone: ZONE,
		hour: 'numeric',
		minute: '2-digit'
	});

	/** The Mountain calendar day an instant falls on, as YYYY-MM-DD. */
	function mtDay(iso: string): string {
		return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(iso));
	}

	/** Minutes past Mountain midnight. The y position of everything. */
	function mtMinutes(iso: string): number {
		const parts = new Intl.DateTimeFormat('en-GB', {
			timeZone: ZONE,
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).format(new Date(iso));
		const [h, m] = parts.split(':').map(Number);
		return h * 60 + m;
	}

	const start = $derived(from ? new Date(from) : new Date());

	const columns = $derived(
		Array.from({ length: days }, (_, i) => {
			const d = new Date(start);
			d.setDate(d.getDate() + i);
			return { key: mtDay(d.toISOString()), label: dayName.format(d) };
		})
	);

	const timed = $derived(events.filter((e) => !e.all_day));
	const allDay = $derived(events.filter((e) => e.all_day));

	/**
	 * The hours worth drawing.
	 *
	 * Not a fixed nine-to-five: an event outside the window would be invisible on
	 * the one screen meant to show everything. The range covers the working day
	 * and then stretches to whatever the week actually contains.
	 */
	const span = $derived.by(() => {
		let lo = 8 * 60;
		let hi = 18 * 60;
		for (const e of timed) {
			lo = Math.min(lo, mtMinutes(e.starts_at));
			hi = Math.max(hi, mtMinutes(e.ends_at ?? e.starts_at) || mtMinutes(e.starts_at) + 30);
		}
		return { from: Math.floor(lo / 60) * 60, to: Math.min(24 * 60, Math.ceil(hi / 60) * 60) };
	});

	const hours = $derived(
		Array.from({ length: Math.max(1, (span.to - span.from) / 60) }, (_, i) => span.from + i * 60)
	);

	/** Pixels per minute. One hour is 52px, which fits a title and a time. */
	const SCALE = 52 / 60;

	/**
	 * Events for one day, packed into columns so overlaps sit side by side.
	 *
	 * A block placed on top of another hides it, and a hidden meeting is worse
	 * than no calendar: the reader believes the slot is free. So overlapping
	 * events share the width, and the packing is the greedy one, which is what
	 * every calendar does and what people expect to see.
	 */
	function layout(dayKey: string) {
		const forDay = timed
			.filter((e) => mtDay(e.starts_at) === dayKey)
			.map((e) => {
				const top = mtMinutes(e.starts_at);
				const end = e.ends_at ? mtMinutes(e.ends_at) : top + 30;
				return { top, end, event: e };
			});

		// The packing itself lives in `calendar-layout.ts`, pure and tested. A
		// real week often has no overlaps, so this is the part live data will not
		// exercise and the part that matters on the day two calls clash.
		return packLanes(forDay);
	}

	function allDayFor(dayKey: string) {
		return allDay.filter((e) => mtDay(e.starts_at) === dayKey);
	}

	/** A calendar's colour, falling back to the app's own rather than to nothing. */
	function tint(e: GridEvent): string {
		return e.calendar_color || 'var(--navy)';
	}
</script>

<div class="grid-wrap">
	<div class="grid" style="--rows: {hours.length}">
		<div class="corner"></div>
		{#each columns as col (col.key)}
			<div class="head">{col.label}</div>
		{/each}

		<!--
			All-day events get their own row rather than a block at midnight.
			Placing them on the timeline would claim they occupy the small hours,
			which is both wrong and the least useful place to draw them.
		-->
		<div class="allday-label">All day</div>
		{#each columns as col (col.key)}
			<div class="allday">
				{#each allDayFor(col.key) as e (e.id)}
					<span class="chip" style="border-left-color: {tint(e)}">{label(e)}</span>
				{/each}
			</div>
		{/each}

		<div class="hours">
			{#each hours as minute (minute)}
				<div class="hour" style="height: {60 * SCALE}px">
					<span>{hourName.format(new Date(2026, 0, 1, minute / 60))}</span>
				</div>
			{/each}
		</div>

		{#each columns as col (col.key)}
			<div class="day" style="height: {(span.to - span.from) * SCALE}px">
				{#each hours as minute (minute)}
					<div class="rule" style="top: {(minute - span.from) * SCALE}px"></div>
				{/each}

				{#each layout(col.key) as block (block.item.event.id)}
					<div
						class="block"
						class:busy={block.item.event.free_busy_only}
						style="top: {(block.item.top - span.from) * SCALE}px;
						       height: {Math.max(18, (block.item.end - block.item.top) * SCALE - 2)}px;
						       left: {block.leftPct}%; width: calc({block.widthPct}% - 3px);
						       border-left-color: {tint(block.item.event)}"
						title="{label(block.item.event)} · {clock.format(new Date(block.item.event.starts_at))}"
					>
						<span class="block-title">{label(block.item.event)}</span>
						<span class="block-time">{clock.format(new Date(block.item.event.starts_at))}</span>
					</div>
				{/each}
			</div>
		{/each}
	</div>
</div>

<style>
	/*
	 * The grid scrolls sideways inside its own box at narrow widths.
	 *
	 * Seven columns cannot fit a phone, and squeezing them to fit produces
	 * columns too narrow to read. Scrolling the grid keeps the page itself from
	 * scrolling sideways, which is the rule that matters. D22.
	 */
	.grid-wrap {
		overflow-x: auto;
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-2);
		background: var(--surface-card);
	}

	.grid {
		display: grid;
		grid-template-columns: 5rem repeat(7, minmax(8rem, 1fr));
		min-width: 61rem;
	}

	.corner,
	.head,
	.allday-label,
	.allday {
		border-bottom: 1px solid var(--border-thin);
	}

	.head {
		padding: var(--space-2) var(--space-3);
		font-size: 0.8125rem;
		font-weight: 600;
		border-left: 1px solid var(--border-thin);
	}

	.allday-label,
	.corner {
		padding: var(--space-2) var(--space-3);
		font-size: 0.6875rem;
		color: var(--text-secondary);
	}

	.allday {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		padding: 2px var(--space-2);
		min-height: 1.75rem;
		border-left: 1px solid var(--border-thin);
	}

	.chip {
		font-size: 0.6875rem;
		padding: 1px var(--space-2);
		border-left: 3px solid var(--navy);
		border-radius: 2px;
		background: var(--surface-hover);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}

	.hours {
		display: grid;
	}

	.hour {
		position: relative;
		padding-right: var(--space-2);
		text-align: right;
		font-size: 0.6875rem;
		color: var(--text-secondary);
	}

	.hour span {
		position: relative;
		top: -0.4em;
	}

	.day {
		position: relative;
		border-left: 1px solid var(--border-thin);
	}

	.rule {
		position: absolute;
		left: 0;
		right: 0;
		border-top: 1px solid var(--border-thin);
		opacity: 0.6;
	}

	.block {
		position: absolute;
		overflow: hidden;
		padding: 2px var(--space-2);
		border-radius: 3px;
		border-left: 3px solid var(--navy);
		background: var(--surface-hover);
		font-size: 0.6875rem;
		line-height: 1.3;
	}

	/*
	 * A busy block is drawn quieter than a real one.
	 *
	 * It carries less information by rule, and looking identical to an event
	 * with a title invites the reader to wonder what happened to the title.
	 */
	.block.busy {
		background: repeating-linear-gradient(
			135deg,
			var(--surface-hover),
			var(--surface-hover) 6px,
			var(--surface-page) 6px,
			var(--surface-page) 12px
		);
		color: var(--text-secondary);
	}

	.block-title {
		display: block;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.block-time {
		display: block;
		color: var(--text-secondary);
	}
</style>
