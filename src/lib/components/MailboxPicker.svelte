<script lang="ts">
	/**
	 * Which mailbox is on screen, styled as the design's selector button.
	 *
	 * Shown even with one account connected, because "whose mail am I reading"
	 * should never be inferred from context. With one account it reads as a
	 * label rather than a choice, which is honest: it still answers the question.
	 *
	 * "All mailboxes" is a deliberate option and never a default. Under D111 the
	 * union is legitimate only because it was asked for and because every row it
	 * returns names its account.
	 */

	import { reauthLabel, type ReauthAccount } from '$lib/mailbox-warning';

	export type PickerAccount = ReauthAccount;

	let {
		accounts,
		active,
		busy = false,
		onChange
	}: {
		accounts: PickerAccount[];
		active: string;
		busy?: boolean;
		onChange: (account: string) => void;
	} = $props();

	const current = $derived(
		active === 'all'
			? 'All mailboxes'
			: (accounts.find((a) => a.id === active)?.account_email ?? 'Not connected')
	);

</script>

<div class="picker">
	<label class="shell">
		<span class="label mono">Mailbox</span>
		<select
			value={active}
			disabled={busy}
			aria-label="Mailbox"
			onchange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}
		>
			{#each accounts as account (account.id)}
				<option value={account.id}>
					{account.account_email ?? account.id}{reauthLabel(account)
						? ` (${reauthLabel(account)})`
						: ''}
				</option>
			{/each}
			{#if accounts.length > 1}
				<option value="all">All mailboxes</option>
			{/if}
		</select>
		<span class="shown">{current}</span>
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M6 9l6 6 6-6" />
		</svg>
	</label>
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--space-2);
	}

	/**
	 * The native select sits invisibly over the button so the control keeps its
	 * keyboard behaviour and its accessible name, while looking like the design.
	 * A div with a listbox would have meant rebuilding what the browser gives.
	 */
	.shell {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: 8px 12px;
		background: var(--surface-card);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: var(--text-base);
		color: var(--ink);
		max-width: 100%;
		transition: background-color var(--transition-fast);
	}

	.shell:hover {
		background: var(--surface-hover);
	}

	.shell:focus-within {
		box-shadow: 0 0 0 3px rgba(16, 42, 76, 0.14);
	}

	.label {
		font-size: var(--text-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--text-secondary);
		flex-shrink: 0;
	}

	.shown {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	select {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
		font: inherit;
	}

</style>
