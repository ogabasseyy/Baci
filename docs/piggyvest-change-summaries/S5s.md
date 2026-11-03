# S5s: wallet PIN routes for the storefront customer

## What changes

Four server routes are added so a signed-in storefront customer can manage a wallet PIN: check its status, set the first PIN, change it, and reset it. Status reports four plain facts: whether this is the primary wallet, whether a PIN exists, whether a reset is needed, and whether PIN handling is available at all. Stable error codes cover wrong PIN, locked, already set, not set, reset needed, and sign-in too old. The runbook names the routes. They get their own limit of ten requests a minute.

## Why

The database already stores PINs, but nothing on the server could call it. The runbook lists the PIN routes as a prerequisite for switching PINs on, and the savings PIN check cannot work for a customer who has no way to set a PIN.

## What could go wrong and how it is prevented

- A customer picks their own hash. The server alone turns the PIN into a stored value using the secret pepper and signs every request, so the database refuses anything the server did not make.
- A customer acts on another shop or account. The shop comes from the server's wallet configuration and the account from the sign-in, never from the request. A request carrying any extra field is rejected.
- A PIN leaks. It is checked for shape, never logged, never returned, and never placed in an error. Tests look for it in every response and in all log output.
- Guessing or heavy hashing load. The database locks after five wrong PINs, and the routes are limited per caller and stop working when the shared limiter is unavailable.
- Reset by a stolen old session. The database requires a recent sign-in and the routes pass its answer through without weakening it.
- The signing time going stale during slow hashing. The time is taken after the hashing, right before the database call.
- Unexpected database answers become "temporarily unavailable", never success.

## How it is tested

Tests cover each route for sign-in first, the forgery check, malformed or invalid input, a missing or too-short pepper, success, wrong PIN, lockout, reset needing a fresh sign-in, and the PIN never appearing in output. The server-side hashing and signing are compared against the existing helpers. Database calls are mocked.

## How it stays switched off

Nothing is switched on. Without the pepper secret, the signing key row and an enabled shop row, status says "not available" and the other routes answer "unavailable". The primary wallet setting must also be on for the routes to do anything. No database change is made.
