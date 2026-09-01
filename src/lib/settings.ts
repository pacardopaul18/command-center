/**
 * Configuration that lives outside the code.
 *
 * One KV key holding one object, read on every page load and written whole.
 * Not D1: these are preferences, not records. They have no history worth
 * keeping, no relationships, and nothing joins to them, and a table would mean
 * a migration every time one is added.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: every setting here is read by something.
 * The prototype draws about thirty controls, and roughly half of them describe
 * behaviour this app does not have. A toggle that stores a value nothing reads
 * is worse than no toggle: it tells the reader they have changed something, and
 * the app carries on exactly as before. D27, in the one place where it is most
 * tempting to break.
 *
 * What the prototype draws and this deliberately does not build is listed in
 * `NOT_BUILT` below, with the reason for each, and shown on the page. Saying
 * "not built, because" is honest; drawing a dead switch is not.
 */

export type Density = 'comfortable' | 'compact';
export type DefaultDue = 'today' | 'tomorrow' | 'none';
export type WeekStart = 'monday' | 'sunday';

export interface Settings {
	/* --- General ---------------------------------------------------------- */

	/** Shown in the sidebar and used as the digest sender name. */
	workspace_name: string;

	/**
	 * Which day a week starts on, for every "this week" count.
	 *
	 * Read by the meetings counts and the ledger's week arithmetic. Not a
	 * cosmetic choice: a Sunday start moves what "this week" means by a day at
	 * both ends.
	 */
	week_starts_on: WeekStart;

	/* --- Notifications ---------------------------------------------------- */

	/** Read by the scheduled handler before it sends. Off means no email goes. */
	morning_digest: boolean;
	evening_digest: boolean;

	/* --- Appearance ------------------------------------------------------- */

	/** A class on the shell. Compact tightens table and list rows. */
	density: Density;

	/** Alternating row tint on long tables. Off by default. */
	zebra_rows: boolean;

	/** Where the logo in the sidebar goes. */
	start_page: string;

	/* --- Invoicing -------------------------------------------------------- */

	/** Read by the next-number route. INV by default. */
	invoice_prefix: string;

	/** Offered when an invoice is raised with no explicit terms. */
	default_payment_terms: string;

	/** Applied to a new invoice unless it says otherwise. Percent, not basis points. */
	default_tax_percent: number;

	/* --- Action items ----------------------------------------------------- */

	/** What quick add uses when no deadline is typed. */
	default_due: DefaultDue;
}

/**
 * The defaults, which are also what the app did before settings existed.
 *
 * Every one of these matches the behaviour already in the code, so turning
 * settings on changes nothing until somebody changes something. A default that
 * differed would mean the feature silently altered the app on the day it
 * shipped.
 */
export const DEFAULT_SETTINGS: Settings = {
	workspace_name: 'Command Center',
	week_starts_on: 'monday',
	morning_digest: true,
	evening_digest: true,
	density: 'comfortable',
	zebra_rows: false,
	start_page: '/',
	invoice_prefix: 'INV',
	default_payment_terms: 'Net 30',
	default_tax_percent: 0,
	default_due: 'tomorrow'
};

export const START_PAGES = [
	{ value: '/', label: 'Dashboard' },
	{ value: '/actions', label: 'Action items' },
	{ value: '/mail', label: 'Mail' },
	{ value: '/projects', label: 'Projects' },
	{ value: '/invoices', label: 'Invoicing' }
] as const;

export const PAYMENT_TERM_OPTIONS = ['Due on receipt', 'Net 7', 'Net 15', 'Net 30', 'Net 45', 'Net 60'];

/**
 * What the prototype draws and this does not build, with the reason.
 *
 * Shown on the page rather than kept here, because a reader who goes looking
 * for a control deserves to find out why it is missing on the screen where they
 * expected it, not in a source comment.
 */
export const NOT_BUILT: { label: string; why: string }[] = [
	{
		label: 'Timezone',
		why: 'The whole app is anchored to Mountain time: the cron triggers, the digests and every "today" are computed from it. Making it a preference is a change to that anchor, not a setting.'
	},
	{
		label: 'Currency',
		why: 'Invoices and the ledger are US dollars, and nothing here converts between currencies. A picker would let you choose a currency the figures would then ignore.'
	},
	{
		label: 'Date format',
		why: 'Dates are formatted in about two hundred places. Threading a preference through all of them is a real change; a module-level default would be shared across requests on the server, which is a bug waiting for a second user.'
	},
	{
		label: 'Quiet hours',
		why: 'Nothing is ever pushed to a phone, so there are no alerts to silence. The digests are email, on a schedule, and can be turned off above.'
	},
	{
		label: 'Session length and sign out everywhere',
		why: 'Sessions belong to Cloudflare Access, not to this app. The control lives in the Access dashboard, and a copy of it here would be a switch that changes nothing.'
	},
	{
		label: 'At-risk after N days, weekly capacity, snooze presets, confirm before done',
		why: 'Each needs wiring into a module it does not yet touch. They are worth building and are not built, which is a different thing from a switch that stores a value nothing reads.'
	}
];

/** Narrows an unknown blob to Settings, filling anything missing from defaults. */
export function readSettings(raw: unknown): Settings {
	const value = (raw ?? {}) as Partial<Settings>;

	const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
		typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

	const text = (v: unknown, fallback: string, max = 120) =>
		typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : fallback;

	const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

	/**
	 * A number that is not a number falls back rather than becoming NaN.
	 *
	 * A NaN tax rate reaches an invoice as a total of NaN, which renders as
	 * nothing at all and is the most expensive kind of blank on the screen.
	 */
	const percent = (v: unknown, fallback: number) => {
		const n = Number(v);
		return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
	};

	return {
		workspace_name: text(value.workspace_name, DEFAULT_SETTINGS.workspace_name),
		week_starts_on: oneOf(value.week_starts_on, ['monday', 'sunday'], 'monday'),
		morning_digest: flag(value.morning_digest, DEFAULT_SETTINGS.morning_digest),
		evening_digest: flag(value.evening_digest, DEFAULT_SETTINGS.evening_digest),
		density: oneOf(value.density, ['comfortable', 'compact'], 'comfortable'),
		zebra_rows: flag(value.zebra_rows, DEFAULT_SETTINGS.zebra_rows),
		start_page: oneOf(
			value.start_page,
			START_PAGES.map((p) => p.value),
			'/'
		),
		invoice_prefix: text(value.invoice_prefix, DEFAULT_SETTINGS.invoice_prefix, 8)
			.toUpperCase()
			.replace(/[^A-Z]/g, '') || DEFAULT_SETTINGS.invoice_prefix,
		default_payment_terms: text(
			value.default_payment_terms,
			DEFAULT_SETTINGS.default_payment_terms
		),
		default_tax_percent: percent(value.default_tax_percent, DEFAULT_SETTINGS.default_tax_percent),
		default_due: oneOf(value.default_due, ['today', 'tomorrow', 'none'], 'tomorrow')
	};
}
