<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import {
		BILLING_SCHEDULES,
		INVOICE_KIND_LABELS,
		INVOICE_STATUS_LABELS,
		PAYMENT_TERMS,
		PERIOD_STATUS_LABELS,
		PERIOD_STATUS_TONE,
		REMINDER_CADENCES,
		SERVICE_CATALOGUE,
		TERM_DAYS,
		formatMoney,
		formatUsd,
		invoiceTotals,
		nextPeriodStatus,
		parseMoneyToCents
	} from '$lib/types';
	import type { BillingPeriod, DiscountKind, Invoice, InvoiceKind, TimeEntry } from '$lib/types';
	import { formatDay, formatDayShort, formatDayYear, formatMoment } from '$lib/format';
	import { buildComposeUrl } from '$lib/gmail-compose';
	import BillingAutomation from '$lib/components/BillingAutomation.svelte';
	import BillingPeriods from '$lib/components/BillingPeriods.svelte';
	import Button from '$lib/components/Button.svelte';
	import FormField from '$lib/components/FormField.svelte';
	import Input from '$lib/components/Input.svelte';
	import Select from '$lib/components/Select.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import Textarea from '$lib/components/Textarea.svelte';
	import type { PageData } from './$types';

	/**
	 * Invoicing, rebuilt around the client.
	 *
	 * The old screen listed billing periods and then every invoice in the firm,
	 * which answers "what is outstanding" and nothing else. The question actually
	 * being asked at this screen is about one client at a time: what have they
	 * been billed, what have they paid, what is late, and what goes out next. So
	 * the rail picks a client and everything to the right is that client.
	 *
	 * Two boundaries are load bearing and appear in the copy as well as the code:
	 *
	 *   Nothing here sends mail. The app holds no scope that could and registers
	 *   no route that could try, asserted in tests/layer2-no-send-surface.test.ts.
	 *   Marking an invoice sent records what Paul did; the message itself leaves
	 *   through a prefilled Gmail compose window he presses Send in.
	 *
	 *   Money is never asserted twice. A total is the sum of its lines, computed
	 *   by invoiceTotals, which the server imports too. The form previewing one
	 *   number while the database stores another is the failure this shares one
	 *   function to prevent.
	 */

	let { data }: { data: PageData } = $props();

	const client = $derived(data.detail?.client ?? null);
	const money = $derived(data.detail?.money ?? null);
	const invoices = $derived(data.detail?.invoices ?? []);
	const periods = $derived(data.detail?.periods ?? []);
	const archived = $derived(client?.status === 'archived');

	let busy = $state(false);
	let notice = $state('');
	let errorMessage = $state('');

	/** Rail filter, invoice filter and invoice search are all local to a view. */
	let clientSearch = $state('');
	let invoiceSearch = $state('');
	let bucketFilter = $state<'all' | 'overdue' | 'open' | 'paid' | 'other'>('all');

	let expandedInvoice = $state<string | null>(null);
	let expandedPeriod = $state<string | null>(null);
	let entries = $state<Record<string, TimeEntry[]>>({});
	let entriesError = $state('');

	let showNewClient = $state(false);
	let editingProfile = $state(false);
	let showMore = $state(false);
	let showStatement = $state(false);
	let payFor = $state<string | null>(null);

	async function send(path: string, method: string, body: unknown, message: string) {
		busy = true;
		errorMessage = '';
		try {
			const res = await fetch(path, {
				method,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			const payload = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
				error?: string;
				trail_error?: string | null;
				posting_error?: string | null;
			};
			if (!res.ok) {
				errorMessage = payload.error ?? 'The request failed.';
				return null;
			}
			await invalidateAll();
			// A payment that saved but did not post, or a change that saved but did
			// not reach the trail, is reported rather than swallowed. Both are the
			// kind of half success that otherwise shows up weeks later as a number
			// nobody can explain.
			const partial = payload.posting_error || payload.trail_error;
			notice = partial ? `${message} ${partial}` : message;
			return payload;
		} catch {
			errorMessage = 'Could not reach the server.';
			return null;
		} finally {
			busy = false;
		}
	}

	// --- The rail ------------------------------------------------------------

	const railRows = $derived(
		data.clients
			.filter((c) => c.name.toLowerCase().includes(clientSearch.trim().toLowerCase()))
			// Archived clients keep their history and stop competing for attention,
			// so they sort last rather than disappearing.
			.slice()
			.sort((a, b) => (a.status === 'archived' ? 1 : 0) - (b.status === 'archived' ? 1 : 0))
	);

	function railHref(id: string) {
		return `/invoices?client=${encodeURIComponent(id)}&tab=${data.tab}`;
	}

	function tabHref(tab: string) {
		return data.selectedId
			? `/invoices?client=${encodeURIComponent(data.selectedId)}&tab=${tab}`
			: `/invoices?tab=${tab}`;
	}

	// --- One client's documents ----------------------------------------------

	type Bucket = 'overdue' | 'open' | 'paid' | 'other';

	/**
	 * Which pile a document belongs to.
	 *
	 * Estimates, credit notes and voided invoices are one pile called other,
	 * because none of them is money owed. Keeping them on the screen but out of
	 * the three money buckets is the whole point: they are documents that exist
	 * and are not receivables.
	 */
	function bucketOf(inv: Invoice): Bucket {
		if (inv.voided_at || (inv.kind && inv.kind !== 'invoice')) return 'other';
		if ((inv.amount_paid_cents ?? 0) >= inv.amount_cents) return 'paid';
		return inv.is_overdue === 1 ? 'overdue' : 'open';
	}

	function weightOf(inv: Invoice, bucket: Bucket) {
		if (bucket === 'paid') return inv.amount_paid_cents;
		if (bucket === 'other') return inv.amount_cents;
		return inv.amount_cents - inv.amount_paid_cents;
	}

	const buckets = $derived.by(() => {
		const totals: Record<Bucket, { cents: number; count: number }> = {
			overdue: { cents: 0, count: 0 },
			open: { cents: 0, count: 0 },
			paid: { cents: 0, count: 0 },
			other: { cents: 0, count: 0 }
		};
		for (const inv of invoices) {
			const bucket = bucketOf(inv);
			totals[bucket].cents += weightOf(inv, bucket);
			totals[bucket].count += 1;
		}
		return totals;
	});

	const barTotal = $derived(buckets.overdue.cents + buckets.open.cents + buckets.paid.cents);

	const visibleInvoices = $derived.by(() => {
		const q = invoiceSearch.trim().toLowerCase();
		return invoices.filter((inv) => {
			if (bucketFilter !== 'all' && bucketOf(inv) !== bucketFilter) return false;
			if (!q) return true;
			return `${inv.invoice_number} ${inv.category ?? ''} ${inv.subcategory ?? ''}`
				.toLowerCase()
				.includes(q);
		});
	});

	/**
	 * Quantity and rate for a document with no line items.
	 *
	 * The 900 invoices raised before migration 0024 have no breakdown. Rather
	 * than an empty column, the row shows the billable hours of the billing
	 * period it came from, which is the number the invoice was raised against,
	 * and says where it came from in the expanded view. Nothing is invented: an
	 * invoice with no period shows nothing.
	 */
	function quantityOf(inv: Invoice): string {
		const items = inv.items ?? [];
		if (items.length > 0) return items.reduce((sum, i) => sum + i.quantity, 0).toFixed(2);
		return inv.period_hours ? inv.period_hours.toFixed(2) : '';
	}

	function rateOf(inv: Invoice): string {
		const items = inv.items ?? [];
		if (items.length > 0) {
			const rates = new Set(items.map((i) => i.unit_rate_cents));
			return rates.size > 1 ? 'mixed' : formatUsd([...rates][0]);
		}
		if (inv.period_hours && inv.period_hours > 0) {
			return `${formatUsd(Math.round(inv.amount_cents / inv.period_hours))} est`;
		}
		return '';
	}

	function statusLabel(inv: Invoice): string {
		if (inv.voided_at) return 'Void';
		if (inv.kind && inv.kind !== 'invoice') return INVOICE_KIND_LABELS[inv.kind];
		if (inv.is_overdue === 1) return 'Overdue';
		return INVOICE_STATUS_LABELS[inv.status];
	}

	function statusTone(inv: Invoice) {
		if (inv.voided_at) return 'waiting' as const;
		if (inv.kind && inv.kind !== 'invoice') return 'blocked' as const;
		if (inv.is_overdue === 1) return 'overdue' as const;
		if (inv.status === 'paid') return 'done' as const;
		if (inv.status === 'partial') return 'atrisk' as const;
		if (inv.status === 'sent') return 'waiting' as const;
		return 'open' as const;
	}

	function toggleInvoice(id: string) {
		expandedInvoice = expandedInvoice === id ? null : id;
	}

	// --- Time entries, kept from the screen this replaced ---------------------

	async function togglePeriod(periodId: string) {
		if (expandedPeriod === periodId) {
			expandedPeriod = null;
			return;
		}
		expandedPeriod = periodId;
		entriesError = '';
		if (entries[periodId]) return;
		try {
			const res = await fetch(`/api/invoicing/periods/${periodId}/entries`);
			const payload = (await res.json().catch(() => null)) as
				| { entries?: TimeEntry[]; error?: string }
				| null;
			if (!res.ok || !payload) {
				entriesError = payload?.error ?? 'Could not load the time entries.';
				return;
			}
			entries[periodId] = payload.entries ?? [];
		} catch {
			entriesError = 'Could not reach the server.';
		}
	}

	async function advancePeriod(period: BillingPeriod) {
		const next = nextPeriodStatus(period.status);
		if (!next) return;
		await send(
			`/api/invoicing/periods/${period.id}`,
			'PATCH',
			{ status: next },
			`Period marked ${PERIOD_STATUS_LABELS[next].toLowerCase()}.`
		);
	}

	// --- The client profile ---------------------------------------------------

	let profileDraft = $state({
		name: '',
		contact_name: '',
		contact_email: '',
		contact_phone: '',
		billing_address: '',
		billing_terms: '',
		billing_schedule: '',
		rate: ''
	});

	function startEditProfile() {
		if (!client) return;
		profileDraft = {
			name: client.name,
			contact_name: client.contact_name ?? '',
			contact_email: client.contact_email ?? '',
			contact_phone: client.contact_phone ?? '',
			billing_address: client.billing_address ?? '',
			billing_terms: client.billing_terms ?? '',
			billing_schedule: client.billing_schedule ?? '',
			rate: client.default_rate_cents ? formatMoney(client.default_rate_cents) : ''
		};
		editingProfile = true;
	}

	async function saveProfile(event: SubmitEvent) {
		event.preventDefault();
		if (!client) return;
		const ok = await send(
			`/api/invoicing/clients/${client.id}/billing`,
			'PATCH',
			{
				name: profileDraft.name,
				contact_name: profileDraft.contact_name,
				contact_email: profileDraft.contact_email,
				contact_phone: profileDraft.contact_phone,
				billing_address: profileDraft.billing_address,
				billing_terms: profileDraft.billing_terms,
				billing_schedule: profileDraft.billing_schedule,
				default_rate_cents: profileDraft.rate
			},
			'Client details saved.'
		);
		if (ok) editingProfile = false;
	}

	async function toggleArchive() {
		if (!client) return;
		const next = archived ? 'active' : 'archived';
		await send(
			`/api/invoicing/clients/${client.id}/billing`,
			'PATCH',
			{ status: next },
			next === 'archived'
				? 'Client archived. Everything stays readable.'
				: 'Client reactivated.'
		);
	}

	/**
	 * Notes save when typing stops, not on a button.
	 *
	 * A note nobody remembered to save is a note that was never written. The
	 * debounce is long enough that a sentence is one request rather than thirty.
	 */
	let noteTimer: ReturnType<typeof setTimeout> | null = null;
	let noteDraft = $state<string | null>(null);
	const noteValue = $derived(noteDraft ?? client?.notes ?? '');

	function onNotes(value: string) {
		noteDraft = value;
		if (noteTimer) clearTimeout(noteTimer);
		noteTimer = setTimeout(async () => {
			if (!client) return;
			await send(
				`/api/invoicing/clients/${client.id}/billing`,
				'PATCH',
				{ notes: value },
				'Notes saved.'
			);
			noteDraft = null;
		}, 800);
	}

	// --- A new client ---------------------------------------------------------

	let newClient = $state({
		name: '',
		contact_name: '',
		contact_email: '',
		contact_phone: '',
		billing_address: '',
		rate: '',
		billing_terms: 'Net 15',
		billing_schedule: 'Monthly'
	});

	async function createClient(event: SubmitEvent) {
		event.preventDefault();
		if (!newClient.name.trim()) {
			errorMessage = 'A client name is required.';
			return;
		}
		const payload = await send(
			'/api/invoicing/clients',
			'POST',
			{ ...newClient, default_rate_cents: newClient.rate },
			'Client created.'
		);
		if (payload) {
			showNewClient = false;
			newClient = {
				name: '',
				contact_name: '',
				contact_email: '',
				contact_phone: '',
				billing_address: '',
				rate: '',
				billing_terms: 'Net 15',
				billing_schedule: 'Monthly'
			};
		}
	}

	// --- Documents ------------------------------------------------------------

	interface DraftLine {
		service: string;
		description: string;
		quantity: string;
		rate: string;
	}

	interface DocumentForm {
		mode: 'create' | 'edit';
		id: string | null;
		kind: InvoiceKind;
		recurring: boolean;
		frequency: string;
		invoice_number: string;
		issue_date: string;
		due_date: string;
		status: string;
		category: string;
		subcategory: string;
		message: string;
		discount_kind: '' | DiscountKind;
		discount_value: string;
		tax_percent: string;
		items: DraftLine[];
	}

	let form = $state<DocumentForm | null>(null);

	function blankLine(): DraftLine {
		return {
			service: SERVICE_CATALOGUE[0],
			description: '',
			quantity: '1',
			rate: client?.default_rate_cents ? formatMoney(client.default_rate_cents) : ''
		};
	}

	function addDays(day: string, days: number) {
		const date = new Date(`${day}T00:00:00Z`);
		date.setUTCDate(date.getUTCDate() + days);
		return date.toISOString().slice(0, 10);
	}

	async function openForm(kind: InvoiceKind, recurring = false) {
		showMore = false;
		showStatement = false;
		payFor = null;
		const terms = client?.billing_terms ?? 'Net 15';
		const res = await fetch(`/api/invoicing/next-number?kind=${kind}`);
		const suggested = res.ok
			? ((await res.json()) as { invoice_number: string }).invoice_number
			: '';
		form = {
			mode: 'create',
			id: null,
			kind,
			recurring,
			frequency: client?.auto_frequency ?? 'Monthly',
			invoice_number: suggested,
			issue_date: data.today,
			due_date: addDays(data.today, TERM_DAYS[terms] ?? 15),
			status: 'draft',
			category: '',
			subcategory: '',
			message: '',
			discount_kind: '',
			discount_value: '0',
			tax_percent: '0',
			items: [blankLine()]
		};
	}

	function editDocument(inv: Invoice) {
		showMore = false;
		payFor = null;
		form = {
			mode: 'edit',
			id: inv.id,
			kind: inv.kind ?? 'invoice',
			recurring: Boolean(inv.recurring_frequency),
			frequency: inv.recurring_frequency ?? 'Monthly',
			invoice_number: inv.invoice_number,
			issue_date: inv.issue_date,
			due_date: inv.due_date,
			status: inv.status,
			category: inv.category ?? '',
			subcategory: inv.subcategory ?? '',
			message: inv.message ?? '',
			discount_kind: (inv.discount_kind as DiscountKind | null) ?? '',
			discount_value:
				inv.discount_kind === 'amount'
					? formatMoney(inv.discount_value ?? 0)
					: String(inv.discount_value ?? 0),
			tax_percent: String(inv.tax_percent ?? 0),
			items:
				(inv.items ?? []).length > 0
					? (inv.items ?? []).map((item) => ({
							service: item.service,
							description: item.description ?? '',
							quantity: String(item.quantity),
							rate: formatMoney(item.unit_rate_cents)
						}))
					: [
							{
								// An invoice with no breakdown opens with its own total as one
								// line, so editing it does not silently rewrite the amount.
								service: SERVICE_CATALOGUE[0],
								description: inv.subcategory ?? 'As previously invoiced',
								quantity: '1',
								rate: formatMoney(inv.amount_cents)
							}
						]
		};
	}

	/** The form's own arithmetic, from the function the server uses. */
	const formTotals = $derived.by(() => {
		if (!form) return null;
		const lines = form.items.map((item) => ({
			quantity: Number(item.quantity) || 0,
			unit_rate_cents: parseMoneyToCents(item.rate || '0') ?? 0
		}));
		const discountValue =
			form.discount_kind === 'amount'
				? (parseMoneyToCents(form.discount_value || '0') ?? 0)
				: Number(form.discount_value) || 0;
		return invoiceTotals(
			lines,
			form.discount_kind === '' ? null : form.discount_kind,
			discountValue,
			Number(form.tax_percent) || 0
		);
	});

	async function saveDocument(event: SubmitEvent) {
		event.preventDefault();
		if (!form || !client) return;

		const body = {
			client_id: client.id,
			kind: form.kind,
			invoice_number: form.invoice_number,
			issue_date: form.issue_date,
			due_date: form.due_date,
			status: form.status,
			category: form.category,
			subcategory: form.subcategory,
			message: form.message,
			discount_kind: form.discount_kind === '' ? null : form.discount_kind,
			discount_value: form.discount_value,
			tax_percent: form.tax_percent,
			recurring_frequency: form.recurring ? form.frequency : null,
			items: form.items.map((item) => ({
				service: item.service,
				description: item.description,
				quantity: item.quantity,
				rate: item.rate
			}))
		};

		// The noun keeps its capital: it opens the sentence.
		const noun = INVOICE_KIND_LABELS[form.kind];
		const payload =
			form.mode === 'create'
				? await send('/api/invoicing/invoices', 'POST', body, `${noun} saved.`)
				: await send(
						`/api/invoicing/invoices/${form.id}/document`,
						'PATCH',
						body,
						`${noun} updated.`
					);
		if (payload) {
			expandedInvoice = (payload.invoice as Invoice | undefined)?.id ?? expandedInvoice;
			form = null;
		}
	}

	// --- Row actions ----------------------------------------------------------

	async function markSent(inv: Invoice) {
		await send(
			`/api/invoicing/invoices/${inv.id}/document`,
			'PATCH',
			{ status: 'sent' },
			`${inv.invoice_number} marked as sent.`
		);
	}

	async function logReminder(inv: Invoice) {
		await send(
			`/api/invoicing/invoices/${inv.id}/events`,
			'POST',
			{
				kind: 'reminded',
				detail: `Reminder sent by hand to ${client?.contact_email ?? 'the billing contact'}.`,
				occurred_at: data.today
			},
			'Reminder recorded on the invoice.'
		);
	}

	async function duplicate(inv: Invoice) {
		const payload = await send(
			`/api/invoicing/invoices/${inv.id}/copy`,
			'POST',
			{ as: inv.kind ?? 'invoice' },
			`Copied ${inv.invoice_number}.`
		);
		if (payload) expandedInvoice = (payload.invoice as Invoice | undefined)?.id ?? null;
	}

	async function convert(inv: Invoice) {
		const payload = await send(
			`/api/invoicing/invoices/${inv.id}/copy`,
			'POST',
			{ as: 'invoice', convert: true },
			`${inv.invoice_number} converted into an invoice.`
		);
		if (payload) expandedInvoice = (payload.invoice as Invoice | undefined)?.id ?? null;
	}

	async function voidDocument(inv: Invoice) {
		await send(
			`/api/invoicing/invoices/${inv.id}/void`,
			'POST',
			{},
			`${inv.invoice_number} voided.`
		);
	}

	/**
	 * The message, opened in Gmail with everything already in it.
	 *
	 * Built in the browser from what is already on the page. If it were built on
	 * the server the body would travel through a request and could land in a log,
	 * which is the one way this could quietly become a place mail is recorded.
	 * D89, and the same reasoning as the mail screen.
	 */
	function composeHref(inv: Invoice) {
		const due = formatDay(inv.due_date);
		const outstanding = inv.amount_cents - inv.amount_paid_cents;
		return buildComposeUrl({
			authuser: null,
			to: client?.contact_email ?? '',
			cc: client?.billing_cc ?? undefined,
			subject: `${inv.invoice_number} from Command Center`,
			body:
				`Hello${client?.contact_name ? ` ${client.contact_name.split(' ')[0]}` : ''},\n\n` +
				`${inv.invoice_number} is for ${formatUsd(inv.amount_cents)}, due ${due}.` +
				(outstanding !== inv.amount_cents
					? ` ${formatUsd(outstanding)} of it is still outstanding.`
					: '') +
				`\n\n${inv.message ?? 'The breakdown is on the invoice itself.'}\n\nThank you.`
		});
	}

	// --- Payments -------------------------------------------------------------

	let payDraft = $state({ invoice_id: '', amount: '', method: 'Wire transfer', paid_on: '' });

	function openPayment(invoiceId?: string) {
		showMore = false;
		form = null;
		showStatement = false;
		const target = invoiceId
			? invoices.find((i) => i.id === invoiceId)
			: invoices.find((i) => bucketOf(i) === 'overdue' || bucketOf(i) === 'open');
		payDraft = {
			invoice_id: target?.id ?? '',
			amount: target ? formatMoney(target.amount_cents - target.amount_paid_cents) : '',
			method: 'Wire transfer',
			paid_on: data.today
		};
		payFor = 'open';
	}

	function onPayInvoiceChange(id: string) {
		const target = invoices.find((i) => i.id === id);
		payDraft.invoice_id = id;
		if (target) payDraft.amount = formatMoney(target.amount_cents - target.amount_paid_cents);
	}

	async function savePayment(event: SubmitEvent) {
		event.preventDefault();
		if (!payDraft.invoice_id) {
			errorMessage = 'Choose the invoice the money came in against.';
			return;
		}
		const payload = await send(
			`/api/invoicing/invoices/${payDraft.invoice_id}/payments`,
			'POST',
			{ amount: payDraft.amount, paid_on: payDraft.paid_on, method: payDraft.method },
			'Payment recorded and posted to the ledger.'
		);
		if (payload) payFor = null;
	}

	const payable = $derived(
		invoices.filter((i) => !i.voided_at && (!i.kind || i.kind === 'invoice') && i.status !== 'paid')
	);

	// --- Automation -----------------------------------------------------------

	async function setAutomation(patch: Record<string, unknown>, message: string) {
		if (!client) return;
		await send(`/api/invoicing/clients/${client.id}/billing`, 'PATCH', patch, message);
	}

	async function raiseRecurringNow() {
		if (!client) return;
		const payload = await send(
			'/api/invoicing/recurring/raise',
			'POST',
			{ client_id: client.id },
			'Checked the recurring schedule.'
		);
		if (payload) {
			const raised = (payload.raised as string[] | undefined) ?? [];
			notice = raised.length
				? `Raised ${raised.join(', ')} as a draft. Nothing was sent.`
				: 'Nothing is due yet on this schedule.';
		}
	}

	// --- The statement --------------------------------------------------------

	const statementRows = $derived(
		invoices.filter((inv) => bucketOf(inv) === 'overdue' || bucketOf(inv) === 'open')
	);
	const statementTotal = $derived(
		statementRows.reduce((sum, inv) => sum + (inv.amount_cents - inv.amount_paid_cents), 0)
	);
</script>

<svelte:head>
	<title>Invoicing | Command Center</title>
</svelte:head>

<header class="head">
	<div>
		<h1>Invoicing</h1>
		<p class="sub">
			Hours in, invoices out, and what is still owed. All amounts in USD. Nothing on this screen
			sends mail.
		</p>
	</div>
	<Button
		onclick={() => {
			showNewClient = !showNewClient;
			form = null;
		}}
	>
		{showNewClient ? 'Cancel' : 'New client'}
	</Button>
</header>

<p class="status-line" role="status" aria-live="polite">{notice}</p>

{#if errorMessage}
	<p class="error-banner" role="alert">{errorMessage}</p>
{/if}

<!-- The four figures, computed over every invoice rather than the rows on
     screen. A total that only counts what is visible is a different number
     wearing the same label. -->
<section class="tiles" aria-label="Invoicing totals">
	<div class="tile">
		<p class="label-mono">Total invoiced</p>
		<p class="tile-amount mono">{formatUsd(data.headline.invoiced_cents)}</p>
		<p class="tile-note mono">{data.headline.invoice_count} invoices</p>
	</div>
	<div class="tile accent-navy">
		<p class="label-mono">Available to collect</p>
		<p class="tile-amount mono">{formatUsd(data.headline.collectable_cents)}</p>
		<p class="tile-note mono">{data.headline.open_count} open</p>
	</div>
	<div class="tile accent-gold">
		<p class="label-mono">Overdue</p>
		<p class="tile-amount mono">{formatUsd(data.headline.overdue_cents)}</p>
		<p class="tile-note mono">{data.headline.overdue_count} past due</p>
	</div>
	<div class="tile accent-green">
		<p class="label-mono">Collected in {data.headline.month_label}</p>
		<p class="tile-amount mono">{formatUsd(data.headline.collected_month_cents)}</p>
		<p class="tile-note mono">
			{data.headline.collected_month_count} payment{data.headline.collected_month_count === 1
				? ''
				: 's'} recorded
		</p>
	</div>
</section>

<div class="split">
	<aside class="rail" aria-label="Clients">
		<div class="rail-search">
			<label class="visually-hidden" for="client-search">Search clients</label>
			<Input id="client-search" bind:value={clientSearch} placeholder="Search clients" />
		</div>
		<ul class="rail-list">
			{#each railRows as row (row.id)}
				<li>
					<a
						class="rail-row"
						class:current={row.id === data.selectedId}
						href={railHref(row.id)}
						aria-current={row.id === data.selectedId ? 'true' : undefined}
					>
						<span class="rail-top">
							<span class="rail-name">{row.name}</span>
							{#if row.status === 'archived'}
								<StatusChip tone="blocked" label="Archived" size="sm" />
							{:else if row.overdue_cents > 0}
								<StatusChip tone="overdue" label="Overdue" size="sm" />
							{:else}
								<StatusChip tone="ontrack" label="Current" size="sm" />
							{/if}
						</span>
						<span class="rail-bottom mono">
							<span class="rail-balance">{formatUsd(row.open_cents)}</span>
							<span class="rail-word">open</span>
							<span class="rail-count">{row.invoice_count} inv</span>
						</span>
					</a>
				</li>
			{:else}
				<li class="rail-empty">No client matches that.</li>
			{/each}
		</ul>
	</aside>

	<div class="detail">
		{#if showNewClient}
			<section class="panel">
				<h2>New client</h2>
				<p class="panel-sub">
					A client account holds the billing profile and every document raised against it. Nothing
					is billed until an invoice is raised.
				</p>
				<form onsubmit={createClient}>
					<div class="grid-3">
						<FormField label="Client name">
							<Input bind:value={newClient.name} maxlength={200} required />
						</FormField>
						<FormField label="Contact person">
							<Input bind:value={newClient.contact_name} maxlength={200} />
						</FormField>
						<FormField label="Email">
							<Input bind:value={newClient.contact_email} type="email" mono maxlength={200} />
						</FormField>
						<FormField label="Phone">
							<Input bind:value={newClient.contact_phone} mono maxlength={60} />
						</FormField>
						<FormField label="Billing address">
							<Input bind:value={newClient.billing_address} maxlength={500} />
						</FormField>
						<FormField label="Hourly rate" hint="Plain numbers, for example 150.00">
							<Input bind:value={newClient.rate} mono />
						</FormField>
						<FormField label="Payment terms">
							<Select bind:value={newClient.billing_terms}>
								{#each PAYMENT_TERMS as term (term)}
									<option value={term}>{term}</option>
								{/each}
							</Select>
						</FormField>
						<FormField label="Billing schedule">
							<Select bind:value={newClient.billing_schedule}>
								{#each BILLING_SCHEDULES as schedule (schedule)}
									<option value={schedule}>{schedule}</option>
								{/each}
							</Select>
						</FormField>
					</div>
					<div class="form-actions">
						<Button type="submit" disabled={busy}>Create client</Button>
						<Button variant="ghost" onclick={() => (showNewClient = false)}>Cancel</Button>
					</div>
				</form>
			</section>
		{/if}

		{#if !client}
			<p class="empty">No clients yet. Create one to raise the first invoice.</p>
		{:else}
			<section class="panel">
				<div class="panel-head">
					<div>
						<div class="name-row">
							<h2>{client.name}</h2>
							{#if archived}
								<StatusChip tone="blocked" label="Archived" size="sm" />
							{:else if (money?.overdue_cents ?? 0) > 0}
								<StatusChip tone="overdue" label="Overdue" size="sm" />
							{:else}
								<StatusChip tone="ontrack" label="Current" size="sm" />
							{/if}
						</div>
						<p class="panel-sub mono">
							Client since {formatDayYear(client.created_at.slice(0, 10))}
							{#if client.billing_schedule}
								<span class="sep">·</span>{client.billing_schedule}
							{/if}
						</p>
					</div>
					{#if !editingProfile}
						<div class="panel-actions">
							<Button variant="secondary" size="sm" onclick={startEditProfile}>Edit details</Button>
							<Button variant="ghost" size="sm" disabled={busy} onclick={toggleArchive}>
								{archived ? 'Reactivate' : 'Archive client'}
							</Button>
						</div>
					{/if}
				</div>

				{#if editingProfile}
					<form class="profile-form" onsubmit={saveProfile}>
						<div class="grid-3">
							<FormField label="Client name">
								<Input bind:value={profileDraft.name} maxlength={200} required />
							</FormField>
							<FormField label="Contact person">
								<Input bind:value={profileDraft.contact_name} maxlength={200} />
							</FormField>
							<FormField label="Email">
								<Input bind:value={profileDraft.contact_email} type="email" mono maxlength={200} />
							</FormField>
							<FormField label="Phone">
								<Input bind:value={profileDraft.contact_phone} mono maxlength={60} />
							</FormField>
							<FormField label="Billing address">
								<Input bind:value={profileDraft.billing_address} maxlength={500} />
							</FormField>
							<FormField label="Hourly rate" hint="Empty means no standing rate">
								<Input bind:value={profileDraft.rate} mono />
							</FormField>
							<FormField label="Payment terms">
								<Select bind:value={profileDraft.billing_terms}>
									<option value="">Not set</option>
									{#each PAYMENT_TERMS as term (term)}
										<option value={term}>{term}</option>
									{/each}
								</Select>
							</FormField>
							<FormField label="Billing schedule">
								<Select bind:value={profileDraft.billing_schedule}>
									<option value="">Not set</option>
									{#each BILLING_SCHEDULES as schedule (schedule)}
										<option value={schedule}>{schedule}</option>
									{/each}
								</Select>
							</FormField>
						</div>
						<div class="form-actions">
							<Button type="submit" size="sm" disabled={busy}>Save</Button>
							<Button variant="ghost" size="sm" onclick={() => (editingProfile = false)}>
								Cancel
							</Button>
						</div>
					</form>
				{:else}
					<dl class="facts">
						<div>
							<dt class="label-mono">Contact</dt>
							<dd>{client.contact_name ?? 'Not set'}</dd>
						</div>
						<div>
							<dt class="label-mono">Email</dt>
							<dd class="mono">{client.contact_email ?? 'Not set'}</dd>
						</div>
						<div>
							<dt class="label-mono">Phone</dt>
							<dd class="mono">{client.contact_phone ?? 'Not set'}</dd>
						</div>
						<div>
							<dt class="label-mono">Billing address</dt>
							<dd>{client.billing_address ?? 'Not set'}</dd>
						</div>
						<div>
							<dt class="label-mono">Payment terms</dt>
							<dd>{client.billing_terms ?? 'Not set'}</dd>
						</div>
						<div>
							<dt class="label-mono">Hourly rate</dt>
							<dd class="mono">
								{client.default_rate_cents
									? `${formatUsd(client.default_rate_cents)} per hour`
									: 'No standing rate'}
							</dd>
						</div>
					</dl>
				{/if}

				<div class="stats">
					<div class="stat">
						<p class="label-mono">Open balance</p>
						<p class="stat-amount mono">{formatUsd(money?.open_cents ?? 0)}</p>
					</div>
					<div class="stat">
						<p class="label-mono">Overdue</p>
						<p class="stat-amount mono" class:warn={(money?.overdue_cents ?? 0) > 0}>
							{formatUsd(money?.overdue_cents ?? 0)}
						</p>
					</div>
					<div class="stat">
						<p class="label-mono">Collected this year</p>
						<p class="stat-amount mono good">{formatUsd(money?.collected_year_cents ?? 0)}</p>
						<p class="stat-note mono">
							{money?.collected_year_count ?? 0} payment{(money?.collected_year_count ?? 0) === 1
								? ''
								: 's'}
						</p>
					</div>
					<div class="stat">
						<p class="label-mono">Average days to pay</p>
						<p class="stat-amount mono">
							{money?.avg_days_to_pay === null || money?.avg_days_to_pay === undefined
								? 'No data'
								: `${money.avg_days_to_pay} d`}
						</p>
						<p class="stat-note mono">From issue to settled</p>
					</div>
				</div>

				<div class="notes">
					<label class="label-mono" for="client-notes">Notes</label>
					<Textarea
						id="client-notes"
						value={noteValue}
						oninput={(e) => onNotes((e.currentTarget as HTMLTextAreaElement).value)}
						rows={2}
						maxlength={4000}
						placeholder="Anything worth remembering about billing this client. Saved as you stop typing."
					/>
				</div>
			</section>

			{#if archived}
				<div class="callout">
					<p>
						This client is archived. Everything stays readable, and nothing new should be raised
						until it is reactivated.
					</p>
					<Button variant="secondary" size="sm" disabled={busy} onclick={toggleArchive}>
						Reactivate
					</Button>
				</div>
			{/if}

			<nav class="tabs" aria-label="Client views">
				<a class="tab" class:current={data.tab === 'overview'} href={tabHref('overview')}>
					Invoices
				</a>
				<a class="tab" class:current={data.tab === 'time'} href={tabHref('time')}>
					Time and periods
				</a>
				<a class="tab" class:current={data.tab === 'automation'} href={tabHref('automation')}>
					Automation
				</a>
			</nav>

			{#if data.tab === 'automation'}
				<section class="panel">
					<h2>Automation</h2>
					<p class="panel-sub">
						What this app is allowed to do on its own. It cannot mail your client, so the furthest it
						goes is raising a draft and putting a prompt in your digest.
					</p>
					<BillingAutomation
						{client}
						{busy}
						onSet={setAutomation}
						onRaise={raiseRecurringNow}
					/>
				</section>
			{:else if data.tab === 'time'}
				<section class="panel">
					<h2>Time and periods</h2>
					<p class="panel-sub">
						The hours behind the invoices. A period gathers time entries; an invoice is raised from
						what the period counted.
					</p>
					<BillingPeriods
						{periods}
						{entries}
						expanded={expandedPeriod}
						error={entriesError}
						{busy}
						onToggle={togglePeriod}
						onAdvance={advancePeriod}
					/>
				</section>
			{:else}
				<section class="panel documents">
					<div class="panel-head">
						<div class="name-row">
							<h2>Documents</h2>
							<span class="count mono">{invoices.length} in total</span>
						</div>
						{#if !archived}
							<div class="panel-actions">
								<Button size="sm" onclick={() => openForm('invoice')}>New invoice</Button>
								<div class="menu-wrap">
									<Button
										variant="secondary"
										size="sm"
										aria-expanded={showMore}
										onclick={() => (showMore = !showMore)}
									>
										More
									</Button>
									{#if showMore}
										<div class="menu">
											<button type="button" onclick={() => openPayment()}>Record payment</button>
											<button type="button" onclick={() => openForm('estimate')}>
												New estimate
											</button>
											<button type="button" onclick={() => openForm('credit')}>
												New credit note
											</button>
											<button type="button" onclick={() => openForm('invoice', true)}>
												New recurring invoice
											</button>
											<button
												type="button"
												onclick={() => {
													showStatement = true;
													showMore = false;
													form = null;
												}}
											>
												Statement of account
											</button>
										</div>
									{/if}
								</div>
							</div>
						{/if}
					</div>

					<!-- One bar, three piles, in proportion. Clicking a segment filters
					     the list to it, so the picture and the rows agree. -->
					{#if barTotal > 0}
						<div class="bar" aria-hidden="true">
							{#each [['overdue', buckets.overdue.cents], ['open', buckets.open.cents], ['paid', buckets.paid.cents]] as [name, cents] (name)}
								{#if (cents as number) > 0}
									<span
										class="seg seg-{name}"
										style="width: {(((cents as number) / barTotal) * 100).toFixed(1)}%"
									></span>
								{/if}
							{/each}
						</div>
					{/if}

					<div class="filters">
						<div class="chips" role="group" aria-label="Filter documents">
							{#each [['all', 'All', invoices.length, buckets.overdue.cents + buckets.open.cents + buckets.paid.cents], ['overdue', 'Overdue', buckets.overdue.count, buckets.overdue.cents], ['open', 'Open, not due', buckets.open.count, buckets.open.cents], ['paid', 'Paid', buckets.paid.count, buckets.paid.cents], ['other', 'Estimates and voids', buckets.other.count, buckets.other.cents]] as [key, label, count, cents] (key)}
								<button
									type="button"
									class="chip-btn chip-{key}"
									class:on={bucketFilter === key}
									aria-pressed={bucketFilter === key}
									onclick={() => (bucketFilter = key as typeof bucketFilter)}
								>
									<span class="dot" aria-hidden="true"></span>
									{label}
									<span class="chip-amount mono">{formatUsd(cents as number)}</span>
									<span class="chip-count mono">{count}</span>
								</button>
							{/each}
						</div>
						<div class="filter-search">
							<label class="visually-hidden" for="invoice-search">Search documents</label>
							<Input
								id="invoice-search"
								bind:value={invoiceSearch}
								placeholder="Search number or category"
							/>
						</div>
					</div>

					{#if showStatement}
						<div class="inset">
							<div class="inset-head">
								<p class="label-mono">Statement of account, {formatDay(data.today)}</p>
								<div class="inset-actions">
									<Button
										variant="secondary"
										size="sm"
										href="/invoices/print?client={client.id}"
										target="_blank"
										rel="noopener"
									>
										Print or save as PDF
									</Button>
									<Button variant="ghost" size="sm" onclick={() => (showStatement = false)}>
										Close
									</Button>
								</div>
							</div>
							{#if statementRows.length === 0}
								<p class="entries-note">Nothing outstanding. There is no statement to render.</p>
							{:else}
								<ul class="statement">
									{#each statementRows as inv (inv.id)}
										<li>
											<span class="mono s-number">{inv.invoice_number}</span>
											<span class="mono s-date">{formatDayShort(inv.issue_date)}</span>
											<span class="s-desc">{inv.subcategory ?? inv.category ?? 'Invoice'}</span>
											<span class="mono s-due">due {formatDayShort(inv.due_date)}</span>
											<span class="mono s-amount">
												{formatUsd(inv.amount_cents - inv.amount_paid_cents)}
											</span>
										</li>
									{/each}
								</ul>
								<p class="statement-total">
									<span>Balance due</span>
									<span class="mono">{formatUsd(statementTotal)}</span>
								</p>
							{/if}
						</div>
					{/if}

					{#if payFor}
						<form class="inset" onsubmit={savePayment}>
							<p class="label-mono">Record payment</p>
							<div class="grid-4">
								<FormField label="Invoice">
									<Select
										value={payDraft.invoice_id}
										onchange={(e) =>
											onPayInvoiceChange((e.currentTarget as HTMLSelectElement).value)}
									>
										<option value="">Choose an invoice</option>
										{#each payable as inv (inv.id)}
											<option value={inv.id}>
												{inv.invoice_number} · {formatUsd(inv.amount_cents - inv.amount_paid_cents)}
												outstanding
											</option>
										{/each}
									</Select>
								</FormField>
								<FormField label="Amount received">
									<Input bind:value={payDraft.amount} mono required />
								</FormField>
								<FormField label="Date received" hint="The date the money arrived">
									<Input type="date" bind:value={payDraft.paid_on} mono required />
								</FormField>
								<FormField label="Method">
									<Select bind:value={payDraft.method}>
										{#each ['Wire transfer', 'ACH', 'Check', 'Card'] as method (method)}
											<option value={method}>{method}</option>
										{/each}
									</Select>
								</FormField>
							</div>
							<div class="form-actions">
								<Button type="submit" size="sm" disabled={busy}>Save payment</Button>
								<Button variant="ghost" size="sm" onclick={() => (payFor = null)}>Cancel</Button>
								<p class="hint">Posts to the ledger as income on the date it arrived.</p>
							</div>
						</form>
					{/if}

					{#if form}
						<form class="inset" onsubmit={saveDocument}>
							<p class="label-mono">
								{form.mode === 'edit'
									? `Editing ${form.invoice_number}`
									: form.recurring
										? 'New recurring invoice'
										: `New ${INVOICE_KIND_LABELS[form.kind].toLowerCase()}`}
							</p>

							<div class="grid-4">
								<FormField label="Number">
									<Input bind:value={form.invoice_number} mono required />
								</FormField>
								<FormField label="Date">
									<Input type="date" bind:value={form.issue_date} mono required />
								</FormField>
								<FormField label="Due date">
									<Input type="date" bind:value={form.due_date} mono required />
								</FormField>
								{#if form.kind === 'invoice'}
									<FormField label="Status" hint="Part paid and paid follow the payments">
										<Select bind:value={form.status}>
											<option value="draft">Draft</option>
											<option value="sent">Sent</option>
										</Select>
									</FormField>
								{/if}
								<FormField label="Category">
									<Input bind:value={form.category} maxlength={80} placeholder="Consulting" />
								</FormField>
								<FormField label="Subcategory">
									<Input
										bind:value={form.subcategory}
										maxlength={120}
										placeholder="Contract renewal"
									/>
								</FormField>
								{#if form.recurring}
									<FormField label="Repeats" hint="Raised as a draft on this schedule">
										<Select bind:value={form.frequency}>
											{#each BILLING_SCHEDULES as schedule (schedule)}
												<option value={schedule}>{schedule}</option>
											{/each}
										</Select>
									</FormField>
								{/if}
							</div>

							<div class="lines">
								<div class="line-head label-mono">
									<span>Product or service</span>
									<span>Description</span>
									<span class="num">Qty</span>
									<span class="num">Rate</span>
									<span class="num">Amount</span>
									<span></span>
								</div>
								{#each form.items as item, index (index)}
									<div class="line">
										<label class="visually-hidden" for="svc-{index}">
											Product or service for line {index + 1}
										</label>
										<Select id="svc-{index}" bind:value={item.service}>
											{#each SERVICE_CATALOGUE as service (service)}
												<option value={service}>{service}</option>
											{/each}
										</Select>
										<label class="visually-hidden" for="desc-{index}">
											Description for line {index + 1}
										</label>
										<Input
											id="desc-{index}"
											bind:value={item.description}
											placeholder="What this line covers"
										/>
										<label class="visually-hidden" for="qty-{index}">
											Quantity for line {index + 1}
										</label>
										<Input id="qty-{index}" bind:value={item.quantity} mono required />
										<label class="visually-hidden" for="rate-{index}">
											Rate for line {index + 1}
										</label>
										<Input id="rate-{index}" bind:value={item.rate} mono required />
										<span class="mono line-amount">
											{formatUsd(formTotals?.line_cents[index] ?? 0)}
										</span>
										<Button
											variant="ghost"
											size="sm"
											aria-label="Remove line {index + 1}"
											onclick={() => {
												if (form && form.items.length > 1) form.items.splice(index, 1);
											}}
										>
											Remove
										</Button>
									</div>
								{/each}
								<Button
									variant="ghost"
									size="sm"
									onclick={() => form && form.items.push(blankLine())}
								>
									Add line
								</Button>
							</div>

							<div class="totals-row">
								<FormField label="Message on the document">
									<Input
										bind:value={form.message}
										maxlength={1000}
										placeholder="Thank you. Payment details are below."
									/>
								</FormField>
								<dl class="totals">
									<div>
										<dt>Subtotal</dt>
										<dd class="mono">{formatUsd(formTotals?.subtotal_cents ?? 0)}</dd>
									</div>
									<div class="totals-edit">
										<dt>
											<label class="visually-hidden" for="disc-kind">Discount kind</label>
											<Select id="disc-kind" bind:value={form.discount_kind}>
												<option value="">No discount</option>
												<option value="percent">Percent off</option>
												<option value="amount">Amount off</option>
											</Select>
											{#if form.discount_kind !== ''}
												<label class="visually-hidden" for="disc-value">Discount value</label>
												<Input id="disc-value" bind:value={form.discount_value} mono />
											{/if}
										</dt>
										<dd class="mono">-{formatUsd(formTotals?.discount_cents ?? 0)}</dd>
									</div>
									<div class="totals-edit">
										<dt>
											<label for="tax-pct">Tax percent</label>
											<Input id="tax-pct" bind:value={form.tax_percent} mono />
										</dt>
										<dd class="mono">{formatUsd(formTotals?.tax_cents ?? 0)}</dd>
									</div>
									<div class="grand">
										<dt>Total</dt>
										<dd class="mono">{formatUsd(formTotals?.total_cents ?? 0)}</dd>
									</div>
								</dl>
							</div>

							<div class="form-actions">
								<Button type="submit" size="sm" disabled={busy}>
									{form.mode === 'edit' ? 'Save changes' : 'Save'}
								</Button>
								<Button variant="ghost" size="sm" onclick={() => (form = null)}>Cancel</Button>
								<p class="hint">Every save lands in the document trail.</p>
							</div>
						</form>
					{/if}

					{#if visibleInvoices.length === 0}
						<p class="empty">
							{invoices.length === 0
								? 'Nothing has been raised for this client yet.'
								: 'No document matches that filter.'}
						</p>
					{:else}
						<div class="scroll-x table-wrap">
							<table class="documents-table">
								<caption class="visually-hidden">
									Documents raised for {client.name}
								</caption>
								<thead>
									<tr>
										<th scope="col" class="label-mono">Date</th>
										<th scope="col" class="label-mono">Number</th>
										<th scope="col" class="label-mono">Category</th>
										<th scope="col" class="label-mono">Subcategory</th>
										<th scope="col" class="label-mono">Due</th>
										<th scope="col" class="label-mono num">Qty</th>
										<th scope="col" class="label-mono num">Rate</th>
										<th scope="col" class="label-mono num">Total</th>
										<th scope="col" class="label-mono">Status</th>
									</tr>
								</thead>
								<tbody>
									{#each visibleInvoices as inv (inv.id)}
										<tr class:void={Boolean(inv.voided_at)}>
											<td class="mono nowrap">{formatDayShort(inv.issue_date)}</td>
											<td class="mono">
												<button
													type="button"
													class="row-open"
													aria-expanded={expandedInvoice === inv.id}
													onclick={() => toggleInvoice(inv.id)}
												>
													{inv.invoice_number}
												</button>
											</td>
											<td>{inv.category ?? 'Uncategorised'}</td>
											<td class="muted">{inv.subcategory ?? ''}</td>
											<td class="mono nowrap">{formatDayShort(inv.due_date)}</td>
											<td class="mono num">{quantityOf(inv)}</td>
											<td class="mono num">{rateOf(inv)}</td>
											<td class="mono num strong">{formatUsd(inv.amount_cents)}</td>
											<td>
												<StatusChip tone={statusTone(inv)} label={statusLabel(inv)} size="sm" />
											</td>
										</tr>
										{#if expandedInvoice === inv.id}
											<tr class="expanded">
												<td colspan="9">
													<div class="row-actions">
														{#if !inv.voided_at && (!inv.kind || inv.kind === 'invoice')}
															{#if inv.status !== 'paid'}
																<Button
																	variant="secondary"
																	size="sm"
																	onclick={() => openPayment(inv.id)}
																>
																	Record payment
																</Button>
															{/if}
															{#if inv.status === 'draft'}
																<Button
																	variant="ghost"
																	size="sm"
																	disabled={busy}
																	onclick={() => markSent(inv)}
																>
																	Mark as sent
																</Button>
															{/if}
															{#if inv.status !== 'paid'}
																<Button
																	variant="ghost"
																	size="sm"
																	disabled={busy}
																	onclick={() => logReminder(inv)}
																>
																	Log a reminder
																</Button>
															{/if}
														{/if}
														{#if inv.kind === 'estimate' && !inv.voided_at}
															<Button
																variant="ghost"
																size="sm"
																disabled={busy}
																onclick={() => convert(inv)}
															>
																Convert to invoice
															</Button>
														{/if}
														<Button
															variant="ghost"
															size="sm"
															disabled={busy}
															onclick={() => duplicate(inv)}
														>
															Duplicate
														</Button>
														{#if !inv.voided_at}
															<Button variant="ghost" size="sm" onclick={() => editDocument(inv)}>
																Edit
															</Button>
														{/if}
														<Button
															variant="ghost"
															size="sm"
															href="/invoices/print?invoice={inv.id}"
															target="_blank"
															rel="noopener"
														>
															Print or save as PDF
														</Button>
														{#if client.contact_email}
															<Button
																variant="ghost"
																size="sm"
																href={composeHref(inv)}
																target="_blank"
																rel="noopener"
															>
																Open in Gmail
															</Button>
														{/if}
														{#if !inv.voided_at && inv.amount_paid_cents === 0}
															<Button
																variant="ghost"
																size="sm"
																disabled={busy}
																onclick={() => voidDocument(inv)}
															>
																Void
															</Button>
														{/if}
													</div>

													<p class="label-mono section-label">Line items</p>
													{#if (inv.items ?? []).length > 0}
														<ul class="items">
															{#each inv.items ?? [] as item (item.id)}
																<li>
																	<span class="i-service">{item.service}</span>
																	<span class="i-desc">{item.description ?? ''}</span>
																	<span class="mono i-calc">
																		{item.quantity} x {formatUsd(item.unit_rate_cents)}
																	</span>
																	<span class="mono i-amount">{formatUsd(item.amount_cents)}</span>
																</li>
															{/each}
														</ul>
													{:else}
														<p class="entries-note">
															This invoice was raised before invoices carried line items, so it has
															no breakdown.
															{#if inv.period_hours}
																The billing period behind it counted {inv.period_hours.toFixed(2)} billable
																hours{inv.period_note ? ` for ${inv.period_note}` : ''}.
															{/if}
														</p>
													{/if}

													<dl class="summary">
														{#if inv.subtotal_cents !== null && inv.subtotal_cents !== undefined}
															<div>
																<dt>Subtotal</dt>
																<dd class="mono">{formatUsd(inv.subtotal_cents)}</dd>
															</div>
														{/if}
														{#if (inv.discount_cents ?? 0) > 0}
															<div>
																<dt>
																	Discount
																	{inv.discount_kind === 'percent'
																		? `${inv.discount_value}%`
																		: 'amount'}
																</dt>
																<dd class="mono">-{formatUsd(inv.discount_cents ?? 0)}</dd>
															</div>
														{/if}
														{#if (inv.tax_cents ?? 0) > 0}
															<div>
																<dt>Tax {inv.tax_percent}%</dt>
																<dd class="mono">{formatUsd(inv.tax_cents ?? 0)}</dd>
															</div>
														{/if}
														<div>
															<dt>Total</dt>
															<dd class="mono strong">{formatUsd(inv.amount_cents)}</dd>
														</div>
														{#if inv.amount_paid_cents > 0}
															<div>
																<dt>Received</dt>
																<dd class="mono good">{formatUsd(inv.amount_paid_cents)}</dd>
															</div>
															<div>
																<dt>Outstanding</dt>
																<dd class="mono">
																	{formatUsd(inv.amount_cents - inv.amount_paid_cents)}
																</dd>
															</div>
														{/if}
													</dl>

													{#if inv.message}
														<p class="message">{inv.message}</p>
													{/if}

													<p class="label-mono section-label">Trail</p>
													{#if (inv.events ?? []).length === 0}
														<p class="entries-note">
															Nothing recorded. This document predates the trail.
														</p>
													{:else}
														<ul class="trail">
															{#each inv.events ?? [] as event (event.id)}
																<li>
																	<span class="mono t-when">{formatMoment(event.occurred_at)}</span>
																	<span class="t-kind label-mono">{event.kind}</span>
																	<span class="t-what">{event.detail}</span>
																</li>
															{/each}
														</ul>
													{/if}
												</td>
											</tr>
										{/if}
									{/each}
								</tbody>
							</table>
						</div>

						<!-- D22: below 960px the same rows render as cards, which is the
						     only readable shape at 412px. -->
						<ul class="cards">
							{#each visibleInvoices as inv (inv.id)}
								<li class="card-row">
									<div class="card-head">
										<button
											type="button"
											class="row-open mono"
											aria-expanded={expandedInvoice === inv.id}
											onclick={() => toggleInvoice(inv.id)}
										>
											{inv.invoice_number}
										</button>
										<StatusChip tone={statusTone(inv)} label={statusLabel(inv)} size="sm" />
									</div>
									<p class="card-what">
										{inv.category ?? 'Uncategorised'}
										{#if inv.subcategory}<span class="sep">·</span>{inv.subcategory}{/if}
									</p>
									<dl class="card-facts mono">
										<div><dt>Total</dt><dd>{formatUsd(inv.amount_cents)}</dd></div>
										<div>
											<dt>Outstanding</dt>
											<dd>{formatUsd(inv.amount_cents - inv.amount_paid_cents)}</dd>
										</div>
										<div><dt>Issued</dt><dd>{formatDayShort(inv.issue_date)}</dd></div>
										<div><dt>Due</dt><dd>{formatDayShort(inv.due_date)}</dd></div>
									</dl>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}
		{/if}
	</div>
</div>

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
		max-width: 62ch;
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

	/* One column at 412px, two at 720, four at 1100. */
	.tiles {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}
	.tile {
		padding: var(--space-3) var(--space-4);
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-left: 3px solid var(--border-strong);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
	}
	.tile.accent-navy {
		border-left-color: var(--navy-500);
	}
	.tile.accent-gold {
		border-left-color: var(--gold);
	}
	.tile.accent-green {
		border-left-color: var(--green);
	}
	.tile-amount {
		margin-top: var(--space-1);
		font-size: var(--text-lg);
		font-weight: var(--weight-medium);
	}
	.tile-note {
		margin-top: 2px;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.split {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		margin-top: var(--space-5);
	}

	.rail {
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		overflow: hidden;
	}
	.rail-search {
		padding: var(--space-3);
		border-bottom: 1px solid var(--border-thin);
	}
	.rail-list {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 420px;
		overflow-y: auto;
	}
	.rail-row {
		display: block;
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--border-thin);
		border-left: 3px solid transparent;
		color: inherit;
		text-decoration: none;
		transition: background-color var(--transition-fast);
	}
	.rail-row:hover {
		background: var(--surface-hover);
		text-decoration: none;
	}
	.rail-row.current {
		background: var(--navy-50);
		border-left-color: var(--navy);
	}
	.rail-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.rail-name {
		font-weight: var(--weight-medium);
		color: var(--text-link);
	}
	.rail-bottom {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		margin-top: var(--space-1);
		font-size: var(--text-xs);
	}
	.rail-balance {
		font-size: var(--text-sm);
	}
	.rail-word,
	.rail-count {
		color: var(--text-secondary);
	}
	.rail-count {
		margin-left: auto;
	}
	.rail-empty {
		padding: var(--space-4);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.detail {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
	}

	.panel {
		padding: var(--space-4);
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
	}
	.panel h2 {
		font-size: var(--text-lg);
	}
	.panel-sub {
		margin-top: var(--space-1);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.panel-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.panel-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.name-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.count {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.grid-3,
	.grid-4 {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-3);
		margin-top: var(--space-4);
	}
	.form-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}
	.hint {
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.facts {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-3);
		margin-top: var(--space-4);
		padding-top: var(--space-4);
		border-top: 1px solid var(--border-thin);
	}
	.facts dd {
		margin: 2px 0 0;
		font-size: var(--text-sm);
	}

	.stats {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}
	.stat {
		padding: var(--space-3);
		background: var(--surface-callout);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
	}
	.stat-amount {
		margin-top: var(--space-1);
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
	}
	.stat-amount.warn {
		color: var(--text-warn);
	}
	.stat-note {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.good {
		color: var(--green-700);
	}

	.notes {
		margin-top: var(--space-4);
		padding-top: var(--space-4);
		border-top: 1px solid var(--border-thin);
	}
	.notes label {
		display: block;
		margin-bottom: var(--space-2);
	}

	.callout {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--surface-callout);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
	}

	.tabs {
		display: inline-flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		padding: var(--space-1);
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
	}
	.tab {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--text-body);
		text-decoration: none;
		white-space: nowrap;
	}
	.tab:hover {
		background: var(--navy-50);
		text-decoration: none;
	}
	.tab.current {
		background: var(--navy);
		color: var(--text-inverse);
	}

	/* A switch, not a checkbox with a picture on it: role and aria-checked carry
	   the state, and the visual is the same fact drawn twice. */
	/* --- Documents --- */
	.menu-wrap {
		position: relative;
	}
	.menu {
		position: absolute;
		right: 0;
		top: calc(100% + var(--space-1));
		z-index: 20;
		display: flex;
		flex-direction: column;
		min-width: 220px;
		padding: var(--space-1);
		background: var(--surface-card);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-pop);
	}
	.menu button {
		display: flex;
		align-items: center;
		min-height: var(--tap);
		padding: var(--space-2) var(--space-3);
		text-align: left;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		font: inherit;
		font-size: var(--text-sm);
		color: var(--text-body);
		cursor: pointer;
	}
	.menu button:hover {
		background: var(--surface-hover);
	}

	.bar {
		display: flex;
		height: 10px;
		margin-top: var(--space-4);
		border-radius: var(--radius-pill);
		background: var(--surface-row-alt);
		overflow: hidden;
	}
	.seg-overdue {
		background: var(--gold-600);
	}
	.seg-open {
		background: var(--navy-500);
	}
	.seg-paid {
		background: var(--green);
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin-top: var(--space-3);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.chip-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		/* 44px tap-target floor, D22. The pill looks small; the hit area is not. */
		min-height: var(--tap);
		padding: var(--space-1) var(--space-3);
		background: var(--surface-card);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-pill);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--text-link);
		cursor: pointer;
		transition: background-color var(--transition-fast);
	}
	.chip-btn:hover {
		background: var(--navy-50);
	}
	.chip-btn.on {
		background: var(--navy-50);
		border-color: var(--navy-500);
	}
	.chip-btn:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--muted);
	}
	.chip-overdue .dot {
		background: var(--gold-600);
	}
	.chip-open .dot {
		background: var(--navy-500);
	}
	.chip-paid .dot {
		background: var(--green);
	}
	.chip-other .dot {
		background: var(--border-strong);
	}
	.chip-amount,
	.chip-count {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.filter-search {
		flex: 1 1 200px;
		max-width: 280px;
		margin-left: auto;
	}

	.inset {
		margin-top: var(--space-4);
		padding: var(--space-4);
		background: var(--surface-row-alt);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
	}
	.inset-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.inset-actions {
		display: flex;
		gap: var(--space-2);
	}

	.statement {
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: 0;
	}
	.statement li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--border-thin);
		font-size: var(--text-sm);
	}
	.s-number {
		width: 90px;
		color: var(--text-link);
	}
	.s-date,
	.s-due {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.s-desc {
		flex: 1;
	}
	.s-amount {
		margin-left: auto;
	}
	.statement-total {
		display: flex;
		justify-content: space-between;
		gap: var(--space-4);
		margin-top: var(--space-3);
		font-weight: var(--weight-semibold);
	}

	.lines {
		margin-top: var(--space-4);
	}
	.line-head {
		display: none;
	}
	.line {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-2);
		padding: var(--space-3) 0;
		border-top: 1px solid var(--border-thin);
		align-items: center;
	}
	.line-amount {
		font-size: var(--text-sm);
	}

	.totals-row {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-4);
		margin-top: var(--space-4);
	}
	.totals {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}
	.totals > div {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.totals dt {
		color: var(--text-secondary);
	}
	.totals-edit dt {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.totals-edit :global(.control) {
		max-width: 150px;
	}
	.grand {
		padding-top: var(--space-2);
		border-top: 1px solid var(--border-strong);
		font-weight: var(--weight-semibold);
	}
	.grand dt {
		color: var(--text-body);
	}

	.scroll-x {
		overflow-x: auto;
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
		border-radius: var(--radius-md);
	}
	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.card-what {
		margin-top: 2px;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.card-facts {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
		margin: var(--space-3) 0 0;
		font-size: var(--text-xs);
	}
	.card-facts dt {
		color: var(--text-secondary);
	}
	.card-facts dd {
		margin: 2px 0 0;
	}

	.row-open {
		/* The number is the control. Padded out to the tap floor rather than
		   drawn larger, so the table keeps its density on a desktop and stays
		   pressable on a phone. An invoice number never wraps: half a number on
		   each of two lines is not a number anyone can read back. */
		min-height: var(--tap);
		white-space: nowrap;
		padding: var(--space-2) 0;
		background: none;
		border: none;
		font: inherit;
		color: var(--text-link);
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.row-open:hover {
		text-decoration: underline;
	}
	.row-open:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.row-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin-bottom: var(--space-3);
	}
	.section-label {
		margin-top: var(--space-3);
		margin-bottom: var(--space-2);
	}
	.items,
	.trail {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.items li,
	.trail li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--border-thin);
		font-size: var(--text-sm);
	}
	.i-service {
		width: 170px;
		font-weight: var(--weight-medium);
	}
	.i-desc {
		flex: 1;
		color: var(--text-secondary);
	}
	.i-calc {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.i-amount {
		margin-left: auto;
	}
	.t-when {
		width: 120px;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.t-kind {
		width: 90px;
	}
	.t-what {
		flex: 1;
	}
	.summary {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: var(--space-3) 0 0;
		font-size: var(--text-sm);
	}
	.summary > div {
		display: flex;
		justify-content: space-between;
		gap: var(--space-4);
		max-width: 360px;
		margin-left: auto;
	}
	.summary dt {
		color: var(--text-secondary);
	}
	.strong {
		font-weight: var(--weight-semibold);
	}
	.message {
		margin-top: var(--space-3);
		padding: var(--space-3);
		background: var(--surface-callout);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
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
	.sep {
		margin: 0 var(--space-1);
	}
	.muted {
		color: var(--text-secondary);
	}
	.num {
		text-align: right;
	}
	.nowrap {
		white-space: nowrap;
	}

	@media (min-width: 720px) {
		.grid-3,
		.grid-4 {
			grid-template-columns: 1fr 1fr;
		}
		.tiles {
			grid-template-columns: 1fr 1fr;
		}
		.stats {
			grid-template-columns: 1fr 1fr;
		}
		.facts {
			grid-template-columns: 1fr 1fr;
		}
		.totals-row {
			grid-template-columns: 1fr 320px;
		}
	}

	@media (min-width: 960px) {
		.cards {
			display: none;
		}
		.table-wrap {
			display: block;
			margin-top: var(--space-3);
		}
		.documents-table {
			width: 100%;
			border-collapse: collapse;
		}
		.documents-table th {
			padding: var(--space-2) var(--space-3);
			text-align: left;
			white-space: nowrap;
			border-bottom: 2px solid var(--border-strong);
			background: var(--surface-row-alt);
		}
		.documents-table td {
			padding: var(--space-3);
			border-top: 1px solid var(--border-thin);
			vertical-align: top;
		}
		.documents-table th.num,
		.documents-table td.num {
			text-align: right;
		}
		.documents-table tbody tr:hover {
			background: var(--surface-hover);
		}
		.documents-table tr.expanded:hover,
		.documents-table tr.expanded {
			background: var(--surface-row-alt);
		}
		.documents-table tr.void td {
			color: var(--text-secondary);
		}
		/* Six columns, sized so the description keeps room. The panel sits
		   inside a 300px rail and a 1200px cap, so every pixel spent on a
		   number column comes out of the one field that holds a sentence. */
		.line {
			grid-template-columns: 170px minmax(160px, 1fr) 64px 96px 96px auto;
		}
		.line-head {
			display: grid;
			grid-template-columns: 170px minmax(160px, 1fr) 64px 96px 96px auto;
			gap: var(--space-2);
			padding-bottom: var(--space-2);
		}
		.line-head .num {
			text-align: right;
		}
		.line-amount {
			text-align: right;
		}
	}

	@media (min-width: 1100px) {
		.tiles {
			grid-template-columns: repeat(4, 1fr);
		}
		.stats {
			grid-template-columns: repeat(4, 1fr);
		}
		.facts {
			grid-template-columns: repeat(3, 1fr);
		}
		.grid-3 {
			grid-template-columns: repeat(3, 1fr);
		}
		.grid-4 {
			grid-template-columns: repeat(4, 1fr);
		}
		.split {
			display: grid;
			grid-template-columns: 300px minmax(0, 1fr);
			gap: var(--space-5);
			align-items: start;
		}
		.rail-list {
			max-height: calc(100vh - 320px);
		}
	}
</style>
