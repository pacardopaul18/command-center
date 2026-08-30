<script lang="ts">
	/**
	 * Which mailbox is on screen.
	 *
	 * Shown even with one account connected, because "which mailbox am I looking
	 * at" is a question the answer to should never be inferred from context. With
	 * one account it reads as a label rather than a choice, which is honest: it
	 * still tells you whose mail this is.
	 *
	 * "All accounts" is a deliberate option rather than a default. Crossing
	 * accounts is a thing Paul asks for, and every row in that view says which
	 * account it came from.
	 */

	export interface SwitchableAccount {
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
		accounts: SwitchableAccount[];
		active: string;
		busy?: boolean;
		onChange: (account: string) => void;
	} = $props();

	/** An account whose token is out, or nearly. */
	function warning(account: SwitchableAccount): string | null {
		if (account.status === 'needs_reauth') return 'needs reconnecting';
		if (!account.reauth) return null;
		if (account.reauth.expired) return 'expired';
		if (account.reauth.days_left !== null && account.reauth.days_left <= 2) {
			return `${account.reauth.days_left}d left`;
		}
		return null;
	}

	const needsAttention = $derived(accounts.filter((a) => warning(a) !== null));
</script>

<div class="switcher">
	<label>
		<span class="label">Mailbox</span>
		<select
			value={active}
			disabled={busy}
			onchange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}
		>
			{#each accounts as account (account.id)}
				<option value={account.id}>
					{account.account_email ?? account.id}{warning(account) ? ` (${warning(account)})` : ''}
				</option>
			{/each}
			{#if accounts.length > 1}
				<option value="all">All accounts</option>
			{/if}
		</select>
	</label>

	{#if active === 'all'}
		<p class="note">
			Showing every account together. Each row says which one it came from.
		</p>
	{/if}

	{#each needsAttention as account (account.id)}
		<p class="warn" role="status">
			{account.account_email ?? account.id}
			{#if account.reauth?.expired || account.status === 'needs_reauth'}
				needs reconnecting. Google expires the token every seven days while the app is
				unpublished, which is expected rather than a fault.
			{:else}
				expires in {account.reauth?.days_left} day{account.reauth?.days_left === 1 ? '' : 's'}.
			{/if}
			Reconnect it in Settings.
		</p>
	{/each}
</div>

<style>
	.switcher {
		margin-bottom: var(--space-3);
	}

	label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.label {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}

	select {
		font: inherit;
		font-size: var(--text-sm);
		padding: var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text-primary);
		max-width: 100%;
	}

	.note {
		margin: var(--space-2) 0 0;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.warn {
		margin: var(--space-2) 0 0;
		font-size: var(--text-sm);
		border: 1px solid var(--gold);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
	}
</style>
