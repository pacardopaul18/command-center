<script lang="ts">
	import { formatDayShort, formatDayYear } from '$lib/format';
	import { INVOICE_KIND_LABELS, formatUsd } from '$lib/types';
	import type { Invoice } from '$lib/types';
	import type { PageData } from './$types';

	/**
	 * Nothing auto-prints.
	 *
	 * A page that opens a print dialog by itself takes the decision away from the
	 * reader, and this URL is also a clean read only view worth having on its
	 * own. Same reasoning as the printable reports.
	 */
	let { data }: { data: PageData } = $props();

	const outstanding = (inv: Invoice) => inv.amount_cents - inv.amount_paid_cents;

	/** Present for a document, null for a statement. The template branches on it. */
	const doc = $derived(data.invoice);

	const statementRows = $derived(
		data.invoices.filter(
			(inv) =>
				!inv.voided_at &&
				(!inv.kind || inv.kind === 'invoice') &&
				inv.amount_paid_cents < inv.amount_cents
		)
	);
	const statementTotal = $derived(statementRows.reduce((sum, inv) => sum + outstanding(inv), 0));

	const title = $derived(
		doc
			? `${doc.invoice_number} for ${data.client?.name ?? 'client'}`
			: `Statement for ${data.client?.name ?? 'client'}`
	);
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<nav class="bar">
	<a href="/invoices?client={data.client?.id ?? ''}">Back to invoicing</a>
	<button type="button" onclick={() => window.print()}>Print or save as PDF</button>
</nav>

<article class="sheet">
	<header>
		<p class="brand">Command Center</p>
		{#if doc}
			<h1>
				{INVOICE_KIND_LABELS[doc.kind ?? 'invoice']}
				{doc.invoice_number}
			</h1>
			<dl class="stamp">
				<div><dt>Issued</dt><dd>{formatDayYear(doc.issue_date)}</dd></div>
				<div><dt>Due</dt><dd>{formatDayYear(doc.due_date)}</dd></div>
				<div><dt>Terms</dt><dd>{data.client?.billing_terms ?? 'As agreed'}</dd></div>
			</dl>
		{:else}
			<h1>Statement of account</h1>
			<dl class="stamp">
				<div><dt>As at</dt><dd>{formatDayYear(data.today)}</dd></div>
				<div><dt>Terms</dt><dd>{data.client?.billing_terms ?? 'As agreed'}</dd></div>
			</dl>
		{/if}
	</header>

	<section class="to">
		<p class="label-mono">Billed to</p>
		<p class="who">{data.client?.name}</p>
		{#if data.client?.contact_name}<p>{data.client.contact_name}</p>{/if}
		{#if data.client?.billing_address}<p>{data.client.billing_address}</p>{/if}
		{#if data.client?.contact_email}<p class="mono">{data.client.contact_email}</p>{/if}
	</section>

	{#if doc}
		{#if doc.voided_at}
			<p class="void-mark">This document is void. It counts toward nothing.</p>
		{/if}

		<table>
			<thead>
				<tr>
					<th scope="col">Product or service</th>
					<th scope="col">Description</th>
					<th scope="col" class="num">Qty</th>
					<th scope="col" class="num">Rate</th>
					<th scope="col" class="num">Amount</th>
				</tr>
			</thead>
			<tbody>
				{#each doc.items ?? [] as item (item.id)}
					<tr>
						<td>{item.service}</td>
						<td>{item.description ?? ''}</td>
						<td class="num mono">{item.quantity}</td>
						<td class="num mono">{formatUsd(item.unit_rate_cents)}</td>
						<td class="num mono">{formatUsd(item.amount_cents)}</td>
					</tr>
				{:else}
					<tr>
						<td colspan="5" class="none">
							No line breakdown was recorded for this invoice.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>

		<dl class="totals">
			{#if doc.subtotal_cents !== null && doc.subtotal_cents !== undefined}
				<div><dt>Subtotal</dt><dd class="mono">{formatUsd(doc.subtotal_cents)}</dd></div>
			{/if}
			{#if (doc.discount_cents ?? 0) > 0}
				<div>
					<dt>Discount</dt>
					<dd class="mono">-{formatUsd(doc.discount_cents ?? 0)}</dd>
				</div>
			{/if}
			{#if (doc.tax_cents ?? 0) > 0}
				<div>
					<dt>Tax {doc.tax_percent}%</dt>
					<dd class="mono">{formatUsd(doc.tax_cents ?? 0)}</dd>
				</div>
			{/if}
			<div class="grand">
				<dt>Total, USD</dt>
				<dd class="mono">{formatUsd(doc.amount_cents)}</dd>
			</div>
			{#if doc.amount_paid_cents > 0}
				<div><dt>Received</dt><dd class="mono">{formatUsd(doc.amount_paid_cents)}</dd></div>
				<div class="grand">
					<dt>Balance due</dt>
					<dd class="mono">{formatUsd(outstanding(doc))}</dd>
				</div>
			{/if}
		</dl>

		{#if data.payments.length > 0}
			<section class="paid">
				<p class="label-mono">Payments received</p>
				<ul>
					{#each data.payments as payment (payment.id)}
						<li>
							<span class="mono">{formatDayYear(payment.paid_on)}</span>
							<span>{payment.method ?? 'Payment'}</span>
							<span class="mono">{formatUsd(payment.amount_cents)}</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if doc.message}
			<p class="message">{doc.message}</p>
		{/if}
	{:else}
		<table>
			<thead>
				<tr>
					<th scope="col">Number</th>
					<th scope="col">Issued</th>
					<th scope="col">For</th>
					<th scope="col">Due</th>
					<th scope="col" class="num">Balance</th>
				</tr>
			</thead>
			<tbody>
				{#each statementRows as inv (inv.id)}
					<tr>
						<td class="mono">{inv.invoice_number}</td>
						<td class="mono">{formatDayShort(inv.issue_date)}</td>
						<td>{inv.subcategory ?? inv.category ?? 'Invoice'}</td>
						<td class="mono">{formatDayShort(inv.due_date)}</td>
						<td class="num mono">{formatUsd(outstanding(inv))}</td>
					</tr>
				{:else}
					<tr><td colspan="5" class="none">Nothing outstanding.</td></tr>
				{/each}
			</tbody>
		</table>

		<dl class="totals">
			<div class="grand">
				<dt>Balance due, USD</dt>
				<dd class="mono">{formatUsd(statementTotal)}</dd>
			</div>
		</dl>
	{/if}

	<footer>
		<p>All amounts in USD. Raised from Command Center.</p>
	</footer>
</article>

<style>
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--surface-card);
		border-bottom: 1px solid var(--border-thin);
	}
	.bar button {
		padding: var(--space-2) var(--space-4);
		background: var(--navy);
		border: none;
		border-radius: var(--radius-sm);
		font: inherit;
		color: var(--text-inverse);
		cursor: pointer;
	}

	.sheet {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		max-width: 780px;
		margin: var(--space-6) auto;
		padding: var(--space-6);
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
	}

	header {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-bottom: var(--space-4);
		border-bottom: 2px solid var(--navy);
	}
	.brand {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--text-secondary);
	}
	.stamp {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-5);
		font-size: var(--text-sm);
	}
	.stamp dd {
		/* A definition list indents its dd by default, which reads as a mistake
		   on a document where the label sits directly above its value. */
		margin: 0;
	}
	.stamp dt {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--text-secondary);
	}

	.who {
		font-weight: var(--weight-semibold);
	}
	.to p {
		font-size: var(--text-sm);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}
	th {
		padding: var(--space-2);
		text-align: left;
		border-bottom: 1.5px solid var(--border-strong);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--text-secondary);
	}
	td {
		padding: var(--space-2);
		border-bottom: 1px solid var(--border-thin);
		vertical-align: top;
	}
	.num {
		text-align: right;
	}
	.none {
		color: var(--text-secondary);
	}

	.totals {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		align-self: flex-end;
		min-width: 300px;
		font-size: var(--text-sm);
	}
	.totals > div {
		display: flex;
		justify-content: space-between;
		gap: var(--space-4);
	}
	.totals dt {
		color: var(--text-secondary);
	}
	.grand {
		padding-top: var(--space-2);
		border-top: 1px solid var(--border-strong);
		font-weight: var(--weight-semibold);
	}
	.grand dt {
		color: var(--text-body);
	}

	.paid ul {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
		font-size: var(--text-sm);
	}
	.paid li {
		display: flex;
		gap: var(--space-4);
		padding: var(--space-1) 0;
	}

	.message {
		padding: var(--space-3);
		background: var(--surface-callout);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
	}
	.void-mark {
		padding: var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		font-weight: var(--weight-semibold);
	}

	footer {
		padding-top: var(--space-4);
		border-top: 1px solid var(--border-thin);
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	@media print {
		/* The controls are for the screen. They are not part of the document. */
		.bar {
			display: none;
		}
		.sheet {
			max-width: none;
			margin: 0;
			padding: 0;
			border: none;
			gap: 14pt;
		}
		header {
			border-bottom: 1.5pt solid #000;
		}
		h1 {
			font-size: 16pt;
		}
		table {
			font-size: 9pt;
		}
	}
</style>
