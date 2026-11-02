# Transaction PIN store for wallet payments

Task: P6-wallet-pin-db
Owner sign-off: not required

## What changes

This adds the database side of a wallet PIN and the server code that hashes it. A customer sets a PIN once and changes it with the old one; setting the first PIN or resetting it needs a sign-in within 15 minutes. The PIN is never stored: the server mixes it with a secret key and a salt, and the database keeps a one-way fingerprint of that in a private area no app or API key can read. A correct PIN gives a one-time "proof" for one exact payment, valid 120 seconds.

## Why

Plan default 2: every PiggyVest wallet payment needs the PIN, so an unlocked phone or stolen login cannot spend the wallet. Tying the proof to one payment stops it being reused or stretched.

## What could go wrong and how it is prevented

- Guessing: five wrong tries lock the PIN for 30 minutes; each later lock doubles, up to 24 hours. Simultaneous tries all count.
- A stolen database copy cannot be used to guess PINs without the server's key, and a copied value is not accepted as the PIN.
- An old or stolen session cannot set the first PIN or reset one; adding a sign-in step from that session does not count.
- If a customer record is moved to another account, the PIN stops working instead of passing over.
- A proof is spent once, even by two requests at the same moment, expires after 120 seconds, and is refused for any other customer, shop, purpose, amount or request. A refusal never uses up a good proof.
- A changed key asks for a reset, not a lockout; a mistyped key keeps PINs off but never takes the website down.
- Emergency stop: switching a shop off at once stops every PIN action and proof spend, so protected payments are refused.

## How it is tested

Database tests cover lock times, sign-in rules, single use, expiry, every mismatch, the 10-proof limit, the shop switch, moved and deleted customers, and racing requests. Permission checks confirm no app or API role can read the PIN tables or spend a proof. Each rule was broken on purpose, one at a time (59 variations), and the tests caught every one. Server tests check the hashing against independent values, and that the key never appears in errors or stops the site starting.

## How it stays switched off

Nothing spends a proof yet. With the server's PIN key unset, no PIN can be set. Every shop's PIN switch starts off; only an owner-approved runbook step turns one on.
