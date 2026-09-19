# Ogabassey UBA REDVAULT Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans for authorized implementation. Follow the tasks and acceptance checks below. This document authorizes no implementation, commits, deployment, real payments or outgoing communications.

**Goal:** Offer 10% off negotiable product lines when their pre-discount subtotal is below ₦200,000, or 5% when it is ₦200,000 or more, through Pay with UBA on Ogabassey's website, iOS app and Android app.

**Architecture:** Extend Baci's existing discount creation, calculation and redemption system. Reuse the shared product-negotiability policy as the REDVAULT product eligibility rule. Bind the discount to an Ogabassey-only, server-initialized Paystack hosted checkout and verify payments before approving orders or releasing value.

**Tech stack:** Next.js, TypeScript, Expo/React Native, packages/shared, Supabase PostgreSQL/RLS, Paystack hosted checkout, Vitest and Jest.

**Spec:** Owner decisions in this task, consolidated in this document. Earlier drafts that included the excluded brands, proposed web-only delivery or introduced a campaign budget are superseded.

**Terra execution order:** Follow the [phased handoff and parent-review gates](2026-09-11-ogabassey-uba-redvault-phased-handoff.md). Its Phase 0–5 sequence refines the tasks below into independently reviewed deliverables; web/mobile work may run in parallel only after the backend contract is accepted.

## Confirmed requirements

- UBA has already accepted the proposed hosted checkout, subject to successful testing. Do not ask UBA to approve the same route again.
- This is an Ogabassey-specific partnership. Other merchants cannot activate, configure or invoke it. Ordinary discount functionality remains available to them.
- Website, iOS and Android are all included.
- Owner clarification on 12 September supersedes the flat 5% draft: **10% below ₦200,000 eligible pre-discount merchandise subtotal; 5% at or above ₦200,000**. The same rule that makes a product non-negotiable also makes it ineligible for REDVAULT.
- Current exclusions: Infinix, Tecno, Vivo, Redmi, Xiaomi, Oppo, Itel, Honor and Samsung A series. These are exclusions, not the eligible-product list.
- Reuse `isProductNegotiable` from `packages/shared/src/lib/negotiation-policy.ts`; do not maintain a second independent brand list or frozen list of product IDs.
- Evaluate the policy on authoritative catalog brand/name data. Do not trust client-supplied brand, name, eligibility or price. Preserve the existing policy's semantics rather than inventing a phones-only restriction.
- Mixed baskets use only eligible lines to select the tier and receive its discount. Excluded merchandise, shipping, tax, gift wrapping and other fees neither count toward the threshold nor receive a discount. Quantities and variant prices must be respected. Refunds retain original stored net allocations rather than repricing the remaining basket.
- Paystack collects all card details. Baci must not collect PAN, CVV, PIN or OTP or implement its own card-entry/BIN inspection flow.
- Support UBA online-enabled Verve, Visa and Mastercard. Payment acceptance does not create a device-financing facility.
- No total campaign budget or reservation engine has been requested. Do not add one.
- No new merchant-facing partnership activation toggle. Any operational enable/disable control must remain restricted to this specific partnership and cannot override merchant identity.

## Evidence and current integration points

Source was inspected during this task at local HEAD `d0d1cbd2fd4b5867a980644acf5e29fd7c451c0c`; source inspection is not deployment or runtime proof. Recheck the implementation checkout before coding.

| Existing area | Relevant files and reuse |
| --- | --- |
| Product policy | `packages/shared/src/lib/negotiation-policy.ts` and `.test.ts`: shared non-negotiable exclusions, including Samsung A-series matching |
| Discount creation | `apps/web/src/schemas/discount-codes.ts`, `apps/web/src/app/api/discount-codes/route.ts`, `apps/web/src/app/dashboard/marketing/discount-codes/discount-client.tsx`: existing percentage/fixed discounts and targeting |
| Discount/order calculation | `apps/web/src/app/api/orders/route.ts`, `apps/web/src/lib/checkout/discount-amount.ts`, `apps/web/src/lib/checkout/eligible-line-discount.ts`: review and extend actual per-line calculation and provenance |
| Payment initialization | `apps/web/src/app/api/payments/initialize/route.ts`, `apps/web/src/lib/paystack.ts`: order-derived amount and hosted session initialization |
| Payment completion | `apps/web/src/app/api/payments/webhook/route.ts`, `apps/web/src/app/api/payments/verify/route.ts`, `apps/web/src/lib/payments/finalize-order-gateway-payment.ts`: signature validation, verification and shared finalization |
| Web checkout | `apps/web/src/components/storefront/ogabassey/pages/checkout-page.tsx` |
| Mobile checkout | `apps/mobile-storefront/components/checkout/checkout-payment-finalization.ts`, `apps/mobile-storefront/components/payment-gateway/PaymentGatewayCheckoutView.tsx` |

The existing creation schema defaults `usage_limit_per_customer` to 1 and supports optional caps/dates. The owner has not agreed those restrictions for REDVAULT; do not silently inherit the default.

Mailbox evidence read in this task: j.bassey account `4705563000000008002`, message `1788855033912153400`, subject `BIN - UBA REDVAULT`. UBA's reply accepts the experience subject to testing and explicitly requires the three card schemes. No credentials belong in this plan or test evidence.

Official documentation inspected:

- [Metadata filters](https://paystack.com/docs/payments/metadata/): selected bank cards and card brands.
- [Transaction API](https://paystack.com/docs/api/transaction/): server initialization, card channel restriction, verification.
- [BIN verification](https://paystack.com/docs/api/verification/): documented lookup uses six digits; it does not establish exact eight-digit enforcement.
- [Webhooks](https://paystack.com/docs/payments/webhooks/): raw-payload HMAC-SHA512 and delivery retries.
- [Test payments](https://paystack.com/docs/payments/test-payments/): standard sandbox instruments are not proof of every UBA-issued range.
- [Refunds](https://paystack.com/docs/payments/refunds/): asynchronous refund outcomes.

## Task 1: Reuse discount configuration and product eligibility

- [ ] Trace the existing discount creation UI, validation endpoint, order RPC and redemption lifecycle before changing them. Establish where product-level eligible subtotal is enforced; preview validation alone is insufficient.
- [ ] Associate an existing-system discount record with the protected Ogabassey REDVAULT partnership. Enforce the protected 10%/5% eligible-subtotal tier policy server-side, not a generic coupon percentage applied to the `all` subtotal.
- [ ] Derive Ogabassey identity from trusted merchant context and verify the order belongs to that identity. A copied discount record, public code, merchant setting or request ID cannot grant partnership access.
- [ ] Prevent ordinary discount create/update APIs from assigning or removing the protected partnership/payment constraint. Preserve ordinary discount behavior for other merchants.
- [ ] Add an append-only migration for the protected REDVAULT order-validation path. The existing discount redemption SQL checks for any matching item and computes against the whole subtotal; do not route REDVAULT through that calculation unchanged. Validate the eligible-line amount rather than the full-basket subtotal, including for direct RPC calls.
- [ ] Evaluate eligibility with the shared TypeScript negotiation policy on the server. Extend the existing signed discount-provenance mechanism to bind eligible line identities, price/quantity, allocations, merchant, customer, order version and partnership identity. The database must validate the proof and its binding to actual order items before accepting those eligibility results; plain client-supplied eligibility flags are insufficient. Do not duplicate the brand policy in SQL. Restrict proof creation to the trusted server boundary, with replay protection.
- [ ] Introduce a separate proof action `storefront_redvault_discount` with payload version `1`. Sign the action and version along with all required bindings; the REDVAULT database verifier accepts only this exact action/version and rejects missing fields or unknown versions. Preserve the existing `storefront_transaction_discount` version-3 negotiation proof and verifier unchanged. Legacy negotiation proofs cannot authorize REDVAULT, and REDVAULT proofs cannot be substituted into the legacy path. Deploy the additive database verifier before enabling callers that emit the new proof.
- [ ] Use an explicit REDVAULT-only rounding rule: nearest kobo, half up, on each canonical eligible line total. For nonnegative integer `lineSubtotalKobo`, compute `floor((lineSubtotalKobo * 5 + 50) / 100)` with overflow-safe integer arithmetic. Consolidate only lines equivalent in authoritative product ID, variant ID, condition, normalized variant attributes, unit price, VAT category/rate and tax-inclusive/exclusive treatment. Use the existing line-identity normalization and include these additional pricing/tax fields; do not group by display name or product/variant/price alone. Excluded lines receive zero. Sum allocations to obtain the order discount; never include shipping, gift wrapping or separately itemized tax in the product discount base. Preserve the existing tax calculation policy for discounted products.
- [ ] Canonical groups are calculation units only: retain each original persisted order-item identity and its quantity. Bind group membership and all identity/pricing/tax fields into the signed proof, and validate them against the actual order items. Allocate the rounded group discount to units using integer division with remainder distributed in stable persisted order-item/unit order; store those allocations against the original items for refunds. Equivalent line splitting or reordering must not change the total discount, and distinct conditions, attributes or tax treatments must remain separate groups.
- [ ] Apply the same integer arithmetic to the database validation of signed eligible lines and require exact allocation/total equality. Do not use the existing whole-naira helper or its SQL tolerance for REDVAULT. Leave ordinary discounts' current rounding unchanged.
- [ ] For an all-excluded basket, do not advertise a saving or attach a REDVAULT discount. For a mixed basket, explain that the saving and tier threshold apply to eligible items only.
- [ ] Snapshot the policy result, source product/variant identity, original line amounts and discount allocations with the order/payment attempt. Policy or catalog changes affect new quotes, not an already issued attempt's accounting.

Acceptance example: a negotiable item worth NGN 100,000 and an excluded item worth NGN 50,000 produce NGN 5,000 REDVAULT discount and NGN 145,000 product total before other charges. The excluded item receives zero discount.

Rounding examples: an eligible line of 100,009 kobo receives 5,000 kobo discount; 100,010 kobo receives 5,001 kobo. Two identical units at 100,005 kobo are one canonical 200,010-kobo line and receive 10,001 kobo, whether submitted as one line or two.

## Task 2: Add Pay with UBA on web and mobile

- [ ] Add a dedicated checkout payment choice on Ogabassey's website, iOS and Android. All surfaces consume the same server-produced totals and eligibility summary.
- [ ] Extend checkout request validation to recognize this choice while keeping `paystack` as the underlying gateway. Bind the choice to the protected discount, not a client-supplied bank/filter object.
- [ ] Return original product subtotal, eligible-line discount, final payable total and payment attempt identity using existing response conventions. Include loading, decline, cancellation and verification-pending states.
- [ ] Open the server-returned Paystack hosted session through existing web/mobile mechanisms. Browser redirects and WebView messages only trigger server verification; they never establish payment success.
- [ ] Ensure old clients or direct API callers cannot redeem the protected discount through generic checkout or manual code entry.
- [ ] On a payment-method change, request a new server price without REDVAULT. Never leave the discounted order available to another unrestricted payment gateway.

## Task 3: Initialize restricted payment attempts

- [ ] Persist a durable attempt/reference, merchant/order ownership, order version, NGN amount in kobo and discount snapshot before the provider request. Reuse an existing equivalent unresolved attempt for repeated requests.
- [ ] Initialize with card-only channels, Paystack's verified UBA bank code and `verve`, `visa`, `mastercard` brand filters. Obtain the bank code from the provider's supported bank data; do not guess it.
- [ ] Do not enable recurring-only restrictions, which can unnecessarily exclude Verve cards.
- [ ] Record requested restrictions for audit, but do not treat echoed metadata as proof that Paystack enforced them.
- [ ] Reconcile an initialization timeout against the same reference. An ambiguous response is not permission to issue a duplicate charge attempt.
- [ ] Mark replaced attempts superseded while retaining their immutable snapshots. Do not assume a local status change disables an old hosted session.
- [ ] If a superseded attempt later succeeds, record the capture and hold it for review/refund rather than paying the replacement order automatically.

Provider validation: prove that the hosted restrictions accept the required UBA cards and reject non-UBA cards across retries/card switching. Use the supplied ranges below as provider coverage references, without collecting customer card numbers. Bank-level filtering is documented; exact eight-digit coverage is not established by that fact alone. Escalate an actual evidence gap to Paystack. Seek a UBA decision only if resolving it changes the accepted journey or eligibility.

## Task 4: Gate completion, settlement and refunds

- [ ] Verify the webhook HMAC-SHA512 over the raw body with a timing-safe comparison; reject missing/invalid signatures and missing secrets before processing.
- [ ] Independently verify provider success, reference, environment, exact expected amount/currency, card channel and the issuer/eligibility evidence established by provider validation. A successful API request is not necessarily a successful payment.
- [ ] Resolve merchant/order from the persisted attempt and enforce the protected partnership gate before any generic order-paid transition, inventory release, merchant credit or success notification.
- [ ] Share the gate across webhook, verification, reconciliation, recovery workers and administrative completion paths. Include settlement fallback paths in the audit.
- [ ] Explicitly separate REDVAULT pricing from usage redemption. The existing discount order-creation RPC increments usage when creating the order; the protected REDVAULT path must persist a pending discount application without incrementing usage or writing a completed redemption. Leave ordinary discount redemption timing unchanged. Order abandonment, failed initialization and method switching must not consume REDVAULT usage.
- [ ] At verified payment approval, atomically lock the discount/application and order records, enforce any explicitly configured usage limits, create one completed redemption, increment usage once and approve the order. Add a unique constraint on the REDVAULT application/order redemption identity so webhook, callback and reconciliation races cannot redeem twice; a second capture for the same order remains a separate captured-payment review.
- [ ] If an agreed usage limit is reached between checkout and payment completion, retain the capture as unapproved and route it to review/refund without consuming usage or delivering value. No campaign-budget reservation system is introduced. Expired campaign or changed terms use the attempt's stored validity conditions; do not silently reprice a successful capture.
- [ ] Use existing idempotent outbox/recovery mechanisms for downstream work; retain durable retry evidence before acknowledging work that must be retried internally.
- [ ] Keep captured-but-unapproved funds recorded. Unknown eligibility, mismatches, duplicate captures, cancelled orders and obsolete attempts produce a review state, not fulfilment or spendable merchant credit.
- [ ] Establish Paystack's subaccount settlement/refund behavior. Baci's internal hold cannot prevent external settlement after capture; do not claim otherwise.
- [ ] Refund using the original capture and stored line allocations. Enforce cumulative refund limits, reconcile uncertain refund requests before retry, and track pending/processing/failed/processed outcomes. Do not equate request acceptance with customer receipt.
- [ ] For quantity-based partial returns, allocate a canonical line's discount across its units using integer division, assigning any remainder one kobo at a time in persisted unit order. Refund each returned unit's stored net amount, without recalculating the tier. Full line returns must sum exactly to the original net line amount. Restore usage only on a confirmed refund outcome if the agreed restoration rule calls for it, with idempotent restoration records.
- [ ] An operational kill switch stops new REDVAULT attempts but leaves reconciliation and refunds working for existing attempts.

## Task 5: Regression and acceptance tests

For each changed behavior, add colocated tests, demonstrate the relevant failure before implementation, then confirm the same test passes. Do not use real card data or real payment traffic during implementation tests.

| Test group | Required scenarios |
| --- | --- |
| Shared eligibility | Every excluded brand; Samsung A-series excluded; Samsung S/Z and other policy-eligible products included; case/name variations match the existing shared rule |
| Pricing | Mixed basket example above; all-excluded basket; quantities; variants; integer-kobo rounding; authoritative data overrides forged client fields |
| Database pricing | The NGN 100,000 eligible plus NGN 50,000 excluded basket accepts only NGN 5,000 discount; reject NGN 7,500, forged eligibility/proof, replay and altered product/quantity/price bindings through direct RPC calls |
| Rounding | Both half-kobo boundary examples; canonical duplicate-line consolidation; exact server/database equality; ordinary whole-naira discounts remain unchanged |
| Line identity | Same product/variant/price with different condition, attributes or tax treatment stays separate; equivalent attribute-key ordering groups consistently; splitting/reordering equivalent lines preserves total discount; partial refunds retain original order-item allocations |
| Proof compatibility | Legacy negotiation proofs still work only on their original path; cross-action substitution, missing bindings, unknown versions and mutated group identity/tax fields fail; additive verifier is available before new callers are enabled |
| Redemption timing | Unpaid/abandoned/switched orders consume zero usage; successful approval consumes one; duplicate events consume no additional usage; concurrent final-limit claims cannot both succeed |
| Policy consistency | Web, iOS, Android and server use the same rule; new products are evaluated by policy; existing attempt allocations remain unchanged after catalog edits |
| Merchant isolation | Other merchant ID/host/order, copied code, direct API invocation and ordinary discount edits cannot activate or bypass REDVAULT |
| Payment restriction | Required UBA schemes and supplied-range coverage; non-UBA rejection; card switching; alternative channel and manual-code bypass attempts |
| Completion | Invalid signature, missing secret, wrong reference/environment/amount/currency/channel, missing eligibility evidence and duplicate/out-of-order events |
| Concurrency/recovery | Repeated initialization, lost responses, callback/webhook/reconciler races, stale sessions, late success, cancellation and already-paid orders |
| Refund/settlement | Partial/full refund, duplicate request, failure and delayed outcome; no premature credit or fulfilment; settlement fallbacks cannot bypass the gate |
| Refund allocations | Sequential partial-unit returns sum to the original net line amount; refund failures never restore usage; repeated processed events cannot restore twice |
| Customer experience | Web/iOS/Android loading, PIN/OTP/3DS hosted flow, decline, cancel/back navigation, reconnect and pending verification |
| Existing behavior | Ordinary merchant discounts, non-REDVAULT payments and current negotiation behavior remain unchanged |

- [ ] Run focused Vitest/Jest suites for each task, then repository-required `pnpm turbo lint`, `pnpm turbo typecheck` and `pnpm turbo test`. Run mobile platform-drift checks if platform-specific branches change.
- [ ] Run `coderabbit review --agent -t uncommitted` before shipping or any separately authorized commit; resolve critical/high findings and review remaining actionable findings.
- [ ] In a separately authorized sandbox session, capture configuration/version, request restrictions, sanitized verification results and acceptance/rejection evidence. Standard test-card success does not prove all issuer ranges.
- [ ] Prepare an evidence report for UBA before launch; do not send it without authorization. Explicitly separate unit/mock results, provider sandbox evidence and any later authorized live validation.

## Open commercial decisions and release conditions

The 10%/5% eligible-subtotal tiers, shared non-negotiable exclusions, Ogabassey exclusivity and web/iOS/Android scope are confirmed. Do not reopen them.

Before activation, record explicit decisions for campaign dates, minimum spend/caps if any, usage limits, stacking with negotiated prices/other discounts, wallet/savings/split-payment treatment, funding/fees and refund usage restoration. No blanket one-use restriction, unlimited-use promise or additional budget may be inferred. Assign an operations owner for captured-payment reviews and refunds.

These unresolved inputs must not be replaced by invented production defaults. They do not prevent writing tests with explicit fixtures or building the disabled integration after implementation authorization.

Launch remains blocked on failed provider coverage/enforcement tests, incomplete commercial configuration, unresolved quality failures or missing operational recovery. UBA's acceptance itself is already confirmed. The previously mentioned 5–10 working days is provisional and must be re-estimated against validated scope and evidence.

## Review status and implementation handoff

The latest document review found no new material contradictions. Earlier findings are incorporated: eligible-subtotal database enforcement, explicit kobo rounding, payment-time redemption, complete line identity, persisted refund allocations and a separate REDVAULT proof action/version. This is a document-review result, not evidence that code, migrations or provider behavior have passed tests.

Confirmed decisions remain fixed: Ogabassey exclusivity; website, iOS and Android; 10% below ₦200,000 eligible pre-discount subtotal and 5% at or above; shared non-negotiable exclusions; existing discount-system reuse; Paystack-hosted card entry. No new budget machinery or duplicate product exclusion list is required.

After implementation is authorized, execute Tasks 1–5 in order, keeping the feature disabled until release conditions are met. Recheck current source and applicable repository instructions before starting. Preserve ordinary merchant discounts and negotiation behavior; do not use unresolved commercial terms as implicit defaults.

| Remaining condition | Responsible party | Evidence required before activation |
| --- | --- | --- |
| Commercial configuration | Ogabassey owner, with UBA where agreement is needed | Explicit values or explicit absence of dates/caps/limits; stacking, split-payment, funding/fee and refund-restoration decisions |
| Hosted UBA restriction | Implementation team; Paystack for any capability gap | Documented supported configuration and sanitized positive/negative test results covering the required schemes and supplied coverage |
| Correctness and isolation | Implementation team | Passing pricing, direct-RPC, merchant-isolation, proof, concurrency and refund tests; required repository checks and code review |
| Customer experience | Implementation team | Successful web, iOS and Android checkout/recovery evidence with consistent server totals |
| Payment operations | Assigned Ogabassey operations owner | Tested reconciliation/refund workflow, internal-hold versus external-settlement behavior and kill-switch procedure |
| UBA outcome report | Implementation team prepares; owner authorizes sending | Report distinguishes mock tests, sandbox coverage, limitations and any separately authorized live validation |

Do not reopen UBA's acceptance of the unchanged hosted-checkout journey. Escalate only a demonstrated technical gap or a proposed change to the agreed journey/eligibility. No implementation, external testing, outgoing report or deployment is authorized by this review record.

## Supplied UBA coverage reference

These are supplied inputs, not inferred card ranges. Preserve their original string lengths; do not shorten eight-digit entries to six digits or reconstruct PANs.

| Scheme/product | Supplied prefixes |
| --- | --- |
| Visa prepaid | 41739600, 43587400, 44549300, 48484200 |
| Visa credit | 42035900 |
| Visa debit | 42250000, 42825450, 47297700, 49206900 |
| Verve | 506102 |
| Mastercard gold debit | 517868 |
| Mastercard world debit | 519863 |
| Mastercard platinum debit | 519885 |
| Mastercard standard debit | 519911 |
| Mastercard prepaid | 529820, 538956 |
| Mastercard SME | 545993 |

## Repository constraints

Honor current applicable AGENTS.md files. Preserve concurrent changes. Use pnpm, Biome and existing testing frameworks; extract touched logic from oversized files into focused modules with colocated tests. Shared policy belongs in packages/shared. New tables require RLS and foreign-key indexes; migrations are append-only. Never extend user-facing service-role access merely because existing payment routes contain it: use authenticated/scoped access and narrowly authorized worker completion. Do not modify proxy.ts or protected configuration without explicit authorization. No implementation, migration application, dependency installation, deployment, real payments, emails or commits are part of saving this plan.
