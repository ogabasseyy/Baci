# Period attribution recovery — bounded local metadata

## Scope and authority

- Original product rules lines 27, 37, 39 and 41 require period/disposition accounting. This slice retains unresolved recovery linkage, not completed period accounting.
- One immutable record references the existing canonical ledger operation primary key. No second economic identity, deduplication store, balance bucket or ledger apply operation is introduced.
- Only existing `credit_eligible_paid_interest` and `record_pending_interest` operations qualify. Amount is read and checked against canonical postings/command, never caller supplied.
- Period remains unknown, covered period null, entitlement/disposition unresolved, financial effects UNKNOWN and funds use not_authorized. Recording time is not a payout-period identity.
- Existing canonical reversal reference is read without deleting original metadata. Reservation/settlement observations do not determine entitlement or cancellation finality. Metadata remains readable after late canonical credits and financial reservations.

## Boundary and locking

- Seven parameters: integration, merchant, customer, goal, business, current actor, canonical ledger operation UUID.
- SQL requires isolated local database/socket and policy-writer session; existing `lock_scope` preserves registry/ledger/policy/customer/goal lock order.
- Both policy and ledger bindings must be enabled, full-scope matched, and authorize the actual login. Current customer actor is rechecked under lock; a recorded actor must also match, preventing reassigned ownership from inheriting historical recovery records.
- Row identity is the canonical operation FK. Concurrent same-operation records return the same immutable receipt. No proposal, caller amount, financial outcome or synthetic confirmation is accepted.
- New table denies default access with restrictive RLS and immutable update/delete/truncate guards. No shipping execution grants are added.
- Synthetic harness credits use the existing canonical apply interface with temporary fixture-only grants, then revoke those grants. They are not provider observations or a shipping confirmation capability.

## Read-only customer connection

- `customer-period-recovery-handler.ts` exports `createPiggyvestCustomerPeriodRecoveryHandler(commonOptions)` with GET only.
- Reuses `customer-operation-handler.ts` for authentication first, strict duplicate/extra query rejection, fixed goal, current scoped actor revalidation, abort/deadline protection and redacted errors; reuses actual `createPeriodRecovery` read rather than another data implementation.
- Approved route: `/period-attribution?goalId=<uuid>&ledgerOperationId=<canonical-credit-uuid>`, optional `services.periodRecovery.enabled`; Fermat owns composition wiring. No HTTP record/write.
- Public schema excludes raw evidence identity and recording actor. Original canonical credit amount is explicitly historical, not current spendability. No mapping from purchase-intent identity to interest-credit identity is inferred.

## Verification provenance

- Initial schema/handler feature RED: missing implementation module; restored GREEN: 15 tests across five owned unit/schema files.
- Disposable current-actor check mutation RED exit 3: `/tmp/piggy-period-actor-red.log`; unchanged source restored GREEN: `/tmp/piggy-period-restored-green.log`.
- Ledger-login P2 regression RED exit 3: `/tmp/piggy-period-ledger-login-red.log`; explicit same-scope login check GREEN: `/tmp/piggy-period-ledger-login-green.log`. Hooke independently accepted the fix.
- Final draft SQL, restart, owner revocation, canonical reversal/history, immutable metadata and ACL tests GREEN exit 0: `/tmp/piggy-period-final-acl-green.log`. Synthetic local PostgreSQL only.
- Scoped Biome passes; parent owns root lint/typecheck/full-suite.
- Standard executor + actual HTTP acceptance command: `PIGGYVEST_PERIOD_STANDARD_EXECUTOR=1 bash tools/test/period-recovery-local.test.sh` **exit 0** after Russell's combined 183/184/185 manifest registration. Both opt-in tests passed through the actual restricted executor and real local HTTP after PostgreSQL restart: `/tmp/piggy-period-standard-http-green.log`. Includes concurrent duplicate metadata records, lost ACK/readback, scoped/reversed/pending history, unauthenticated/extra-authority/cross-plan rejection, public redaction and read-only SQL dispatch.
- First standard run's tests passed but its outer zsh wrapper attempted assigning read-only variable `status`, producing wrapper exit 1. Corrected wrapper (`result_code`) reran the entire harness to verified exit 0; no runtime change or test suppression.
- Hooke final handler/composition review found no P1/P2 and independently ran seven relevant tests successfully. Its scope is metadata/authentication, not financial acceptance.

## Freeze and remaining contracts

- SQL `supabase/migrations/20260912184000_period_attribution_recovery.sql` frozen after Hooke acceptance: SHA-256 `77968a2684d13b90d0b31d888a7ec928ec7ff31a82194d1ca6fd7823fcb1dab9`.
- Two exact statements are `PERIOD_RECOVERY_STATEMENTS.readPeriodRecovery` and `.recordPeriodRecovery`, seven parameters, policy-writer only. Russell owns catalog/manifest registration.
- Provider payout identity, covered period, gross/net/tax, reversal finality and post-cancellation transfer entitlement remain unresolved. No forfeiture, business sweep, accrual conversion, provider request or money permission is implemented or claimed.
- Owned source/schema/test/harness files are now frozen after registered executor/HTTP acceptance and final read-handler review. READY FOR PARENT REVIEW for this bounded local slice. No deployment, live/provider readiness or full-product completion is claimed.
