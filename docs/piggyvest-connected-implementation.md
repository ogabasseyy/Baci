# Connected local implementation — 12 September 2026

This report distinguishes runnable local implementation from provider activation.
No commit, push, deployment, remote migration, credential use or money movement
is authorized or established by this work.

## Latest completed local wave

This checkpoint supersedes older descriptions below of missing HTTP packaging,
funding connections and nonpersistent schedule proposals. Earlier counts remain
historical, not additive full-suite totals. Reports were checked for this
documentation update; runtime tests were not rerun.

- **Current browser components:** Sartre's separate disposable 4183 fixture
  prepared goal 702 once, immediately removed funding/account details and cached
  progress, then read the retained 5000 internal-kobo principal reservation with
  zero paid/pending interest. Reload was recovery-only, without funding or a new
  preparation opportunity. Pending-state ordering is supported by deterministic
  component regressions, not a separate browser timing capture. The original
  same-session 4181 cluster and its consumed 702 operation were preserved;
  identical IDs in the new fixture do not replace that evidence. See the
  [browser QA report](../tools/test/runtime-journey-browser/README.md).
- **SSR and current funding guards:** actual request-scoped Supabase SSR is
  project-bound, exclusive with the injected client factory, and explicitly
  configured. Synthetic auth/RLS HTTP tests do not establish a real login. CSRF
  binds origin, cookie path, fixed goal, actor and session. Funding SQL/mapping/
  fetch dependencies are checked around awaits; late response bodies are
  cancelled. Web/native cancellation subscriptions block funding and progress
  before preparation dispatch and throughout uncertainty/recovery. Hiding
  instructions does not revoke the provider account. See the
  [runtime report](../apps/web/src/lib/piggyvest/runtime-composition.report.md)
  and [independent bounded review](piggyvest-final-gap-audit.md).
- **Actual packaged HTTP and restricted PostgreSQL:** four tests passed in total:
  one abort case, two connected journeys, and one post-restart case, plus SQL
  assertions before/after restart. These cover distinct variants, auth/real CSRF
  bootstrap, duration consent, zero-principal funding display, fixture-only
  duplicate internal credits, activation, separate-goal cancellation/recovery,
  schedule pause and database-clock expiry. Abort prevents the next accounts
  read, not the already-started wallet read. This is not a provider
  webhook-to-ledger bridge.
- **Cleanup acceptance:** the anomalous concurrently edited run is retained in
  the [journey report](../apps/web/src/lib/piggyvest/runtime-journey-local.report.md),
  separately from the parent's clean frozen baseline. The exact host-Bash
  nounset/exit-status defect was reproduced and corrected with a completion
  sentinel. Four cleanup regressions pass, including failed PostgreSQL stop
  retaining directories with nonzero exit. The separate post-fix full journey
  exited 0 with four tests/SQL assertions; its directories were verified removed
  while both browser holds remained intact.
- **171000 registered purchase current recovery:** parent reports root lint and
  typecheck passed at the 171000 checkpoint, not full-monorepo testing. Hooke
  reviewed the frozen read-only operation. After exact catalog/registry
  integration, the owner reports four actual standard-executor/HTTP tests passed;
  the prior purchase/lifecycle HTTP harness also passed three before restart and
  one after restart, with five existing pricing-executor tests in each command.
  Current internal balances/reservation evidence remain separate from historical
  receipts and grant no funds-use or retry authority. See the
  [registered recovery report](../apps/web/src/lib/piggyvest/purchase-current-recovery.report.md).
- **172000 registered local acceptance passed:** parent reports exit 0 in
  `/private/tmp/piggy-parent-collection-acceptance.log`: the new standard-executor
  case passed once before and once after PostgreSQL restart, with the other phase
  intentionally skipped each time. SQL canonical-evidence/no-duplicate-credit/
  late-principal invariants and 12 observed lock waits (eight existing, four new)
  passed. Leibniz independently reports the same green result and unchanged
  frozen hash. Parent root lint passed four tasks with warnings retained, and
  typecheck passed six tasks after 172000. This accepts the bounded local path
  only; the provider financial bridge remains disabled.

Runnable commands and precise limitations are in the linked reports. Packaging
uses explicit TEST-only empty-env, server-only and rejecting pg-native
substitutions; dependency/digest proof is not a production deployment recipe.

## Connected paths

- `createPiggyvestCustomerScreenRuntime` authenticates first, resolves the
  configured allowlisted merchant/customer/goal through RLS, revalidates before
  persistence and response, and returns a strict public screen projection.
- The shared loopback-only policy HTTP client invokes GET/POST with explicit
  cookie/CSRF configuration, bounded responses, correlation checks and abort
  handling. No ambient credentials or automatic retries are used.
- Web and native consume the same public screen schema. Exact prepared duration
  is displayed and submitted; missing or different duration cannot silently
  acquire consent. Generic older draft consent is not retroactively upgraded.
- Connected regressions cross the shared client, actual HTTP listener, session-
  bound CSRF, policy store and real restricted PostgreSQL executor. Auth/RLS and
  provider responses remain synthetic; neither real login nor provider sandbox
  execution is established. Database persistence is real and local.

## Persisted lifecycle

The local-only lifecycle stores selected duration before acceptance, then
requires exact duration and policy consent. Activation uses locked confirmed
internal principal, a valid exact-device quote and the 5% threshold. It creates
an immutable guarantee receipt, derives calendar maturity/grace in Africa/Lagos,
and keeps collection paused. Existing shorter promises are not overwritten.

Prepared duration and generic acceptance serialize on the same scope locks;
neither can silently win a race and create an activatable unconsented duration.
An activation receipt is historical evidence, not current spendability or a
standing permission to collect funds.

## Cancellation boundary

Cancellation preparation uses the existing shared ledger reservation, not a
second balance system. It requires a disabled-by-default reviewed terms-version
and hash mapping, current ownership, exact disclosed amounts and no conflicting
reservation. Principal is reserved; interest disposition remains unresolved.
Dispatch returns an explicit contract gap. There is no refund-success claim,
interest sweep, reservation release or provider mutation.

An isolated web cancellation review now connects to an authenticated local
handler and the restricted executor. Public requests cannot choose an actor,
tenant or account. The handler validates CSRF and bounded JSON, rechecks ownership
and compares exact quoted amounts transactionally. Unknown outcomes retain the
possibility of a reservation; no automatic retry or funds-release claim is made.
Exact-command replay preserves the original operation ID without a fresh quote.

Append-only correction 602 removes an unnecessary update of an already-paused
goal that invalidated the accepted policy snapshot through the production-style
timestamp trigger. Regression tests preserve that snapshot after preparation.
Existing migrations 600 and 601 remain unchanged.

## Reconciliation evidence

The wallet-scoped transaction-list reader verifies trusted mapping and wallet
ownership before retrieving one bounded page. The documented list amount is
kobo; observations retain their provider statuses without becoming spendable
customer credits. Field-specific gaps for financial event attribution, interest
amounts and settlement remain in the contract register.

## Still required for the full product

1. Finish customer connections beyond proved funding/consent paths: current
   pricing/protected offers, complete lifecycle/purchase presentation and all
   corresponding shared-client/native flows. First funding must not require
   activation; a checkbox alone cannot authorize funding instructions.
2. Complete wallet-preserving device change, unfunded closure, all-payment-leg
   and compensation transitions, and late principal/surplus/period-interest
   recovery. Accepted 171000 observations and 172000 canonical-evidence/late-
   principal checks do not establish all period-interest, disposition, settlement
   or compensation requirements, nor enable a provider financial bridge.
3. Finish collection-owner handover/cadence and customer restart-consent flows;
   durable pause/resume proposals and expiry exist but grant no debit permission.
   Complete reviewed terms, full-public-schema compatibility, installed native
   session/networking acceptance, production packaging and final candidate review.
4. Obtain scoped approval for external staging configuration, restricted grants,
   credentials and provider sandbox operations. Then verify real delivery,
   reconciliation and recovery before calling the integration live.

The loopback browser preview is synthetic. No deployed storefront or native
route supplies these staging inputs by default. Provider profiling, valid API
credentials, deployed webhook readiness and successful sandbox end-to-end tests
are separate evidence gates; none follows from these local tests.

## Verified local checkpoint

Parent verification on 12 September 2026:

- Web targeted suites: 1,374 passed, 28 opt-in cases skipped across 117 suites.
  An earlier run exposed an outdated executor-catalog expectation; the explicit
  approved-operation expectation was corrected before this passing rerun.
- Shared contracts/client: 103 tests passed. Native savings/variant components:
  171 tests passed across 25 suites; Jest still prints its forced-exit advisory.
- Connected local PostgreSQL consent: nine existing persistence tests plus four
  connected flow tests passed, with one durable acceptance and no ledger writes.
- Lifecycle: seven real-executor tests, synchronized activation/reservation and
  both duration-consent lock-order races passed, including restart durability.
- Registered staging migration replay: 33 drafts passed ACL/RLS and restart
  checks on a synthetic minimal public schema, not the production schema.
  Nine replay-planner tests also passed.
- Preview checks: six component, four fixture/source and three server tests
  passed. Browser checks showed exact one/three-month duration, reset consent
  after switching variants and blocked funding after simulated acceptance.

A public unauthenticated staging webhook GET returned HTTP 200 with successful
TLS verification. No POST, credentialed API call or provider delivery was tested;
this result does not identify the deployed revision or enable financial handling.
Full monorepo tests, native device acceptance and deployment remain unproven.

### Final cancellation follow-up checkpoint

- Parent targeted web run: 1,416 passed, 30 opt-in tests skipped in 122 suites.
  Root lint and typecheck passed. This is not a full-monorepo test result.
- Parent replay after correction 602: 34 registered staging drafts passed
  ACL/RLS and restart checks on the synthetic baseline.
- Parent cancellation harness passed timestamp/isolation/observed-lock cases,
  one real-adapter test and five connected UI/handler tests with real restricted
  local PostgreSQL. Authentication and HTTP remain synthetic/in-process.
- Database assertions prove one success reservation/intent, no reservation for
  mismatched displayed amounts, unchanged interest and no terminal operations.
- Independent review closed a UUID-casing receipt mismatch. Command bytes are
  preserved while identity comparison is canonical; twenty web review tests
  and fourteen shared-contract tests pass.

Both customer handlers share the bounded request-body reader. Deployed routing,
durable customer recovery UI, native cancellation presentation and provider
refund/interest handling remain outstanding. No provider message was sent.

### Mobile review and browser fixture follow-up

An isolated native `PiggyvestCancellationReview` now consumes the shared public
contract. It handles exact confirmation, canonical UUID comparison, late results,
unmount, unavailable quotes and uncertain outcomes. It is not yet bound into a
deployed native screen or an authenticated transport.

Same-tick duplicate submission was reproduced in both review implementations.
The web regression initially dispatched twice; checking the attempted-operation
set inside the action handler now prevents the second call before React renders.
The server's durable idempotency remains the authoritative financial protection.

The loopback preview now includes a separate synthetic cancellation section.
Browser verification confirmed unchecked confirmation initially disables the
button, simulated preparation cannot claim a refund, goal changes reset consent,
uncertainty disables resubmission, and missing session hides the quoted amounts.
All browser receipts and reservations are invented display states; no database,
provider request, real terms acceptance or money movement occurs in this fixture.

Parent verification: 24 native component tests, 21 web cancellation tests,
12 preview component/fixture tests and seven preview isolation tests pass.
Root lint/typecheck and whitespace checks pass; existing lint warnings and Jest
forced-exit advisory remain. Full-monorepo and installed-device tests were not
run for this follow-up. No production files, credentials or infrastructure were
activated.

## Parallel integration checkpoint

- Restricted executor now includes exactly one read-only cancellation recovery
  operation and three purchase preparation/quote/status operations, exclusively
  for the existing policy writer. No remote grants or deployment were applied.
- Parent recovery harness passes committed-response-loss recovery and a separate
  post-restart read, with one retained reservation and no resubmission.
- Parent purchase harness passes five real-executor tests and second-restart
  assertions. Quotes are explicitly fixture-published, not an authoritative
  checkout integration; no orders, settlement or fulfilment are created.
- Web/native optional cancellation controller bindings preserve exact commands
  within an authenticated in-memory lifetime. Recovery-only reconstruction
  never grants retry authority. New server uncertainty now supersedes cached
  preparation success; this review finding was fixed on both platforms.
- Scheduling is a tested nonpersistent proposal planner, not saved consent or
  an enabled collection schedule. No cadence or money transport is inferred.
- Parent broad targeted web run: 1,527 tests pass, 36 opt-in cases skipped.
  Root lint/typecheck pass. Parent full local replay: 37 registered drafts pass
  ACL/RLS/restart checks on the synthetic baseline, not production-schema proof.
- Native recovery binding/screen rerun: 16 tests pass. The initial concurrent
  run hit one five-second test timeout; the unchanged focused rerun passed.
  This is not a full native-suite result. Jest's forced-exit advisory remains.

The provider readiness report is `docs/piggyvest-provider-final-readiness.md`.
It records remaining contracts, approval gates and draft questions; none were
sent. The latest completed-wave section supersedes this earlier checkpoint's
missing funding-binder, durable-schedule and packaged-runtime descriptions.
Remaining local work is the requirement-level checklist above, not only provider
approval.
Provider settlement/refund/interest processing and deployed sandbox validation
remain separately gated. The full product is not complete or live.
