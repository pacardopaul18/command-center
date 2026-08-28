<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import {
		AGING_BUCKETS,
		AGING_LABELS,
		INVOICE_STATUS_LABELS,
		PERIOD_STATUS_LABELS,
		PERIOD_STATUS_TONE,
		formatMoney,
		nextPeriodStatus,
		parseMoneyToCents
	} from '$lib/types';
	import type { BillingPeriod, Invoice } from '$lib/types';
	import { formatDay } from '$lib/format';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import FormField from '$lib/components/FormField.svelte';
	import Input from '$lib/components/Input.svelte';
	import Select from '$lib/components/Select.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');
	let showPeriodForm = $state(false);
	let entryFor = $state<string | null>(null);
	let invoiceFor = $state<string | null>(null);
	let payingId = $state<string | null>(null);

	let periodDraft = $state({ client_id: '', period_start: '', period_end: '', note: '' });
	let entryDraft = $state({ entry_date: '', hours: '', description: '', project_id: '' });
	let invoiceDraft = $state({ invoice_number: '', issue_date: '', due_date: '', amount: '' });
	let payDraft = $state('');

	async function send(path: string, method: string, body: unknown, message: string) {
		busy = true;
		errorMessage = '';
		try {
			const res = await fetch(path, {
				method,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			const payload = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				errorMessage = payload.error ?? 'The request failed.';
				return false;
			}
			await invalidateAll();
			notice = message;
			return true;
		} catch {
			errorMessage = 'Could not reach the server.';
			return false;
		} finally {
			busy = false;
		}
	}

	const bandTotals = $derived.by(() =>
		AGING_BUCKETS.map((bucket) => {
			const row = data.bands.find((b) => b.aging_bucket === bucket);
			return {
				bucket,
				count: row?.invoice_count ?? 0,
				cents: row?.outstanding_cents ?? 0
			};
		})
	);

	const totalOutstanding = $derived(bandTotals.reduce((sum, b) => sum + b.cents, 0));

	async function createPeriod(event: SubmitEvent) {
		event.preventDefault();
		if (!periodDraft.client_id) {
			errorMessage = 'Choose a client for the billing period.';
			return;
		}
		if (await send('/api/invoicing/periods', 'POST', periodDraft, 'Billing period created.')) {
			periodDraft = { client_id: '', period_start: '', period_end: '', note: '' };
			showPeriodForm = false;
		}
	}

	async function addEntry(event: SubmitEvent, period: BillingPeriod) {
		event.preventDefault();
		const hours = Number(entryDraft.hours);
		if (!Number.isFinite(hours) || hours <= 0) {
			errorMessage = 'Hours must be a number greater than zero.';
			return;
		}
		const ok = await send(
			'/api/invoicing/entries',
			'POST',
			{ ...entryDraft, hours, billing_period_id: period.id },
			'Time entry added.'
		);
		if (ok) entryDraft = { entry_date: '', hours: '', description: '', project_id: '' };
	}

	async function advance(period: BillingPeriod) {
		const next = nextPeriodStatus(period.status);
		if (!next) return;
		await send(
			`/api/invoicing/periods/${period.id}`,
			'PATCH',
			{ status: next },
			`Period marked ${PERIOD_STATUS_LABELS[next].toLowerCase()}.`
		);
	}

	async function createInvoice(event: SubmitEvent, period: BillingPeriod) {
		event.preventDefault();
		const cents = parseMoneyToCents(invoiceDraft.amount);
		if (cents === null) {
			errorMessage = 'The amount must look like 1234.56.';
			return;
		}
		const ok = await send(
			'/api/invoicing/invoices',
			'POST',
			{
				invoice_number: invoiceDraft.invoice_number,
				issue_date: invoiceDraft.issue_date,
				due_date: invoiceDraft.due_date,
				amount_cents: cents,
				billing_period_id: period.id,
				status: 'sent'
			},
			'Invoice created.'
		);
		if (ok) {
			invoiceDraft = { invoice_number: '', issue_date: '', due_date: '', amount: '' };
			invoiceFor = null;
		}
	}

	async function recordPayment(event: SubmitEvent, invoice: Invoice) {
		event.preventDefault();
		const cents = parseMoneyToCents(payDraft);
		if (cents === null) {
			errorMessage = 'The amount must look like 1234.56.';
			return;
		}
		const ok = await send(
			`/api/invoicing/invoices/${invoice.id}`,
			'PATCH',
			{ amount_paid_cents: cents },
			'Payment recorded.'
		);
		if (ok) {
			payDraft = '';
			payingId = null;
		}
	}

	function agingLabel(invoice: Invoice) {
		return invoice.aging_bucket ? AGING_LABELS[invoice.aging_bucket] : 'Paid';
	}
</script>

<svelte:head>
	<title>Invoicing | Command Center</title>
</svelte:head>

<header class="head">
	<div>
		<h1>Invoicing</h1>
		<p class="sub">Hours in, invoices out, and what is still owed.</p>
	</div>
	<Button onclick={() => (showPeriodForm = !showPeriodForm)}>
		{showPeriodForm ? 'Cancel' : 'New billing period'}
	</Button>
</header>

<p class="status-line" role="status" aria-live="polite">{notice}</p>

{#if errorMessage}
	<p class="error-banner" role="alert">{errorMessage}</p>
{/if}

<!-- Aging band. Totals come from the same query as the rows below, so the two
     can never disagree. -->
<section class="bands" aria-label="Outstanding by aging bucket">
	{#each bandTotals as band (band.bucket)}
		<div class="band" class:alarm={band.bucket === 'b90_plus' && band.cents > 0} class:warn={band.bucket === 'b61_90' && band.cents > 0}>
			<p class="band-label label-mono">{AGING_LABELS[band.bucket]} days</p>
			<p class="band-amount mono">{formatMoney(band.cents)}</p>
			<p class="band-count mono">{band.count} invoice{band.count === 1 ? '' : 's'}</p>
		</div>
	{/each}
</section>

<p class="total mono">Total outstanding {formatMoney(totalOutstanding)}</p>

{#if showPeriodForm}
	<div class="block">
		<Card title="New billing period">
			<form onsubmit={createPeriod}>
				<div class="grid">
					<FormField label="Client">
						<Select bind:value={periodDraft.client_id}>
							<option value="">Choose a client</option>
							{#each data.clients as client (client.id)}
								<option value={client.id}>{client.name}</option>
							{/each}
						</Select>
					</FormField>
					<FormField label="Note">
						<Input bind:value={periodDraft.note} maxlength={500} placeholder="August retainer" />
					</FormField>
					<FormField label="Period start">
						<Input type="date" bind:value={periodDraft.period_start} mono required />
					</FormField>
					<FormField label="Period end">
						<Input type="date" bind:value={periodDraft.period_end} mono required />
					</FormField>
				</div>
				<div class="form-actions"><Button type="submit" disabled={busy}>Create period</Button></div>
			</form>
		</Card>
	</div>
{/if}

<h2 class="section">Billing periods</h2>

{#if data.periods.length === 0}
	<p class="empty">No billing periods yet. Create one to start logging hours against a client.</p>
{:else}
	<ul class="periods">
		{#each data.periods as period (period.id)}
			{@const next = nextPeriodStatus(period.status)}
			<li class="period">
				<div class="period-head">
					<div class="period-titles">
						<p class="period-client">{period.client_name}</p>
						<p class="period-dates mono">
							{formatDay(period.period_start)} to {formatDay(period.period_end)}
							{#if period.note}<span class="sep">·</span>{period.note}{/if}
						</p>
					</div>
					<StatusChip
						tone={PERIOD_STATUS_TONE[period.status]}
						label={PERIOD_STATUS_LABELS[period.status]}
						size="sm"
					/>
				</div>

				<p class="period-stats mono">
					{period.entry_count ?? 0} entr{(period.entry_count ?? 0) === 1 ? 'y' : 'ies'}
					<span class="sep">·</span>{(period.billable_hours ?? 0).toFixed(2)} billable h
					<span class="sep">·</span>{(period.total_hours ?? 0).toFixed(2)} total h
					{#if period.invoice_number}
						<span class="sep">·</span>{period.invoice_number}
					{/if}
				</p>

				<div class="period-actions">
					{#if period.status === 'open'}
						<Button variant="secondary" size="sm" onclick={() => (entryFor = entryFor === period.id ? null : period.id)}>
							{entryFor === period.id ? 'Close' : 'Add time'}
						</Button>
					{/if}
					{#if next}
						<Button variant="ghost" size="sm" disabled={busy} onclick={() => advance(period)}>
							Mark {PERIOD_STATUS_LABELS[next].toLowerCase()}
						</Button>
					{/if}
					{#if period.status === 'reconciled' && !period.invoice_id}
						<Button variant="ghost" size="sm" onclick={() => (invoiceFor = invoiceFor === period.id ? null : period.id)}>
							{invoiceFor === period.id ? 'Close' : 'Create invoice'}
						</Button>
					{/if}
				</div>

				{#if entryFor === period.id}
					<form class="inline-form" onsubmit={(e) => addEntry(e, period)}>
						<div class="grid">
							<FormField label="Date">
								<Input type="date" bind:value={entryDraft.entry_date} mono required />
							</FormField>
							<FormField label="Hours">
								<Input bind:value={entryDraft.hours} mono placeholder="2.5" required />
							</FormField>
							<div class="span-all">
								<FormField label="Description">
									<Input bind:value={entryDraft.description} maxlength={500} />
								</FormField>
							</div>
						</div>
						<div class="form-actions"><Button type="submit" size="sm" disabled={busy}>Add entry</Button></div>
					</form>
				{/if}

				{#if invoiceFor === period.id}
					<form class="inline-form" onsubmit={(e) => createInvoice(e, period)}>
						<div class="grid">
							<FormField label="Invoice number">
								<Input bind:value={invoiceDraft.invoice_number} mono placeholder="INV-2041" required />
							</FormField>
							<FormField label="Amount" hint="Plain numbers, for example 12400.00">
								<Input bind:value={invoiceDraft.amount} mono placeholder="12400.00" required />
							</FormField>
							<FormField label="Issue date">
								<Input type="date" bind:value={invoiceDraft.issue_date} mono required />
							</FormField>
							<FormField label="Due date">
								<Input type="date" bind:value={invoiceDraft.due_date} mono required />
							</FormField>
						</div>
						<div class="form-actions"><Button type="submit" size="sm" disabled={busy}>Create invoice</Button></div>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<h2 class="section">Invoices</h2>

{#if data.invoices.length === 0}
	<p class="empty">No invoices yet.</p>
{:else}
	<!-- D22: the table appears at 960px. Below that the same rows render as
	     cards, which is the only readable shape at 412px. -->
	<div class="table-wrap">
		<table>
			<caption class="visually-hidden">Invoices with outstanding amounts and aging</caption>
			<thead>
				<tr>
					<th scope="col" class="label-mono">Invoice</th>
					<th scope="col" class="label-mono">Client</th>
					<th scope="col" class="label-mono num">Amount</th>
					<th scope="col" class="label-mono num">Outstanding</th>
					<th scope="col" class="label-mono">Due</th>
					<th scope="col" class="label-mono">Aging</th>
					<th scope="col" class="label-mono">Status</th>
					<th scope="col"><span class="visually-hidden">Actions</span></th>
				</tr>
			</thead>
			<tbody>
				{#each data.invoices as invoice (invoice.id)}
					<tr class:flag={invoice.is_overdue === 1}>
						<td class="mono">{invoice.invoice_number}</td>
						<td>{invoice.client_name}</td>
						<td class="mono num">{formatMoney(invoice.amount_cents)}</td>
						<td class="mono num">{formatMoney(invoice.outstanding_cents ?? 0)}</td>
						<td class="mono nowrap">
							{formatDay(invoice.due_date)}
							{#if invoice.is_overdue === 1}
								<span class="overdue-note">{invoice.days_overdue} days past</span>
							{/if}
						</td>
						<td>
							{#if invoice.aging_bucket}
								<StatusChip
									tone={invoice.aging_bucket === 'b0_30' ? 'open' : invoice.aging_bucket === 'b31_60' ? 'atrisk' : 'overdue'}
									label={agingLabel(invoice)}
									size="sm"
								/>
							{:else}
								<StatusChip tone="done" label="Settled" size="sm" />
							{/if}
						</td>
						<td>{INVOICE_STATUS_LABELS[invoice.status]}</td>
						<td class="right">
							{#if invoice.status !== 'paid'}
								<Button variant="ghost" size="sm" onclick={() => { payingId = payingId === invoice.id ? null : invoice.id; payDraft = ''; }}>
									Record payment
								</Button>
							{/if}
						</td>
					</tr>
					{#if payingId === invoice.id}
						<tr>
							<td colspan="8">
								<form class="pay-form" onsubmit={(e) => recordPayment(e, invoice)}>
									<FormField label="Total paid to date">
										<Input bind:value={payDraft} mono placeholder={formatMoney(invoice.amount_cents)} required />
									</FormField>
									<Button type="submit" size="sm" disabled={busy}>Save</Button>
								</form>
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
	</div>

	<ul class="cards">
		{#each data.invoices as invoice (invoice.id)}
			<li class="card-row" class:flag={invoice.is_overdue === 1}>
				<div class="card-head">
					<span class="mono num-strong">{invoice.invoice_number}</span>
					{#if invoice.aging_bucket}
						<StatusChip
							tone={invoice.aging_bucket === 'b0_30' ? 'open' : invoice.aging_bucket === 'b31_60' ? 'atrisk' : 'overdue'}
							label={agingLabel(invoice)}
							size="sm"
						/>
					{:else}
						<StatusChip tone="done" label="Settled" size="sm" />
					{/if}
				</div>
				<p class="card-client">{invoice.client_name}</p>
				<dl class="card-facts mono">
					<div><dt>Amount</dt><dd>{formatMoney(invoice.amount_cents)}</dd></div>
					<div><dt>Outstanding</dt><dd>{formatMoney(invoice.outstanding_cents ?? 0)}</dd></div>
					<div>
						<dt>Due</dt>
						<dd>
							{formatDay(invoice.due_date)}
							{#if invoice.is_overdue === 1}<span class="overdue-note">{invoice.days_overdue} days past</span>{/if}
						</dd>
					</div>
					<div><dt>Status</dt><dd>{INVOICE_STATUS_LABELS[invoice.status]}</dd></div>
				</dl>
				{#if invoice.status !== 'paid'}
					<Button variant="ghost" size="sm" onclick={() => { payingId = payingId === invoice.id ? null : invoice.id; payDraft = ''; }}>
						Record payment
					</Button>
					{#if payingId === invoice.id}
						<form class="pay-form" onsubmit={(e) => recordPayment(e, invoice)}>
							<FormField label="Total paid to date">
								<Input bind:value={payDraft} mono placeholder={formatMoney(invoice.amount_cents)} required />
							</FormField>
							<Button type="submit" size="sm" disabled={busy}>Save</Button>
						</form>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.sub {
		margin-top: var(--space-1);
		color: var(--text-secondary);
	}
	.status-line {
		min-height: 1.25rem;
		margin-top: var(--space-2);
		font-size: var(--text-sm);
		color: var(--green-700);
	}
	.error-banner {
		margin-top: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--red-200);
		border-radius: var(--radius-sm);
		background: var(--red-100);
		color: var(--red);
	}

	/* One column at 412px, two at 720, four at 960. */
	.bands {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}
	.band {
		padding: var(--space-3) var(--space-4);
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-left: 3px solid var(--border-strong);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
	}
	.band.warn {
		border-left-color: var(--gold);
	}
	.band.alarm {
		border-left-color: var(--red);
	}
	.band-amount {
		margin-top: var(--space-1);
		font-size: var(--text-lg);
		font-weight: var(--weight-medium);
	}
	.band-count {
		margin-top: 2px;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.total {
		margin-top: var(--space-3);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.block {
		margin-top: var(--space-4);
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-3);
	}
	.form-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}

	.section {
		margin-top: var(--space-6);
	}
	.empty {
		margin-top: var(--space-3);
		padding: var(--space-5) var(--space-4);
		text-align: center;
		color: var(--text-secondary);
		background: var(--surface-card);
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-md);
	}

	.periods {
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.period {
		padding: var(--space-3) var(--space-4);
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
	}
	.period-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.period-client {
		font-weight: var(--weight-medium);
	}
	.period-dates,
	.period-stats {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.period-dates {
		margin-top: 2px;
	}
	.period-stats {
		margin-top: var(--space-2);
	}
	.period-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin-top: var(--space-2);
	}
	.inline-form {
		margin-top: var(--space-3);
		padding-top: var(--space-3);
		border-top: 1px solid var(--border-thin);
	}
	.sep {
		margin: 0 var(--space-1);
	}

	.pay-form {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-2);
		padding: var(--space-3) 0;
	}

	.table-wrap {
		display: none;
	}

	.cards {
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.card-row {
		padding: var(--space-3) var(--space-4);
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-left: 3px solid transparent;
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
	}
	.card-row.flag {
		border-left-color: var(--red);
	}
	.card-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.num-strong {
		font-weight: var(--weight-medium);
	}
	.card-client {
		margin-top: 2px;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.card-facts {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
		margin: var(--space-3) 0 var(--space-2);
		font-size: var(--text-xs);
	}
	.card-facts dt {
		color: var(--text-secondary);
	}
	.card-facts dd {
		margin: 2px 0 0;
	}
	.overdue-note {
		display: block;
		color: var(--red);
		font-size: var(--text-xs);
	}

	@media (min-width: 720px) {
		.grid {
			grid-template-columns: 1fr 1fr;
		}
		.span-all {
			grid-column: 1 / -1;
		}
		.bands {
			grid-template-columns: 1fr 1fr;
		}
	}

	@media (min-width: 960px) {
		.bands {
			grid-template-columns: repeat(4, 1fr);
		}
		.cards {
			display: none;
		}
		.table-wrap {
			display: block;
			margin-top: var(--space-3);
			padding: var(--space-1) var(--space-2) var(--space-2);
			background: var(--surface-card);
			border: 1px solid var(--border-thin);
			border-radius: var(--radius-md);
			box-shadow: var(--shadow-card);
			overflow-x: auto;
		}
		table {
			width: 100%;
			border-collapse: collapse;
		}
		th {
			padding: var(--space-2) var(--space-3);
			text-align: left;
			font-weight: var(--weight-medium);
			white-space: nowrap;
		}
		td {
			padding: var(--space-3);
			border-top: 1px solid var(--border-thin);
			vertical-align: top;
		}
		th.num,
		td.num {
			text-align: right;
		}
		td.nowrap {
			white-space: nowrap;
		}
		td.right {
			text-align: right;
		}
		tbody tr:hover {
			background: var(--surface-hover);
		}
		tr.flag td:first-child {
			box-shadow: inset 3px 0 0 var(--red);
		}
	}
</style>
