# S5s: wallet PIN routes for the storefront customer

## What changes

Four server routes are added so a signed-in storefront customer can manage a wallet PIN: check its status, set the first PIN, change it, and reset it. Status reports four plain facts: whether this is the primary wallet, whether a PIN exists, whether a reset is needed, and whether PIN handling is available at all. Changes are limited to ten a minute, counted once by the shared limiter, and status reads have their own allowance. Status also reports "not available" when the signing key is missing, through a small database change that only affects that read.

## Why

The database already stores PINs, but nothing on the server could call it. The savings PIN check cannot work for a customer who has no way to set a PIN.

## What could go wrong and how it is prevented

- A customer picks their own hash. The server alone turns the PIN into a stored value using the secret pepper and signs every request, so the database refuses anything the server did not make.
- A customer acts on another shop or account. The shop comes from the server's wallet configuration and the account from the sign-in, never from the request. A request carrying any extra field is rejected.
- A PIN leaks. It is checked for shape, never logged, never returned, and never placed in an error. Tests check every response and log.
- Guessing or heavy hashing load. The database locks after five wrong PINs, and the routes are limited per IP address (IPv6 per /64 block, not per customer; a per-customer limiter is a pre-enable prerequisite in the runbook) and stop working when the shared limiter is unavailable.
- Reset by a stolen old session. The database requires a recent sign-in.
- A stale signing time. It is taken after hashing, right before the database call.
- Unexpected database answers become "temporarily unavailable", never success.

## How it is tested

Tests cover each route for sign-in first, the forgery check, malformed or invalid input, a missing or too-short pepper, success, wrong PIN, lockout, reset needing a fresh sign-in, and the PIN never appearing in output. Hashing and signing are compared against the existing helpers, with database calls mocked. One test runs the shared limiter with a route and checks it is charged once; a database test checks status goes unavailable without the signing key.

## How it stays switched off

Nothing is switched on. Without the pepper secret, the signing key row and an enabled shop row, status says "not available" and the other routes answer "unavailable". The primary wallet setting must also be on for the routes to do anything. The one database change only makes status more cautious.
