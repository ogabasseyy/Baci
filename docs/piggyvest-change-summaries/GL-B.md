# The deposit safety check now really checks, instead of always saying no

Task: GL-B
Owner sign-off: required

## What changes

The database check that decides whether a bank deposit may be credited to a PiggyVest-backed wallet used to answer "not ready" for everything. It now answers "ready" for the two deposit paths (the direct inflow handler and the bank inbox worker) only when the pieces those paths depend on are in place, and otherwise lists each missing piece by a fixed code. Every other surface, any unknown surface and any error still answer "not ready".

## What it checks

- The deposit ledger tables and functions exist.
- The database login the path runs as exists, can log in, is not elevated and has not expired.
- Inflow: the login holds exactly the evidence role, can run the ledger entry point, has an enabled inflow authority and its integration is enabled.
- Bank inbox: the worker's session safety check is clean, its bank authority and integration are enabled and agree on merchant, business and environment, and the integration's inflow authority is enabled. When several integrations share the one worker login, every one of them must pass: a healthy integration cannot make the worker look ready while another is disabled or broken (a retired authority row for the login must be removed, or it keeps the worker not ready).

## Not checked here (open questions)

- The master kill switch is a web environment setting the database cannot see. It still stops new deposits where it is read.
- The database cannot see the web flags (inflow and bank inbox switches), the provider webhook secret, or whether the provider side is ready.
- Surfaces other than inflow and bank_inbox (settlement, spend, goals and so on) answer "not supported" until their own fences are defined.

## How it stays switched off

Nothing here turns a deposit switch on. Production keeps every PiggyVest switch off, so no deposit reaches this check. Who may call the check is unchanged.

## How it is tested

A database test proves ready with every piece present, not ready with each piece missing on its own, unknown and unsupported surfaces refused, errors treated as not ready, and the grants unchanged.
