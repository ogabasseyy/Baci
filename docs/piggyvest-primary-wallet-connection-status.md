# Primary-wallet connection status

This records local implementation evidence, not a production completion claim.

## Implemented locally

- Authenticated onboarding binds merchant, customer, user, integration, business
  and environment before customer creation. BVN is not retained in the intent.
- Provider wallet/account reads use stored ownership mappings, not client wallet
  identifiers. Ordinary wallet creation requests interest disabled explicitly.
- Ready account reads now persist accepted-to-verified onboarding through an
  exact scoped restricted RPC. A refused verification does not return readiness;
  matched existing customers remain quarantined rather than adopted.
- Signed inflows enter a restricted, environment-bound, idempotent ledger path.
- Savings contributions reserve confirmed PiggyVest-backed funds before dispatch.
  Provider acceptance is pending, not settlement. Verified matching transaction
  evidence is required to credit the savings goal.
- Recovery selects outstanding operations by authenticated customer and goal.
  Status checks release only undispatched reservations. Dispatched transfers are
  reconciled rather than refunded on timeout.
- Mobile startup/goal changes recover pending operations before enabling another
  savings contribution; stale responses from previous goals are discarded.
- A partial unique index permits only one reserved/dispatched operation per
  primary intent and savings goal. Same-operation retries remain permitted.
- Interest-only primary goal completion now feeds the existing notification
  queue with the shared `milestone:100` identity. Repeated status updates do not
  duplicate the notice; a verified reversal that reopens the goal voids it.
- Primary account setup no longer manufactures Paystack settings. It derives
  its own setup availability while leaving legacy account availability intact.
- Primary savings setup now connects the existing mobile funding entrypoint to
  authenticated provisioning and recovery, with explicit interest consent and
  no second BVN prompt. Recovery does not redispatch creation. Non-ready responses
  cannot expose accounts and a new lookup clears previously displayed accounts.
- The shared signed Paystack webhook isolates primary-card references and both
  object/JSON metadata before legacy settlement. Its retryable response is not
  collection verification or PiggyVest custody settlement.
- Onboarding and savings provisioning now select the fixed provider origin from
  validated environment configuration. Staging no longer defaults to the
  production provider URL. Independent origin/runtime/route checks passed 30 tests.
- Signed interest payouts now reach the primary paid-interest dispatcher before
  legacy processing. Durable credits and duplicates are acknowledged; unrecorded
  prerequisites and conflicts remain retryable. Disabled primary configuration
  retains the existing legacy path. This hook does not establish provider identity
  crosswalks, remote capability activation or a durable unresolved-event backlog.
- Card custody reservations, transfer outbox, signed settlement and shared bank/card
  alias deduplication are implemented locally. Independent mocked custody checks
  passed 76 tests. Financial dispatch, runtime scheduling and reconciliation remain
  deployment gates; a submitted transfer is not confirmed wallet funding.
- The public webhook now routes signed wallet-transfer outflows through durable
  primary-card intake before legacy processing. Queued receipts are acknowledged
  only after storage; this is not a completed funding acknowledgment. Proven
  unrelated receipts retain legacy processing. Storage failures request redelivery.
- Six finalized signed-custody and production-interest migrations are registered
  with independently checked source hashes; 116 registry tests pass locally.
- Independent production-interest runtime, signed proof, store, dispatch and
  progress validation passes 57 tests across five suites. This is mocked/local
  evidence; it does not establish a provider payout or remote bridge readiness.
- The production paid-interest SQL fixture independently passes in a fresh local
  Unix-socket-only PostgreSQL cluster: authenticated earnings, net reversals,
  exact completion capacity, payout deduplication and notification insertion.
  The cluster is stopped after validation. Synthetic fixture evidence does not
  prove remote grants, provider identity or phone delivery.
- Interest webhook intake now stores exact signed events before returning a
  queued acknowledgment. Rejected payloads and failed persistence do not reach
  synchronous or legacy credit paths. Helper/intake and actual webhook-route
  coverage passes 66 tests across eight suites. Queue worker finalization and
  remote activation remain required; queued interest is not earned balance.
- Independent interest-inbox runtime/store/intake/worker checks pass 32 tests
  across four suites, including retained signing-key verification. The interest
  package now passes both offline artifact tests after its in-progress
  inbox-worker migration hash was updated. Registered production-interest
  migration hashes remain unchanged. Final source freezing, worker operational
  validation and registry validation are still required.
- The durable interest-inbox SQL fixture also independently passes in a fresh
  stopped-after-use local PostgreSQL cluster. It verifies lease fencing,
  retained prerequisites, immutable raw bytes, deduplicated conflict variants,
  processed-state evidence and denied authenticated/service-role receipt access.
- Card-worker launch/binding checks pass 15 tests across three suites; separate
  custody reader/worker checks pass 19 tests across two suites. The current
  approved-file binding is operation-specific. It is not proof of automatic
  custody reconciliation for future payments: a reusable authenticated provider
  crosswalk adapter or explicit operation evidence remains a connection gate.
- Standalone card-worker package generation passes both local package tests:
  it bundles the reviewed closure, records source/output hashes and emits an
  inactive scheduler. This proves artifact construction, not installation.

## Evidence boundaries

- The expanded mobile wallet/payment-gateway run passes 1,076 tests across 185
  suites, including primary-card persistence, pending callback status and legacy
  payment regressions. This uses the isolated local Jest configuration and mocks;
  it is not Metro/device acceptance or provider funding evidence.
- The single-pending PostgreSQL fixture failed without the new index because a
  second operation was accepted. With the index, the attempted second reserve
  rolls back, preserving wallet balance, pending transaction count and retry ID.
- PostgreSQL fixtures use an isolated local cluster and synthetic test rows. They
  do not prove provider cash movement or remote migration application.
- Focused mobile/backend tests use mocked provider HTTP. No new production
  account, deposit, transfer, interest payout or notification is claimed here.
- The automated completion-notification PostgreSQL fixture loads the actual
  engagement storage/event migrations. Without the new completion trigger it
  fails because interest alone produces no completion notice; with the trigger
  it verifies deduplication, reversal and unchanged principal. This proves queue
  insertion, not phone delivery.
- The isolated DOM validation passed 13 tests with three remote-runtime tests
  skipped. It used an alternate installed DOM runtime, one React instance and
  native HTTP objects; the shared dependency tree was not changed. Default jsdom
  still fails before tests run, so this does not prove the default CI environment.
- The paid-interest route regression first failed five cases without the primary
  dispatch connection. After wiring, 39 webhook/helper tests passed, including
  existing bank inflow and legacy webhook cases. Scoped formatting passes.
- Card-custody routing regressions failed four cases before connection, then
  passed with the connection. The expanded webhook/intake run passes 41 tests,
  including unrelated fallback, forged receipts and redacted storage failures.
- Mobile lint passed its last collected snapshot. Full mobile typecheck reports
  unrelated carousel/auth test errors. The fresh web typecheck completed in
  3m33s and reports only four existing `Product.item` errors; the earlier interest
  fixture typing errors are absent. Worker-tool checks were separately run and
  pass after the app check stopped the aggregate command. Latest
  full web lint now passes across 12,338 files with 14 existing warnings and no
  errors. The complete PiggyVest webhook-directory run passes
  42 tests across six suites, including the consolidated inflow coverage.
  Full app typecheck remains failing on the four existing `Product.item` errors;
  later agent edits require renewed validation before shipment.
- API-route CodeRabbit review completed with zero findings for its snapshot.
- Fresh API-route CodeRabbit review including the interest/card webhook hooks
  raised two trivial test-maintenance issues. Mock ordering was corrected and
  duplicate inflow coverage consolidated without losing the forged-signature
  case. The resulting five-suite run passes 45 tests and scoped Biome passes.
  Other review slices and newly edited agent files remain separate gates.

## Remaining connection gates

Release-base verification confirms PR 3620 merged as
`4a4e4fddd6bdb732c666c6c1db4250a357eafac3`; current remote main is
`3f0ac0a9e0d10d6d6845ddb8e7260e7f31d20a69`. The working checkout remains
detached at `afef44eee3c348f60e541e5aafbb6d71c12b5cdc`, with overlapping
tracked wallet paths in the GitHub comparison. Preserve this checkout and
reconcile onto current main in an approved release branch; do not publish it
blindly or discard its changes. Branch/commit/PR approval has been requested.

Compatibility reconciliation restored 13 absent migration source files exactly
from cached main and preserved all 38 primary migration pins. The stricter
registry suite now passes 134 cases and fails four existing SQL-byte conflicts:
20260925140000, 20260926110100, 20260926110400 and 20261003160000. Each local
file is unchanged from detached HEAD; each main version came through PR 3620.
Do not rewrite those existing migrations or weaken their pins. Prepare the
release on the approved current-main baseline and revalidate exact source bytes.
Restoring local source files did not apply or replay any database migration.

Parent card-transfer validation passes 22 tests across provider, policy,
claim-once worker and custody-connection suites. This validates mocked command
binding and dispatch behavior, not a real provider transfer or automatic
post-Paystack funding. Final worker activation and provider crosswalk evidence
remain separate requirements.

The parent found and reproduced an environment-routing defect in savings
submission and transaction-status verification: staging configurations previously
used the provider client's production default. Both now select the provider
origin from the validated durable environment. The four focused suites pass
21 tests; the broader bank/savings/provider slice passes 147 tests across
25 suites, with one separately gated integration test skipped. These are local
mock checks, not evidence of a provider transfer or remote settlement.

Final parent validation at 2026-10-07T20:16Z passes 662 tests across 88 suites
for primary-wallet libraries, schemas and the primary wallet/provisioning/transfer
customer routes. Three explicitly gated database suites remain skipped in this
mock run; separately recorded isolated PostgreSQL results do not establish
production permissions or provider delivery. Current full web lint passes over
12,367 files with zero errors and 14 existing warnings. Card-worker scoped
TypeScript passes, but the full application typecheck gate remains unresolved.
The shutdown cancellation regression passes 11 focused tests and independent
review confirms pre-claim/pre-POST cancellation with durable reconciliation.

Fresh unauthenticated GET probes at 2026-10-07T20:15:54Z again returned 404 for
the primary wallet, savings provisioning and savings transfer routes. The prior
19:38Z probe returned 200 for the existing webhook. Production still lacks publicly reachable
new customer routes at these paths. No financial request was made.

Read-only public GET probes on 7 October 2026 returned 404 for
`https://ogabassey.com/api/storefront/customer/wallet/piggyvest-primary` and
`https://ogabassey.com/api/storefront/customer/savings/primary-provisioning`.
The existing PiggyVest webhook reachability GET returned 200. These observations
prove neither authenticated capability readiness nor signed provider delivery.
The new customer routes are not publicly reachable at those production paths yet.

1. Apply and verify the accepted-to-verified onboarding migration remotely, then
   validate provider ownership on an authorized account. Local RPC/test evidence
   is not remote deployment or provider acceptance evidence.
2. Deploy and configure the connected savings-goal provisioning/runtime and
   restricted enrollment capabilities. Verify account creation and recovery with
   authorized provider evidence; local tests are not production activation.
3. Verify the provider customer/wallet/conduit crosswalk for signed bank inflows.
   Do not infer identity from phone/email or remove hyphens to make IDs match.
   Preserve exact signed bank receipts for retry when card-custody proof is
   outstanding. The current ledger deliberately returns `conflict` for that
   dependency; redacted quarantine alone cannot safely replay a later valid
   deposit. The actual webhook now calls the durable bank inbox before immediate
   credit: accepted/duplicate/conflicting stored receipts acknowledge without
   legacy processing, storage unavailability requests redelivery, and unrelated
   receipts retain legacy fallback. The complete webhook slice passes 51 local
   tests across six suites. Parent validation of the bank runtime, intake and
   worker together with the webhook passes 69 tests across nine suites. Fresh
   API CodeRabbit review completed with zero findings for its 21-file snapshot.
   Full web typecheck still reports the four existing `Product.item` errors;
   it is not a passing release gate. The three appended bank migrations now
   have independently verified, registered source hashes; remote application
   and runtime activation remain outstanding. The complete migration registry
   passes 124 tests, including bank and card-selector source completeness.
   Parent isolated PostgreSQL validation now passes after correcting the
   fixture's ambiguous claim column, timestamp normalization and temporary
   helper-table ownership without relaxing raw-byte or runtime privilege checks.
   It executes pending-receipt replay after custody proof, bank/card alias dedup,
   independent bank credit, lease recovery and preserved exhausted receipts.
   The fixture cluster is stopped; this is not provider delivery evidence.
   mock-suite success does not establish this SQL acceptance gate. Read-only
   cross-review also found missing signing-key retries returning operational
   success and restricted-role readiness not rejecting expanded effective
   privileges. The missing-key path is now regression-fixed: persist retry,
   then raise a redacted operational error rather than report worker success.
   The full bank runtime/store/intake/worker plus webhook slice passes 74 tests
   across ten suites. Expanded-role rejection now passes isolated PostgreSQL
   acceptance, including inherited capability, unexpected effective table/RPC
   grants and missing required authority. Production effective-ACL inventory
   remains required; fixture-wide PUBLIC revokes must not be copied to production.
   Finalized bank intake/retry/CLI validation passes 40 tests across seven suites.
   These local checks do not establish delivery, scheduler activation or credit.
   The renewed full web lint run passes over 12,363 files with 14 existing
   warnings and zero errors; this does not clear the separate typecheck,
   PostgreSQL acceptance, review or deployment gates.
4. Connect card collection to PiggyVest custody using verified settlement or
   approved prefunding. Preserve legacy Paystack balances and late deposits.
5. Review paid-interest allocation, capacity and goal completion together. Accrued
   interest is not paid cash; only verified net payouts may increase funded totals.
6. Integrate notification delivery and verify phone permission/token, receipt,
   inbox state and goal deep link on a real device.
7. Review/apply the registered append-only migrations, restricted role/configuration
   deployment, CI/CodeRabbit and authenticated production/staging activation.
8. Verify legacy spending and withdrawal custody boundaries when the local wallet
   contains both legacy and PiggyVest-backed funds.

The goal remains active until these connections and permissible end-to-end checks
are verified. A hidden button, library-only implementation or fixture pass is not
an integration completion gate.
