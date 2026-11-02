# P3-capture-drain-login: the capture drain runs from the VPS on its own login

## What changes

Since #3861 the website keeps an exact copy of every genuine PiggyVest
notification before it replies. This change adds the background job that
finishes any stored notification whose processing did not complete.

- A new database role can only take a stored notification off the queue,
  settle one it took itself, and read queue counts. It cannot log in, store
  new notifications or read the stored data directly.
- The job runs every minute on the VPS under a separate login that you
  create later from the runbook. It never uses the all-powerful admin key.
- A readiness check confirms that login, the schedule, the VPS signing
  keys, that alerts reach PostHog, and that nothing waits too long.

## Why

Without this job, a notification that failed after it was stored waits until
PiggyVest resends it, and PiggyVest stops resending after ten tries. Rule R5
requires finishing it automatically.

## What could go wrong and how it is prevented

- **Paying twice.** Every ledger that moves money ignores a transaction it has
  already applied. The tests crash the job mid-run and check the money moves
  exactly once.
- **The job using too much power.** Before every action it checks it is its
  own login, in one role only, with no special rights, over an encrypted
  connection. A database test runs that exact check.
- **Old-style notifications.** These need the admin key, which the job does
  not have. It sets them aside for review with an alert, so they never hold
  up other work; PiggyVest's resend still closes them.
- **A missing or outdated key on the VPS.** The notification waits instead of
  being treated as forged, and readiness names the missing key.
- **Alerts nobody sees.** VPS alerts go to PostHog; readiness fails without it.

## How it is tested

Automated tests cover: the switch off means no database connection; a login
with an extra role or without encryption is refused; #3861's job tests run
through the new database path; a crashed run is picked up later and applied
once; set-aside notifications never come back to block new deposits; a
notification signed with a key the VPS lacks waits; and nothing the job runs
can reach an admin connection.

## How it stays switched off

Nothing runs until three things happen, each by you: the login is created,
its password is put on the VPS, and `PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED`
is set to `true` there. Until then the job wakes each minute and exits
immediately, and the website keeps answering "try again" so PiggyVest keeps
resending.
