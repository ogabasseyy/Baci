# Internal savings ledger handoff

This is a synthetic/local accounting slice. No provider payload parser, remote
binding, financial webhook, customer route, entitlement decision, cash
reconciliation, purchase lifecycle, or refund transport is enabled.

## Stable adapter and snapshot

`createSavingsLedger(identity, execute)` in `savings-ledger.ts` accepts a trusted,
server-resolved `{ integrationId, merchantId, customerId, goalId }` UUID tuple.
The injected executor signature is
`(text: string, values: readonly string[]) => Promise<{ rows: unknown }>`.

- `apply(command)` returns `{ operationId, outcome: 'recorded' }` after durable
  storage acknowledgement. Exact replay returns the same acknowledgement.
- `snapshot()` returns `PiggyvestSavingsLedgerSnapshot`, exported by
  `../../schemas/piggyvest-savings-ledger-snapshot.ts`.
- All adapter errors are redacted as `Internal savings ledger unavailable`.
  A transport/commit error is indeterminate: retry the identical operation and
  evidence identity; never create a replacement ID to work around an error.

The snapshot contains `ledger`, `activeReservation`, and `fundingReversed`.
`ledger` has `confirmedPrincipalKobo`, `reservedPrincipalKobo`,
`paidEligibleInterestKobo`, `reservedPaidInterestKobo`, `pendingInterestKobo`.
Principal and paid-interest totals INCLUDE their reservations. Subtract each
reservation exactly once. Pending interest is a separate memorandum balance,
never purchasing power or proof of paid cash.

`activeReservation` is null or `{ operationId, kind, principalKobo, interestKobo }`.
Map `reserve_purchase` to policy `purchase`; map `reserve_refund` to policy
`cancellation`. `fundingReversed` conservatively stays true after any principal
or paid-interest reversal; no review-clearance operation exists in this slice.
Snapshot values must replace caller financial fields, not merge with them.

## Canonical commands

The strict command schema is `piggyvest-savings-ledger.ts` under schemas.
Every command has `operationId`, `kind`, `principalKobo`, `interestKobo`,
`evidenceId`, and `referenceId`. Amounts are integer kobo in 0..9007199254740991;
combined amounts and balances cannot overflow the safe integer range.
Evidence is a bounded opaque internal reference, not a provider payload.

| Kind | Amounts / reference | Effect |
| --- | --- | --- |
| credit_principal | Positive principal, zero interest, null reference | Full principal liability credit |
| record_pending_interest | Zero principal, positive interest, null reference | Nonspendable pending memorandum |
| credit_eligible_paid_interest | Zero principal, positive interest, null reference | Explicit already-eligible paid classification |
| reserve_purchase | Positive combined principal/interest, null reference | One exclusive reservation |
| reserve_refund | Positive principal, zero interest, null reference | One exclusive principal refund reservation |
| release_purchase | Zero amounts, purchase reservation reference | Release only an explicitly resolved internal purchase reservation |
| settle_reservation | Zero amounts, purchase/refund reference | Consume the referenced reservation exactly once |
| reverse_credit | Zero amounts, original credit reference | Full reversing entries, once, only if funds remain available |

Pending and paid classifications are independent. There is no inferred payout,
unit conversion, automatic pending-to-paid conversion, interest-rate formula,
forfeiture, business revenue allocation, fee deduction, or ordinary-wallet claim.
Verified attribution/eligibility is an upstream contract gate. Where a known
pending record must be removed, its exact full reversal is explicit. Partial
reversals and disputed/insufficient reversals fail closed for reconciliation.

Refund release is intentionally absent: failed/unknown attempts leave principal
reserved. Timeouts have no ledger mutation. Settlement and purchase release are
INTERNAL decisions requiring separately established finality; the ledger does
not prove provider completion. Late principal is retained even while reserved.
Remaining interest is never swept during a refund. Cancellation terms and
interest disposition require a separate reviewed implementation.

`internal_clearing` is an internal balancing control, not verified provider cash
or business revenue. Pending uses `pending_clearing` to avoid duplicating cash.
Every journal is balanced at transaction commit and immutable afterward.

## Exact executor and manifest wiring for coordinator

Use restricted login `piggyvest_staging_ledger_worker`; it must match `session_user`
and each owner-seeded `bindings.authorized_login`. No role memberships, table
privileges, service-role user APIs, or arbitrary SQL. Both RPCs require READ
COMMITTED isolation. Commit must complete before acknowledging a write. Lock
ordering is integration registry, binding, customer, goal; no network request belongs inside it.

Catalog strings (only this role; parameter counts 5 and 4):

```sql
SELECT piggyvest_savings_ledger.apply($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb) AS result
SELECT piggyvest_savings_ledger.snapshot($1::uuid,$2::uuid,$3::uuid,$4::uuid) AS result
```

Database signatures:

```sql
piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb) RETURNS jsonb
piggyvest_savings_ledger.snapshot(uuid,uuid,uuid,uuid) RETURNS jsonb
```

The first four arguments always mean integration, merchant, customer, goal.
Write argument five is the JSON-serialized validated internal command. The
executor result is exactly one `{ result: ... }` row. Register strict parameter
schemas and both statements in the existing catalog/config/session role enums.
Use only synthetic fixture grants for local runtime integration:

```sql
GRANT USAGE ON SCHEMA piggyvest_savings_ledger TO piggyvest_staging_ledger_worker;
GRANT EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb),
  piggyvest_savings_ledger.snapshot(uuid,uuid,uuid,uuid) TO piggyvest_staging_ledger_worker;
```

Bindings reference the existing integration registry and live merchant/customer/
goal ownership. They are disabled by default and ownership/login are immutable.
Owner fixture provisioning must explicitly bind and enable each synthetic goal.
No provider wallet verification is implied by a local binding. The migrations
seed no bindings and grant no access. Keep all remote transports/bindings blocked
until contracts and scoped activation authority are separately verified.

The public RPC entry points lock and require an enabled existing integration
registry row, including its registered account configuration. Disabled or unknown
integrations reject writes, reads, replay and reversals. No recovery exception is
invented. The renamed `apply_bound` and `snapshot_bound` helpers are private;
NEVER grant or catalog them. Account registration is not provider verification.

Add these six new migrations, in order, to replay/runtime manifests after the
existing registry and public ownership tables. No existing migration is edited:

- `20260912120000_piggyvest_savings_ledger_tables.sql`
- `20260912120100_piggyvest_savings_ledger_guards.sql`
- `20260912120200_piggyvest_savings_ledger_apply.sql`
- `20260912120300_piggyvest_savings_ledger_snapshot.sql`
- `20260912120400_piggyvest_savings_ledger_registry_gate.sql`
- `20260912120500_piggyvest_savings_ledger_numeric_reference_casts.sql`

The dedicated harness uses minimal synthetic parent tables. It validates these
real six migrations, not full production schema replay. Coordinator owns full
manifest/restricted-executor integration. Existing device-change and checkout
paths are not automatically protected: their integration must respect the same
goal lock and ledger reservation, with server-side lifecycle/consent checks.

## Local acceptance evidence

Run `bash tools/test/run-piggyvest-ledger-sql-local.sh`. It starts a disposable
PostgreSQL cluster on a private Unix socket, disables TCP, applies only this
slice, tests journal lifecycle, restarts PostgreSQL, and verifies durable replay.

The harness verifies default schema/table/function denial (including
service_role), a restricted login denied another binding but allowed its own,
live ownership drift, disabled bindings, fractional/string/null/overflow amounts,
source-evidence conflicts, deferred balance rejection with rollback, immutable
updates/deletes/truncation and late append denial, nonspendable pending interest,
failed-refund retention, insufficient/duplicate reversals and late credits.

Synchronized two-session results, 2026-09-12 local run:

- PASS purchase versus refund: exactly one reservation; loser conflicts.
- PASS identical concurrent credit: one durable journal and replay result.
- PASS competing reversals: original credit consumed only once.
- PASS integration disable versus credit: the waiting writer rejects the disabled registry.

For each race, the harness waits until `pg_stat_activity` reports the second
session waiting on a PostgreSQL lock before permitting the first to commit.
Post-race balances and restart replay are asserted. READ COMMITTED is enforced;
REPEATABLE READ is explicitly rejected to prevent stale aggregate decisions.

Final scoped run: 21 Vitest tests across four colocated suites passed; Biome
checked all eight owned TypeScript files without errors. Coordinator owns final
monorepo validation. No remote CodeRabbit review was run under the no-remote-call
boundary.

Colocated Vitest tests cover command/store/snapshot validation, parameterized
adapter writes/reads, identity acknowledgements and redacted failures. No remote
review, provider call, deployment, or financial activation is evidence here.

Review regressions were reproduced before fixing: uppercase UUID acknowledgement
failed in the adapter, and resolving a direct JSON numeric `40.0` reservation
raised a bigint parse error. The adapter now compares lowercase UUID identities
without changing the serialized command (including on replay). The final
append-only migration replaces only the private `apply_bound` implementation,
changing its two reference amount casts to `numeric::bigint`. SQL acceptance
includes `40.0` principal and `10.0` interest through release and settlement.
Public wrapper signatures and grants remain unchanged.
