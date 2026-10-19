# Bounded local provisioning recovery

`recoverPiggyvestProvisioning` accepts trusted `{ storage, wallet }` configuration,
canonical `{ intentId, customerId, goalId }` scope, the committed restricted executor,
and injected fetch. It reads only acknowledged/unknown intents. It never calls POST,
claims provisioning again, resolves KYC by guessed IDs, reads funding accounts,
or changes ledger/balance state. Tests use synthetic data exclusively.

## Ownership reasoning

The [wallet creation contract](https://www.piggyvestbusiness.com/docs/api/wallet/create)
ties its returned wallet ID to the customer in the submitted API-wallet request and
explicitly permits querying by ID for asynchronous readiness. A persisted accepted
plan acknowledgement, immutable dispatched customer and request fingerprint, plus
an existing trusted mapping of that provider customer to this local customer form
the ownership chain. The [wallet GET](https://www.piggyvestbusiness.com/docs/api/wallet/retrieve)
then checks that exact wallet, expected business, NGN currency and active status.
GET does not need to repeat customer identity to finish this already anchored chain.
An active wallet or caller-supplied ID alone cannot establish the chain.

Historical customer acknowledgements are different. The
[customer creation contract](https://www.piggyvestbusiness.com/docs/api/customers/create)
distinguishes `new_customer`; existing storage did not preserve that provenance.
An accepted customer intent alone therefore cannot bootstrap trusted ownership.
Historical customer recovery remains observational. The dedicated seven-argument
`record_created_customer` RPC atomically records a new accepted acknowledgement and
immutable provenance, only for a validated `new_customer:true` response. It requires
the live original dispatch token, so historical accepted/unknown rows cannot be
stamped retroactively. SQL trusts the restricted recorder to invoke this distinct
contract correctly; arbitrary caller booleans are not independent provider evidence.

This new customer receipt plus exact active default-wallet GET permits customer
completion without inventing a goal mapping. A plan may use either an existing
trusted customer mapping or that completed proven customer receipt. An unconfirmed
customer receipt or historical acknowledgement alone does not qualify. The coordinator
owns the core client/store branch to the new RPC; the separate
`recordPiggyvestCreatedCustomer` helper also exposes the narrow validated contract.

Before creating a customer, the funding coordinator now reads
`read_customer_mapping` using only the configured integration and merchant plus the
canonical local customer ID and expected provider business. It reuses the provider
customer ID only when immutable, previously verified wallet mappings for that exact
tenant/customer agree on one ID, no other local customer in the integration uses it,
and no durable customer intent contradicts it. Disabled or wrong-business registry
state and inconsistent or stale mappings fail closed. `new_customer:false`, matching
phone/email/BVN, and uncertain POST outcomes still never establish ownership or
trigger a retry.

Unknown outcomes cannot confirm, including unknown rows with opaque reference IDs.
No-reference unknowns record `missing_reference` without HTTP. Other observations
record only bounded outcome enums, at most five distinct outcomes per intent.

## Verification and completion

Begin verification commits a random token bound to intent/fingerprint/acknowledgement
wallet/customer/business, expiring after 60 seconds. Only then may a single bounded
GET begin. Reissuing a snapshot invalidates its old token. Confirmation rechecks the
token, acknowledgement, enabled current registry and immutable business snapshot,
local ownership and trusted customer mapping transactionally under locks. It creates
the exact plan mapping and completion receipt atomically. Conflicts never overwrite
another mapping. Provider fields are stripped to ID/business/currency/status; no
balance or supplied customer field contributes evidence.

Completion is `provisioning_recovery_verifications.completed_at`, **not a new value
in legacy `provisioning_intents.status`**. This preserves the existing single-dispatch
and customer-correlation APIs without editing shared schemas. A later `begin` returns
the durable completed receipt without another GET. Disabled or changed scope still
fails closed. Completion means resource readiness, never funding or financial finality.

## Coordinator integration

1. Merge the five exact entries in `provisioning-recovery-statements.ts` into the
   existing allowlisted executor catalog. Each is provisioner-only. Keep argument
   counts: read 6, observe 10, begin 6, confirm 11, record-created-customer 7.
   Project the named columns exactly. Recording arguments are integration, merchant,
   intent, claim token, expected business, provider customer ID, provider wallet ID.
2. Add all seven `20260912110000`–`20260912110600` SQL files to ordered replay sources,
   migration hash manifests and disposable runtime fixture application. No runtime
   caller grants ship in these migrations; grant only these exact functions and
   schema usage to the restricted provisioner in the synthetic harness.
3. Wire `recoverPiggyvestProvisioning` through the committed READ COMMITTED executor
   with bounded connection/statement/lock deadlines. Do not expose its private
   reference reader or tokens in a public API. Resolve customer/goal scope server-side.
4. Add real-driver tests for committed begin before mocked GET, completion COMMIT
   failure, two-verifier fencing, restricted permissions, and completion replay.
   Never reuse POST after unknown or uncertain COMMIT. No test should call PiggyVest.
5. Run SQL fixtures `piggyvest_provisioning_recovery_confirmation.sql`, then
   `piggyvest_provisioning_recovery_failures.sql`, then
   `piggyvest_provisioning_recovery_provenance.sql` after a fresh existing provisioning
   setup fixture (before other provisioning lifecycle fixtures create overlapping
   synthetic identities), or in a separate disposable database. They own their
   `recovery_test` schema/role and do not fit an already-populated lifecycle fixture.

This slice does not change executor/catalog/manifests/harness or other agents' files.
Full schema replay, combined runtime wiring and provider acceptance remain separate.

## Scoped verification

On 12 September 2026, all three SQL fixtures passed against a fresh Unix-socket-only
PostgreSQL 18 cluster with synthetic public-table fixtures. After a server restart,
all three customer/plan completion receipts remained present. Cases cover historical
provenance rejection, first-customer/first-plan success, exact scope/account/token
fencing, expired verification, changed registry/ownership, mapping conflict, atomic
rollback, bounded observational recovery, no resend and restricted role denial.
This is focused real SQL verification, not full Supabase schema/RLS replay or
provider acceptance. The coordinator owns combined runtime and monorepo checks.

## Stable migration SHA-256

| Timestamp | SHA-256 |
| --- | --- |
| 20260912110000 | `ccd447be36f8301b092416156dec397d5afa61f25a0437800801f22d2f5526b9` |
| 20260912110100 | `6daecbc0eca7f1d78a8a83da42dca1568c8bb528bd5192f75bee6044b10870db` |
| 20260912110200 | `26bb10c4ad85040ea94ca430a854ac7391af76e5c41418482f5a73687c2f8272` |
| 20260912110300 | `2676cd4b0f27fea38ab7c5f801d34c2ca5b097bf3ff3d32c61fea863d9290427` |
| 20260912110400 | `3fc443ce5741aa11b8ef67ba2aeb11e8708381a8c453b84c4affe5ea9cf2fb20` |
| 20260912110500 | `416331e0290d3ce631fb8f17dbf717494c0101efc58fb4affcf7f2094955e00f` |
| 20260912110600 | `6864f0da120b52d1e1829888d1c5f5a85d02129329737e8079d88c1e068f8aa5` |
