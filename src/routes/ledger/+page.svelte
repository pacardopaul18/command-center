<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { apiWrite } from '$lib/http';
	import { formatMoney } from '$lib/types';
	import Card from '$lib/components/Card.svelte';
	import type { PageData } from './$types';

	/**
	 * The ledger. P3-E1.
	 *
	 * A list and a way to add a line, which is what proves the shape against a
	 * real month. The dashboard is E5 and deliberately absent: a chart drawn over
	 * a store nobody has typed into yet would be a picture of the seed data.
	 *
	 * Totals are per currency and never combined. That is not a display choice,
	 * it is the same guarantee the API enforces, shown.
	 */

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let errorMessage = $state('');
	let showForm = $state(false);

	let form = $state({
		txn_date: new Date().toISOString().slice(0, 10),
		category_id: '',
		amount: '',
		currency: 'USD',
		client_id: '',
		project_id: '',
		notes: ''
	});

	const grouped = $derived.by(() => {
		const out: Record<string, typeof data.categories> = { income: [], expense: [], overhead: [] };
		for (const c of data.categories) out[c.kind]?.push(c);
		return out;
	});

	const KIND_LABEL: Record<string, string> = {
		income: 'Income',
		expense: 'Expense',
		overhead: 'Overhead'
	};

	/** Expenses and overhead read as money leaving, which the sign shows. */
	function signed(t: { amount_cents: number; category_kind: string }): string {
		const out = t.category_kind === 'income' ? t.amount_cents : -t.amount_cents;
		return `${out < 0 ? '-' : ''}${formatMoney(Math.abs(out))}`;
	}

	async function add(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		errorMessage = '';
		const result = await apiWrite('/api/ledger/transactions', 'POST', {
			txn_date: form.txn_date,
			category_id: form.category_id,
			amount: form.amount,
			currency: form.currency,
			client_id: form.client_id || null,
			project_id: form.project_id || null,
			notes: form.notes || null
		});
		if (!result.ok) {
			errorMessage = result.error ?? 'Could not add that line.';
		} else {
			form = { ...form, amount: '', notes: '', client_id: '', project_id: '' };
			showForm = false;
			await invalidateAll();
		}
		busy = false;
	}
</script>

<svelte:head><title>Ledger</title></svelte:head>

<header class="head">
	<div>
		<h1>Ledger</h1>
		<p class="sub">
			What came in and what went out. Single entry, and revenue counts when the money arrives
			rather than when the invoice is sent.
		</p>
	</div>
	<button type="button" class="primary" onclick={() => (showForm = !showForm)}>
		{showForm ? 'Cancel' : 'Add a line'}
	</button>
</header>

{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}

{#if data.categories.length === 0}
	<Card title="No categories yet">
		<p class="empty">
			A line needs a category to sit under. Add one through the API for now; the category
			editor is a later epic.
		</p>
	</Card>
{/if}

{#if showForm}
	<Card title="Add a line">
		<form onsubmit={add} class="form">
			<label>
				<span>Date</span>
				<input type="date" bind:value={form.txn_date} required />
			</label>

			<label>
				<span>Category</span>
				<select bind:value={form.category_id} required>
					<option value="" disabled>Choose one</option>
					{#each Object.entries(grouped) as [kind, list] (kind)}
						{#if list.length}
							<optgroup label={KIND_LABEL[kind]}>
								{#each list as category (category.id)}
									<option value={category.id}>
										{category.parent_name ? `${category.parent_name} / ` : ''}{category.name}
									</option>
								{/each}
							</optgroup>
						{/if}
					{/each}
				</select>
			</label>

			<label>
				<span>Amount</span>
				<input
					type="text"
					inputmode="decimal"
					bind:value={form.amount}
					placeholder="1250.00"
					required
				/>
			</label>

			<label>
				<span>Currency</span>
				<input type="text" bind:value={form.currency} maxlength="3" size="3" required />
			</label>

			<label>
				<span>Client, if it belongs to one</span>
				<select bind:value={form.client_id}>
					<option value="">None</option>
					{#each data.clients as client (client.id)}
						<option value={client.id}>{client.name}</option>
					{/each}
				</select>
			</label>

			<label class="wide">
				<span>Notes</span>
				<input type="text" bind:value={form.notes} />
			</label>

			<p class="fine wide">
				Enter the amount as a positive figure. Whether it counts up or down is decided by the
				category, so an expense of 40 is 40 under an expense category, never -40.
			</p>

			<div class="wide">
				<button type="submit" class="primary" disabled={busy || !form.category_id}>
					{busy ? 'Saving...' : 'Add it'}
				</button>
			</div>
		</form>
	</Card>
{/if}

<Card title="Totals">
	{#if data.totals.length === 0}
		<p class="empty">Nothing recorded yet.</p>
	{:else}
		<!--
			One row per currency, never one figure across them. Adding dollars to
			pesos gives a number that looks finished and means nothing.
		-->
		<div class="scroll">
		<table class="totals">
			<thead>
				<tr>
					<th>Currency</th>
					<th class="num">In</th>
					<th class="num">Out</th>
					<th class="num">Overhead</th>
					<th class="num">Net</th>
					<th class="num">Lines</th>
				</tr>
			</thead>
			<tbody>
				{#each data.totals as total (total.currency)}
					<tr>
						<th scope="row" class="mono">{total.currency}</th>
						<td class="num mono">{formatMoney(total.income_cents)}</td>
						<td class="num mono">{formatMoney(total.expense_cents)}</td>
						<td class="num mono">{formatMoney(total.overhead_cents)}</td>
						<td class="num mono strong">{formatMoney(total.amount_cents)}</td>
						<td class="num mono">{total.entries}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		</div>
		{#if data.totals.length > 1}
			<p class="fine">
				Two currencies, so there is no single net. Each row stands on its own until a
				conversion rate is a thing this app knows, which it does not.
			</p>
		{/if}
	{/if}
</Card>

<Card title="Lines">
	{#if data.transactions.length === 0}
		<p class="empty">No lines yet.</p>
	{:else}
		<div class="scroll">
			<table class="lines">
				<thead>
					<tr>
						<th>Date</th>
						<th>Category</th>
						<th>Client</th>
						<th>Notes</th>
						<th class="num">Amount</th>
					</tr>
				</thead>
				<tbody>
					{#each data.transactions as line (line.id)}
						<tr>
							<td class="mono nowrap">{line.txn_date}</td>
							<td>
								{line.category_name}
								<span class="kind">{KIND_LABEL[line.category_kind]}</span>
							</td>
							<td>
								{#if line.client_name}
									{line.client_name}{#if line.project_name} · {line.project_name}{/if}
								{:else}
									<span class="dim">None</span>
								{/if}
							</td>
							<td>{line.notes ?? ''}</td>
							<td class="num mono nowrap" class:out={line.category_kind !== 'income'}>
								{signed(line)}
								<span class="cur">{line.currency}</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</Card>

<style>
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-4);
		flex-wrap: wrap;
		margin-bottom: var(--space-4);
	}

	h1 {
		font-size: var(--text-2xl);
		font-weight: 700;
		margin: 0 0 6px;
	}

	.sub {
		margin: 0;
		max-width: 60ch;
		color: var(--text-secondary);
		font-size: var(--text-sm);
	}

	.primary {
		padding: 8px 14px;
		background: var(--navy);
		border: 1px solid var(--navy);
		border-radius: var(--radius-sm);
		color: #fff;
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
	}

	.primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.error {
		margin: 0 0 var(--space-3);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--gold);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
	}

	.form {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: var(--space-3);
	}

	.wide {
		grid-column: 1 / -1;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--text-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--text-secondary);
	}

	input,
	select {
		padding: 8px 10px;
		font: inherit;
		font-size: var(--text-sm);
		text-transform: none;
		letter-spacing: normal;
		color: var(--ink);
		background: var(--surface-page);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}

	th,
	td {
		padding: 8px 10px;
		text-align: left;
		border-bottom: 1px solid var(--border-thin);
		vertical-align: top;
	}

	thead th {
		font-size: var(--text-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--text-secondary);
	}

	.num {
		text-align: right;
	}

	.strong {
		font-weight: 600;
	}

	.nowrap {
		white-space: nowrap;
	}

	.out {
		color: var(--text-secondary);
	}

	.cur {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.kind {
		display: block;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.dim {
		color: var(--text-secondary);
	}

	.empty,
	.fine {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	/* Wide tables scroll inside their own box rather than pushing the page. */
	.scroll {
		overflow-x: auto;
	}
</style>
