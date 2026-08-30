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

	export interface PickerAccount {
		id: string;
		account_email: string | null;
		status?: string;
		reauth?: { days_left: number | null; expired: boolean } | null;
	}

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

	/** An account whose token is out, or nearly. Google's clock runs per account. */
	function warning(account: PickerAccount): string | null {
		if (account.status === 'needs_reauth') return 'needs reconnecting';
		if (!account.reauth) return null;
		if (account.reauth.expired) return 'expired';
		if (account.reauth.days_left !== null && account.reauth.days_left <= 2) {
			return `${account.reauth.days_left}d left`;
		}
		return null;
	}

	const current = $derived(
		active === 'all'
			? 'All mailboxes'
			: (accounts.find((a) => a.id === active)?.account_email ?? 'Not connected')
	);

	const needsAttention = $derived(accounts.filter((a) => warning(a) !== null));
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
					{account.account_email ?? account.id}{warning(account)
						? ` (${warning(account)})`
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

	{#each needsAttention as account (account.id)}
		<p class="warn" role="status">
			{account.account_email ?? account.id}
			{#if account.reauth?.expired || account.status === 'needs_reauth'}
				needs reconnecting. Google expires the token every seven days while the app is
				unpublished, which is expected rather than a fault.
			{:else}
				expires in {account.reauth?.days_left} day{account.reauth?.days_left === 1 ? '' : 's'}.
			{/if}
		</p>
	{/each}
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

	.warn {
		margin: 0;
		max-width: 34rem;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--gold);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
	}
</style>
