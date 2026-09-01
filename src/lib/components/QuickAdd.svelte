<script lang="ts">
	import { untrack } from 'svelte';
import { apiWrite } from '$lib/http';
	import { invalidateAll } from '$app/navigation';
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import FormField from './FormField.svelte';
	import Input from './Input.svelte';
	import Select from './Select.svelte';
	import Textarea from './Textarea.svelte';
	import type { DefaultDue } from '$lib/settings';

	/**
	 * Global capture, per the architecture's UX principles: reachable from
	 * anywhere, keyboard first, sensible defaults.
	 *
	 * This is what makes the brand-voice empty state wording true. Until it
	 * existed, "add one with quick add, or press N" named two things that were
	 * not there. See D27.
	 *
	 * The redesign turns one form into nine. Each kind names where it lands
	 * before anything is typed, because the whole point of one capture box for
	 * the firm is that it is never ambiguous which drawer a thing went into.
	 *
	 * The prototype has a tenth kind, Calendar invite, whose own note says it is
	 * "sent through the Google Calendar API". This app holds calendar.readonly
	 * and nothing else, by D70, asserted by tests/layer2-no-send-surface. A
	 * quick add kind that saves nothing here and opens a Google tab instead
	 * would break the one promise this box makes, so it is not offered. Drafting
	 * an invite belongs to the Calendar screen, where it can be what it is.
	 *
	 * Reference data is fetched once, the first time the dialog opens, rather
	 * than on every page load. A capture box nobody has opened should cost
	 * nothing.
	 */

	let {
		open = $bindable(false),
		today,
		defaultDue = 'tomorrow'
	}: { open?: boolean; today: string; defaultDue?: DefaultDue } = $props();

	interface FieldSpec {
		key: string;
		label: string;
		kind: 'text' | 'date' | 'select' | 'money';
		options?: () => { value: string; label: string }[];
		placeholder?: string;
		mono?: boolean;
		span?: boolean;
		required?: boolean;
	}

	interface KindSpec {
		label: string;
		dot: string;
		destination: string;
		note: string;
		titleLabel: string;
		titlePlaceholder: string;
		areaLabel: string;
		areaPlaceholder: string;
		fields: FieldSpec[];
		/** Where the saved thing can be opened. */
		href: (created: Record<string, unknown>) => string;
		/**
		 * Values that have to be fetched before the form can be filled.
		 *
		 * An invoice needs its next number, and the number is the database's to
		 * decide, not the browser's. Run when the kind is picked so the field
		 * arrives filled rather than being invented at save time.
		 */
		prepare?: () => Promise<Record<string, string>>;
		/** The request. Returns null when the form is not usable yet. */
		save: (
			title: string,
			area: string,
			values: Record<string, string>
		) => { path: string; body: Record<string, unknown> } | { error: string };
	}

	// --- Reference data --------------------------------------------------------

	let projects = $state<{ id: string; name: string }[]>([]);
	let clients = $state<{ id: string; name: string }[]>([]);
	let categories = $state<{ id: string; name: string; kind: string }[]>([]);
	let owners = $state<string[]>([]);
	let loadedRefs = $state(false);
	/**
	 * Whether the pickers can be trusted yet.
	 *
	 * The four reference lists arrive a moment after the dialog opens, and a
	 * select with no options has no value, so a form submitted in that window
	 * fails on a field the reader can see is empty and cannot fill. Rather than
	 * hope nobody is that fast, the save waits and says why.
	 */
	let refsReady = $state(false);

	async function loadRefs() {
		if (loadedRefs) return;
		loadedRefs = true;
		const [p, c, cat, o] = await Promise.all([
			fetch('/api/projects').then((r) => (r.ok ? r.json() : null)).catch(() => null),
			fetch('/api/clients').then((r) => (r.ok ? r.json() : null)).catch(() => null),
			fetch('/api/ledger/categories').then((r) => (r.ok ? r.json() : null)).catch(() => null),
			fetch('/api/people/owners').then((r) => (r.ok ? r.json() : null)).catch(() => null)
		]);
		projects = p?.projects ?? [];
		clients = c?.clients ?? [];
		categories = cat?.categories ?? [];
		owners = o?.owners ?? [];
		refsReady = true;
	}

	const asOptions = (rows: { id: string; name: string }[], none?: string) =>
		(none ? [{ value: '', label: none }] : []).concat(
			rows.map((r) => ({ value: r.id, label: r.name }))
		);

	const plain = (values: string[]) => values.map((v) => ({ value: v, label: v }));

	function addDays(days: number) {
		const base = new Date(`${today}T00:00:00Z`);
		base.setUTCDate(base.getUTCDate() + days);
		return base.toISOString().slice(0, 10);
	}

	// --- The kinds -------------------------------------------------------------

	const KINDS: KindSpec[] = [
		{
			label: 'Action item',
			dot: 'var(--navy-500)',
			destination: 'Action items',
			note: 'A commitment tracked to done. Lands in the tracker.',
			titleLabel: 'What has to happen',
			titlePlaceholder: 'Collect the revised timeline for Dovecote',
			areaLabel: 'Context',
			areaPlaceholder: 'One line so the item still makes sense later.',
			fields: [
				{
					key: 'owner',
					label: 'Owner',
					kind: 'select',
					options: () => [{ value: '', label: 'Unassigned' }, ...plain(owners)]
				},
				{ key: 'deadline', label: 'Deadline', kind: 'date', mono: true },
				{
					key: 'project_id',
					label: 'Project',
					kind: 'select',
					options: () => asOptions(projects, 'No project')
				},
				{
					key: 'source',
					label: 'Source',
					kind: 'select',
					options: () => [
						{ value: 'manual', label: 'Manual' },
						{ value: 'meeting', label: 'Meeting' },
						{ value: 'email', label: 'Mail' }
					]
				}
			],
			href: () => '/actions?view=open',
			save: (title, area, v) => ({
				path: '/api/action-items',
				body: {
					title,
					context: area,
					owner: v.owner,
					deadline: v.deadline,
					project_id: v.project_id,
					status: 'open',
					source: v.source || 'manual'
				}
			})
		},
		{
			label: 'Ticket',
			dot: 'var(--red)',
			destination: 'the project board',
			note: 'Something broken or needed on a project. Lands in that project.',
			titleLabel: 'What is wrong or needed',
			titlePlaceholder: 'Portal login fails for the Beacon proof of concept',
			areaLabel: 'Description',
			areaPlaceholder: 'Steps to reproduce, expected and actual.',
			fields: [
				{
					key: 'project_id',
					label: 'Project',
					kind: 'select',
					required: true,
					options: () => asOptions(projects, 'Choose a project')
				},
				{
					key: 'priority',
					label: 'Priority',
					kind: 'select',
					options: () => [
						{ value: 'normal', label: 'Normal' },
						{ value: 'high', label: 'High' },
						{ value: 'urgent', label: 'Urgent' },
						{ value: 'low', label: 'Low' }
					]
				},
				{
					key: 'assignee',
					label: 'Assignee',
					kind: 'select',
					options: () => [{ value: '', label: 'Unassigned' }, ...plain(owners)]
				},
				{ key: 'due_date', label: 'Due', kind: 'date', mono: true }
			],
			href: (created) => `/tickets/${created.id}`,
			save: (title, area, v) => {
				if (!v.project_id) return { error: 'A ticket needs a project.' };
				return {
					path: '/api/tickets',
					body: {
						project_id: v.project_id,
						title,
						description: area,
						priority: v.priority || 'normal',
						assignee: v.assignee,
						due_date: v.due_date
					}
				};
			}
		},
		{
			label: 'Meeting',
			dot: 'var(--gold-600)',
			destination: 'Meetings',
			note: 'A call to log. The transcript is imported later.',
			titleLabel: 'What the call was',
			titlePlaceholder: 'Caldera scoping call',
			areaLabel: 'Agenda or notes',
			areaPlaceholder: 'What it needs to cover.',
			fields: [
				{ key: 'meeting_date', label: 'Date', kind: 'date', mono: true },
				{
					key: 'client_id',
					label: 'Client',
					kind: 'select',
					options: () => asOptions(clients, 'No client')
				},
				{
					key: 'project_id',
					label: 'Project',
					kind: 'select',
					options: () => asOptions(projects, 'No project')
				},
				{
					key: 'attendees',
					label: 'Attendees',
					kind: 'text',
					placeholder: 'Comma separated',
					span: true
				}
			],
			href: (created) => `/meetings/${created.id}`,
			save: (title, area, v) => ({
				path: '/api/meetings',
				body: {
					title,
					notes: area,
					meeting_date: v.meeting_date || today,
					client_id: v.client_id,
					project_id: v.project_id,
					attendees: v.attendees
				}
			})
		},
		{
			label: 'Project',
			dot: 'var(--green)',
			destination: 'Projects',
			note: 'A new engagement. Lands on the board in Initiating.',
			titleLabel: 'Project name',
			titlePlaceholder: 'Caldera systems integration',
			areaLabel: 'Brief',
			areaPlaceholder: 'What the engagement covers, in a paragraph.',
			fields: [
				{
					key: 'client_id',
					label: 'Client',
					kind: 'select',
					options: () => asOptions(clients, 'No client')
				},
				{ key: 'target_close', label: 'Target close', kind: 'date', mono: true },
				{
					key: 'next_milestone',
					label: 'Next milestone',
					kind: 'text',
					placeholder: 'Kickoff booked',
					span: true
				}
			],
			href: (created) => `/projects/${created.id}`,
			save: (title, area, v) => ({
				path: '/api/projects',
				body: {
					name: title,
					description: area,
					client_id: v.client_id,
					target_close: v.target_close,
					next_milestone: v.next_milestone,
					phase: 'initiating',
					status: 'on_track'
				}
			})
		},
		{
			label: 'Client',
			dot: 'var(--gold)',
			destination: 'Clients',
			note: 'A client record with its contact and billing defaults.',
			titleLabel: 'Client name',
			titlePlaceholder: 'Caldera Systems',
			areaLabel: 'Notes',
			areaPlaceholder: 'Anything worth remembering.',
			fields: [
				{ key: 'contact_name', label: 'Contact person', kind: 'text', placeholder: 'Jane Smith' },
				{
					key: 'contact_email',
					label: 'Email',
					kind: 'text',
					mono: true,
					placeholder: 'billing@caldera.com'
				},
				{
					key: 'billing_terms',
					label: 'Payment terms',
					kind: 'select',
					options: () => plain(['Net 15', 'Net 7', 'Net 30', 'Due on receipt'])
				},
				{ key: 'rate', label: 'Hourly rate, USD', kind: 'money', mono: true, placeholder: '100' }
			],
			href: () => '/clients',
			save: (title, area, v) => ({
				path: '/api/invoicing/clients',
				body: {
					name: title,
					notes: area,
					contact_name: v.contact_name,
					contact_email: v.contact_email,
					billing_terms: v.billing_terms || 'Net 15',
					default_rate_cents: v.rate
				}
			})
		},
		{
			label: 'Ledger line',
			dot: 'var(--gold-600)',
			destination: 'the Ledger',
			note: 'Money in or out. The category decides the direction.',
			titleLabel: 'What it was',
			titlePlaceholder: 'Incoming wire fee',
			areaLabel: 'Anything else',
			areaPlaceholder: 'Optional.',
			fields: [
				{ key: 'txn_date', label: 'Date', kind: 'date', mono: true },
				{
					key: 'category_id',
					label: 'Category',
					kind: 'select',
					required: true,
					options: () =>
						categories.map((c) => ({ value: c.id, label: `${c.name}, ${c.kind}` }))
				},
				{
					key: 'client_id',
					label: 'Client',
					kind: 'select',
					options: () => asOptions(clients, 'None')
				},
				{ key: 'amount', label: 'Amount, USD', kind: 'money', mono: true, placeholder: '1250.00' }
			],
			href: () => '/ledger',
			save: (title, area, v) => {
				if (!v.category_id) return { error: 'A ledger line needs a category.' };
				if (!v.amount) return { error: 'A ledger line needs an amount.' };
				return {
					path: '/api/ledger/transactions',
					body: {
						category_id: v.category_id,
						client_id: v.client_id,
						txn_date: v.txn_date || today,
						amount: v.amount,
						// The ledger requires a currency and offers no default, by
						// design: a row whose currency was assumed is a row that
						// silently means something else. Quick add states it.
						currency: 'USD',
						notes: [title, area].filter(Boolean).join('. ')
					}
				};
			}
		},
		{
			label: 'SOP page',
			dot: 'var(--red)',
			destination: 'the SOP library',
			note: 'A new procedure, created as a draft you can version later.',
			titleLabel: 'Page title',
			titlePlaceholder: 'Weekly billing run',
			areaLabel: 'First steps',
			areaPlaceholder: 'Rough steps, tidied later in the editor.',
			fields: [
				{
					key: 'category',
					label: 'Category',
					kind: 'select',
					options: () =>
						plain(['Finance', 'Delivery', 'Compliance', 'Operations', 'People', 'Client care'])
				},
				{ key: 'review_due', label: 'Review due', kind: 'date', mono: true }
			],
			href: () => '/sops',
			save: (title, area, v) => {
				if (!area.trim()) return { error: 'An SOP needs at least its first steps.' };
				return {
					path: '/api/sops',
					body: {
						title,
						body: area,
						category: v.category,
						review_due: v.review_due,
						change_note: 'Captured from quick add'
					}
				};
			}
		},
		{
			label: 'Template',
			dot: 'var(--navy-500)',
			destination: 'Templates',
			note: 'A reusable skeleton. Square brackets become fill-in holes.',
			titleLabel: 'Template name',
			titlePlaceholder: 'Monthly client performance report',
			areaLabel: 'Skeleton',
			areaPlaceholder: 'Write it with [holes] like [client] or [period].',
			fields: [
				{
					key: 'type',
					label: 'Type',
					kind: 'select',
					options: () => [
						{ value: 'email', label: 'Email' },
						{ value: 'doc', label: 'Document' }
					]
				},
				{
					key: 'scenario',
					label: 'When to use it',
					kind: 'text',
					placeholder: 'Sent on the first of the month',
					span: true
				}
			],
			href: () => '/templates',
			save: (title, area, v) => {
				if (!area.trim()) return { error: 'A template needs a body.' };
				return {
					path: '/api/templates',
					body: { name: title, body: area, scenario: v.scenario, type: v.type || 'email' }
				};
			}
		},
		{
			label: 'Invoice',
			dot: 'var(--green)',
			destination: 'Invoicing',
			note: 'A draft invoice on a client. Nothing is sent from here.',
			titleLabel: 'What it covers',
			titlePlaceholder: 'August retainer',
			areaLabel: 'Message on the invoice',
			areaPlaceholder: 'Thank you. Payment details are below.',
			prepare: async () => {
				const res = await fetch('/api/invoicing/next-number?kind=invoice').catch(() => null);
				const body = res?.ok ? ((await res.json()) as { invoice_number?: string }) : null;
				return { invoice_number: body?.invoice_number ?? '' };
			},
			fields: [
				{
					key: 'client_id',
					label: 'Client',
					kind: 'select',
					required: true,
					options: () => asOptions(clients, 'Choose a client')
				},
				{ key: 'invoice_number', label: 'Number', kind: 'text', mono: true },
				{ key: 'issue_date', label: 'Date', kind: 'date', mono: true },
				{ key: 'due_date', label: 'Due', kind: 'date', mono: true },
				{ key: 'category', label: 'Category', kind: 'text', placeholder: 'Consulting' },
				{ key: 'quantity', label: 'Quantity, hours', kind: 'text', mono: true, placeholder: '8' },
				{ key: 'rate', label: 'Rate, USD', kind: 'money', mono: true, placeholder: '110' }
			],
			href: (created) => `/invoices?client=${String(created.client_id ?? '')}`,
			save: (title, area, v) => {
				if (!v.client_id) return { error: 'An invoice needs a client.' };
				if (!v.quantity || !v.rate) return { error: 'An invoice line needs a quantity and a rate.' };
				if (!v.invoice_number) return { error: 'An invoice needs a number.' };
				return {
					path: '/api/invoicing/invoices',
					body: {
						client_id: v.client_id,
						invoice_number: v.invoice_number,
						issue_date: v.issue_date || today,
						due_date: v.due_date || addDays(15),
						status: 'draft',
						category: v.category,
						subcategory: title,
						message: area,
						items: [
							{ service: 'Consulting hours', description: title, quantity: v.quantity, rate: v.rate }
						]
					}
				};
			}
		}
	];

	// --- Form state ------------------------------------------------------------

	let kindIndex = $state(0);
	const kind = $derived(KINDS[kindIndex]);

	let title = $state('');
	let area = $state('');
	/**
	 * Seeded with the first kind's defaults at construction, not on open.
	 *
	 * The dialog element and its fields exist in the DOM before anything opens
	 * it, so an empty record here means every `bind:value` binds to undefined,
	 * which Svelte refuses outright. The page rendered and the console carried
	 * the reason; found by driving the screen, D128.
	 */
	let values = $state<Record<string, string>>(defaults(KINDS[0]));
	let busy = $state(false);
	let errorMessage = $state('');
	let titleInput = $state<HTMLInputElement | null>(null);

	/** What this session has captured, newest first, with a way back to it. */
	let log = $state<{ id: string; message: string; href: string }[]>([]);

	/**
	 * What the deadline field opens with, from settings.
	 *
	 * It was two days, hardcoded. The setting exists because two days is a
	 * guess: some people capture things they mean to do today and some capture
	 * things for tomorrow, and neither is wrong. `none` leaves it empty, which
	 * is a real choice rather than an absence: an item with no deadline is not
	 * overdue and does not appear in what will slip.
	 */
	function deadlineDefault(): string {
		if (defaultDue === 'none') return '';
		return defaultDue === 'today' ? today : addDays(1);
	}

	function defaults(spec: KindSpec): Record<string, string> {
		const next: Record<string, string> = {};
		for (const field of spec.fields) {
			if (field.kind === 'date') {
				next[field.key] =
					field.key === 'deadline'
						? deadlineDefault()
						: field.key === 'due_date' || field.key === 'target_close'
							? addDays(15)
							: today;
			} else if (field.options) {
				next[field.key] = field.options()[0]?.value ?? '';
			} else {
				next[field.key] = '';
			}
		}
		return next;
	}

	function reset(keepKind = true) {
		if (!keepKind) kindIndex = 0;
		title = '';
		area = '';
		values = defaults(KINDS[kindIndex]);
		errorMessage = '';
	}

	async function pickKind(index: number) {
		kindIndex = index;
		title = '';
		area = '';
		values = defaults(KINDS[index]);
		errorMessage = '';
		queueMicrotask(() => titleInput?.focus());
		const prepared = await KINDS[index].prepare?.();
		if (prepared && kindIndex === index) values = { ...values, ...prepared };
	}

	/**
	 * Reset every time it opens, so a cancelled capture never leaks into the next.
	 *
	 * `untrack` is load bearing and was added after watching the bug. Resetting
	 * reads the reference lists, through each select's options, so without it
	 * this effect depended on projects, clients, categories and owners. Those
	 * arrive from four fetches a moment after the dialog opens, and every one of
	 * them re-ran the reset and wiped whatever had been typed in the meantime.
	 * The save still worked, so the only evidence was a capture log entry with
	 * no title in it. Found by driving the screen, D128.
	 */
	$effect(() => {
		if (!open) return;
		untrack(() => {
			reset();
			queueMicrotask(() => titleInput?.focus());
			void loadRefs().then(async () => {
				fillEmptyDefaults();
				const prepared = await KINDS[kindIndex].prepare?.();
				if (prepared) values = { ...values, ...prepared };
			});
		});
	});

	/**
	 * Fills the pickers once their options exist, without touching anything the
	 * reader has already chosen or typed.
	 */
	function fillEmptyDefaults() {
		const fresh = defaults(KINDS[kindIndex]);
		const next = { ...values };
		for (const [key, value] of Object.entries(fresh)) {
			if (!next[key] && value) next[key] = value;
		}
		values = next;
	}

	async function submit(again: boolean) {
		if (!title.trim()) {
			errorMessage = `${kind.titleLabel} cannot be empty.`;
			return;
		}
		const plan = kind.save(title.trim(), area.trim(), values);
		if ('error' in plan) {
			errorMessage = plan.error;
			return;
		}

		busy = true;
		errorMessage = '';
		try {
			const result = await apiWrite<Record<string, unknown>>(plan.path, 'POST', plan.body);
			if (!result.ok) {
				/**
				 * The dialog stays open on failure. Closing it would hide the error
				 * along with the unsaved item, which is how a failed save became
				 * indistinguishable from a successful one.
				 */
				errorMessage = result.error ?? 'Could not save it.';
				return;
			}

			const created = (Object.values(result.data ?? {})[0] ?? {}) as Record<string, unknown>;
			log = [
				{
					id: crypto.randomUUID(),
					message: `${kind.label} added to ${kind.destination}: ${title.trim()}`,
					href: kind.href(created)
				},
				...log
			].slice(0, 5);

			await invalidateAll();
			if (again) {
				// Keeps the kind and its pickers, clears what was typed. Capturing
				// six things from one call is the case this exists for.
				title = '';
				area = '';
				queueMicrotask(() => titleInput?.focus());
			} else {
				open = false;
			}
		} finally {
			busy = false;
		}
	}
</script>

<Modal bind:open title="Quick add">
	<form class="qa" onsubmit={(e) => { e.preventDefault(); submit(false); }}>
		<p class="hint">
			One capture point for the whole firm. Pick where it goes, fill the short form, done.
		</p>

		{#if errorMessage}
			<p class="error" role="alert">{errorMessage}</p>
		{/if}

		<fieldset class="kinds">
			<legend class="label-mono">Where it goes</legend>
			{#each KINDS as k, i (k.label)}
				<button
					type="button"
					class="kind"
					class:current={i === kindIndex}
					aria-pressed={i === kindIndex}
					onclick={() => pickKind(i)}
				>
					<span class="dot" style="background: {k.dot}" aria-hidden="true"></span>
					{k.label}
				</button>
			{/each}
		</fieldset>

		<p class="note">{kind.note}</p>

		<FormField label={kind.titleLabel}>
			<Input bind:value={title} bind:element={titleInput} placeholder={kind.titlePlaceholder} />
		</FormField>

		<div class="grid">
			{#each kind.fields as field (field.key)}
				<div class:span-all={field.span}>
					<FormField label={field.label}>
						{#if field.kind === 'select'}
							{@const options = field.options?.() ?? []}
							<Select bind:value={values[field.key]} disabled={options.length === 0}>
								{#if options.length === 0}
									<option value="">Loading</option>
								{/if}
								{#each options as option (option.value)}
									<option value={option.value}>{option.label}</option>
								{/each}
							</Select>
						{:else}
							<Input
								type={field.kind === 'date' ? 'date' : 'text'}
								bind:value={values[field.key]}
								mono={field.mono}
								placeholder={field.placeholder}
							/>
						{/if}
					</FormField>
				</div>
			{/each}
		</div>

		<FormField label={kind.areaLabel}>
			<Textarea bind:value={area} rows={3} placeholder={kind.areaPlaceholder} />
		</FormField>

		<div class="actions">
			<Button type="submit" disabled={busy || !refsReady}>Add {kind.label.toLowerCase()}</Button>
			<Button variant="secondary" disabled={busy || !refsReady} onclick={() => submit(true)}>
				Save and add another
			</Button>
			<Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
		</div>

		{#if log.length > 0}
			<ul class="log">
				{#each log as entry (entry.id)}
					<li>
						<span>{entry.message}</span>
						<a href={entry.href}>Open it</a>
					</li>
				{/each}
			</ul>
		{/if}
	</form>
</Modal>

<style>
	.qa {
		padding: 0 var(--space-4) var(--space-4);
	}

	.hint {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.error {
		margin: 0 0 var(--space-3);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--red-200);
		border-radius: var(--radius-sm);
		background: var(--red-100);
		color: var(--red);
		font-size: var(--text-sm);
	}

	.kinds {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin: 0 0 var(--space-2);
		padding: 0;
		border: 0;
	}

	.kinds legend {
		margin-bottom: var(--space-2);
		padding: 0;
	}

	.kind {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--tap);
		padding: var(--space-1) var(--space-3);
		background: var(--surface-card);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-pill);
		font: inherit;
		font-size: var(--text-sm);
		color: var(--text-body);
		cursor: pointer;
	}

	.kind:hover {
		background: var(--surface-hover);
	}

	.kind.current {
		background: var(--navy);
		border-color: var(--navy);
		color: var(--text-inverse);
	}

	.kind:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.note {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-3);
		margin: var(--space-3) 0;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}

	.log {
		list-style: none;
		margin: var(--space-4) 0 0;
		padding: var(--space-3) 0 0;
		border-top: 1px solid var(--border-thin);
	}

	.log li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-1) 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	@media (min-width: 560px) {
		.grid {
			grid-template-columns: 1fr 1fr;
		}

		.span-all {
			grid-column: 1 / -1;
		}
	}
</style>
