# Transaction PIN store for wallet payments

Task: P6-wallet-pin-db
Owner sign-off: not required

## What changes

This adds the database side of a wallet PIN and the server code that hashes it. A customer sets a PIN once and changes it with the old one; setting the first PIN or resetting it needs a sign-in within 15 minutes. The PIN is never stored: the server mixes it with a secret key and a salt, and the database keeps a one-way fingerprint of that in a private area no app or API key can read. A correct PIN gives a one-time "proof" for one exact payment, valid 120 seconds. Every PIN request also carries a short-lived signature from the server, made with a second key the database holds, so the database only accepts a fingerprint the server itself produced.

## Why

Plan default 2: every PiggyVest wallet payment needs the PIN, so an unlocked phone or stolen login cannot spend the wallet. Tying the proof to one payment stops it being reused or stretched.

## What could go wrong and how it is prevented

- Guessing: five wrong tries lock the PIN for 30 minutes; each later lock doubles, up to 24 hours. Simultaneous tries all count.
- A stolen database copy cannot be used to guess PINs without the server's key, and a copied value is not accepted as the PIN.
- A signed-in customer cannot skip the server by calling the database directly with a PIN fingerprint they made up: set, change, reset and check all need the server's signature for that exact customer, shop and request, no more than two minutes old, and are refused (and change nothing) without it. The signing key is a one-way derivative of the server key, kept in a private table only the owner can read. Until the owner adds it, every PIN action answers "unavailable".
- An old or stolen session cannot set the first PIN or reset one; adding a sign-in step from that session does not count.
- If a customer record is moved to another account or shop, the PIN stops working instead of passing over.
- A proof is spent once, even by two requests at the same moment, expires after 120 seconds, and is refused for any other customer, shop, purpose, amount or request. A refusal never uses up a good proof. The refusal reason is decided in a fixed order (wrong proof, then different payment, then already used, then expired), so "already used" and "expired" only ever describe the payment the proof was made for.
- Waiting never helps an attacker or hurts a customer: every time check (lockout start, proof expiry, the age of a sign-in, a new proof's start time) is read after the database has the row it was waiting for, not before.
- A changed key asks for a reset, not a lockout; a mistyped key keeps PINs off but never takes the website down.
- Emergency stop: switching a shop off at once stops every PIN action and proof spend, so protected payments are refused.

## How it is tested

Database tests cover lock times, sign-in rules, single use, expiry, every mismatch, the 10-proof limit, the shop switch, moved and deleted customers, racing requests, and calls with a made-up fingerprint and no valid server signature (refused for set, change, reset and check). Permission checks confirm no app or API role can read the PIN tables or spend a proof. In an earlier round each rule was broken on purpose, one at a time, and the tests caught every one; the suites have changed since, and no count is claimed for this round (CI runs the suites on the database). Server tests check the hashing and the signing against independent values, that the keys never appear in errors or stop the site starting, and that the secret is not part of the build settings.

## How it stays switched off

Nothing spends a proof yet. With the server's PIN key unset, no PIN can be set, and with no signing key in the database nothing can be set or checked either. Every shop's PIN switch starts off; only owner-approved runbook steps add the signing key and turn a shop on.

The server's PIN key is also checked for variety: a long but repetitive value is treated as unset, so the key must be randomly generated.
