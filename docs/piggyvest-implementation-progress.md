# PiggyVest implementation execution

Updated 12 September 2026. Local implementation authorized; deployment, hosted storage, secrets, provider transactions and messages remain separately approval-gated.

## Work order

### Browser QA and mobile edge-case closure

The isolated synthetic web preview now runs actual policy/funding/status panels at
`http://127.0.0.1:4179/`, with env loading disabled and no provider requests. Parent
browser checks confirmed explicit consent, exact-variant reset, funding states,
logout clearing and failed-consent retry. This is component QA, not the deployed
storefront or provider sandbox.

Mobile review found and fixed stale catalog/route choices, delayed automatic
targets, stale goal/authorization effects, confirmed-success key retirement,
cross-merchant saved-card state and dismissed recovery errors. Independent
follow-up review found the additional three findings resolved. Parent ran 143
mobile tests across 23 suites and 1,099 web tests across 90 suites successfully.
Native device UI has not been run. See `docs/piggyvest-local-ui-qa.md` for exact
scope, preview checks and remaining native prerequisites. No external changes.

### Authenticated draft consent composition

- Added concrete session-derived policy context with merchant/project/customer
  allowlists and explicit RLS projections; no request-selected actor or customer.
- Added bounded no-store draft read/accept handler with real CSRF integration,
  exact staged revision and SHA256 terms matching, and idempotent SQL revalidation.
  Review caught stalled request-body reads; two-second timeout/abort handling and
  regressions now cover this, alongside byte/chunk/header limits.
- Added accessible draft review and a panel that validates reads/acknowledgements,
  resets on context changes and rejects stale results. Consent never activates
  funding, a price guarantee, interest or purchases.
- Parent composition tests connect concrete RLS resolution, cookie CSRF, actual
  handler and panel with synthetic database responses. Three cases pass. The
  existing actual policy executor now also has nine passing disposable-DB tests,
  with least privilege, deferred commit rejection and restart durability.
- Combined provider/UI/schema tests: 91 suites / 1,130 passed, 19 skipped. A later
  stale-read case passes in the eight-test panel suite. Root lint/typecheck pass;
  no claim is made that the historical full-monorepo suite failures are resolved.

No live route, production page, external authentication, remote SQL, deployment,
secret, DNS or provider operation was performed. Runtime binding and approved
terms are explicit release prerequisites, not inferred from synthetic success.

### Latest local review: funding display and draft consent persistence

- Funding display uses a strict public schema, rejects extra provider fields and
  hides account details immediately across goal/session and loader transitions.
  Independent review reproduced a null-to-same-key stale account commit; regression
  tests now cover that commit, A-to-B-to-A, loader restoration and late responses.
- The authenticated goal resolver was independently reviewed with no verified
  findings. It still refuses to infer versioned consent from legacy goal metadata.
- Private draft policy snapshots and immutable consent receipts now have scoped
  SQL/store implementations. Collection remains paused, guarantee null, with
  disabled registry/terms defaults and no public/customer/service-role grants.
  A dedicated exact-statement executor role permits local-test transport only.
- SQL review found relative-expiry and UUID-casing defects. Append-only migration
  `20260912140300_goal_policy_canonical_commands.sql` and regressions fix both;
  independent follow-up source review found no further actionable issue. All four
  new drafts are pinned in the pending migration hash registry, not applied remotely.
- Parent verification: 82 suites / 975 tests pass; three suites / ten tests skipped
  in that normal run. Separately, the disposable PostgreSQL policy harness passes
  scope, permissions, immutability, absolute timestamps, UUID compatibility, actual
  lock-waiter concurrency, credit-before-consent rejection and restart durability.
  These are synthetic local checks, not provider sandbox validation.
- A prior combined run caught in-progress RED executor tests; the passing run
  above supersedes those failures. Root lint passes all four tasks (one existing
  warning), root typecheck passes all six tasks, and `git diff --check` passes.
  After correcting a test-only nullable-props type, the four hook regressions pass
  again. The historical full-monorepo evidence/clean-head failures remain separate;
  this focused run is not a claim that the entire monorepo suite is green.

This does not complete the full savings product. Authenticated acceptance/page
wiring, provider chronology, activation, scheduled collections, purchase settlement
and cancellation/refund workflows remain. Local absence of funding history does
not prove no pending provider inflow; the policy foundation must not activate a
funded legacy plan or be treated as proof of a customer's actual acceptance.

1. Finish exact-variant savings behavior and independent SQL review. Preserve legacy funds and original terms; never treat internal inventory anchors as customer choices.
2. Verify official provider contracts and build a fail-closed read-only staging adapter with synthetic tests.
3. Implement pure savings policy decisions separately from provider-dependent financial effects.
4. Build and verify internal durable inbox/account mapping without enabling financial effects. Activation and event-specific accounting require confirmed signed payload, units and retry contracts. Unknown financial events must not credit balances.
5. Connect recovery and synthetic-only savings paths after underlying database and accounting checks pass.
6. Run targeted tests, isolated database behavior tests, lint/typecheck and broad regression/review. Record failures without disabling guards.
7. Present exact staging activation and sandbox-run prerequisites for owner approval. Registration success is not financial integration success.

## Active assignments

- Mobile consistency: variant eligibility, internal inventory anchors and exact-device labels; regression tests.
- Independent database review: migration correctness, direct-RPC safety, completed legacy recovery and faithful local SQL validation.
- Provider adapter: strict staging configuration, wallet retrieval ownership checks, bounded/redacted HTTP handling and contract register.
- Pure policy: price activation/readiness with confirmed money and consent only.
- Coordinator: integration, scope boundaries, recovery contract and final acceptance.

## Known blockers

- Completed legacy recovery is connected locally to a dedicated mobile selector and authenticated API. The append-only SQL is reviewed and passes focused synthetic checks, but remains unapplied to staging.
- The earlier full-suite run failed in migration-registry and cost/evidence tooling. The pending registry now includes exact migration hashes and its frozen-base smoke check passes. Whole-suite acceptance is still outstanding; do not weaken clean-worktree evidence guards.
- Official signature docs describe SHA512 over JSON.stringify and unconditional 200 acknowledgement. A provider-signed representative vector and storage-outage/redelivery contract are still required before enabling financial intake.
- Provider amount units, detailed financial event contracts, refund route/fees, interest attribution and settlement ownership must be established before their affected financial operations are enabled.
- No current authenticated PiggyVest API result or financial sandbox success is claimed.

## Evidence

- Existing API slice: 25 focused tests passed; lint and typecheck passed before this execution batch.
- New work must carry its own red/green and final review evidence. Drafted or mocked behavior is not deployed, durable or provider-certified behavior.

## Execution checkpoint

- Added strict authenticated `goals/resolve-variant` endpoint and schema. Request-supplied customer IDs, balances and prices are rejected; ownership is server-resolved and successful responses must match the requested goal.
- Seven savings API/schema suites passed (49 tests). Color is now retained in server-side exact-variant labels.
- Read-only staging adapter and pure policy tests passed together: seven suites, 63 tests. Independent review rejected configuration host bypass, raw provider-field passthrough, cancellation-consent defaults and inconsistent reservations; corrections have focused coverage.
- Policy is disconnected pure code. The local version marker does not prove customer consent; no accrued interest becomes spendable and no cancellation/refund/FX operation is enabled by these helpers.
- Mobile recovery uses a dedicated same-product variant selector, not product swap. Completed unresolved goals now expose “Choose exact variant” from normal wallet navigation without enabling top-ups.
- SQL review produced append-only corrections for expensive legacy selection, forged snapshots, over-total redemption and nonfinite numeric values. A disposable socket-only PostgreSQL harness exercises focused synthetic schema/RPC behavior. It does not recreate Supabase extensions or prove full-schema RLS.
- Corrected the positive recovery SQL test fixture to select an affordable variant; timestamped historical migrations were not edited. The expensive-selection rejection remains a separate regression.
- Registering exact new migration hashes in the existing pending-source manifest addresses the migration-registry failures without relaxing verification or hiding SQL files.

## Not implemented or activated

Provider-backed ledger/reconciliation, deposit simulation, fund transfers, cancellation payouts and schedules remain unimplemented and gated by their contracts and isolated storage/credential activation. Local provisioning request/dispatch code is now being verified, but real customer/wallet creation and confirmation are not enabled or tested. Offline authenticated intake and a durable inbox now exist, but are disconnected from the public endpoint. These foundations are not a complete financial integration. Original registration-service work remains in the original worktree and must be deliberately included in any future approved staging artifact.

## Resumed verification, 12 September 2026

- Independently reviewed completed-goal navigation. Two new regressions failed before the fix: no recovery button and navigation incorrectly opening a new plan. Both pass after the fix; the three-suite navigation/action run passed 11 tests.
- Focused mobile savings run passed 31 suites / 250 tests before the navigation follow-up. The final extracted client/action run passed three suites / 34 tests. Counts overlap and must not be added together as unique tests.
- Focused web API, schema, adapter, policy and pending-source tests passed 20 suites / 140 tests.
- Frozen migration-base verification passed its selected smoke case (14 other cases intentionally not selected). No manifest guard was relaxed.
- `bash tools/test/run-customer-savings-sql-regressions-local.sh` passed all four focused behavior scripts in a disposable socket-only synthetic PostgreSQL cluster.
- `pnpm turbo lint` passed all four tasks with existing warnings. `pnpm turbo typecheck` passed all six tasks after correcting a new test callback return type.
- The full monorepo test suite has not been rerun to completion in this resumed batch. Earlier full-suite failures are not erased by these targeted passes. Physical mobile UI and provider sandbox acceptance remain outstanding.

## Durable processing continuation

- Added offline bounded request intake, raw-byte signature verification, common-envelope validation and a parameterized PostgreSQL adapter. An accepted result requires the injected executor to resolve after commit; no real connection is provisioned.
- Added private staging inbox and disabled-by-default account registry migrations. Exact duplicates do not insert again; conflicting bytes never overwrite an event. All caller grants remain revoked.
- Added lease-fenced claims, bounded attempts, retry/dead-letter handling and a quarantine-only worker. It never writes balances or marks financial events processed.
- Reused the existing signature primitive from the original worktree rather than inventing a second algorithm. Provider serialization confirmation remains an activation gate, not a reason to stop offline implementation.
- Independent review found quoted UTF-8 header rejection and a character-count/SQL-byte-count mismatch. Both were reproduced and fixed. A separate regression fixes excessive empty stream chunks; retained request data is bounded.
- Latest focused processing/schema/manifest run: 15 suites / 180 tests passed. Local PostgreSQL harness passed restart/replay and two-session claim checks. No provider API was called.
- Added immutable trusted wallet-to-plan mapping and an account/merchant-bound lookup adapter. Both provider wallet and customer IDs must match. SQL rechecks current local ownership; cross-tenant mappings are rejected.
- Reviewed and fixed provider-customer/local-customer consistency across multiple plans. Provisioning serializes per integration at READ COMMITTED; stale-snapshot isolation is rejected. Two-session provisioning tests pass.

## Final continuation checks

- Focused processing, mapping, schemas and exact migration-hash checks: 18 suites / 205 tests passed. These runs overlap earlier counts.
- Both disposable PostgreSQL harnesses passed, including restart/replay, concurrent claims, mapping permissions and serialized customer binding. Four new staging migrations are hash-pinned alongside the six existing savings drafts. Nothing was applied remotely.
- Final `pnpm turbo lint` and `pnpm turbo typecheck` passed, with existing lint warnings.
- Full `pnpm turbo test --concurrency=1` was interrupted after failures in `cloudflare-evidence-process-isolation`, `validate-storefront-edge-inventory`, and a timing-sensitive `verify-event-pipeline-modularity` case. This is not a full-suite pass. The modularity case timed out at its unchanged 10-second limit in an isolated rerun; a diagnostic run with a 30-second CLI timeout passed without changing repository configuration. Do not disable clean-checkout or reviewed-artifact guards to obtain green results.
- Scoped Zoho searches for Anjola's messages failed twice with connector HTTP 500/Internal Error. The earlier temporary mailbox script is no longer present. Email contents, including any newer signed sample, remain unverified; no reply was sent and no credentials were displayed.
- Remaining financial work: provider-backed provisioning/intents, transactional ledger/reconciliation, settlement/refund/scheduling integration and end-to-end sandbox validation. The current worker quarantines all events and cannot affect balances. See the contract register and inbox runbook for the precise activation boundaries.

## Goal continuation: provisioning and funding

- The full implementation goal remains active. `docs/piggyvest-goal-execution.md` tracks the original scope and missing acceptance evidence; this batch is not a reduced definition of completion.
- Added documented customer/dedicated-wallet request construction, synthetic allowlisting, server-owned interest routing and keyed request fingerprints. Raw KYC/contact fields are never persisted in the intent store or logged; bounded private correlation IDs are retained for recovery.
- Added seven private append-only provisioning migrations, a restricted SQL adapter and an orchestrator that awaits prepare and first-dispatch results before POST. The injected executor must resolve only after commit; a real driver is not yet wired. Requests are application-idempotent; no provider idempotency is assumed. Missing or conflicting ownership/account/customer bindings prevent dispatch.
- Accepted results preserve bounded private recovery IDs and remain awaiting confirmation. Timeouts, ambiguous responses, stale claims and failed result commits cannot trigger another POST. Explicit confirmation/recovery completion and real executor wiring remain outstanding.
- Added a bounded shared staging HTTP transport and mapped funding-account reads. Funding rejects missing injected transport before any global network fallback, checks wallet ownership/currency and active status, and treats absent accounts as pending. No displayed account creates a deposit or changes a balance.
- Independent review found that omitting an interest payout destination was incorrectly assumed to route to the new wallet. A precise regression failed before the fix and now passes; accrual with that choice requires explicit verified default-routing configuration. No such live configuration was provisioned.
- Focused provider/schema/exact-migration-hash run passed 35 suites / 457 tests. The new seven-suite provisioning subset passed 114 tests; counts overlap and must not be added together.
- Coordinator reran `bash tools/test/run-piggyvest-provisioning-sql-local.sh`: passed ownership/RLS, replay/conflict, first-dispatch concurrency, customer/account binding, expiry/fencing and restart/recovery fixtures in disposable socket-only PostgreSQL. All seven new SQL files are independently hash-pinned in the existing manifest; 17 savings/staging migration drafts are now registered.
- Final `pnpm turbo lint` passed four tasks with existing warnings; `pnpm turbo typecheck` passed six tasks. `git diff --check` passed. The full monorepo suite was not rerun to completion in this batch, and prior broad failures remain separately reported.
- Next work is a real restricted local executor and provisioning recovery/confirmation, then transactional ledger/reconciliation and savings integration. Staging deployment, provider profiling, authenticated credential use, signed financial event acceptance and end-to-end sandbox validation remain unproven and approval-gated. See `docs/piggyvest-provisioning-local.md` for executor and activation requirements.

## Restricted database runtime continuation

- Added pinned `pg` driver and types with a minimal dependency-only lockfile change. Installation used disabled lifecycle scripts; the frozen workspace install passed. No environment files, deployed roles or remote database connections were created.
- Implemented the real parameterized executor with a role-specific exact SQL catalog, explicit connection identity/TLS, safe-session checks, bounded connection/query/lock/overall timeouts, READ COMMITTED transactions and COMMIT acknowledgement before returning. Uncertain results fail closed without retries; provider payloads and credentials are not logged.
- Added a disposable Unix-socket-only PostgreSQL runtime harness. Eight synthetic integration tests passed: concurrent inbox deduplication, quarantine, deferred COMMIT failure rollback, independent role denial, lock timeout, committed provisioning before simulated HTTP, concurrent single dispatch and response-loss no-resend. The harness uses real driver/storage but mocked provider HTTP, not the provider sandbox.
- Added unit/schema regressions for privilege escalation, environment fallback, unsafe SQL/parameters, byte mutation, nonsettling connections, late query completion and redacted errors. Constructor redaction first failed and was corrected; constructor mocks were subsequently made constructible after the combined run exposed a test setup failure.
- Focused provider/schema/hash tests passed 39 suites / 528 tests; the eight real-database cases are intentionally skipped in that ordinary run and are executed separately by the disposable harness. These counts do not replace full-suite or provider validation.
- Independent read-only executor review reported no verified actionable issues. It did not rerun the database tests and is not certification or a review of the entire savings integration.
- Final runtime batch validation: `pnpm turbo lint` passed four tasks with existing warnings; `pnpm turbo typecheck` passed six tasks; `git diff --check` passed. The fresh full `pnpm turbo test` run failed when mobile-storefront Jest terminated with SIGSEGV; Turbo then terminated the web/admin runs. Three of six tasks completed successfully. This is not a green full suite and the crash cause has not been established. Log: `/private/tmp/piggyvest-runtime-full-suite.log`.
- Confirmation/recovery completion, ledger/reconciliation, financial effects and product wiring remain unfinished. No merge, deployment, provider operation or external message occurred. Current provisioning and readiness details are in `docs/piggyvest-provisioning-local.md`.

## 12 September: recovery, ledger and review follow-through

- Added fresh-customer provenance, bounded independent wallet verification and
  transactional customer/plan completion with immutable goal mapping. Historical
  acknowledgements cannot manufacture ownership and uncertain creation never resends.
- Added restricted internal balanced ledger, transaction observation adapter and
  authenticated-goal-resolver savings view. No provider event is yet classified as
  spendable money; neither pending interest nor a creation acknowledgement is cash.
- Independent review identified UUID acknowledgement normalization, decimal JSON
  reference casts and purchase availability during an existing reservation. All
  three were fixed with regression coverage; SQL correction is append-only.
  The reservation regression first reproduced the incorrect confirmation action
  for both purchase and cancellation reservations during an ordinary read.
- Post-review focused validation: 57 suites / 698 tests passed; the 10 database
  tests skipped in that run passed separately in 3 real PostgreSQL suites. Ledger
  SQL acceptance, restart and four synchronized concurrency races also passed.
  Thirty migration drafts are hash registered. No remote migration was applied.
- New regression formatting initially failed lint and was corrected. Final
  `pnpm turbo lint` passed four tasks with existing warnings, typecheck passed six
  tasks and `git diff --check` passed.
- Serial full-suite retry is still running in
  `/private/tmp/piggyvest-implementation-final-full-suite.log`; mobile-storefront
  reports 985 passing suites, but this is not a completed monorepo pass. The run
  started before final review fixes; focused post-review tests are separate evidence.
- Rechecked official webhook payload/signature documentation after the owner's
  question. The payload page still omits event-specific financial details and the
  signature example says always acknowledge 200 without durable-outage guidance.
  Do not ask for all public docs again; request only the missing contract details.
- Full product implementation is not complete. See
  `docs/piggyvest-implementation-readiness.md` for remaining local product paths,
  provider contract gaps and separate deployment/sandbox approval gates.

## 12 September: parallel interest and customer-status implementation

- Used separate agents for the accrued-interest adapter, isolated customer-status
  component and the nonpayment variant recovery security fix; parent implemented
  the transport allowlist, server display projection and integration tests, then
  reviewed the agent patches. No external operations were performed.
- Official accrued-interest response contract now has bounded, one-page retrieval
  using trusted staging wallet/business/customer mapping. Requires explicit date
  windows, validates pagination and never converts unconfirmed provider monetary
  units into ledger balances. Interest observations remain nonspendable.
- Added accessible staging-labelled exact-variant status display and a server
  projection backed by the existing internal ledger view. Pending interest comes
  from the same snapshot as purchasing power and cannot trigger purchase readiness.
  Synthetic integration coverage renders the actual component using this projection.
  Actual page authentication/persisted-goal resolution and customer-route wiring
  are still required; a callback interface alone is not end-to-end authentication.
- Removed unnecessary payment-secret/VTU/Kuda dependencies from the new variant
  recovery route. Its dedicated RLS context requires the customer already be linked
  to the authenticated user in the resolved merchant; it performs no implicit
  email-based linking or customer writes. Existing Paystack routes are unchanged.
- Review caught opaque pagination cursors incorrectly inheriting wallet-path
  restrictions. A regression reproduced rejection of literal percent-encoded text
  in an opaque cursor; separate bounded cursor validation now accepts it without
  widening wallet paths, HTTP methods, API origins or redirects.
- Final focused run: 73 suites / 827 tests passed, with ten real PostgreSQL cases
  passed separately in three suites. Root lint passed four tasks with existing
  warnings; typecheck passed six tasks. Registry and analytics authority rerun:
  58 tests across three suites passed. Counts overlap; do not total them.
- Earlier full serial monorepo run finished with seven failed web suites (ten
  tests), not a green full suite. Mid-edit migration registration and missing
  colocated catalog tests were corrected and rerun. The variant credential-graph
  regression was fixed separately. Three cost/evidence tests require a clean,
  approved source/lockfile snapshot; those safeguards were not weakened or
  regenerated to bless this dirty worktree. No full-suite pass is claimed.
- First concurrent focused run caught an accrued-interest configuration error;
  the agent fixed it and the final run is green. A concurrent lint run observed
  unfinished agent test formatting; final lint is green after formatting.
- Funding details page integration, persisted consent/lifecycle, settlement/refund
  workflows, schedules and the deployment artifact remain outstanding alongside
  provider-specific contract and activation gates. The full integration is not done.
- The final repository-wide event-pipeline security boundary test passed after
  the variant-route isolation fix (one test, 90 seconds). No allowlist exception
  or credential-authority guard was weakened.
