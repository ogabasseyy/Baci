# P6: card top-up into the PiggyVest wallet is permanently switched off

## What changes

- The web endpoint that starts a card top-up into the PiggyVest primary wallet
  now always answers "no longer available" (HTTP 410, code
  `PRIMARY_CARD_FUNDING_RETIRED`), before it checks who is asking, reads any
  settings, or contacts Paystack or the database.
- The app's card database connector no longer contains the steps that start a
  card top-up.
- A database change removes everyone's permission to run the three steps that
  start a card top-up, including permissions given only in production. It
  checks its own work and stops the deploy if anyone could still run them.
- Checking an existing card top-up no longer tries to restart a stuck one.
- The clean-up tool for abandoned card checkouts is fixed: it failed whenever
  it found something to clean up.
- The mobile app treats the new answer like today's "not available": it
  forgets an unfinished top-up that never started and uses the regular top-up.

## Why

You decided card funding into PiggyVest is dropped. Until now the refusal
relied on settings being off; filling them in would have restarted card
top-ups. Now the code and the database refuse, whatever the settings say.

## What could go wrong and how it is prevented

- **A customer is mid-way through a card top-up when this ships.** Before
  merging, a read-only count (`docs/ops/primary-card-funding-retirement.md`)
  must show no open card top-ups; otherwise merging waits.
- **A payment that already happened is lost.** Status checks, Paystack
  notifications and the clean-up tool keep working, so existing payments are
  still recorded.
- **A phone gets stuck on "pending".** A phone that saved a top-up but never
  learned its number retries without checking whether the wallet is enabled.
  The updated app moves on to the regular top-up. Older app versions keep
  showing "pending" until updated; no money moves.
- **Someone rolls back the code.** The database still refuses.

## How it is tested

- With every card setting filled in, the endpoint still refuses without
  touching login, settings, Paystack or the database.
- Status checks still resolve existing top-ups and never restart one.
- The real clean-up tool runs end to end.
- A database check on every pull request adds an extra permission, re-applies
  the change and confirms no role can run the retired steps, while status and
  clean-up keep theirs.
- Mobile tests show an unfinished top-up is released and the regular top-up
  runs, while one that may have been paid is kept.

## How it stays switched off

There is no switch. Turning card funding back on would need a new, reviewed
database change and your explicit decision.
