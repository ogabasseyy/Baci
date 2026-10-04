# PiggyVest provider contracts and final-readiness dependencies

**READY FOR PARENT REVIEW — 12 September 2026. Not activation approval.**

This report concerns the implementation checkout at
`/Users/mac/Baci-worktrees/cursor-savings-phase1`. Public official documentation
was inspected read-only on 12 September; no API credentials, provider operations,
remote database, deployment or external messages were used. The approved
wallet-interest business case and dedicated wallet per plan are not reopened.

## Sources and interpretation

Read `docs/piggyvest-goal-execution.md`,
`docs/piggyvest-connected-implementation.md`,
`docs/piggyvest-contract-register.md`, implementation-readiness and sandbox reports,
plus both original `2026-09-11-piggyvest-staging-integration.md` and
`2026-09-11-piggyvest-savings-product-rules.md` under the explicitly authorized
original worktree's `docs/superpowers/plans/` directory. Original plans were not
copied or modified. Historical report counts and deployment observations are not
fresh verification by this review.

“Missing” below means not specified sufficiently in the inspected public pages;
it does not mean the provider lacks the capability or has not privately supplied
an answer. No mailbox or private credentials were inspected. Product-policy
decisions are distinguished from provider contracts.

## Available contracts and precisely scoped gaps

| Area | Official contract available now | Remaining gate and affected operation |
| --- | --- | --- |
| Transaction list | Singular `GET /api/v1/transaction`; `edges[].amount` explicitly kobo; wallet filter, limit maximum 100, cursor, optional collapsed batches. Status vocabulary is pending/successful/failed/partial; failed is described as terminal failure and partial as incomplete batch/split success. [List](https://www.piggyvestbusiness.com/docs/api/transactions) | No blanket unknown-units gate for this amount. Category/economic-event attribution, reversal linkage and cross-observation deduplication must still be established before ledger posting. Keep batches uncollapsed and page reads bounded. |
| Single transaction | `GET /api/v1/transaction/:transaction_id`, optional wallet ownership filter, customer/source/destination IDs, references, status and interest breakdown are documented. [Single](https://www.piggyvestbusiness.com/docs/api/transactions/single) | The page does not specify field units for its amount, fee, available/source/destination balances or gross/tax/net interest breakdown. Do not infer those from the list row or classify unexplained cash as principal/interest. |
| Transfers and recovery | Wallet/bank POST inputs use integer kobo and merchant reference; wallet transfer is within the business account. Reference is returned through webhook/TSQ. HTTP 202 is processing, not final success. [Wallet transfer](https://www.piggyvestbusiness.com/docs/api/transfers/wallet), [bank transfer](https://www.piggyvestbusiness.com/docs/api/transfers/bank) | Exact duplicate-reference/idempotency scope, retention, response-loss recovery and reversal/compensation semantics are not supplied by these pages. A stable reference alone is not permission to resubmit. |
| Verify by reference | `GET /api/v1/transaction/verify?reference=...`, optional wallet filter; TSQ lists success/pending/failed. [TSQ](https://www.piggyvestbusiness.com/docs/api/transfers/status) | Preserve the distinction between TSQ `success` and list/single `successful`; obtain explicit normalization and reversal/partial semantics before a financial state-machine mapping. A status contract exists, but not a complete accounting contract. |
| Event attribution | Named inflow/outflow, wallet-transfer and interest-payout events exist. Common envelope includes eventId, customer, type/category, eventData and applicable wallet/reference fields. GET 200 is required for webhook registration, POST for delivery. [Events](https://www.piggyvestbusiness.com/docs/webhooks/events), [payload](https://www.piggyvestbusiness.com/docs/webhooks/payload) | Need complete synthetic financial samples linking eventId, PVB transaction ID, merchant/peer reference, wallet, amount/currency and payout period. Confirm ID uniqueness/retry stability and reversal links. Different observations of one movement must not create multiple credits. |
| Signature and delivery | `x-pvb-signature`, HMAC-SHA512 hex; sample hashes `JSON.stringify(req.body)` and recommends 200 acknowledgement. [Signature](https://www.piggyvestbusiness.com/docs/webhooks/signature) | Need an exact signed-byte vector and serialization rules, especially Unicode/whitespace, plus storage-outage response, retry schedule/retention and manual replay. Do not guess canonicalization or acknowledge lost valid events merely to satisfy registration. |
| Interest | Paginated original/differential accruals, daily accrual and prior-month payout on the first are documented. More than four monthly withdrawals removes that month's payout eligibility; bank outflow is explicitly included. [Interest](https://www.piggyvestbusiness.com/docs/api/wallet/interest) | Amount/balance/percentage units, calculation/rounding and gross/net treatment remain unspecified here. Need payout-to-plan/period attribution, late payout/reversal rules and technical counter scope, timezone and failed/reversed/internal-transfer counting. The owner's per-wallet design is retained; do not impose a four-plan limit or assume internal transfers exempt. |
| Interest routing and cancellation | Wallet creation accepts accrual enablement and a payout wallet; creation is asynchronous. [Create wallet](https://www.piggyvestbusiness.com/docs/api/wallet/create) | Creation options do not establish a post-creation stop-accrual, historical-interest cancellation or paid-interest recovery operation. Need verified destination/default routing and the actual mechanism for the approved plan policy. No principal forfeiture or unrelated-wallet clawback. |
| Fees | A PATCH fee-responsibility setting exists, with verified business/session/role requirements; fee-wallet eligibility matters and the page warns invalid settings may silently fail. [Fee settings](https://www.piggyvestbusiness.com/docs/api/wallet/transaction-fee) | Numeric tariffs, caps, taxes, rounding, failed/reversed-transfer fees and authoritative read-back are not established here. Zero customer cancellation percentage is not zero provider cost. Unresolved costs cannot silently reduce principal refunds. |
| Scheduling | Creation schedules funded source-wallet transfers; PATCH can cancel/reactivate using is_active and optional next attempt. Expired schedules cannot reactivate. [Create schedule](https://www.piggyvestbusiness.com/docs/api/schedules/create), [cancel schedule](https://www.piggyvestbusiness.com/docs/api/schedules/cancel) | This is not an external-bank/card collection mandate, plan cancellation or refund API. Need timezone, in-flight cancellation, retry/catch-up and per-attempt reference semantics before collection integration. Keep one collection owner; preserve Paystack isolation. |
| Sandbox funding | `POST /api/v1/transfer/test/funding`, integer kobo; text maximum NGN 100,000. Example 50,000,000 kobo exceeds that maximum; concrete success fields are absent. [Test funding](https://www.piggyvestbusiness.com/docs/api/funding) | Confirm approved synthetic identities/destinations, actual test-only behavior, small operation cap, response/reset/replay procedure. Do not copy the example or issue a test credit before durable delivery/recovery is ready. |

### Public-contract refresh during resumed implementation

Rechecked the official payload, signature and wallet-interest pages on
12 September 2026. The payload page still provides a wallet-creation envelope
with omitted event-specific details, not a complete financial inflow or paid-
interest sample. The signature example still signs `JSON.stringify(req.body)`
with SHA-512 and acknowledges with HTTP 200; it does not resolve durable-storage
failure or byte-serialization compatibility. The interest page describes accrual
and payout timing but does not establish paid-payout attribution or remaining
amount-unit/reversal contracts. The fee page could not be retrieved in this
refresh; this is not evidence that fees are absent. Existing contract gates stay
in force while independent local implementation continues.

Sources: [payload](https://www.piggyvestbusiness.com/docs/webhooks/payload),
[signature](https://www.piggyvestbusiness.com/docs/webhooks/signature),
[interest](https://www.piggyvestbusiness.com/docs/api/wallet/interest).

Refund destination/timing and customer disclosure, reviewed all-interest terms,
post-grace handling, exceptional FX/company cancellation, and split-payment
collection/compensation order also require **owner/product decisions**. Do not ask
PiggyVest to decide Ogabassey's policy. A documented bank transfer is a potential
movement primitive, not proof of an approved principal-refund workflow.

## Current code boundaries inspected

- `apps/web/src/lib/piggyvest/staging-json-request.ts` already owns bounded fixed
  staging transport and exact endpoint/method checks. Reuse it, not a second client.
- `transaction-list.ts` and `transaction-reconciliation.ts` preserve observations
  without financial effects. The list's kobo contract does not authorize summing
  rows into customer cash or counting both collection and destination funding.
- `staging-runtime.ts` composes durable intake and quarantine with separate
  restricted executors. It is not a complete deployed ingress/financial worker.
- `customer-screen-runtime.ts` composes authenticated local policy handling;
  `piggyvest-postgres-configuration.ts` explicitly disallows the policy-writer
  role over TLS. Packaging must not silently remove this local-only boundary.
- `cancel-plan.ts` returns contract-gap dispatch and potentially retained
  reservation on uncertainty. Its preparation is not refund execution or actual
  interest disposition. The connected report records correction 602 preserving
  the accepted goal snapshot, not external financial finality.

Independent local work remains possible: strict observation projections,
synthetic reconciliation transitions, shared reservation/recovery UX, full-schema
compatibility tests and packaging proof. Missing interest/refund contracts must
not halt those tasks or be counted as implemented operations.

## Packaging: reuse, then prove the actual artifact

Existing tools inspected: `tools/test/piggyvest-full-local-plan.mjs`, its tests,
the replay shell/report, and `tools/test/piggyvest-web-preview/config.mjs` with
its test and README. The planner already rejects malformed registry input and
altered migration bytes without evaluating registry code. The preview disables
env/config discovery and public assets, and restricts serving to loopback. Neither
is a deployable authenticated backend artifact.

Root and web Dockerfiles are general Next application builds with broad source
copy and dependency installation; they are not proof of an isolated PiggyVest
artifact. They were not executed. The original plan describes a dependency-free
single-handler registration builder; that tooling is absent from this checkout.
Only the two original plans were authorized/read outside this checkout, so no
current registration-builder or deployed-bundle inspection is claimed.

No new smoke script was added: duplicating the existing planner/config tests
would not prove backend packaging. A meaningful next packaging task needs an
explicit entry point and dependency closure, owned through the parent:

1. Freeze exact candidate source bytes, including dirty/untracked additions,
   lockfile and selected migration hashes. Git HEAD alone cannot identify this
   shared worktree's artifact. Review the registration-builder handoff separately.
2. Package the real server entry points and dependencies (including pg, schema
   imports, aliases and server-only handling) using the approved offline/prebuilt
   path. No Next/Vercel source build or env discovery during a secret-free smoke.
3. Execute the packaged output, not source mocks: unset configuration must fail
   closed; synthetic injected configuration must exercise auth/CSRF, limits,
   redaction, method policy and inert financial dispatch. Prohibit network fallback
   and check that browser output contains no server modules or configuration.
4. Exercise that same output against disposable socket-only PostgreSQL for
   committed intake, deduplication, restart and lost-acknowledgement behavior.
   Replay on a faithful synthetic production-schema baseline separately; the
   minimal fixture replay does not cover all real triggers/constraints.
5. Record artifact digest, runtime/dependency inventory and exact test/review
   results before requesting deployment. Keep ingress durability and outgoing
   operation controls separate; rollback must retain inbox and reservation history.

## Ordered sandbox dependencies — approval required, not commands to execute now

1. **Local candidate:** packaged-output proof, parent root checks/review, faithful
   schema/RLS replay and all affected regressions. No secret or provider needed.
2. **Approval package:** exact isolated project/database/business, explicit
   allowlisted synthetic merchant/customer/goal, restricted role/grant catalog,
   secret names only, artifact digest, retention/redaction plan, operation counts
   and caps, and durable-compatible rollback. No generic service-role fallback.
3. **Read-only access:** only after scoped approval, verify staging origin,
   authenticated business and wallet ownership, certificate/host/project identity,
   and least-privilege access. Credential receipt is not authentication evidence.
4. **Durable receiver:** verify deployed revision plus GET/POST behavior, signed
   vector compatibility, durable acknowledgement and outage/redelivery recovery.
   Public GET success alone is not this gate. No simulated financial event before
   this or an explicitly verified alternative recovery arrangement.
5. **First funding slice:** one approved synthetic customer and one plan wallet,
   committed provisioning intent, verified account, one capped simulated deposit,
   one economic credit despite duplicate delivery/query, and cash reconciliation.
   Verify authenticated customer visibility and cross-customer denial separately.
   No real bank transfer, settlement, refund, schedule or fulfilment in this slice.
6. **Additional scenarios:** independently approve transfers, interest, refunds
   and schedules only as their contracts pass. Test unknown outcomes, reversal,
   late principal/interest, partial payments and recovery without double dispatch.
   Provider review and production certification remain separate subsequent gates.

## Concise questions for Anjola — draft only, not sent

1. Could you supply synthetic signed inflow and interest-payout samples, their
   exact signing representation, and the mapping from event/reference to internal
   transaction ID, wallet and payout period? Please include deduplication/reversal
   identity rules and units for the remaining balance/fee/interest fields.
2. What response is required when durable storage fails, and what are delivery
   retry intervals, retention and manual replay options? Are event IDs stable?
3. What are duplicate-reference and response-loss recovery rules for transfers,
   including TSQ success versus successful, reversals and partial outcomes?
4. For the approved per-plan design, please confirm payout routing/defaults,
   calculation/tax/rounding rules, counter behavior for internal/failed/reversed
   outflows, and the supported mechanism to stop pending interest and handle
   already-paid plan interest on cancellation without affecting principal.
5. Please provide fee tariffs/payer verification and failed/reversed fee treatment,
   plus approved synthetic refund destinations, test identities, wallet limits
   and funding/reset procedure resolving the test-funding example discrepancy.
6. Before schedules are enabled, please confirm execution timezone, cancellation
   of in-flight attempts, retries/catch-up and per-attempt references.

These are technical gaps, not a renewed request for business-use-case approval.
Known endpoints, kobo transfer/list units and monthly payout timing need not be
requested again. Fee pricing remains deferred for independent local development;
unknown is not zero, and charged/refund paths retain their specific gates.

## Verification and limitations of this report

- Fresh command: `pnpm exec node --test tools/test/piggyvest-full-local-plan.test.mjs tools/test/piggyvest-web-preview/config.test.mjs` — **10 passed, 0 failed**.
- Invoked the existing `planReplay` with only the local registry and migration
  files: **34 selected hashes verified**, from
  `20260912080000_piggyvest_staging_webhook_inbox.sql` through
  `20260912160200_cancel_plan_preserve_goal_snapshot.sql`. This was read-only
  hash validation, not SQL execution or dependency packaging.
- Only this new Markdown report is changed. No runtime change, so no new TDD
  RED/GREEN claim or runtime Biome result; existing regression tests were reused.
- No root checks, database harness, build, provider authentication, sandbox event,
  deployment or physical-device test was performed in this report task. Existing
  connected report results remain attributed to their original runs.

Local review readiness is established for this report only. The full savings
product, sandbox E2E, artifact deployment and live financial integration are not
claimed complete.
