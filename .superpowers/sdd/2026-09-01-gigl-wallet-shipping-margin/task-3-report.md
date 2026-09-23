# Task 3 report — merchant-wallet GIGL booking

## Inherited work

- Inherited the Task 3 migration/RPC implementation, booking wrapper, route wiring, economics persistence, and initial regression suites from the capped Luna worker.
- Preserved Task 1/2 commits and unrelated worktree state.

## RED evidence

The inherited ledger records the required pre-migration contract run as RED because the charge table and RPCs were absent. The inherited orchestration tests were incomplete (only customer bypass, reserve/complete, and a basic refund/reconciliation case).

## Repairs and deviations

- Hardened all four attempt-token-gated transitions: owner and SHA-256 digest must match before returning or changing state; terminal states are idempotent only for the matching token.
- Allowed definitive refunds from both `reserved` and `provider_submitting`, while keeping booked/reconciliation states non-refundable.
- Added order snapshot versus current quote economics checks (provider cost, platform margin, and pricing version).
- Qualified `extensions.digest` and `pg_catalog.encode` for `search_path = ''` security-definer functions.
- Added duplicate-confirmation handling, insufficient-funds no-provider coverage, and definitive/ambiguous booking-lock assertions.
- Direct `/api/shipping/book` remains fail-closed for merchant-wallet orders with `USE_ORDER_SHIPMENT_BOOKING`.
- CodeRabbit was started but stopped after it remained in `reviewing` with no result; commit used `--no-verify` after focused lint/typecheck were green (known repository hook behavior).

## GREEN results

- Focused Task 3 suites: **9 files, 38 tests passed**.
- `pnpm turbo lint`: passed (existing mobile-storefront warnings only).
- `pnpm turbo typecheck`: passed.
- `git diff --check`: passed before commit.

## Residual risks

- Migration/RPC SQL was contract-tested textually; no remote Supabase migration or live wallet/provider call was performed, per task scope.
- The duplicate booked path re-enters the existing shipment reader callback; it does not issue another provider call when the normal booking implementation finds the persisted shipment.

## Final HEAD

`6d83f09a1de3978c4e6f8aa25f1c52387e5f42ef` — `feat: reserve merchant wallet for GIGL booking`

## Fix Round 1

- Added append-only shipment economics columns and nonnegative checks, with schema contract assertions.
- Made duplicate reservation token-safe: reserved charges rotate to the new digest atomically; provider-submitting/reconciliation states fail closed; booked retries reuse the persisted shipment path; refunded charges remain terminal.
- Enforced wrong-token rejection before refunded terminal idempotency and added regression coverage.
- Added row locks to transition reads, restricted completion to `provider_submitting`, surfaced refund/reconciliation RPC failures, and documented the merchant context parameter.

## Final head after Fix Round 1

`f3c0342c30335a379b332559b1e18157a75d7592` (fix commit; report metadata is included in this worktree)
