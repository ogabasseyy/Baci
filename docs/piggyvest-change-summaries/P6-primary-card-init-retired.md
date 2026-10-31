# P6: card top-up into the PiggyVest wallet is permanently switched off

## What changes

- The web endpoint that starts a card top-up into the PiggyVest primary wallet
  now always answers "no longer available" (HTTP 410, code
  `PRIMARY_CARD_FUNDING_RETIRED`), before it checks who is asking, reads any
  settings, or contacts Paystack or the database.
- The app's card database connector no longer contains the instructions that
  start a card top-up. Only the read and clean-up instructions remain.
- A new database change removes everyone's permission to run the three
  database steps that start a card top-up, including their owner.
- Checking the status of an existing card top-up no longer tries to restart a
  stuck one. It only asks Paystack what happened and records the answer.
- A bug in the clean-up tool for abandoned card checkouts is fixed: it failed
  whenever it found something to clean up.

## Why

You decided card funding into PiggyVest is dropped. Until now the refusal
relied on the feature's settings being off; filling them in would have started
card top-ups again. Now the refusal is built into the code and the database, so
no setting can turn it back on.

## What could go wrong and how it is prevented

- **A customer is mid-way through a card top-up when this ships.** Before
  merging, a read-only count (in `docs/ops/primary-card-funding-retirement.md`)
  must show no open card top-ups. If any show up, merging stops until they are
  resolved.
- **A payment that already happened is lost.** Status checks, Paystack
  notifications and the clean-up tool keep working, so existing payments are
  still recorded and passed on for crediting.
- **Older app versions show an error.** Older apps only reach this endpoint
  when the PiggyVest wallet is reported as enabled for them, and it is not.
  They keep using today's regular top-up.
- **Someone rolls back the code.** The database still refuses, so even old
  code cannot start a card top-up.

## How it is tested

- With every card setting filled in with working values, a test shows the
  endpoint still refuses without touching login, settings, Paystack or the
  database.
- Tests show status checks still resolve existing top-ups and never restart
  one.
- A test runs the real clean-up tool end to end and shows it completes
  without the retired steps.
- A database check, run on every pull request, confirms no role can run the
  three retired steps while the status and clean-up steps keep their
  permissions.

## How it stays switched off

There is no switch. The refusal lives in the code and in the database
permissions. Turning card funding back on would need a new, reviewed database
change and your explicit decision.
