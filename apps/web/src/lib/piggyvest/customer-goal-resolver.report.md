# Authenticated goal resolution: local handoff

READY FOR PARENT REVIEW. Scoped verification: 25 tests across two suites pass;
Biome passes for all four TypeScript files. Test-first run failed 21 behavioral
assertions before implementation. Runtime resolver is 133 lines. Root checks belong
to parent and were not run. All fixtures are synthetic; no external calls occurred.

Files: `customer-goal-resolver.ts`, `customer-goal-resolver.test.ts`, this report,
`schemas/piggyvest-customer-goal.ts` and its colocated test. No existing files changed.

The resolver calls `supabase.auth.getUser()` first and uses that same passed RLS
client for merchant visibility, customer `(id, merchant_id, user_id)` and goal
`(id, customer_id, merchant_id)` reads. It constructs no client, performs no writes,
uses no email fallback and reads no private schema, balance or credentials.

Successful scoped reads return `needs_migration` with canonical snapshot display
facts and explicit missing-contract reasons. Missing/mismatched/inaccessible rows
return `unavailable`; malformed or legacy snapshots never produce display labels.
The goal's product/variant IDs and stored snapshot determine display. A null exact
variant remains null rather than acquiring an invented SKU or label. Snapshot
prices are neither current offers nor price guarantees and are not returned.

## Why no ready policy result exists yet

The actual goal schema stores legacy status values `active/paused/completed/cancelled/spent`,
unversioned terms/non-withdrawable/early-end timestamps, and freely supplied metadata.
It does not establish acceptance of the policy engine's `2026-09-11` terms,
before-funding timing, all-interest forfeiture, price guarantees or lifecycle mapping.
The create-goal schema accepts arbitrary metadata and the RPC persists it. Even a
well-shaped `policyVersion`, consent boolean or integration ID inside that metadata
cannot be trusted as a new policy contract. Legacy timestamps are only checked for
shape, never promoted to PiggyVest consent.

Integration, provisioning and ledger bindings are private, denied to authenticated
customers, and are not a public goal policy projection. An expected integration ID
in server configuration does not prove a persisted goal binding. The resolver
therefore reports `integration_binding` instead of manufacturing one.

No currently documented persisted record can legitimately produce a ready policy
callback result. This is an explicit persistence gap, not a provider-money blocker.
The concrete read can be called from `resolveAuthenticatedGoal`, but its current
non-ready result will safely become `unavailable` in `customer-status.ts`. Parent
should preserve the migration reason separately if the UI needs remediation metadata.
No existing callback, route, status module or migration was changed.

## Narrow persistence contract needed from parent

Add a reviewed, server-written and RLS-readable goal policy projection with:

- Exact goal/merchant/customer/product/variant identity and a revision binding the
  display snapshot to the same policy device/condition; protect against stale swaps
  and legacy variant recovery. Do not accept independent customer display labels.
- Policy and cancellation-forfeiture version, accepted-at/actor, immutable accepted
  terms reference, and evidence acceptance preceded first funding. Legacy timestamps
  and arbitrary metadata must not be backfilled as acceptance.
- Explicit lifecycle and collection-pause state, rather than translating legacy
  `completed` to purchase-ready or `spent` to a new lifecycle without a contract.
- Versioned, server-authoritative local currency/units for current exact-device offer
  and activation quote, with optional actual guarantees/protected offers and expiry.
  A saved target or snapshot price does not prove any of these. Missing guarantees
  should be explicit null, never inferred price protection.
- An authenticated, scoped nonsecret goal/integration eligibility projection rooted
  in enabled private bindings; do not grant customers access to private worker tables.
- Explicit maturity/grace semantics where used; do not infer grace from maturity_date.

Only after that contract exists should a ready result satisfying
`piggyvestCustomerStatusSchema` be implemented from persisted facts. Provider units,
interest eligibility, financial finality, refunds and withdrawals remain outside this
read-only slice. No production migration is proposed or applied here.
