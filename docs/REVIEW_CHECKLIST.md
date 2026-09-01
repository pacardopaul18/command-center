# Review checklist

What every new job, route or connector is checked against before it is called
done. Short on purpose: these are the failures that have actually happened in
this repo, not a general list of good practice.

Each item names the decision it comes from. If a check does not apply, say so
and why, rather than skipping it silently, which is the same failure the list
exists to catch.

---

## 1. Is it off by decision, or only by missing configuration?

**D180, D184.** A capability prevented only by an absent credential, an unset
environment variable or an unchosen setting is not disabled. It is armed and
waiting for the next obvious click.

- Is there an explicit switch, and is it off by default?
- Is it off for state written before the switch existed, rather than on by
  omission?
- Does only an affirmative value enable it, so a write that forgot to mention it
  cannot turn it on?
- Is the switch checked **before** the credential and the configuration, so the
  refusal never depends on which other things happen to be missing?

Found by asking it: the one-way Asana push was held back only by no workspace
having been chosen, and choosing one to make the mirror settings coherent would
have armed it.

**The boundary, because without it this question stops discriminating.** A
feature that was asked for, is on by default, and runs when its credential is
supplied is **on by design**. The daily digests are that: an email to Paul's own
inbox is the ruled MVP feature, the preference is read and a skip is logged, and
setting `RESEND_API_KEY` turns on a thing somebody wanted. A capability nobody
chose, that runs because some value happens to be set, is **armed by omission**.
The Asana push was that.

The test is not "does it need configuration to run". Everything does. It is
whether a person decided this should happen. Treat every default-on feature as a
finding and the rule is retired within a week.

## 2. Does every early exit say that it stopped, and why?

**D138, D185.** A path that ends before completing and stays quiet produces a
run that looks finished. Three instances of this family so far: a seed load that
reported success having reloaded nothing, a job that returned success with
all-zero counts, and a driver that hit its own step cap and fell out of its loop
without a word, 253 tasks short.

- Every `return`, `break` and bound states what it did and why it stopped.
- A count is accompanied by what it is a count of.
- A non-interactive runner exits non-zero when it did not finish.
- A limit that fires is reported, not merely obeyed.

**Two stops that are not the same stop.** D201. A per-call budget check and a
pre-run projection are both correct and they protect different things. The
per-call check evaluates before each call, so a run that would cost four times
its allowance *begins*, spends the allowance, and stops. The projection is
computed before the first call, so the same run never starts. When the question
is "can this overspend", the answer is the first. When it is "will this fit",
only the second answers, and reporting a projection alongside the charge is a
receipt rather than a decision.

## 3. Can the test fail?

**D80, D180.** A safety test that passes because the dangerous thing could not
have happened anyway is asserting the state of the environment, not the
behaviour of the code. The environment is what changes.

- Would this test fail if the guard were deleted and the credential present?
- Does it assert the **reason** for a refusal, not just that something refused?
- Has the guard it names ever actually executed?

## 4. Does what it reports match what is stored?

**D157, D174.** A loader that reports its own effort will report success on a
file that collided with itself. The crosswalk wrote 55 rows into 45 slots,
reported "55 written", and lost ten Asana gids with no failing number anywhere.

- Read the table back rather than trusting the loop's tally.
- Report both the attempt and the outcome when they can differ.
- Record the counts as a row, not a log line: the question is asked weeks later.

## 5. Is the answer derived, or guessed?

**D175.** An unmatched row is a real answer. A row filed under the wrong owner
is invisible and gets believed; an unfiled one is a question somebody answers
once.

- Is there an unassigned bucket, and is it visible?
- Does the record say **which** rule matched, so a guess cannot be mistaken for
  an exact match?
- Is the loose rule below the exact ones, and conservative enough that two real
  entities cannot collapse onto one key?

## 6. Does it write to a system it is supposed to read?

**D168, D176.** Asana and Dropbox are the source of truth and the app mirrors
them. Mirrored rows are re-pulled, never hand corrected: a local edit is a
correction the next sync silently reverts, and afterwards nobody can say which
was right.

- No outbound call from a read-only path, asserted by a test rather than
  intended.
- No write surface that "will be needed later". The absence is the mechanism.
- Provenance on every mirrored row: source id, and when it was last true.

## 7. Was it looked at, at both widths?

**D128, D167, D183.** Rendered verification at 1920 and 412, never 1440 alone.
A page can throw during hydration and still look almost right: sixteen chips
server-side, fifteen on screen, no error, no failed request, every written
assertion still passing.

- Rendered at 1920 and 412 with real data in it.
- Browser console read, not just the page looked at.
- One H1, 44px tap floor, no horizontal page scroll.

## 8. When something names more than one possible cause, which one was it?

**D188.** A gate that fails, an error that lists two explanations, a log line
with an "or": read the whole message, then confirm which branch actually
occurred before acting on it.

A push was rejected by the suite. The hook's message named two possibilities:
the volume fixture expiring overnight, or a dev server holding the build
directory open. The first was read, the fixture was regenerated and reloaded,
and the push failed again for the reason that had been sitting in the second
half of the same sentence. The gate was right both times.

- Read to the end of the message before acting on the start of it.
- Confirm the branch: run the narrower check, read the actual failing test, look
  at the state the message describes.
- A diagnosis that fits is not a diagnosis that was verified.

**A worked example, because this one nearly went the other way.** Pillar 4 was
ordered against real mail, and the question was whether the 21 threads in the
local database were real. The check made was for the `v-` prefix that marks
seeded rows. None of the threads had it.

That check proved nothing. The `v-` prefix is the *volume seed's* convention and
the mail fixture never used it, so its absence was evidence about the wrong
fixture. What settled it was the account domain: both connected mailboxes were
on `.invalid`, the TLD reserved for exactly this, and the mail was synthetic.

The failure mode to recognise: **a check that would have passed either way.** Ask
what the result would look like if the answer were the other one. If both
answers produce the same observation, the check is not a check. Here, real mail
and fixture mail both lack a `v-` prefix.

Had it gone the other way, a pass over 19 synthetic threads would have produced
counts, a spend line, and a report that looked exactly like the deliverable
while being about nothing.

This is a habit rather than a defect, which is why it is on a checklist rather
than in a test. It costs one command to confirm and an hour to guess wrong.

## 9. Is the property asserted about the thing that answers?

**D191.** A guarantee checked in the process that asks says nothing about the
system that responds. Fourth appearance of this family, and the most expensive:
the others were reports, this one was a control.

The suite creates rows and deletes them again, and its guarantee against running
on real data asserted `CC_DATA !== 'real'` inside the vitest process. That
variable is read by vite when a dev server starts. A suite run can point at a
server started hours earlier with different settings, and one was: a dev server
backed by the real mirror was answering on the suite's own base URL, on the IPv6
loopback, while the fixture server was stopped.

**No write reached the mirror. That was luck, not design.** The pre-flight
refused to start because it found zero action items, and it was looking for a
stale fixture, not for the wrong database. A check that saves you while looking
for something else has not been tested.

- Ask the system that answers. `/api/health` reports which database is behind
  it; the environment variable reports what somebody typed once.
- Assert it in both places that could act on it: the pre-flight that starts the
  run, and the test that claims the property.
- For any flag, credential or mode: is it read in the same process that does the
  dangerous thing? If not, the property is asserted about the wrong system.

---

## A note on revising a finding

A report corrected downward on evidence is the same discipline as one corrected
upward, and is easier to skip because nobody is harmed by the overstatement.

The `DIGEST_TO` fallback was first reported as a live misdirection risk. Checking
`wrangler.toml` showed the variable was set, so the fallback was latent: it would
only have fired if somebody deleted the var. The fix was still worth making and
the severity was still wrong, and both facts were recorded.

Say what changed, say what the evidence was, and do not quietly leave the
stronger version standing because it made the work look more valuable.

---

## Why the synthetic fixture exists

It is coverage, not convenience.

Real data is one shape. The Asana mirror gives every project a link, so a query
joining through that link never misses, and a defect on the null-join path is
invisible on it. The fixture has no mirror at all, so every one of those joins
misses, which is the other half of the space.

`HAVING archived = 0` against a `COALESCE(ap.archived, 0) AS archived` was the
demonstration. SQLite binds the bare name in `HAVING` to the real column
`asana_projects.archived`, not to the SELECT alias, and that column is NULL
where there is no link. `NULL = 0` is NULL, so the filter returned nothing. It
worked flawlessly on 66 real projects and emptied the screen on 220 fixture
ones. D192.

Two consequences worth keeping:

- **Write the expression, not the alias, in `HAVING` and `WHERE`** whenever a
  real column of the same name is in scope. The ambiguity resolves the other
  way.
- **A feature verified only against real data is half verified.** Run it against
  the fixture too, and treat a difference between the two as the finding rather
  than as an inconvenience.
