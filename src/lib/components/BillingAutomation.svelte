<script lang="ts">
	import { BILLING_SCHEDULES, REMINDER_CADENCES } from '$lib/types';
	import type { Client } from '$lib/types';
	import { formatDay } from '$lib/format';
	import Button from './Button.svelte';
	import Input from './Input.svelte';
	import Select from './Select.svelte';

	/**
	 * What the app is allowed to do on its own for one client.
	 *
	 * Two switches, both real, and neither of them sends anything. This app holds
	 * no scope that could mail a client and registers no route that could try,
	 * asserted in tests/layer2-no-send-surface.test.ts, so automation here means
	 * raising a draft and putting a prompt in Paul's own digest. D147.
	 *
	 * The copy says that plainly rather than implying more. A toggle that is on
	 * and does nothing is indistinguishable from one that is working, and the
	 * person who finds out is the client who was never chased.
	 */
	let {
		client,
		busy = false,
		onSet,
		onRaise
	}: {
		client: Client;
		busy?: boolean;
		/** Saves one field of the billing profile and says what to report. */
		onSet: (patch: Record<string, unknown>, message: string) => void;
		onRaise: () => void;
	} = $props();
</script>

<div class="auto-row">
	<div class="auto-text">
		<p class="auto-title">Raise the next invoice as a draft</p>
		<p class="auto-note">
			Copies the last invoice for this client onto today's dates, on the schedule below. A draft,
			never a sent document. You review it and mark it sent yourself.
		</p>
	</div>
	<div class="auto-controls">
		<label class="visually-hidden" for="auto-frequency">Schedule</label>
		<Select
			id="auto-frequency"
			value={client.auto_frequency ?? 'Monthly'}
			onchange={(e) =>
				onSet({ auto_frequency: (e.currentTarget as HTMLSelectElement).value }, 'Schedule saved.')}
		>
			{#each BILLING_SCHEDULES as schedule (schedule)}
				<option value={schedule}>{schedule}</option>
			{/each}
		</Select>
		<button
			type="button"
			role="switch"
			class="switch"
			aria-checked={client.auto_recurring === 1}
			aria-label="Raise the next invoice as a draft"
			disabled={busy}
			onclick={() =>
				onSet(
					{ auto_recurring: client.auto_recurring === 1 ? 0 : 1 },
					client.auto_recurring === 1
						? 'Recurring drafts switched off.'
						: 'Recurring drafts switched on.'
				)}
		>
			<span class="knob"></span>
		</button>
	</div>
</div>

<div class="auto-row">
	<div class="auto-text">
		<p class="auto-title">Flag overdue invoices in the daily digest</p>
		<p class="auto-note">
			Sorts this client's past due invoices to the top of the start of day email you already get,
			and marks the line. A prompt to you, not a message to them.
		</p>
	</div>
	<div class="auto-controls">
		<label class="visually-hidden" for="reminder-cadence">Cadence</label>
		<Select
			id="reminder-cadence"
			value={client.reminder_cadence ?? REMINDER_CADENCES[0]}
			onchange={(e) =>
				onSet({ reminder_cadence: (e.currentTarget as HTMLSelectElement).value }, 'Cadence saved.')}
		>
			{#each REMINDER_CADENCES as cadence (cadence)}
				<option value={cadence}>{cadence}</option>
			{/each}
		</Select>
		<button
			type="button"
			role="switch"
			class="switch"
			aria-checked={client.digest_reminders === 1}
			aria-label="Flag overdue invoices in the daily digest"
			disabled={busy}
			onclick={() =>
				onSet(
					{ digest_reminders: client.digest_reminders === 1 ? 0 : 1 },
					client.digest_reminders === 1
						? 'Digest prompts switched off.'
						: 'Digest prompts switched on.'
				)}
		>
			<span class="knob"></span>
		</button>
	</div>
</div>

<div class="auto-row">
	<div class="auto-text">
		<p class="auto-title">CC on the messages you send from Gmail</p>
		<p class="auto-note">
			Carried into the compose window this screen opens. Prefill only. Nothing here causes mail to
			leave.
		</p>
	</div>
	<div class="auto-controls wide-control">
		<label class="visually-hidden" for="billing-cc">CC addresses</label>
		<Input
			id="billing-cc"
			value={client.billing_cc ?? ''}
			mono
			placeholder="ap@client.com"
			onchange={(e) =>
				onSet({ billing_cc: (e.currentTarget as HTMLInputElement).value }, 'CC addresses saved.')}
		/>
	</div>
</div>

<div class="auto-foot">
	<Button variant="secondary" size="sm" disabled={busy} onclick={onRaise}>
		Raise what is due now
	</Button>
	<p class="auto-note">
		{#if client.auto_next_date}
			Next draft due {formatDay(client.auto_next_date)}.
		{:else}
			The schedule starts the first time this runs.
		{/if}
		The daily job does the same at 07:00 Mountain, before the digest goes out.
	</p>
</div>

<style>
	.auto-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-4) 0;
		border-top: 1px solid var(--border-thin);
	}
	.auto-row:first-of-type {
		margin-top: var(--space-3);
	}
	.auto-text {
		flex: 1 1 320px;
	}
	.auto-title {
		font-weight: var(--weight-medium);
	}
	.auto-note {
		margin-top: 2px;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.auto-controls {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.auto-controls :global(.control) {
		min-width: 180px;
	}
	.wide-control :global(.control) {
		min-width: 260px;
	}
	.auto-foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		padding-top: var(--space-4);
		border-top: 1px solid var(--border-thin);
	}

	/**
	 * A switch, not a checkbox with a picture on it: role and aria-checked carry
	 * the state, and the visual is the same fact drawn twice.
	 *
	 * The track is 46 by 26. The button around it is 44 tall with a transparent
	 * band above and below, so the visual stays a switch and the hit area clears
	 * the tap floor. D22.
	 */
	.switch {
		position: relative;
		width: 46px;
		height: var(--tap);
		flex-shrink: 0;
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
	}
	.switch::before {
		content: '';
		position: absolute;
		inset: 9px 0;
		border-radius: var(--radius-pill);
		background: var(--border-strong);
		transition: background-color var(--transition-base);
	}
	.switch[aria-checked='true']::before {
		background: var(--navy);
	}
	.switch:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}
	.knob {
		position: absolute;
		top: 12px;
		left: 3px;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: #ffffff;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
		transition: left var(--transition-base);
	}
	.switch[aria-checked='true'] .knob {
		left: 23px;
	}
</style>
