# Transaction PIN store for wallet payments

Task: P6-wallet-pin-db
Owner sign-off: not required

## What changes

This adds the database side of a wallet PIN and the server code that hashes it. A customer can set a PIN once, change it with the old one, or reset it after signing in again within 15 minutes. The PIN is never stored: the server mixes it with a secret key and a random salt, and the database keeps only the result, in a private area no app, website or API key can read. A correct PIN gives a one-time "proof" that works once, for 120 seconds, for one exact payment.

## Why

Plan default 2: every PiggyVest wallet payment needs the customer's PIN, so someone with an unlocked phone or a stolen login cannot spend the wallet. Tying the proof to one payment (customer, shop, kind of purchase, amount and request) stops it being reused or stretched.

## What could go wrong and how it is prevented

- Guessing a PIN: five wrong tries lock it for 30 minutes; each later lock doubles, up to 24 hours.
- A stolen database copy: without the server's secret key the stored hashes cannot be used to guess PINs.
- Reusing a proof: it is spent on first use, expires after 120 seconds, and is refused for any other customer, shop, purpose, amount or request. A refused attempt does not use up a good proof.
- A forgotten PIN: reset needs a fresh sign-in, plus two-step verification when the customer uses it. It clears the lock and cancels unused proofs.
- A changed secret key: each PIN remembers which key made it, so a mismatch asks for a reset instead of locking everyone out.
- Emergency stop: switching a shop off at once stops new PINs, PIN checks and proof use, so protected payments are refused, never allowed.

## How it is tested

Database tests cover the lock times and 24-hour cap, the reset sign-in rules, single use, expiry, every mismatch, the limit of 10 open proofs and the shop switch. Permission checks confirm no app or API role can read the PIN tables or spend a proof directly. Each rule was broken on purpose, one at a time (38 variations), and the tests caught every one. Server tests check the hashing against independently computed values and that the secret never appears in errors.

## How it stays switched off

Nothing spends a proof yet. While the server's PIN secret key is unset, no PIN can be set through the app. Every shop's PIN switch starts off; only an owner-approved database step from the enablement runbook turns one on.
