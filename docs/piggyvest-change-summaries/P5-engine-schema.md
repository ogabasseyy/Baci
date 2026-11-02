# P5-engine-schema: the transfer engine's foundations

## What changes

Database foundations for moving money between PiggyVest wallets. Nothing moves money yet.

- **Ogabassey's own wallets.** A register for the Collection, Interest and Fee naira wallets. Customer wallets are refused, checked wallets are locked, and switching one off always works.
- **Allowed movements.** Twelve fixed kinds of transfer, each with a set start and end. Any other route is refused.
- **Transfers and tries.** One record per movement; each try at PiggyVest gets its own reference, never reused. Tries only move forward; only a try never sent can be abandoned.
- **Spending holds** and **a small reader** for Ogabassey's wallets.
- **One door for balance changes**, used once per change, recording who asked and who applied it.
- **Empty settle and fail steps**, named as their owners' plans expect; a check lets only each named owner fill them in.

## Why

Every movement will go through one engine. Fixing its rules first stops later changes quietly altering how money moves.

## What could go wrong and how it is prevented

- **Paying back more than was taken.** Refunds and releases are capped at the amount taken, including waiting ones. No credit exceeds its own transfer, and a payment credit equals what PiggyVest confirmed. Anything else goes to review.
- **Returning money never taken.** A support payout is returned only after its freeze actually came off the balance.
- **Paying twice.** A transfer cannot be marked unpaid while a try might succeed, paid without a confirmed try, or reduced below a try in flight.
- **Applying a change twice.** A repeat writes nothing, even concurrently. A short database fault leaves a change for the next run.
- **Old balances.** Moving one never adds to it.
- **Switched-off wallets.** A switched-off goal wallet, or a house wallet a customer record claims, moves no money.
- **The app changing balances.** Only a dedicated login, not yet created, changes balances; the app only records requests.
- **Lost history.** Account deletion keeps settled records and is refused while money moves.
- **Public access.** Nothing is reachable with the app's public, customer or admin keys.

## How it is tested

Database tests on real PostgreSQL cover every route and state change, the caps, payout returns, the worker's limits, concurrent sessions, account deletion and permissions. Other tests cover the reader and ownership check. Each safety rule was broken on purpose to prove a test catches it.

## How it stays switched off

Every table starts empty. Only the owner adds Ogabassey's wallets, by a written guide. The engine logins do not exist yet, so nothing is applied, and the interest sweep refuses until built.
