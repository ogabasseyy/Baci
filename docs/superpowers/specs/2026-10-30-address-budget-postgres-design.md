# PostgreSQL address spending ledger

The user approved moving address budget counters into the existing database on 2026-10-30 after the Redis outage investigation. The ongoing zero-spend requirement remains; the cost question does not authorize paid usage. Normal reviewed publication is already authorized. This replaces address reservation storage only, preserving the deployed pickup fix and separate broad PR #3835.

## Selected approach and scope

Use a dedicated private PostgreSQL ledger and a narrow server-signed reservation capability, following the repository's scoped JWT pattern. Reusing the cart counter is unsuitable: its one-hour retention cannot preserve daily/monthly usage. Process-local counters would multiply the allowance across servers. New Redis/paid infrastructure is outside scope.

Google keeps the conservative 4,400 autocomplete / 4,500 combined monthly attempt ceilings; Geoapify keeps 2,800 rolling-day attempts and global 250 ms spacing. SKU-aware Google optimization is a separate change. These are app ceilings, not a guarantee that unrelated account usage is free.

## Authority and data

Stage the request guard and observe its anonymous reload canary before granting authenticator membership. Create append-only migrations for private `address_budget` tables, RLS, and a dedicated NOLOGIN/NOBYPASSRLS role. Reuse existing JWT signing material; no new secret, service-role client, browser authority, or customer/address data. The server capability binds provider, request kind, a SHA-256 credential fingerprint, one reservation UUID, and exactly sixty seconds. It may call only `/rpc/reserve_address_provider_request`; the existing PostgREST pre-request guard gets one narrow branch without changing existing roles.

An owner-provisioned authorization records provider/account scope, accepted key fingerprints, period, verified consumed baseline, evidence timestamp/reference, expiration, and cutover/fencing evidence. Request credentials cannot create/reset authorizations. Unknown, expired, mismatched or absent authorization denies. Google periods use America/Los_Angeles; a new month never silently assumes zero external usage. Geoapify baseline debt remains for a conservative 24 hours unless verified retained event history is imported.

## Atomic reservation

One transaction-level lock per provider serializes baseline plus new attempts. Each upstream retry needs a new reservation. Preserve reservations after provider errors or ambiguous database timeouts. A repeated reservation ID does not grant another upstream dispatch. Geoapify pacing retries once, without consuming a unit until admitted. No automatic Redis fallback, process-local development admission, or independent parallel ledger. The reservation receives the exact trimmed API key already captured for the upstream attempt.

## Cutover and activation

Ship tested storage support with no active authorizations. Before admitting production usage, reconcile account-wide free allowance, retained Redis history and unresolved attempts; fence all old/preview consumers or conservatively reserve their remaining possible liability. Do not clear keys, switch to an empty store, infer zero from a new period, or revoke/change credentials under this task.

If exact history or old-instance fencing is unavailable, leave the relevant authorization unavailable and retain manual Store Pickup. Report that as an activation blocker rather than a completed suggestion recovery.

## Verification

Test real PostgreSQL permission/RLS behavior, unknown and expired authorization, provider/key mismatch, monthly and rolling-window boundaries, baseline debt, request replay, concurrent reservations at the ceiling, and global pacing. Unit tests cover the scoped client, response validation and fail-closed timeout behavior; route regressions prove a Redis outage no longer controls an authorized database reservation, and an unavailable database never dispatches to a paid provider. No live Google, Geoapify or GIG probes, orders or payments. Full repository checks and review gates apply before publication.

