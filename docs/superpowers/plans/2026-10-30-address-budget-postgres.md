# Address Budget PostgreSQL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the address flow's Redis reservation dependency without resetting consumed usage or permitting uncertain paid calls.

**Architecture:** A private PostgreSQL ledger owns verified allowance and immutable attempt reservations. A dedicated short-lived JWT can invoke one reservation RPC. Existing address APIs retain their public behavior and provider integrations.

**Tech Stack:** PostgreSQL/RLS, Supabase/PostgREST, TypeScript, Vitest, Node tests.

**Spec:** docs/superpowers/specs/2026-10-30-address-budget-postgres-design.md

## Global Constraints

- No paid provider calls, new credentials, service-role shortcut, counter reset, geolocation change, orders or payments.
- Preserve deployed manual-address Store Pickup and separate PR #3835.
- Google ceilings 4,400 predictions / 4,500 combined monthly; Geoapify 2,800 rolling 24 hours and 250 ms global pacing.
- Default unavailable until current allowance and cutover evidence are verified.
- Append-only migration; narrow new role and guard branch; unchanged existing-role permissions.

## Review Focus

- Replaying a reservation must not authorize two upstream requests.
- A response timeout after commit must retain the unit.
- Concurrent servers must serialize against the same account/provider balance.
- New month or missing ledger must never mint an unverified free allowance.
- Old deployments and other account consumers must not receive a second independent budget.

## Task 1 — Durable scoped ledger

Files: new CLI-named migration(s), supabase/tests/address_provider_budget.sql, .github/scripts/address-provider-budget.sql.test.mjs, relevant existing SQL gate registration.

- [x] Write PostgreSQL behavioral tests for unavailable/expired/mismatched authorization and all boundary/concurrency/replay cases in the spec.
- [x] Run them against disposable local PostgreSQL and observe the missing-ledger failure.
- [x] Add private tables, restrictive role, staged request guard/reload-canary-before-membership release gate and `reserve_address_provider_request()` with validated claims, provider lock and no public configuration capability.
- [x] Run SQL and signed-HTTP tests including an unrelated PUBLIC RPC denial and existing-role guard preservation.
- [x] Independently review authority and cutover semantics.

## Task 2 — Runtime replacement

Files: apps/web/src/lib/address-budget/scoped-client.ts and reservation.ts with colocated tests; apps/web/src/schemas/address-budget-reservation.ts with test; apps/web/src/app/api/places/provider-budget.ts and its tests; google-autocomplete.ts, geoapify-autocomplete.ts, details/route.ts and their tests.

- [x] Write failing regression: healthy authorized database admission works despite unavailable Redis; unavailable database never dispatches upstream.
- [x] Implement `reserveAddressProviderRequest(provider,kind,apiKey)` using the existing scoped signer, SHA-256 fingerprint and unique attempt UUID; validate the RPC result.
- [x] Pass each caller’s exact captured trimmed API key into the reservation. Replace Redis reservations, remove process-local development admission and retain Geoapify pacing retry.
- [x] Test credential mismatch, malformed response, timeout and every provider retry boundary with network mocked below the actual production code.

## Task 3 — Reviewed release and conditional activation

Files: docs/address-autocomplete-fallback.md and operator cutover documentation; existing generated inventory only if affected source bindings require it.

- [x] Document owner-only initialization, evidence requirements, old-instance fencing and safe rollback that cannot reopen the old ledger.
- [ ] Run relevant provider/checkout tests, full required lint/typecheck/tests and exact-head independent/CodeRabbit review.
- [ ] Publish through the authorized normal workflow, preserving all checks.
- [ ] Activate only with verified account allowance/history/fencing; otherwise report the precise blocker.
- [ ] Verify the served revision and mocked nontransactional customer flow; any live provider smoke needs demonstrated free allowance first.

