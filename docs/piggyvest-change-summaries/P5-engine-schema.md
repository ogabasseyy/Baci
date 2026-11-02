# P5-engine-schema: the transfer engine's foundations

## What changes

Database foundations for moving money between PiggyVest wallets. Nothing moves money yet.

- **Ogabassey's own wallets.** A register for the Collection, Interest and Fee naira wallets. Customer wallets are refused and switching one off always works.
- **Allowed movements.** Twelve fixed kinds of transfer, each with a set start and end. Any other route is refused.
- **Transfers and tries.** One record per movement; each try at PiggyVest gets its own reference, never reused. Tries only move forward; only a try never sent can be abandoned.
- **Spending holds** and **a small reader** for Ogabassey's wallets. The reader answers only a login registered for that integration, and shows a wallet as ready only while it belongs to the integration's current PiggyVest business.
- **One door for balance changes**, used once per change, recording who asked and who applied it.
- **Empty settle and fail steps**; a check lets only each named owner fill them in.

## Why

Every movement will go through one engine. Fixing its rules first stops later changes quietly altering how money moves.

## What could go wrong and how it is prevented

- **Paying back more than was taken.** Refunds and releases are capped at the amount taken, including waiting ones.
- **Returning money never taken.** A support payout is returned only after its freeze actually came off the balance.
- **Paying twice.** A transfer cannot be marked unpaid while a try might succeed, paid without a confirmed try, or reduced below a try in flight.
- **Switched-off or outdated wallets.** A switched-off goal wallet, a house wallet a customer record claims, or a house wallet registered for a previous business moves no money.
- **Rewriting history.** A finished try cannot gain or change anything afterwards, and the times it was sent and resolved never change once set.
- **The app changing balances.** Only a dedicated login, not yet created, changes balances; the app only records requests.
- **Public access.** Nothing is reachable with the app's public, customer or admin keys.

## How it is tested

Database tests on real PostgreSQL cover every route and state change, the caps, the worker's limits, concurrent sessions and permissions. Other tests cover the reader and the ownership check, which now reads comments as blank space and also inspects helper functions outside the engine area. Each safety rule was broken on purpose to prove a test catches it.

## How it stays switched off

Every table starts empty. Only the owner adds Ogabassey's wallets, by a written guide. The engine logins do not exist yet, so nothing is applied, and the interest sweep refuses until built.
