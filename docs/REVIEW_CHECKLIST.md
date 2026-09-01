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
