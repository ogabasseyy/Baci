# PiggyVest completion progress — 26 September 2026

## Status

This report records the earlier completion pass. The subsequent seven-agent
implementation and parent review are tracked in
`piggyvest-finishing-dispatch-2026-09-26.md`; consult that report for the current
provider, treasury, canonical funding, submission and exit state.

The follow-on implementation closes several concrete code gaps from the seven-lane
review. It does **not** complete or deploy the whole financial product. All changes
below are local. No provider setting, card charge, customer balance, production
deployment, VPS service, credential, or staging lease was changed.

Work is split between the existing receiver checkout
`/Users/mac/.codex/worktrees/0d77/Baci-app` and savings/mobile checkout
`/Users/mac/Baci-worktrees/cursor-savings-phase1`. Both contain substantial older
uncommitted work. Do not deploy either entire dirty tree as a release artifact.

Only Terra and Luna were delegated work. Parent review rejected several unsafe
completion claims, corrected the financial and push connections, and reran tests.

## Seven-lane outcome

| Lane | Implemented and locally verified | Still required |
| --- | --- | --- |
| Interest | Restricted atomic payout-to-canonical-Earnings adapter, receipt-worker wiring, existing notification trigger integration, economic duplicate/conflict handling | Reviewed actual payout allocation, worker provisioning, deployment, genuine provider payout and phone delivery |
| Prefunded cards | Conservative reservation, separate collection/transfer states, no-resend claims, verify-only recovery leases, scoped SQL and concurrency tests | Real provider adapters and verification, immutable treasury refresh/provisioning, canonical projection/shared inflow dedupe, routes/auto-debit/UI wiring, reversals and live proof |
| Outflow finality | Scoped durable CAS, PG system/login pin, bigint decoding, protected outbox scope, replay wallet-terminal adapter | Actual submission identity writer, genuine complete wallet-transfer event, bank destination normalization, bounded running TSQ reconciliation |
| Purchase/cancellation | Previous safe preparation flows retained | Owner decisions on refund/interest disposition and shortfall; provider execution and order/refund accounting |
| Existing customer | Exact trusted mapping reuse in actual provisioning coordinator; conflicting business/customer/intent refuses before new wallet creation | Missing-map adoption still requires independently verified ownership; deployment |
| Whole-wallet interest | No invented per-wallet split or ordinary-wallet interest credit; payout bridge requires explicit positive customer allocation | Product-wide allocation and business-remainder accounting, ordinary-wallet migration/reconciliation |
| Native notifications | Isolated native capability, real installed application identity and staging origins, correct token acquisition and scoped registration connection | Real separate EAS/native push configuration, matching installed build, physical-device delivery test |

## Actual entry points

### Receiver checkout

- `apps/web/tools/piggyvest-staging/replay-runtime-pass.ts` connects the financial
  adapters to the existing authenticated receipt worker.
- `replay-interest-runtime.ts` normalizes the actual payout/source/destination
  tuple and calls the restricted canonical bridge. It does not use `pvb_wallet`
  as a guessed interest destination.
- `replay-financial-postgres.ts` accepts only the exported SQL statements, exact
  internal host/database/login, and commits before acknowledging. Both SQL
  bridges verify the expected physical PostgreSQL system ID.
- `replay-outflow-runtime.ts` accepts fully identified wallet-transfer terminal
  evidence. Missing bank/wallet fields remain deferred, not successful.
- `transfer-outbox-finality.ts` validates request and returned scope, parses
  PostgreSQL bigint strings safely, and uses an atomic terminal compare-and-set.
- New migrations: `20260926110000_piggyvest_transfer_outbox_finality.sql`,
  `20260926110100_piggyvest_transfer_outbox_finality_grants.sql`, and
  `20260926110200_piggyvest_transfer_outbox_finality_scope_guard.sql`.

### Savings/mobile checkout

- New migration `20260926170000_piggyvest_interest_bridge.sql` implements
  `piggyvest_savings_ledger.apply_interest_receipt`. It creates no binding,
  approved allocation, credentials, or worker grant. Explicit reviewed source-wallet
  payout allocations are immutable except enabling/disabling. This is not a
  pooled-business-payout distribution engine.
- New migration `20260926120000_piggyvest_staging_customer_mapping_read.sql`
  checks enabled integration/business, current customer/goal scope, conflicting
  provider-customer mappings, and previous provisioning intent. Its optional role
  grant does not require creating a provisioner during schema replay.
- Both migrations are hashed in
  `apps/web/tools/db/supabase-history-replay-savings-pending-sources.ts`. The
  two existing replay-plan parsers now recognize only its two explicit exports.
- `customer-plan-funding-ensure.ts` calls that mapping read before creating a
  provider customer; only an independently mapped result is reused.
- `tools/staging/prefunded-card/README.md` describes the inactive durable store
  and exact remaining charging/projection work. It is not registered for deployment.
- `apps/mobile-storefront/lib/hosted-staging-push-capability.ts` rejects
  production EAS/native identifiers (including case variants), wrong installed
  application IDs, wrong origins, non-development builds, and missing capability.
- `config/development-storefront-expo-config.js` supports an explicit reviewed
  `nativeStagingPush` profile. None was provisioned in this pass. The default
  isolated profile still acquires no native token.
- `hooks/use-savings-push-registration.ts` now uses the same capability for the
  server-registration retry. Parent reproduced the missed connection: allowing
  token acquisition alone left registration blocked by the telemetry exclusion.
  Analytics/telemetry remains excluded. Production registration behavior remains
  on its original path; production delivery was not tested.

## Fresh verification

- Receiver/replay, schema, terminal and lifecycle tests: 211 passing tests across
  29 suites. This includes the existing inflow dispatch and receipt-fencing tests.
- Trusted provisioning/schema/coordinator tests: 52 passing tests across four suites.
- Real disposable PostgreSQL provisioning/runtime tests: 13 passing tests across
  four suites.
- Registered private migration replay: 65 migrations pass ACL/RLS checks,
  injected security failures, and restart checks.
- Interest bridge rehearsal loads the real canonical ledger and notification
  migrations. Eight duplicate payout deliveries produce one canonical operation,
  one paid-interest posting, and one notification. Earnings reads 900 kobo for
  the fixture's approved allocation. Failed receipt insertion rolls back the
  operation, postings, and notification. Restart/replay adds nothing. This is
  synthetic evidence, not PiggyVest-paid interest.
- Outflow SQL harness verifies real restricted/service-role sessions, partial-null
  identities, scoped insert/upgrade protection, concurrent CAS and restart.
- Prefunded store SQL harness verifies wrong-session calls, eligibility revocation,
  concurrent row locks, eight same-key first requests, stale/expired verification,
  historical outcome recording after revocation, one-time release and restart.
- Prefunded TypeScript verification: 31 tests across six suites pass. The inactive
  dispatcher is still not connected to a real provider request adapter.
- Native push and lifecycle verification: 89 tests across nine suites pass;
  seven native manifest configuration tests also pass. These are separate from
  device delivery. The parent-added two regression cases fail on the old
  registration gate and pass after the capability connection. The platform drift
  check reports 80 allowlisted branches and zero forbidden branches.
- A local standalone replay bundle builds and passes Node syntax checking at
  `/private/tmp/baci-finish-financial-replay.mjs`. This is a build smoke artifact,
  not an approved deploy package.

Logs are under `/private/tmp/baci-finish-*`. Focused checks do not certify the
entire dirty repositories. Receiver whole-tree typecheck passes; its lint retains
20 pre-existing errors. Savings whole-tree typecheck retains the two existing
mobile fixture errors (date tuple and missing goal-idempotency fields).
The final replay rerun remains 211/211, and the final explicit Biome check of
14 prefunded/push/configuration files passes without fixes.

## Live and activation boundary

The read-only VPS check in this pass found gateway, drafts and funding services
active, and `sudo -n` still requires the owner password. It did not verify new
features: none of these changes is installed there.

Before deploying the financial replay bundle, consolidate its exact source set
and migration dependencies, verify the two actual database identities, provision
the restricted login/grants and protected optional `financialDatabase` config,
and approve the real binding/allocation. Absent that config, financial receipts
remain retryable/deferred; no fallback to production or service-role credentials
exists. Existing legacy outbox rows without full identity remain ineligible.

Genuine interest settlement still needs a nonzero provider payout; a simulated
event cannot establish PiggyVest's rate, source-wallet routing, or payout schedule.
No already-documented transfer capability is blamed on the provider. Card and
exit execution still include work on our side and are not declared complete.
