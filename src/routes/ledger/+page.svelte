<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { apiWrite } from '$lib/http';
	import { formatMoney, formatUsd } from '$lib/types';
	import { formatDayShort } from '$lib/format';
	import { monthLabel, nextMonth, previousMonth } from '$lib/ledger';
	import Card from '$lib/components/Card.svelte';
	import type { PageData } from './$types';
	import type { CurrencyTotal, LedgerTransaction } from './+page';

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
	let showCategories = $state(false);
	let catDraft = $state({ name: '', kind: 'expense', parent_id: '' });
	let editingId = $state<string | null>(null);
	let editDraft = $state({ name: '', parent_id: '' });

	/**
	 * The receipt, attached after the transaction exists.
	 *
	 * A receipt belongs to a transaction, so there is nothing to attach it to
	 * until the row is saved. The form holds the file and uploads it as the
	 * second step rather than pretending the two are one.
	 */
	let receiptFile = $state<File | null>(null);
	let receiptNote = $state('');

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
		for (const c of liveCategories) out[c.kind]?.push(c);
		return out;
	});

	const KIND_LABEL: Record<string, string> = {
		income: 'Income',
		expense: 'Expense',
		overhead: 'Overhead'
	};

	/** Only live categories are offered; archived ones stay visible in the editor. */
	const liveCategories = $derived(data.categories.filter((c) => !c.archived_at));

	const chosenCategory = $derived(data.categories.find((c) => c.id === form.category_id) ?? null);

	/** A receipt makes sense for money going out, not for money arriving. */
	const wantsReceipt = $derived(chosenCategory !== null && chosenCategory.kind !== 'income');

	async function addCategory(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		errorMessage = '';
		const result = await apiWrite('/api/ledger/categories', 'POST', {
			name: catDraft.name,
			kind: catDraft.kind,
			parent_id: catDraft.parent_id || null
		});
		if (!result.ok) errorMessage = result.error ?? 'Could not add that category.';
		else {
			catDraft = { name: '', kind: catDraft.kind, parent_id: '' };
			await invalidateAll();
		}
		busy = false;
	}

	async function saveEdit(id: string) {
		busy = true;
		errorMessage = '';
		const result = await apiWrite(`/api/ledger/categories/${id}`, 'PATCH', {
			name: editDraft.name,
			parent_id: editDraft.parent_id || null
		});
		if (!result.ok) errorMessage = result.error ?? 'Could not save that change.';
		else {
			editingId = null;
			await invalidateAll();
		}
		busy = false;
	}

	async function setArchived(id: string, archived: boolean) {
		busy = true;
		errorMessage = '';
		const result = await apiWrite(`/api/ledger/categories/${id}/archive`, 'POST', { archived });
		if (!result.ok) errorMessage = result.error ?? 'Could not change that.';
		else await invalidateAll();
		busy = false;
	}

	async function removeCategory(id: string) {
		busy = true;
		errorMessage = '';
		const result = await apiWrite(`/api/ledger/categories/${id}`, 'DELETE', undefined);
		// The refusal explains itself and offers deactivating instead, so it is
		// shown as written rather than replaced with something shorter and vaguer.
		if (!result.ok) errorMessage = result.error ?? 'Could not remove that category.';
		else await invalidateAll();
		busy = false;
	}

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
			const created = (result.data as { transaction?: { id: string } } | undefined)?.transaction;
			if (receiptFile && created?.id) {
				const formData = new FormData();
				formData.append('file', receiptFile);
				const upload = await fetch(`/api/ledger/transactions/${created.id}/receipts`, {
					method: 'POST',
					body: formData
				});
				if (!upload.ok) {
					const body = (await upload.json().catch(() => ({}))) as { error?: string };
					// The line saved and the receipt did not. Said plainly, because
					// silently keeping one of the two is how a receipt goes missing.
					errorMessage =
						(body.error ?? 'The receipt did not upload.') +
						' The entry was saved, so attach the receipt again from the list.';
				}
			}
			form = { ...form, amount: '', notes: '', client_id: '', project_id: '' };
			receiptFile = null;
			receiptNote = '';
			showForm = false;
			await invalidateAll();
		}
		busy = false;
	}

	/* ---------------------------------------------------------------------
	 * The month on screen
	 * ------------------------------------------------------------------ */

	function monthUrl(month: string) {
		return `/ledger?month=${month}`;
	}

	const label = $derived(monthLabel(data.month));

	/**
	 * The USD figures, which are the ones the tiles show.
	 *
	 * The totals route answers per currency and never combines them, deliberately:
	 * adding dollars to pesos gives a number that looks finished and means
	 * nothing. The tiles need one set of figures, so they name the currency they
	 * are about, and the per-currency table below still shows every one.
	 */
	function usd(totals: CurrencyTotal[]): CurrencyTotal {
		return (
			totals.find((t) => t.currency === 'USD') ?? {
				currency: 'USD',
				amount_cents: 0,
				income_cents: 0,
				expense_cents: 0,
				overhead_cents: 0,
				entries: 0
			}
		);
	}

	const month = $derived(usd(data.totals));
	const prior = $derived(usd(data.priorTotals));

	/** Money out is expense plus overhead: overhead is a kind of out, not a third thing. */
	const outCents = $derived(month.expense_cents + month.overhead_cents);

	const overheadShare = $derived(
		outCents === 0 ? 0 : Math.round((month.overhead_cents / outCents) * 100)
	);

	const netDelta = $derived(month.amount_cents - prior.amount_cents);

	const inLines = $derived(
		data.transactions.filter((t) => t.currency === 'USD' && t.category_kind === 'income').length
	);
	const outLines = $derived(
		data.transactions.filter((t) => t.currency === 'USD' && t.category_kind !== 'income').length
	);

	/* ---------------------------------------------------------------------
	 * Filters over the month
	 * ------------------------------------------------------------------ */

	let kindFilter = $state<'all' | 'in' | 'out'>('all');
	let search = $state('');

	const visible = $derived.by(() => {
		const needle = search.trim().toLowerCase();
		return data.transactions.filter((line) => {
			if (kindFilter === 'in' && line.category_kind !== 'income') return false;
			if (kindFilter === 'out' && line.category_kind === 'income') return false;
			if (!needle) return true;
			return [line.category_name, line.notes, line.client_name, line.project_name]
				.filter(Boolean)
				.some((text) => String(text).toLowerCase().includes(needle));
		});
	});

	/**
	 * The running balance, computed from the oldest line forward and then drawn
	 * newest first.
	 *
	 * It has to be computed over every line in the month, not over the filtered
	 * list: a balance that only counted the rows a search happened to match would
	 * be a different number on every keystroke and would be wrong on all of them.
	 * So the running total is built once over the whole month and the filter only
	 * decides which rows are drawn.
	 */
	const balances = $derived.by(() => {
		const ordered = [...data.transactions]
			.filter((t) => t.currency === 'USD')
			.sort((a, b) => a.txn_date.localeCompare(b.txn_date) || a.id.localeCompare(b.id));

		const out = new Map<string, number>();
		let running = 0;
		for (const line of ordered) {
			running += line.category_kind === 'income' ? line.amount_cents : -line.amount_cents;
			out.set(line.id, running);
		}
		return out;
	});

	/** Spending by category for the month, biggest first, for the side panel. */
	const byCategory = $derived.by(() => {
		const totals = new Map<string, { name: string; kind: string; cents: number }>();
		for (const line of data.transactions) {
			if (line.currency !== 'USD') continue;
			const entry = totals.get(line.category_id) ?? {
				name: line.category_name,
				kind: line.category_kind,
				cents: 0
			};
			entry.cents += line.amount_cents;
			totals.set(line.category_id, entry);
		}
		const rows = [...totals.values()].sort((a, b) => b.cents - a.cents);
		const largest = rows[0]?.cents ?? 0;
		// The bar is a share of the largest row, not of the total. A share of the
		// total makes every bar tiny the moment one category dominates, which is
		// exactly the month you want to be able to read.
		return rows.map((r) => ({ ...r, share: largest === 0 ? 0 : (r.cents / largest) * 100 }));
	});

	/* ---------------------------------------------------------------------
	 * Correcting a line
	 * ------------------------------------------------------------------ */

	let editingLineId = $state<string | null>(null);
	let lineDraft = $state({ txn_date: '', category_id: '', amount: '', client_id: '', notes: '' });

	function startLineEdit(line: LedgerTransaction) {
		editingLineId = line.id;
		lineDraft = {
			txn_date: line.txn_date,
			category_id: line.category_id,
			amount: (line.amount_cents / 100).toFixed(2),
			client_id: line.client_id ?? '',
			notes: line.notes ?? ''
		};
	}

	async function saveLine() {
		if (!editingLineId) return;
		busy = true;
		errorMessage = '';
		const res = await apiWrite(`/api/ledger/transactions/${editingLineId}`, 'PATCH', {
			txn_date: lineDraft.txn_date,
			category_id: lineDraft.category_id,
			amount: lineDraft.amount,
			client_id: lineDraft.client_id || null,
			notes: lineDraft.notes || null
		});
		busy = false;
		if (res.ok) {
			editingLineId = null;
			await invalidateAll();
		} else {
			errorMessage = res.error ?? 'Could not change that line.';
		}
	}

	async function removeLine(id: string) {
		busy = true;
		errorMessage = '';
		const res = await apiWrite(`/api/ledger/transactions/${id}`, 'DELETE', null);
		busy = false;
		if (res.ok) await invalidateAll();
		else errorMessage = res.error ?? 'Could not remove that line.';
	}

	/** The export takes the window on screen, so the file matches what was read. */
	const exportHref = $derived(`/api/ledger/export?from=${data.from}&to=${data.to}`);
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
	<div class="head-actions">
		<!--
			A plain link, so the browser does the download and the file is exactly
			what the route returned. Fetching it into memory to save it would mean
			holding a month of the books in a blob for no benefit.
		-->
		<a class="ghost" href={exportHref} download>Export CSV</a>
		<button type="button" class="primary" onclick={() => (showForm = !showForm)}>
			{showForm ? 'Cancel' : 'Add a line'}
		</button>
	</div>
</header>

<nav class="months" aria-label="Month">
	<a class="ghost" href={monthUrl(previousMonth(data.month))} aria-label="Previous month">&lt;</a>
	<span class="month-label mono">{label}</span>
	<a class="ghost" href={monthUrl(nextMonth(data.month))} aria-label="Next month">&gt;</a>
	{#if data.custom}
		<span class="fine">
			Showing {data.from} to {data.to}. <a href={monthUrl(data.month)}>Back to months</a>
		</span>
	{/if}
</nav>

{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}

<!--
	USD only, and it says so. The totals route answers per currency and never
	combines them; these tiles need one set of figures, so they name the currency
	rather than quietly summing across.
-->
<div class="tiles">
	<div class="tile in">
		<span class="tile-label mono">Money in</span>
		<span class="tile-value mono">{formatUsd(month.income_cents)}</span>
		<span class="tile-note mono">{inLines} {inLines === 1 ? 'line' : 'lines'}</span>
	</div>
	<div class="tile out">
		<span class="tile-label mono">Money out</span>
		<span class="tile-value mono">{formatUsd(outCents)}</span>
		<span class="tile-note mono">{outLines} {outLines === 1 ? 'line' : 'lines'}</span>
	</div>
	<div class="tile out">
		<span class="tile-label mono">Of which overhead</span>
		<span class="tile-value mono">{formatUsd(month.overhead_cents)}</span>
		<span class="tile-note mono">{overheadShare}% of money out</span>
	</div>
	<div class="tile net">
		<span class="tile-label mono">Net for {label.split(' ')[0]}</span>
		<span class="tile-value mono">{formatUsd(month.amount_cents)}</span>
		<span class="tile-note mono">
			{#if data.custom}
				this window
			{:else if netDelta === 0}
				level with {monthLabel(previousMonth(data.month)).split(' ')[0]}
			{:else}
				{netDelta > 0 ? 'up' : 'down'} {formatUsd(Math.abs(netDelta))} vs
				{monthLabel(previousMonth(data.month)).split(' ')[0]}
			{/if}
		</span>
	</div>
</div>

<div class="board">
	<div class="main">
		<Card title="Lines">
			{#snippet actions()}
				<span class="fine mono">{visible.length} of {data.transactions.length}</span>
			{/snippet}

			<div class="filters">
				<div class="chips" role="group" aria-label="Filter by direction">
					{#each [['all', 'All'], ['in', 'Money in'], ['out', 'Money out']] as [value, text] (value)}
						<button
							type="button"
							class="chip"
							class:on={kindFilter === value}
							aria-pressed={kindFilter === value}
							onclick={() => (kindFilter = value as 'all' | 'in' | 'out')}
						>
							{text}
						</button>
					{/each}
				</div>
				<input
					class="search"
					type="search"
					bind:value={search}
					placeholder="Search lines"
					aria-label="Search lines"
				/>
			</div>

			{#if data.transactions.length === 0}
				<p class="empty">Nothing recorded in {label}.</p>
			{:else if visible.length === 0}
				<p class="empty">No lines match that filter.</p>
			{:else}
				<div class="scroll">
					<table class="lines">
						<thead>
							<tr>
								<th>Date</th>
								<th>Category and notes</th>
								<th>Client</th>
								<th class="num">In</th>
								<th class="num">Out</th>
								<th class="num">Balance</th>
								<th><span class="sr">Actions</span></th>
							</tr>
						</thead>
						<tbody>
							{#each visible as line (line.id)}
								{#if editingLineId === line.id}
									<tr>
										<td colspan="7">
											<form
												class="line-edit"
												onsubmit={(e) => {
													e.preventDefault();
													saveLine();
												}}
											>
												<label>
													<span>Date</span>
													<input type="date" bind:value={lineDraft.txn_date} required />
												</label>
												<label>
													<span>Category</span>
													<select bind:value={lineDraft.category_id} required>
														{#each Object.entries(grouped) as [kind, list] (kind)}
															{#if list.length}
																<optgroup label={KIND_LABEL[kind]}>
																	{#each list as category (category.id)}
																		<option value={category.id}>{category.name}</option>
																	{/each}
																</optgroup>
															{/if}
														{/each}
													</select>
												</label>
												<label>
													<span>Amount</span>
													<input type="text" inputmode="decimal" bind:value={lineDraft.amount} required />
												</label>
												<label>
													<span>Client</span>
													<select bind:value={lineDraft.client_id}>
														<option value="">None</option>
														{#each data.clients as client (client.id)}
															<option value={client.id}>{client.name}</option>
														{/each}
													</select>
												</label>
												<label class="wide">
													<span>Notes</span>
													<input type="text" bind:value={lineDraft.notes} />
												</label>
												<div class="wide line-edit-actions">
													<button type="submit" class="primary" disabled={busy}>Save</button>
													<button type="button" class="ghost" onclick={() => (editingLineId = null)}>
														Cancel
													</button>
												</div>
											</form>
										</td>
									</tr>
								{:else}
									<tr>
										<td class="mono nowrap">{formatDayShort(line.txn_date)}</td>
										<td>
											<span class="cat">{line.category_name}</span>
											{#if line.notes}<span class="note">{line.notes}</span>{/if}
										</td>
										<td>
											{#if line.client_name}
												{line.client_name}
											{:else}
												<span class="dim">None</span>
											{/if}
										</td>
										<td class="num mono in-cell">
											{line.category_kind === 'income' ? formatUsd(line.amount_cents) : ''}
										</td>
										<td class="num mono">
											{line.category_kind === 'income' ? '' : formatUsd(line.amount_cents)}
										</td>
										<td class="num mono">
											{#if line.currency === 'USD'}
												{formatUsd(balances.get(line.id) ?? 0)}
											{:else}
												<span class="dim">{line.currency}</span>
											{/if}
										</td>
										<td class="acts">
											<!--
												D27: the controls exist only where they work. A line this
												app posted from an invoice or read from a statement is not
												editable here, and drawing a pencil that always refuses
												would be worse than drawing nothing. The reason is one
												hover away.
											-->
											{#if line.provenance === 'manual'}
												<button
													type="button"
													class="ghost"
													disabled={busy}
													onclick={() => startLineEdit(line)}
												>
													Edit
												</button>
												<button
													type="button"
													class="ghost"
													disabled={busy}
													onclick={() => removeLine(line.id)}
												>
													Remove
												</button>
											{:else}
												<span
													class="dim fine"
													title={line.provenance === 'invoice'
														? 'Posted from an invoice. Change the payment there.'
														: 'Imported from a statement. Add a correcting line instead.'}
												>
													{line.provenance === 'invoice' ? 'From an invoice' : 'Imported'}
												</span>
											{/if}
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
						<tfoot>
							<tr>
								<td colspan="5">Net for {label}</td>
								<td class="num mono strong">{formatUsd(month.amount_cents)}</td>
								<td></td>
							</tr>
						</tfoot>
					</table>
				</div>
			{/if}
		</Card>
	</div>

	<aside class="side">
		<Card title="By category">
			{#snippet actions()}
				<span class="fine mono">{label}</span>
			{/snippet}

			{#if byCategory.length === 0}
				<p class="empty">Nothing recorded in {label}.</p>
			{:else}
				<ul class="cats">
					{#each byCategory as row (row.name)}
						<li>
							<span class="cat-name">{row.name}</span>
							<span class="cat-amount mono">{formatUsd(row.cents)}</span>
							<!--
								A bar, not a chart. The width is a share of the largest row
								rather than of the total, so a month with one dominant
								category is still readable. `aria-hidden` because the figure
								beside it is the same fact, said properly.
							-->
							<span class="bar" aria-hidden="true">
								<span
									class="bar-fill"
									class:income={row.kind === 'income'}
									style="width: {row.share}%"
								></span>
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>
	</aside>
</div>

{#if liveCategories.length === 0}
	<Card title="No categories yet">
		<p class="empty">
			A line needs a category to sit under. Add one below to get started.
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

			{#if wantsReceipt}
				<label class="wide">
					<span>Receipt, if you have one</span>
					<input
						type="file"
						accept="application/pdf,image/jpeg,image/png,image/heic,image/webp"
						onchange={(e) => {
							const files = (e.currentTarget as HTMLInputElement).files;
							receiptFile = files && files.length ? files[0] : null;
							receiptNote = receiptFile ? `${receiptFile.name}` : '';
						}}
					/>
				</label>
				<p class="fine wide">
					PDF or an image, up to 12 MB. It attaches once the line is saved, because a
					receipt belongs to an entry that exists.
					{#if receiptNote}<strong>{receiptNote}</strong>{/if}
				</p>
			{/if}

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

<Card title="Categories">
	<button type="button" class="ghost" onclick={() => (showCategories = !showCategories)}>
		{showCategories ? 'Hide categories' : `Manage categories (${liveCategories.length})`}
	</button>

	{#if showCategories}
		<form class="form" onsubmit={addCategory}>
			<label>
				<span>Name</span>
				<input type="text" bind:value={catDraft.name} required />
			</label>
			<label>
				<span>Kind</span>
				<select bind:value={catDraft.kind}>
					<option value="income">Income</option>
					<option value="expense">Expense</option>
					<option value="overhead">Overhead</option>
				</select>
			</label>
			<label>
				<span>Nest under</span>
				<select bind:value={catDraft.parent_id}>
					<option value="">Nothing, it is a top level category</option>
					{#each liveCategories.filter((c) => c.kind === catDraft.kind && !c.parent_id) as parent (parent.id)}
						<option value={parent.id}>{parent.name}</option>
					{/each}
				</select>
			</label>
			<div class="wide">
				<button type="submit" class="primary" disabled={busy || !catDraft.name.trim()}>
					Add category
				</button>
			</div>
		</form>

		<div class="scroll">
			<table>
				<thead>
					<tr><th>Category</th><th>Kind</th><th class="num">Entries</th><th>Actions</th></tr>
				</thead>
				<tbody>
					{#each data.categories as category (category.id)}
						<tr class:archived={category.archived_at}>
							<td>
								{#if editingId === category.id}
									<input type="text" bind:value={editDraft.name} aria-label="Category name" />
									<select bind:value={editDraft.parent_id} aria-label="Nest under">
										<option value="">Top level</option>
										{#each liveCategories.filter((c) => c.kind === category.kind && !c.parent_id && c.id !== category.id) as parent (parent.id)}
											<option value={parent.id}>{parent.name}</option>
										{/each}
									</select>
								{:else}
									{#if category.parent_name}<span class="dim">{category.parent_name} / </span>{/if}
									{category.name}
									{#if category.archived_at}<span class="kind">Deactivated</span>{/if}
								{/if}
							</td>
							<td>{KIND_LABEL[category.kind]}</td>
							<td class="num mono">{category.transaction_count}</td>
							<td class="acts">
								{#if editingId === category.id}
									<button type="button" class="ghost" disabled={busy} onclick={() => saveEdit(category.id)}>Save</button>
									<button type="button" class="ghost" onclick={() => (editingId = null)}>Cancel</button>
								{:else}
									<button
										type="button"
										class="ghost"
										onclick={() => {
											editingId = category.id;
											editDraft = { name: category.name, parent_id: category.parent_id ?? '' };
										}}
									>
										Rename
									</button>
									{#if category.archived_at}
										<button type="button" class="ghost" disabled={busy} onclick={() => setArchived(category.id, false)}>Reactivate</button>
									{:else}
										<button type="button" class="ghost" disabled={busy} onclick={() => setArchived(category.id, true)}>Deactivate</button>
									{/if}
									{#if category.transaction_count === 0}
										<button type="button" class="ghost" disabled={busy} onclick={() => removeCategory(category.id)}>Delete</button>
									{/if}
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="fine">
			A category with entries filed under it is deactivated rather than deleted. It leaves
			the pickers and keeps its history, so the reports that already used it still add up.
		</p>
	{/if}
</Card>

<Card title="Every currency">
	{#if data.totals.length === 0}
		<p class="empty">Nothing recorded in this window.</p>
	{:else}
		<!--
			One row per currency, never one figure across them. Adding dollars to
			pesos gives a number that looks finished and means nothing. The tiles
			above are USD and say so; this is the whole picture.
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

<style>

	.head-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.months {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
		flex-wrap: wrap;
	}

	.month-label {
		font-size: var(--text-md);
		color: var(--text-heading);
		min-width: 8ch;
		text-align: center;
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
		gap: var(--space-3);
		margin-bottom: var(--space-4);
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
	}

	.tile.in {
		border-left-color: var(--green-700, #2e7d5b);
	}

	.tile.out {
		border-left-color: var(--gold-600, #c9a84c);
	}

	.tile.net {
		border-left-color: var(--navy-600);
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

	.board {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		align-items: start;
	}

	@media (min-width: 1100px) {
		.board {
			grid-template-columns: minmax(0, 3fr) minmax(0, 1fr);
		}
	}

	.main,
	.side {
		min-width: 0;
	}

	.filters {
		display: flex;
		gap: var(--space-3);
		align-items: center;
		flex-wrap: wrap;
		margin-bottom: var(--space-3);
	}

	.chips {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.chip {
		min-height: 44px;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-thin);
		border-radius: 999px;
		background: transparent;
		color: var(--text-muted);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}

	.chip.on {
		background: var(--navy-700);
		border-color: var(--navy-700);
		color: var(--surface-page);
	}

	.search {
		flex: 1;
		min-width: 180px;
		min-height: 44px;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-sm);
		font: inherit;
		font-size: var(--text-sm);
	}

	.cat {
		display: block;
		color: var(--text-body);
	}

	.note {
		display: block;
		margin-top: 2px;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.in-cell {
		color: var(--green-700, #2e7d5b);
	}

	tfoot td {
		padding-top: var(--space-3);
		border-top: 1px solid var(--border-thin);
		font-size: var(--text-sm);
	}

	.line-edit {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: var(--space-3);
		padding: var(--space-3) 0;
	}

	.line-edit-actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.cats {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.cats li {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: var(--space-1) var(--space-2);
		padding: var(--space-2) 0;
	}

	.cats li + li {
		border-top: 1px solid var(--border-hairline);
	}

	.cat-name {
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}

	.cat-amount {
		font-size: var(--text-sm);
		text-align: right;
	}

	.bar {
		grid-column: 1 / -1;
		display: block;
		height: 4px;
		border-radius: 2px;
		background: var(--border-hairline);
		overflow: hidden;
	}

	.bar-fill {
		display: block;
		height: 100%;
		background: var(--gold-600, #c9a84c);
	}

	.bar-fill.income {
		background: var(--green-700, #2e7d5b);
	}

	/*
	 * Visible to a screen reader, never drawn, and deliberately not positioned:
	 * an absolutely positioned one inside a scrolling table escapes its container
	 * and makes the whole page scroll sideways.
	 */
	.sr {
		display: inline-block;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
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


	.kind {
		display: block;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.dim {
		color: var(--text-secondary);
	}

	tr.archived td {
		opacity: 0.55;
	}

	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.ghost {
		padding: 4px 8px;
		background: none;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font: inherit;
		font-size: var(--text-xs);
		color: var(--navy-700);
		cursor: pointer;
	}

	.ghost:hover {
		background: var(--surface-hover);
	}

	.ghost:disabled {
		opacity: 0.5;
		cursor: not-allowed;
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
