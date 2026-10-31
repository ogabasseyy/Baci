# P3-capture-drain-login: the capture drain runs from the VPS on its own login

## What changes

Since #3861 the website keeps an exact copy of every genuine PiggyVest
notification before it replies. This change adds the background job that
finishes any stored notification whose processing did not complete.

- A new database role, `piggyvest_webhook_capture_worker`, can only take a
  stored notification off the queue, mark it done or put it back, and read
  queue counts. It cannot log in, cannot store new notifications and cannot
  read the stored data directly.
- The job runs every minute on the VPS under a separate login that you
  create later from the runbook. It never uses the all-powerful admin key.
- A readiness check now also confirms that login and that the job is
  switched on and scheduled.

## Why

Without this job, a notification that failed after it was stored waits until
PiggyVest resends it, and PiggyVest stops resending after ten tries. Rule R5
requires finishing it automatically.

## What could go wrong and how it is prevented

- **Paying twice.** Every ledger that moves money ignores a transaction it has
  already applied, so finishing the same notification again changes nothing.
  The tests crash the job mid-run and check the money moves exactly once.
- **The job using too much power.** Before every action it checks it is
  connected as exactly its own login, that the login belongs to one role
  only, has no special rights, and uses an encrypted connection. Otherwise it
  stops.
- **Old-style notifications.** Older ("legacy") notifications need the admin
  key, which the job does not have. It leaves them in the queue and raises
  an alert, and PiggyVest's resend still covers them. The runbook says not to
  turn on the "job owns the retry" switch while an old-style key is set.
- **Forged data.** Each stored notification's signature is checked again
  before use.

## How it is tested

Automated tests cover: the switch off means no database connection at all;
a login with an extra role or without encryption is refused; all of #3861's
existing job tests now run through the new database path; a crashed run is
picked up after five minutes and applied once; old-style notifications are
put back with an alert and no admin connection is ever made. A database test
checks the role's exact permissions.

## How it stays switched off

Nothing runs until three things happen, each by you: the login is created,
its password is put on the VPS, and `PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED`
is set to `true` there. Until then the job wakes each minute and exits
immediately, and the website keeps answering "try again" so PiggyVest keeps
resending.
