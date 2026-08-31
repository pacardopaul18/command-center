/**
 * Local calendar seed, for building and reviewing the Calendar screen.
 *
 * LOCAL ONLY, same rule as the mail seed: it writes to .wrangler/state and must
 * never be pointed at the remote database. Production holds three calendars and
 * one event, which is not enough to tell whether a week view works.
 *
 * Every title, attendee and address is invented for this file. D89.
 *
 *   node seed/calendar-preview.mjs          seed
 *   node seed/calendar-preview.mjs --clear  remove it
 *
 * Two accounts, because All-calendars attribution cannot be seen with one.
 */

import { DatabaseSync } from 'node:sqlite';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const A = 'preview-personal';
const B = 'preview-firm';

function open() {
	if (!existsSync(DIR)) throw new Error('Run npm run dev once first.');
	const f = readdirSync(DIR).find((x) => x.endsWith('.sqlite') && x !== 'metadata.sqlite');
	return new DatabaseSync(join(DIR, f));
}

const db = open();
const NOW = new Date('2026-08-31T00:00:00Z');

/** A day offset from the anchor, at a given hour, as an ISO instant. */
function at(dayOffset, hour, minutes = 0) {
	const d = new Date(NOW);
	d.setUTCDate(d.getUTCDate() + dayOffset);
	d.setUTCHours(hour, minutes, 0, 0);
	return d.toISOString().replace('.000Z', 'Z');
}

function dayOnly(dayOffset) {
	const d = new Date(NOW);
	d.setUTCDate(d.getUTCDate() + dayOffset);
	return d.toISOString().slice(0, 10);
}

function clear() {
	for (const acc of [A, B]) {
		db.prepare(
			`DELETE FROM calendar_event_attendees WHERE event_id IN
       (SELECT id FROM calendar_events WHERE connection_id = ?)`
		).run(acc);
		db.prepare(
			`DELETE FROM calendar_event_state WHERE event_id IN
       (SELECT id FROM calendar_events WHERE connection_id = ?)`
		).run(acc);
		db.prepare("DELETE FROM calendar_events WHERE id LIKE 'cal-seed-%'").run();
	}
	db.prepare("DELETE FROM calendar_sync_state WHERE calendar_id LIKE '%-cal'").run();
}

/**
 * A working fortnight either side of the anchor. Deliberately includes the
 * cases a week view gets wrong: all-day events, a cancelled one, an overlap,
 * something in the past, and a long meeting spanning the afternoon.
 */
const EVENTS = [
	{ d: -6, h: 10, len: 60, title: 'Stonebridge kickoff', acc: A, people: 4 },
	{ d: -3, h: 15, len: 30, title: 'Harborlight check-in', acc: A, people: 2 },
	{ d: -1, h: 9, len: 45, title: 'Weekly planning', acc: A, people: 1 },
	{ d: 0, h: 9, len: 30, title: 'Standup', acc: A, people: 3 },
	{ d: 0, h: 11, len: 60, title: 'Caldera scoping call', acc: A, people: 3, response: 'accepted' },
	{ d: 0, h: 11, len: 30, title: 'Overlapping vendor demo', acc: A, people: 2, response: 'declined' },
	{ d: 0, allDay: true, title: 'Quarter close', acc: B, people: 0 },
	{ d: 1, h: 14, len: 180, title: 'Migration dry run', acc: A, people: 5 },
	{ d: 1, h: 9, len: 30, title: 'Cancelled: budget review', acc: A, people: 3, cancelled: true },
	{ d: 2, h: 16, len: 60, title: 'Pineda invoice discussion', acc: A, people: 2 },
	{ d: 3, h: 10, len: 45, title: 'Vantage partners sync', acc: B, people: 4 },
	{ d: 4, allDay: true, title: 'Public holiday', acc: A, people: 0 },
	{ d: 5, h: 13, len: 90, title: 'Twin Peaks reporting workshop', acc: A, people: 6 },
	{ d: 8, h: 11, len: 30, title: 'Renewals review', acc: B, people: 2 },
	{ d: 11, h: 15, len: 60, title: 'Board pack walkthrough', acc: B, people: 3 }
];

const NAMES = [
	['Rina Dela Cruz', 'rina@harborlight.invalid'],
	['Dex Malabanan', 'dex@stonebridge.invalid'],
	['Joy Fernandez', 'joy@caldera.invalid'],
	['Marco Uy', 'marco@twinpeaks.invalid'],
	['Anna Lim', 'anna@twinpeaks.invalid'],
	['Noel Bautista', 'noel@caldera.invalid']
];

const RESPONSES = ['accepted', 'declined', 'tentative', 'needsAction'];

function seed() {
	clear();
	const now = '2026-08-31T00:00:00Z';

	// The calendars themselves come from the mail seed's accounts.
	for (const acc of [A, B]) {
		const exists = db.prepare('SELECT id FROM connections WHERE id = ?').get(acc);
		if (!exists) {
			console.log(`Account ${acc} is missing. Run seed/mail-preview.mjs first.`);
			process.exit(1);
		}
	}

	let n = 0;
	for (const e of EVENTS) {
		const id = `cal-seed-${n}`;
		const owner = e.acc;
		const startsAt = e.allDay ? dayOnly(e.d) : at(e.d, e.h);
		const endsAt = e.allDay ? dayOnly(e.d + 1) : at(e.d, e.h, e.len);

		db.prepare(
			`INSERT INTO calendar_events
       (id, connection_id, calendar_id, provider_event_id, summary, description, location,
        starts_at, ends_at, all_day, organizer, attendee_count, html_link, fetched_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
		).run(
			id,
			owner,
			`${owner}-cal`,
			`${id}-p`,
			e.title,
			e.people > 0 ? 'Agenda and notes live in the thread.' : null,
			e.people > 2 ? 'Google Meet' : null,
			startsAt,
			endsAt,
			e.allDay ? 1 : 0,
			e.people > 0 ? NAMES[n % NAMES.length][1] : null,
			e.people,
			`https://calendar.google.com/calendar/event?eid=${id}`,
			now
		);

		if (e.cancelled || e.response) {
			db.prepare(
				`INSERT INTO calendar_event_state (event_id, cancelled_at, own_response, updated_at)
         VALUES (?,?,?,?)`
			).run(id, e.cancelled ? now : null, e.response ?? null, now);
		}

		for (let i = 0; i < e.people; i++) {
			const [name, email] = NAMES[(n + i) % NAMES.length];
			db.prepare(
				`INSERT INTO calendar_event_attendees
         (id, event_id, email, display_name, response_status, is_organizer, is_self, created_at)
         VALUES (?,?,?,?,?,?,?,?)`
			).run(
				`${id}-a${i}`,
				id,
				email,
				name,
				RESPONSES[(n + i) % RESPONSES.length],
				i === 0 ? 1 : 0,
				0,
				now
			);
		}
		n++;
	}

	const total = db.prepare("SELECT COUNT(*) n FROM calendar_events WHERE id LIKE 'cal-seed-%'").get().n;
	const people = db
		.prepare("SELECT COUNT(*) n FROM calendar_event_attendees WHERE event_id LIKE 'cal-seed-%'")
		.get().n;
	console.log(`Seeded ${total} events and ${people} attendees across two accounts (local only).`);
}

if (process.argv.includes('--clear')) {
	clear();
	console.log('Calendar seed removed.');
} else {
	seed();
}
db.close();
