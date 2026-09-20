# PiggyVest Business Wallets Staging Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Check off steps only after evidence exists. This document is a plan, not authorization to deploy, provision secrets or initiate provider transactions.

**Goal:** Connect Ogabassey's existing device-savings flow to PiggyVest's staging wallet infrastructure, with reliable accounting and documented end-to-end sandbox results.

**Architecture:** Keep the dedicated staging receiver and main Baci production application isolated. Build a server-only provider adapter, authenticated durable webhook inbox, restricted processing worker and reconciliation service before connecting the savings UI. PiggyVest supplies wallet/fund-movement infrastructure; Ogabassey owns goals, device catalogue, UX and fulfilment.

**Tech Stack:** Existing TypeScript, Next.js, Supabase/PostgreSQL with RLS, Zod, Vitest, pnpm/Turborepo and Biome. Existing Vercel staging project; VPS-generated prebuilt deployment only. No new infrastructure vendor assumed.

**Spec:** Read `docs/piggyvest-staging-readiness.md` for the initial investigation and `docs/piggyvest-staging-deployment.md` for subsequent deployment evidence. This plan supersedes their historical missing-credentials statements, but not their recorded test results.

**Required product specification:** `docs/superpowers/plans/2026-09-11-piggyvest-savings-product-rules.md` defines policy status, cancellation, interest entitlement, concurrent operations, split payments and executable acceptance examples. Tasks 4–6 must satisfy that specification before the savings product is considered complete. It is not a provider contract or production authorization.

**Execution order:** Section 10 converts Tasks 1–6 into gated deliverables. Start with one synthetic customer, one wallet and one reconciled simulated deposit; defer checkout, refunds and schedules until that slice passes. This remains one master plan with a companion product specification, not competing plans.

## 1. Owner summary

The registration endpoint is built and deployed. The full wallet integration is not built. Test credentials have now been supplied, and Anjola's “Piggyvest Business [Staging Access]” email requests end-to-end staging tests followed by their review. No authenticated provider API tests or signed financial-event processing have been demonstrated.

The next deliverable is a secure backend vertical slice: create a synthetic customer and wallet, simulate a small deposit, authenticate and persist its event, and reconcile the resulting balance. Only then connect the device-savings flow. Scheduling and interest are separate acceptance scenarios, not assumed capabilities or rates.

| Readiness layer | Evidence as of this plan |
| --- | --- |
| Local foundation | Registration handler/builder, disabled main-app route, signature primitive; 33 focused tests passed in the preceding implementation turn. |
| Deployed staging | `https://staging.ogabassey.com/api/webhooks/piggyvest`; prior verified GET and unsigned POST ping 200. |
| Signed delivery | Still returns 503; no durable inbox or processing worker exists. |
| Provider profiling | Credentials email received; provider acceptance of the latest receiver behavior is not independently confirmed. |
| Credentials | Owner supplied test keys and `https://staging.piggyvest.business`; no key values belong in this document. Secure provisioning and authentication verification remain pending. |
| End-to-end validation | Not started. Ping success is not a wallet, funding or accounting test. |
| Production | Out of scope; neither certified nor authorized by staging approval. |

## 2. Global constraints and approvals

- Wallet-interest business approval is accepted. Do not reopen it; confirm only technical terms, eligibility, rates and operational behavior needed for implementation.
- Exclude GetIT, cross-app goal synchronization, production migration and real fulfilment.
- Preserve all existing Paystack savings behavior, production data and concurrent work. Recheck worktree/branch status and nested AGENTS.md before every implementation phase.
- No automatic commits, branches, PRs, merges, deployments, external messages or secret changes. Obtain explicit owner approval for each external activation package.
- Prior approval covered registration-service deployment and staging DNS. Do not infer approval for new storage, provider writes or broader financial activation from it. The current request authorizes writing this plan only.
- Never modify `proxy.ts`, `.env*`, business-type configuration or existing migrations without applicable explicit approval. Migrations are append-only. Never run `vercel build` or a cloud source build.
- Use only synthetic records, provider-approved test identity fixtures and simulated money. No production credentials, copied customer records, real BVNs/NINs, real bank recipients or live bank transfers.
- Keep all provider secrets server-side; no keys in source, command arguments, screenshots, reports or logs. Do not log raw webhook/provider bodies or sensitive identifiers. Use redacted internal correlation IDs and aggregate counters.
- Require Zod validation before database writes, authenticated customer context and CSRF for user-initiated mutations, RLS for every new table, and narrowly scoped worker database rights. No new generic Supabase service-role exception.
- Use integer minor units internally and explicit conversions at existing savings boundaries; validate currency, positivity, limits and safe-integer ranges. Do not silently mix naira and kobo.
- No client-authoritative balance changes, automatic order placement or fulfilment based only on an incoming event or frontend progress value.

## 3. Provider contract register

Official pages checked on 11 September 2026; recheck at implementation because the docs are mutable. Archive only redacted contract summaries and synthetic fixtures, not private credential links.

| Source | Established contract | Remaining decision or evidence |
| --- | --- | --- |
| [Authentication](https://www.piggyvestbusiness.com/docs/authentication) | Secret bearer authentication; configurable base URL. Owner supplied staging base. | Read-only auth success, account identity, least-privilege scopes and rotation behavior. Never fall back to the published production base. |
| [Webhook payload](https://www.piggyvestbusiness.com/docs/webhooks/payload) | GET 200 reachability plus POST event delivery; envelope includes event identity, customer, category/type and event data. | Complete schemas, ownership identifiers, event uniqueness scope, ordering, size limits and signed timestamps if supported. |
| [Webhook signature](https://www.piggyvestbusiness.com/docs/webhooks/signature) | `x-pvb-signature`, HMAC-SHA512/hex using the secret; sample signs JSON serialization and returns 200 even for invalid signatures. | Signed raw sample and exact byte/serialization rules. Confirm what happens on durable-storage failure under always-200 guidance. Do not accept multiple guessed canonicalizations. |
| [Test funding](https://www.piggyvestbusiness.com/docs/api/funding) | Test funding endpoint with integer kobo amount and wallet ID. | Text maximum and example amount are inconsistent: do not copy the example. Confirm test-only behavior, use a small approved amount, and establish replay/reset rules. |
| [Wallet transfer](https://www.piggyvestbusiness.com/docs/api/transfers/wallet), [transaction status](https://www.piggyvestbusiness.com/docs/api/transfers/status) | Outgoing transfer and subsequent status-query contracts are available. | Review exact current schemas, idempotency/reference semantics, terminal enums, fees, reversals and uncertain-outcome recovery before coding. |

The forwarded `{ "test": "ping" }` contains Hookdeck headers but no `x-pvb-signature`. Those headers, including `X-Hookdeck-Verified`, are not trusted financial authentication. The current handler acknowledges all requests lacking `x-pvb-signature` without reading or persisting them; it does not accept a wallet event. Confirm the real delivery path preserves the PiggyVest signature. If Hookdeck authentication is required instead, obtain its official contract and dedicated secret rather than inferring an algorithm from the sample.

**Hard stop:** Do not generate financial sandbox events until the receiver can durably accept authenticated deliveries or PiggyVest provides a verified alternative recovery arrangement. Do not turn signed POST 503 into unconditional 200 to pass a check.

## 4. Code boundaries and proposed file map

All paths below are repository-relative. New paths are proposals, not existing implementations. Runtime files require colocated `.test.ts`/`.test.tsx`; keep each file below 300 lines and split by responsibility.

| Boundary | Existing code to preserve or extend | Proposed additions |
| --- | --- | --- |
| Staging receiver | `apps/web/tools/piggyvest-staging/registration-handler.ts`, `build-registration.ts` and tests | Thin staging ingress/worker entry points after packaging review; keep registration behavior until activation gates pass. |
| Main application | `apps/web/src/app/api/webhooks/piggyvest/route.ts` and test | Keep disabled in production. Do not accidentally deploy a second active receiver. |
| Provider adapter | `apps/web/src/lib/piggyvest/verify-piggyvest-payload-signature.ts` and test | `staging-config.ts`, `client.ts`, `wallet-service.ts`, `transfer-service.ts`, `reconcile.ts` under the same directory, with tests. |
| Validation | `apps/web/src/schemas/customer-savings.ts` | `apps/web/src/schemas/piggyvest/{config,event,requests,responses}.ts` and tests; create concrete event schemas only from confirmed contracts. |
| Durable processing | No PiggyVest store exists | `apps/web/src/lib/piggyvest/{inbox,process-event,savings-adapter}.ts` and tests; fresh timestamped migrations and SQL tests under `supabase/migrations/tests/`. |
| Savings context | `apps/web/src/app/api/storefront/customer/savings/shared.ts`, `contributions/manual/route.ts`, `goals/route.ts` | Provider-neutral identity resolution and a staging-only adapter; preserve existing routes' authentication and idempotency behavior. |
| Existing payment/schedules | `apps/web/src/lib/customer-savings-paystack-webhook.ts`, `customer-savings-auto-debit-process.ts`, `apps/web/src/app/api/cron/customer-savings/charge-due/route.ts` | Regression coverage only initially. Do not insert PiggyVest events into Paystack processing or run both schedulers for the same contribution. |
| Savings client | `apps/mobile-storefront/app/wallet/savings/start.tsx` | Inspect its downstream screens/hooks before naming additional edits; extend staging presentation only after backend acceptance. Read mobile AGENTS.md first. |
| Sandbox harness | Existing staging tools directory | `apps/web/tools/piggyvest-staging/run-sandbox.ts` and tests; explicit approval/allowlist checks, redacted results and resumable references. |

Packaging decision: the current builder strips one dependency-free handler. It cannot automatically deploy a database-backed application or imported adapter. Task 2 must choose and test a real dependency-packaging method for the staging service; never assume the present three-file artifact contains new backend modules.

## 5. Execution tasks

Each implementation task follows: write a failing test, run it and observe the intended failure, implement the smallest change, run focused tests, then review the diff. Do not use fabricated provider fixtures to claim contract compatibility.

### Task 1 — Freeze the contracts and account model

**Files:** Create `docs/piggyvest-contract-register.md`; extend this plan with resolved decisions.

- [ ] Inspect latest related work, current savings RPCs and ledger units; identify what is wallet cash versus money reserved for a device goal.
- [ ] Review customer/wallet creation, retrieval, funding accounts, schedules, interest, fees and transactions in official docs; record exact endpoints and supported fields.
- [ ] Validate the approved one-wallet-per-plan model against provider provisioning limits and settlement-wallet ownership. Do not reopen the owner architecture choice unless a documented incompatibility is found.
- [ ] Obtain signed samples and failure/retry contracts, including a durable-storage outage scenario and redelivery retention.
- [ ] Confirm approved test customer/KYC fixtures, simulated transfer destinations and reset/cleanup procedure.
- [ ] Record separate statuses for “confirmed”, “testable locally”, and “blocked”; continue independent local tasks when a provider clarification blocks only one feature.

**Acceptance:** Every enabled operation/event has a source-backed contract and test fixture. Unknown operations remain disabled, including unsupported interest/schedule simulation.

### Task 2 — Isolated configuration and read-only API adapter

**Files:** Proposed `staging-config.ts`, `client.ts`, config/request/response schemas and colocated tests; staging builder tests.

- [ ] Test missing credentials, wrong project/database/account, non-staging base URL, redirects, malformed responses, timeout and rate-limit handling.
- [ ] Implement a server-only client restricted to `https://staging.piggyvest.business`; reject redirects and production fallback. Expose typed validated results, not raw provider errors.
- [ ] Bound request timeouts, concurrency and response sizes; never auto-retry non-idempotent writes. Reserve write operations behind an explicit sandbox-run gate.
- [ ] Choose isolated Supabase staging storage plus separate intake/worker privileges; document the actual hosting, dependency packaging, build and secret configuration diff before provisioning.
- [ ] After owner approval, provision only server-side staging secrets and run a documented read-only auth/account check. Avoid unrelated sandbox records in output.

**Acceptance:** Correct account/environment verified; invalid configuration cannot make provider calls. No production key, storage or scheduled job is inherited. HTTP success alone is not enough: response schema and account identity must match.

### Task 3 — Durable inbox and authenticated ingress

**Files:** Proposed `inbox.ts`, event schemas, new migration/SQL tests, staging receiver and builder with tests.

- [ ] Test valid provider vectors, tampered raw bytes, Unicode/whitespace, duplicate signature headers, malformed/oversized bodies, unknown event types and missing key.
- [ ] Retain bounded raw bytes for authentication using the confirmed representation; do not let middleware destroy the evidence. Never log the body or signature.
- [ ] Design staging-only mappings, inbox and work records. Unique event key: environment + configured provider account + confirmed provider event ID. Add foreign-key indexes, RLS and restricted RPC grants.
- [ ] Persist authenticated accepted events and processing work atomically before success acknowledgement. Store only required data; set access and retention policy. Reject or quarantine schema/identity conflicts without crediting balances.
- [ ] Test real local PostgreSQL concurrency, duplicate delivery, same-ID/different-content conflict, process restart and unavailable storage. Mock-only tests do not establish durability.
- [ ] Implement the provider-confirmed response/recovery policy. Invalid authentication may receive the documented 200 without financial acceptance; valid-event storage failure must not silently discard the event.
- [ ] Keep GET/HEAD reachability and unsigned profiling probe regression tests. Preserve current production disablement.

**Acceptance:** Valid events survive restarts and duplicates without loss/double work; no unauthenticated event changes a balance. Real signed delivery remains disabled until all acceptance conditions pass.

### Task 4 — Wallet operations, accounting worker and reconciliation

**Files:** Proposed wallet/transfer services, `process-event.ts`, `reconcile.ts`, `savings-adapter.ts`, migrations and tests.

- [ ] Define internal interfaces for provider operations and durable records before implementation: validated operation result, pending/unknown/final outcome, verified inbox identity and reconciliation result. These are internal types, not invented provider enums.
- [ ] Create trusted mappings from configured provider account and provider customer/wallet IDs to authenticated merchant/customer/goal. Request body tenant IDs must never grant authority.
- [ ] Persist outgoing operation intent/reference before calling PiggyVest. On timeout, mark outcome unknown and query status before any resubmission; use provider idempotency only where documented.
- [ ] Implement worker claims with leases, bounded attempts, backoff and dead-letter review. Commit a ledger effect and completion marker in one transaction. Distinct events for one transaction must not double credit it.
- [ ] Reconcile pending operations and missed/reordered events against authoritative wallet and transaction reads. Check ownership, reference, amount, currency, fees and allowed transitions.
- [ ] Separate available cash, goal allocation, pending contributions, accrued interest and paid interest; handle reversals without destructive history edits. Never promise an undocumented interest rate.
- [ ] Test cross-tenant mapping, conflicting IDs, lease expiry, replay after restart, concurrency, reversals, mismatches and timeout-after-provider-success.
- [ ] Implement the companion specification's shared purchase/cancellation reservation, principal/interest subledgers, verified payout recognition and late-deposit handling. Run its concurrent-operation and financial acceptance cases against local PostgreSQL, not mocks alone.

**Acceptance:** Exactly one local accounting effect for each confirmed financial movement, despite at-least-once delivery. No provider retry or client refresh can mint money locally. Unknown outcomes are visible and recoverable.

### Task 5 — Staging savings experience and scheduling

**Files:** Existing savings routes/context, schemas and mobile savings entry point; proposed staging savings adapter; colocated tests.

- [ ] Inspect existing device selection, target creation, contribution and progress flow; preserve catalogue/price/fulfilment ownership in Ogabassey.
- [ ] Resolve customer identity without requiring unrelated Paystack secrets on the PiggyVest branch. Do not give sibling routes additional privileged access.
- [ ] Add a server-side staging-only provider choice for approved synthetic accounts, never a client-controlled routing or balance switch.
- [ ] Display pending, confirmed, failed and reconciliation-needed states; progress derives from reconciled server accounting. Completing a target creates no real order or device release in tests.
- [ ] Decide whether PiggyVest schedules wallet movements or actually supports the required contribution collection. Do not assume scheduling equals bank/card debit authorization.
- [ ] Test creation/pause/resume/cancel and timezone/cadence semantics only when documented; ensure the legacy Paystack cron cannot debit the same goal as the PiggyVest path.
- [ ] Run existing manual contribution, goal actions, Paystack webhook and auto-debit regressions unchanged alongside new staging tests.
- [ ] Implement the companion specification's versioned consent, price-lock and readiness rules; separate stop-auto-debit, cancel-plan/refund and post-purchase returns. Keep unresolved FX, refund-route and provider entitlement behavior disabled rather than inventing policy.

**Acceptance:** The synthetic user can select a device, set a goal, contribute, and see correct progress. Scheduling and interest capabilities are explicitly passed or documented as blocked, never silently simulated as provider success.

### Task 6 — Owner-approved activation and end-to-end sandbox run

**Files:** Proposed sandbox runner/tests and `docs/piggyvest-sandbox-results.md`; update deployment handoff.

- [ ] Present the exact staging project/database IDs, credentials configuration, deployment diff, retention policy, test operations and simulated amount limits for approval. No infrastructure or provider writes before approval.
- [ ] Run focused tests, local database integration tests, `pnpm turbo lint`, `pnpm turbo typecheck`, `pnpm turbo test` and CodeRabbit review. Record exact head/diff and all failures; do not bypass the existing clean-worktree test guard.
- [ ] Build with the approved VPS prebuilt flow, verify artifact identity and dependency contents, and deploy only the isolated staging service after approval.
- [ ] Verify DNS, TLS, method behavior, project isolation, body limits, log redaction and durable signed intake. Confirm provider registration separately from our HTTP checks.
- [ ] Run the matrix below with resumable references, synthetic identities, strict staging-host allowlisting, capped simulated amounts and no blind retries. Confirm test funding cannot reach real money before execution.
- [ ] Record operation/event correlation, expected versus actual state, reconciliation result and redacted evidence for each case. Test IDs must not expose KYC, account numbers or raw messages.
- [ ] Produce owner-reviewable results and an unsent provider summary. PiggyVest review and production certification remain separate gates.

## 6. Minimum acceptance matrix

| Scenario | Required evidence |
| --- | --- |
| Environment/auth | Wrong key/base/project/database fails closed; correct staging account verified. |
| Synthetic onboarding | Customer and wallet creation/retrieval agree; retries create no unintended duplicate ownership. |
| Simulated deposit | Small test funding, signed event, durable inbox, one accounting effect and matching provider balance. |
| Manual contribution | Available funds and goal allocation reconcile; repeated request does not allocate twice or exceed the target. |
| Wallet transfer | Pending to documented final outcome; both wallets, fees and transaction status reconcile. No real bank payout. |
| Failed/uncertain transfer | Insufficient balance, validation failure and response-loss recovery leave no false success or repeated transfer. |
| Delivery resilience | Duplicate, reordered, delayed, conflicting, malformed and unauthenticated events cannot corrupt balances. |
| Crash/storage outage | Restart/lease recovery and provider-approved redelivery demonstrate no acknowledged valid-event loss. |
| Tenant isolation | Other merchant/customer/account identifiers cannot read or mutate the synthetic goal. |
| Schedule | Documented cadence and pause/resume/cancel work without a second Paystack debit; otherwise explicitly blocked. |
| Interest | Accrued versus paid values use confirmed terms and units; only provider-supported sandbox evidence counts. |
| Goal completion | Correct server-side progress with no production order, notification or fulfilment side effect. |
| Cancellation | Principal-only refund and separate forfeited-interest ledger; explicit consent, verified destination, pending/failed recovery, no unrelated balance deduction. |
| Concurrent actions | Checkout versus cancellation has one winning reservation; late contributions remain accounted for and do not reopen the plan. |
| Split payment | Only the savings-funded portion settles; all payment legs must succeed before paid status; partial success remains recoverable. |
| Product terms | Activation, maturity/grace, exact-variant price comparison, device swap and customer consent match the companion specification. |

## 7. Rollback and exit criteria

- Keep separate controls for accepting durable events and executing outgoing operations. Stop outgoing writes first on a fault; do not roll back to a ping-only handler that would lose valid deliveries.
- Preserve accepted inbox records, operation references and audit history. Drain or quarantine work, reconcile uncertain operations, and coordinate any provider delivery pause through an owner-approved message.
- Roll back only to a known durable-compatible staging artifact. Do not delete financial history or compensate an unknown transfer automatically.
- Completion means all mandatory matrix cases passed, unresolved contract gaps listed, no unexplained balance differences, restart recovery verified, and an evidence report ready for owner/provider review.
- Local tests, deployed staging, provider profiling, authenticated API access, full sandbox success and production certification must always be reported separately.

## 8. Immediate next action

Implement Task 1 and the offline parts of Tasks 2–3 first. Request one scoped owner approval for isolated storage/credential provisioning and a bounded sandbox test run only after the concrete configuration and test operations are specified. Do not send another “full integration is live” update until the acceptance matrix provides that evidence.

## 9. Owner-approved wallet and settlement design

Approved on 11 September 2026; supersedes Task 1's open architecture choice, but provider provisioning and limits still require validation. This approval does not authorize deployments, secret changes or provider transactions.

- One dedicated provider wallet per savings plan, separate from everyday customer spending and Ogabassey's business proceeds. No four-plan creation limit solely for withdrawal eligibility.
- Contributions accumulate without routine outflows. At customer-authorized purchase, transfer only the savings-funded portion of the order into a verified Ogabassey settlement wallet. Preserve surplus as a customer liability; confirm every payment leg before marking a split-payment order paid.
- The settlement wallet is a proposed business destination, not a verified existing or special provider “admin” wallet. Resolve its ownership and ID server-side; never accept a client-selected settlement destination.
- Persist order-linked intent/reference before submitting a transfer. A 202 response is pending, not payment success. Reconcile terminal success, both wallets, amount and currency before marking an order paid. Sandbox tests never trigger real fulfilment.
- Show accrued interest as pending. Only eligible provider-paid and reconciled interest counts toward purchasing power or early readiness; Ogabassey does not advance unpaid interest.
- Reconcile residual balances and later interest payouts before retiring the plan wallet. Do not reuse it for another plan or silently retain customer entitlements.
- Owner reports withdrawal eligibility is per wallet. Monitor the provider counter and exceptional outflows; do not assume internal transfers are exempt. Business-wallet withdrawals are distinct from customer plan-wallet activity.

### Contract evidence and remaining checks

- [Create wallet](https://www.piggyvestbusiness.com/docs/api/wallet/create): asynchronous customer-linked wallet creation with configurable interest accrual. Multiple-wallet limits and the actual business destination still need verification.
- [Wallet transfer](https://www.piggyvestbusiness.com/docs/api/transfers/wallet): transfers between wallets under the business account, integer kobo, an internal reference and asynchronous confirmation.
- [Retrieve wallet](https://www.piggyvestbusiness.com/docs/api/wallet/retrieve): exposes `withdrawal_count` and wallet balance.
- [Interest](https://www.piggyvestbusiness.com/docs/api/wallet/interest): more than four monthly withdrawals forfeits that month's payout; bank outflows are listed. Internal-transfer counting and reversibility of previously paid interest are not explicitly resolved by these pages. Omission does not prove exemption.

### Required implementation and sandbox tests

- [ ] Reject client-selected settlement destinations and cross-customer plan-wallet references before any operation.
- [ ] Repeated checkout and timeout recovery produce one confirmed settlement and one payment effect; pending/failed transfers cannot mark orders paid.
- [ ] Pending interest cannot complete a target or cover checkout; eligible paid interest can, without duplicate credits on replay.
- [ ] After separately approved synthetic transfers, compare source/destination withdrawal counters before and after internal settlement. Sandbox behavior is not production contractual certification.
- [ ] Cover surplus, late interest and cancellation reconciliation without debiting unrelated balances or silently converting customer funds into business income.
- [ ] Verify settlement-wallet ownership and purpose before activation; stop affected operations if provider limits or terms conflict with the approved design.

## 10. Execution sequence and completion evidence

Fee pricing is deferred by owner direction. It does not block offline implementation, mocked fee scenarios or preparation of the first funding slice. Store an unknown fee as unknown, never zero. A bounded staging run may observe fees after explicit approval of its possible simulated deductions; production rate, cap, taxes and fee payer remain launch gates. Do not enable a principal-refund promise or a real charged operation with unresolved fee treatment.

### A. Freeze contracts and establish a baseline — Task 1

- [ ] Record current branch/worktree, existing changes and applicable AGENTS.md; preserve untracked integration work. Inspect related tasks/implementations before adding modules.
- [ ] Create `docs/piggyvest-contract-register.md` with endpoint, method, auth, request/response schemas, asynchronous outcome, signature representation, idempotency, fee status, source URL and verification date for each operation. Include wallet funding accounts, account reservation and Pocket as documented options; do not expand into cross-app goal sync.
- [ ] Inspect existing customer identity, contribution ledger and scheduled collection paths. Record the actual collection-to-provider funding bridge; a Paystack success cannot count as a second PiggyVest deposit.
- [ ] Run existing focused integration tests and record exact files/counts/results. Previous pass counts are historical, not evidence for the new diff.

Exit: every first-slice operation is either source-backed or explicitly blocked. Missing signature/event contracts block authenticated financial activation, not pure local policy tests.

### B. Build a fail-closed adapter — Task 2

- [ ] Write `staging-config.test.ts`: reject missing values, production/unknown base URLs, account/project mismatch and redirects before a provider request. Implement `staging-config.ts` and corresponding Zod schema only after the tests fail as intended.
- [ ] Write `client.test.ts`: validated read success, malformed/oversized response, timeout, 401/403, 429 and redacted errors. Implement `client.ts` with injected transport for network-free tests; no automatic write retry or raw response logging.
- [ ] Write `wallet-service.test.ts` using verified contracts: create accepted-but-pending, confirmed retrieval, failed provisioning, lost response and empty funding-account list. Expose no funding account to the customer until ownership/provisioning is verified. Never blindly repeat customer/wallet creation after a timeout.
- [ ] Test the actual packaged staging artifact, including imports and server-only boundaries. The existing single-file registration builder is not presumed sufficient for database-backed modules.

Exit: missing configuration causes zero external calls; all local cases pass. No secret provisioning or authenticated live call occurs in this deliverable.

### C. Build durable intake and accounting — Tasks 3–4

- [ ] Define typed inbox/operation interfaces and a fresh migration for mappings, event identities, operation intents, reservations and immutable ledger entries. Include environment/account isolation, RLS, foreign-key indexes and restricted intake/worker RPCs; no generic service-role escape hatch.
- [ ] Write local PostgreSQL tests first for duplicate event identity, conflicting contents, concurrent claims, crash recovery, expired lease and atomic ledger/completion commit. Use an isolated local database, never production credentials or remote reset commands.
- [ ] Implement bounded raw-request authentication against provider vectors, followed by schema validation and durable enqueue. Unknown valid events are retained/quarantined without financial credit; invalid requests never enter financial processing.
- [ ] Persist a trusted onboarding intent before customer/wallet creation. Test a valid creation webhook arriving before the API response is saved, a lost response, duplicate delivery and conflicting customer IDs. Durably quarantine unmatched events and replay only after authoritative provider reads establish the account/customer/wallet mapping. Never derive tenant ownership solely from event fields or resend uncertain creation requests blindly.
- [ ] Implement verified deposit reconciliation using authoritative transaction/wallet reads, source ownership, amount/currency and one economic transaction identity. Distinct webhook events for one deposit produce one ledger credit.
- [ ] Prove collection-to-funding deduplication, wrong-wallet quarantine, over-target surplus and late funding after cancellation. Do not treat provider cash plus local allocation as two balances.

Exit: local restart/concurrency evidence proves durability. Signed ingress remains disabled externally until packaging, storage and delivery-failure gates pass.

First-slice Baci visibility: add a synthetic-account-only authenticated read endpoint and minimal balance view using existing customer-auth/RLS patterns. Inspect existing savings route conventions before choosing its exact path; freeze that path and its colocated test in the contract register before implementation. Show reconciled principal, pending funding and reconciliation status without exposing credentials or unrelated provider identities. Test unauthenticated denial, cross-customer denial, pending versus confirmed funding, duplicate delivery and stale/error states. This is read-only visibility, not activation of checkout or the full savings UI.

### D. First approved sandbox slice — limited Task 6 activation

Mandatory before every deployment, including this first slice: run focused regression tests, local PostgreSQL durability/concurrency tests, `pnpm turbo lint`, `pnpm turbo typecheck`, `pnpm turbo test` and CodeRabbit review against the candidate source snapshot. Verify the packaged artifact and record its digest and untracked source contents as well as the Git head. Stage F is a final handoff, not permission to postpone validation. Failed checks block deployment unless the owner explicitly accepts a documented unrelated failure; missing authentication, tenant-isolation or accounting evidence never counts as passed. Any source change invalidates affected test/review evidence and requires revalidation before deploying the resulting artifact.

- [ ] Present one approval package: exact staging project/database/account, secret names (not values), least-privilege grants, artifact digest, synthetic identity fixtures, wallet count, test amount cap, allowed operations and rollback procedure. No automatic DNS, infrastructure or production changes.
- [ ] After approval only, provision isolated configuration and perform read-only account/auth verification. Deploy the durable receiver with outgoing financial operations still disabled; verify signed delivery/recovery prerequisites before enabling the approved test harness.
- [ ] Create one synthetic customer and one plan wallet, retrieve its funding account, simulate one approved small deposit and verify durable intake, one ledger effect and matching provider cash. Persist resumable operation references and stop on any unexplained difference.
- [ ] Sign in as the synthetic customer and verify the Baci read-only balance view matches reconciled server accounting after funding and refresh. Confirm another synthetic customer cannot read it. Record backend reconciliation and visible customer balance as separate evidence; neither frontend success callbacks nor a provider dashboard screenshot proves both.
- [ ] Record actual staging deductions separately from expected production fees. Do not send real bank funds to a displayed sandbox account. No refunds, settlement transfers, schedules or real fulfilment are included in this first slice.

Exit: `docs/piggyvest-sandbox-results.md` records each operation, redacted evidence, failures and unresolved contracts, including authenticated Baci balance-view verification. Backend-only success must be labelled backend-only, not completion of this milestone. A successful first slice is not completion of checkout, interest or the whole integration.

### E. Complete product behavior — remaining Tasks 4–5

- [ ] Implement the companion specification's modules with colocated tests, beginning with pure activation, price, maturity and readiness rules. Include funded-draft cancellation, protected-offer expiry and explicit consent before schedule restart.
- [ ] Implement shared purchase/cancellation reservations, refund-pending recovery and separately attributed pending/paid/forfeited interest. Require authoritative payout evidence; accrual alone cannot increase purchasing power.
- [ ] Freeze split-payment ordering and compensation against actual provider contracts before adding financial calls. Test partial success, cancelled/expired orders, duplicate confirmation and delayed reversals; staging never fulfils an order.
- [ ] Connect only synthetic allowlisted accounts to the staging UI. Keep general-wallet movement, card funding bridge and auto-collection disabled until their real funding paths and corresponding contracts pass tests. Existing production Paystack behavior stays unchanged.
- [ ] Run every companion acceptance case and parent matrix case. Missing refund route, payout semantics, expiry policy or FX policy blocks only its affected path, but must remain visible in the overall readiness report.

### F. Validation, approval and handoff

For each module: write failing tests, verify the intended failure, implement, then run focused tests before broader checks. Use `pnpm turbo test --filter=@baci/web -- <verified focused test paths>` where supported by the existing test script; verify forwarded arguments before use. Run `pnpm turbo lint`, `pnpm turbo typecheck` and `pnpm turbo test` before completion, plus `coderabbit review --agent -t uncommitted` before shipping. Never bypass a clean-worktree guard by discarding others' work or making an unrequested commit.

- [ ] Record new file paths, exact diff/artifact identity, commands, results and any unrelated failures. Synthetic local tests do not establish provider compatibility; mocks do not establish database durability.
- [ ] Request a new bounded activation package for additional sandbox transfers/refunds/schedules after their prerequisites pass. Prior ping deployment or the first funding run is not blanket authorization.
- [ ] Report six separate states: local validation, deployed staging, provider profiling, credential authentication, sandbox scenario results and production certification. Include production fee confirmation in launch prerequisites.
- [ ] Prepare an unsent WhatsApp update containing only evidenced capabilities and remaining steps. Do not claim the full integration is live after registration or funding-only success.

Implementation-ready means the next deliverable has concrete contracts, tests and storage boundaries. The overall product is complete only when all mandatory scenarios pass or the owner explicitly approves a narrower release scope; blocked scenarios are not counted as passed.
