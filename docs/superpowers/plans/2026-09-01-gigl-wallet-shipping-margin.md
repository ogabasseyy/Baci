# GIGL Merchant-Wallet Shipping and Platform Margin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-owned 10% margin to every GIGL quote and let merchant owners fund and book fresh GIGL shipping for Admin-created orders from their merchant wallet without double-charging storefront orders.

**Architecture:** GIGL provider quotes carry a typed pricing snapshot whose public `price` is the bundled amount while provider cost and platform margin are persisted separately. A database stamp distinguishes `customer_checkout` from `merchant_wallet` funding, settlement retains shopper-paid GIGL shipping, and an idempotent charge ledger reserves/refunds wallet-funded bookings around the existing provider booking lock. Merchant wallet bank-transfer funding uses a merchant-specific Paystack DVA whose provider data is persisted only from verified Paystack webhooks.

**Tech Stack:** Next.js App Router, TypeScript, React Native/Expo, Supabase PostgreSQL with RLS and `SECURITY DEFINER` RPCs, Paystack DVA/webhooks, GIGL, Zod, Vitest, React Native Testing Library, Biome, pnpm/Turborepo.

**Spec:** `docs/superpowers/specs/2026-09-01-gigl-wallet-shipping-margin-design.md`

## Global Constraints

- Work only in `/Users/mac/Baci-app/.worktrees/gigl-wallet-shipping-margin` on `codex/gigl-wallet-shipping-margin`; preserve unrelated work and never edit the dirty root checkout.
- The platform margin is exactly 10% and applies only to GIGL quotes, including domestic and international GIGL options.
- Calculate money with integer kobo: provider kobo is `Math.round(providerCost * 100)`, charged kobo is `Math.ceil(providerKobo * 11000 / 10000)`, and margin is the difference.
- `shipping_quotes.price` remains the one bundled amount shown and charged. Provider cost, margin, pricing version, provider payload, and attempt tokens are internal and never returned by public quote/Admin responses.
- Storefront-paid GIGL shipping uses `customer_checkout`, is retained at settlement, and never debits the merchant wallet at booking.
- An order-scoped Admin quote explicitly writes `merchant_wallet`; do not infer funding from `orders.source`, `shipping_fee`, payment status, or the absence of an earlier quote.
- Wallet-backed booking debits the full bundled amount, exactly once, only after explicit merchant confirmation. Definitive provider rejection refunds once; ambiguous outcomes retain funds and require reconciliation.
- Merchant wallets and GIGL funding are NGN-only in this release.
- Only merchant owners may provision/fund the DVA or spend the merchant wallet. Every route must authenticate first with `authenticateApiRequest`, derive tenant identity through `getUserAccess`, then validate Zod input and enforce owner/permission checks.
- New user-facing routes must use the authenticated scoped Supabase client. They must not construct an admin/service-role client.
- Provider-verified DVA account data is persisted only by the existing signature-verified Paystack webhook graph, not by a user-facing route or client-supplied table insert.
- Never edit existing migration files. Add narrowly scoped append-only migrations with RLS, explicit grants/revokes, fixed `search_path = ''`, and owner checks inside every authenticated `SECURITY DEFINER` RPC.
- Never use `select('*')`, `any`, `dangerouslySetInnerHTML`, manual React memoization, npm/yarn, or new ESLint configuration.
- Follow TDD for every task: demonstrate the exact RED test before implementation, then GREEN focused tests. New runtime files require colocated tests; keep new/touched source and test files at or below 300 lines by extracting focused helpers.
- Do not deploy, push, modify environment files, call live GIGL/Paystack, or apply migrations to production in this branch.

---

### Task 1: Price and persist every GIGL quote with an internal financial split

**Files:**

- Create: `apps/web/src/lib/shipping/gigl-platform-pricing.ts`
- Create: `apps/web/src/lib/shipping/gigl-platform-pricing.test.ts`
- Create: `apps/web/src/app/api/shipping/quotes/shipping-quote-persistence.ts`
- Create: `apps/web/src/app/api/shipping/quotes/shipping-quote-persistence.test.ts`
- Create: `apps/web/src/app/api/shipping/quotes/public-quote-response.ts`
- Create: `apps/web/src/app/api/shipping/quotes/public-quote-response.test.ts`
- Create: `supabase/migrations/20260901190000_add_gigl_quote_economics.sql`
- Create: `apps/web/src/lib/gigl-quote-economics-migration.test.ts`
- Modify: `apps/web/src/lib/shipping/types.ts`
- Modify: `apps/web/src/lib/shipping/providers/gigl.fetch-quote.ts`
- Modify: `apps/web/src/lib/shipping/providers/gigl.fetch-quote.test.ts`
- Modify: `apps/web/src/app/api/shipping/quotes/route.ts`
- Create: `apps/web/src/app/api/shipping/quotes/route.gigl-margin.test.ts`
- Modify: `apps/web/src/lib/shipping/refresh-order-shipment-quote.ts`
- Modify: `apps/web/src/lib/shipping/refresh-order-shipment-quote.test.ts`

**Interfaces:**

- Produces:
  - `GIGL_PRICING_VERSION = 'gigl_platform_margin_v1'`.
  - `GIGL_PLATFORM_MARGIN_BPS = 1000`.
  - `priceGiglQuote(providerCost: number): GiglPricingSnapshot`, where the snapshot is `{ providerCost, platformMargin, price, marginBasisPoints: 1000, pricingVersion: 'gigl_platform_margin_v1' }`.
  - Optional internal `ShippingQuote` fields `providerCost`, `platformMargin`, `marginBasisPoints`, and `pricingVersion`.
  - `toShippingQuoteUpsert(quote, context)` for consistent POST/Admin/refresh persistence.
  - `toPublicQuoteResponse(response)` that removes `rawResponse` and all internal pricing fields from `featured` and `all` while preserving public quote fields.
- Consumes: the GIGL `GrandTotal` in `fetchGiglQuote`; existing quote IDs, ranking, cache, and order-price equality stay intact.

- [ ] **Step 1: Write the failing pricing and provider tests**

Add tests equivalent to:

```ts
expect(priceGiglQuote(10_000)).toEqual({
  marginBasisPoints: 1000,
  platformMargin: 1_000,
  price: 11_000,
  pricingVersion: 'gigl_platform_margin_v1',
  providerCost: 10_000,
});
expect(priceGiglQuote(1000.01).price).toBe(1100.02);
expect(() => priceGiglQuote(0)).toThrow('GIGL provider cost must be positive');
expect(() => priceGiglQuote(Number.NaN)).toThrow(
  'GIGL provider cost must be finite'
);
```

Extend the GIGL fetch test so a provider `GrandTotal` of `10000` returns public
`price: 11000`, `providerCost: 10000`, `platformMargin: 1000`, basis points
`1000`, and the exact pricing version. Retain a non-GIGL quote fixture proving
its price and shape remain unchanged.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @baci/web exec vitest run src/lib/shipping/gigl-platform-pricing.test.ts src/lib/shipping/providers/gigl.fetch-quote.test.ts
```

Expected: FAIL because the pricing module and internal snapshot fields do not exist and GIGL still returns the provider tariff.

- [ ] **Step 3: Add the pricing helper and typed GIGL projection**

Implement the helper with integer-kobo arithmetic and reject non-finite or
non-positive inputs. In `fetchGiglQuote`, compute the snapshot once from
`priceData.GrandTotal`, spread the internal fields onto the returned quote, and
set `price` to the bundled snapshot price. Do not apply the helper in clients,
the aggregator, or non-GIGL adapters.

- [ ] **Step 4: Write failing persistence, redaction, refresh, and migration tests**

The persistence tests must assert this exact mapping for a GIGL quote:

```ts
expect(row).toMatchObject({
  price: 11_000,
  provider_cost: 10_000,
  platform_margin: 1_000,
  platform_margin_bps: 1000,
  pricing_version: 'gigl_platform_margin_v1',
});
```

The public-response test must serialize the result and prove it contains none of
`providerCost`, `platformMargin`, `marginBasisPoints`, `pricingVersion`, or
`rawResponse`, while `price` remains `11000`. The refresh test must prove an
expired GIGL quote persists the replacement public price and split. The migration
contract test must prove the four new `shipping_quotes` columns are nonnegative,
nullable for legacy/non-GIGL rows, and the authenticated/anon grants are not
broadened.

- [ ] **Step 5: Run the new tests and verify RED**

Run:

```bash
pnpm --filter @baci/web exec vitest run src/app/api/shipping/quotes/shipping-quote-persistence.test.ts src/app/api/shipping/quotes/public-quote-response.test.ts src/lib/shipping/refresh-order-shipment-quote.test.ts src/lib/gigl-quote-economics-migration.test.ts
```

Expected: FAIL because the projections, columns, and refresh fields do not exist.

- [ ] **Step 6: Add the append-only quote schema and extracted route helpers**

Add nullable columns `provider_cost numeric(12,2)`, `platform_margin
numeric(12,2)`, `platform_margin_bps integer`, and `pricing_version text` with
checks that cost/margin are nonnegative and basis points are between 0 and
10000. Do not backfill old rows and do not expose new grants.

Extract the route's upsert row construction into `toShippingQuoteUpsert`, use it
from POST and refresh, and return `toPublicQuoteResponse(response)` only after
internal rows are persisted. GET must select public fields only. Preserve the
existing merchant-rate and non-NG fail-closed branches.

- [ ] **Step 7: Run focused GREEN tests and route regressions**

Run:

```bash
pnpm --filter @baci/web exec vitest run src/lib/shipping/gigl-platform-pricing.test.ts src/lib/shipping/providers/gigl.fetch-quote.test.ts src/app/api/shipping/quotes/shipping-quote-persistence.test.ts src/app/api/shipping/quotes/public-quote-response.test.ts src/app/api/shipping/quotes/route.gigl-margin.test.ts src/app/api/shipping/quotes/route.test.ts src/lib/shipping/refresh-order-shipment-quote.test.ts src/lib/gigl-quote-economics-migration.test.ts
git diff --check
```

Expected: PASS; route response contains the bundled price and no internal split.

- [ ] **Step 8: Commit Task 1**

```bash
git add apps/web/src/lib/shipping apps/web/src/app/api/shipping/quotes apps/web/src/lib/gigl-quote-economics-migration.test.ts supabase/migrations/20260901190000_add_gigl_quote_economics.sql
git commit -m "feat: add GIGL platform shipping margin"
```

### Task 2: Stamp GIGL funding source and retain shopper-paid shipping at settlement

**Files:**

- Create: `supabase/migrations/20260901191000_stamp_gigl_order_economics.sql`
- Create: `apps/web/src/lib/gigl-order-economics-migration.test.ts`
- Modify: `apps/web/src/lib/payments/paid-order-rich-select.ts`
- Modify: `apps/web/src/lib/payments/paid-order-side-effect-types.ts`
- Modify: `apps/web/src/lib/payments/run-paid-order-side-effects.ts`
- Modify: `apps/web/src/lib/payments/run-paid-order-side-effects.test.ts`
- Modify: `apps/web/src/lib/payments/paid-order-settlement-executor.ts`
- Create: `apps/web/src/lib/payments/paid-order-settlement-executor.gigl-shipping.test.ts`
- Modify: `apps/web/src/lib/payments/paid-order-settlement-executor.juicyway.test.ts`

**Interfaces:**

- Produces order fields `shipping_funding_source`, `shipping_provider_cost`,
  `shipping_platform_margin`, `shipping_platform_retained_amount`, and
  `shipping_pricing_version`.
- `shipping_funding_source` accepts only `customer_checkout` and
  `merchant_wallet`; legacy rows remain null.
- The database stamp defaults a newly selected, newly priced GIGL quote to
  `customer_checkout` unless the mutation explicitly supplies
  `merchant_wallet`. It copies the split from the quote and sets retained amount
  to `quote.price` only for `customer_checkout`; merchant-wallet retained amount
  is zero.
- `RichPaidOrder` exposes nullable `shipping_platform_retained_amount` and
  `shipping_funding_source`.
- Settlement result and RPC metadata add `commerce_platform_fee` and
  `retained_shipping_amount`, while `p_platform_fee` remains their combined
  deduction.

- [ ] **Step 1: Write failing migration contract tests**

Assert the migration adds all five columns and a trigger/function that:

```text
new priced GIGL quote + null funding source -> customer_checkout
explicit merchant_wallet -> merchant_wallet
customer_checkout retained amount -> shipping_quotes.price
merchant_wallet retained amount -> 0
legacy quote with null pricing_version -> no guessed source/split
```

Assert the function uses merchant/quote/provider equality and never changes
`orders.shipping_fee`, `orders.subtotal`, or `orders.total`.

- [ ] **Step 2: Run the migration test and verify RED**

```bash
pnpm --filter @baci/web exec vitest run src/lib/gigl-order-economics-migration.test.ts
```

Expected: FAIL because the migration and order columns do not exist.

- [ ] **Step 3: Add the order snapshot migration**

Add the columns and a `BEFORE INSERT OR UPDATE OF selected_quote_id,
shipping_funding_source` trigger. The trigger must query the exact selected quote,
require matching `merchant_id` and `provider = 'GIGL'`, copy the split only when
`pricing_version = 'gigl_platform_margin_v1'`, and preserve null legacy behavior.
An explicit `merchant_wallet` value is authoritative; all other invalid source
values fail the check constraint.

- [ ] **Step 4: Write failing settlement regressions**

Add the focused GIGL cases to the new settlement test file, leaving the existing
264-line regression suite unchanged. Core assertions are:

```ts
expect(rpc).toHaveBeenCalledWith('record_merchant_settlement', {
  p_platform_fee: 12_000,
  p_metadata: expect.objectContaining({
    commerce_platform_fee: 1_000,
    retained_shipping_amount: 11_000,
  }),
  // retain the existing required arguments
});
```

Use a `grossAmount` large enough for the existing commerce fee to be `1000`.
Add separate cases proving `merchant_wallet`, null/legacy funding, and non-GIGL
orders retain zero shipping; Juicyway follows the same funding-source rule. Add a
case proving fees exceeding verified gross throw before the settlement RPC.

- [ ] **Step 5: Run settlement tests and verify RED**

```bash
pnpm --filter @baci/web exec vitest run src/lib/payments/paid-order-settlement-executor.gigl-shipping.test.ts src/lib/payments/paid-order-settlement-executor.test.ts src/lib/payments/paid-order-settlement-executor.juicyway.test.ts src/lib/payments/run-paid-order-side-effects.test.ts
```

Expected: FAIL because the rich order and settlement executor ignore retained
shipping.

- [ ] **Step 6: Thread the snapshot through paid-order settlement**

Add the two order fields to `PAID_ORDER_RICH_SELECT` and `RichPaidOrder`. In the
settlement executor, accept retained shipping only when source is
`customer_checkout`; validate it as finite, nonnegative money; add it to the
existing commerce platform fee; keep the existing `gateway + platform <= gross`
fail-closed check; and write the separated values to result and RPC metadata.
Do not create a wallet debit or a new paid-order side-effect step.

- [ ] **Step 7: Run focused GREEN tests and financial regressions**

```bash
pnpm --filter @baci/web exec vitest run src/lib/gigl-order-economics-migration.test.ts src/lib/payments/paid-order-settlement-executor.gigl-shipping.test.ts src/lib/payments/paid-order-settlement-executor.test.ts src/lib/payments/paid-order-settlement-executor.juicyway.test.ts src/lib/payments/run-paid-order-side-effects.test.ts src/lib/payments/financial-consistency.test.ts
git diff --check
```

Expected: PASS; storefront GIGL shipping is retained once and manual/legacy
shipping is not retained.

- [ ] **Step 8: Commit Task 2**

```bash
git add supabase/migrations/20260901191000_stamp_gigl_order_economics.sql apps/web/src/lib/gigl-order-economics-migration.test.ts apps/web/src/lib/payments
git commit -m "feat: retain storefront GIGL shipping settlement"
```

### Task 3: Add an idempotent merchant-wallet shipping charge state machine

**Files:**

- Create: `supabase/migrations/20260901192000_add_merchant_shipping_charges.sql`
- Create: `apps/web/src/lib/merchant-shipping-charges-migration.test.ts`
- Create: `apps/web/src/lib/shipping/merchant-shipping-charge.ts`
- Create: `apps/web/src/lib/shipping/merchant-shipping-charge.test.ts`
- Create: `apps/web/src/lib/shipping/book-wallet-funded-order-shipment.ts`
- Create: `apps/web/src/lib/shipping/book-wallet-funded-order-shipment.test.ts`
- Modify: `apps/web/src/lib/shipping/book-order-shipment.ts`
- Create: `apps/web/src/lib/shipping/book-order-shipment.gigl-economics.test.ts`
- Modify: `apps/web/src/app/api/orders/[id]/route.ts`
- Create: `apps/web/src/app/api/orders/[id]/route.merchant-wallet-booking.test.ts`
- Modify: `apps/web/src/app/api/shipping/book/route.ts`
- Create: `apps/web/src/app/api/shipping/book/route.merchant-wallet.test.ts`

**Interfaces:**

- Produces table `merchant_shipping_charges` with one row per order/quote and
  statuses `reserved`, `provider_submitting`, `booked`, `refunded`, and
  `needs_reconciliation`.
- Produces authenticated owner-only RPCs:

```ts
reserveMerchantShippingCharge({ orderId, quoteId, attemptToken })
// -> { chargeId, chargedAmount, balanceAfter, status }

beginMerchantShippingChargeSubmission({ chargeId, attemptToken })
completeMerchantShippingCharge({ chargeId, attemptToken, shipmentId })
refundMerchantShippingCharge({ chargeId, attemptToken, reasonCode })
markMerchantShippingChargeForReconciliation({
  chargeId,
  attemptToken,
  reasonCode,
  providerReference,
})
```

- `bookWalletFundedOrderShipment` accepts the existing scoped Supabase client,
  merchant/order IDs, and a callback that invokes `bookOrderShipment`; it owns
  reserve, provider-submitting, completion/refund/reconciliation transitions.
- Customer-checkout/null funding bypasses this wrapper without any wallet RPC.

- [ ] **Step 1: Write failing migration/RPC contract tests**

The test must inspect exact SQL behavior for:

```text
owner and order/quote/merchant equality required
NGN and merchant_wallet funding required
wallet row locked before balance check
available balance decremented by quote.price
debit wallet transaction source_type = gigl_shipping
duplicate order+quote reservation returns the existing debit
insufficient funds raises MERCHANT_WALLET_INSUFFICIENT
attempt-token-gated begin/complete/refund/reconciliation transitions
refund appends one linked credit and restores available balance once
authenticated grants limited to the five owner-checked RPCs
table RLS enabled with owner read only and no direct write policy
```

- [ ] **Step 2: Run migration tests and verify RED**

```bash
pnpm --filter @baci/web exec vitest run src/lib/merchant-shipping-charges-migration.test.ts
```

Expected: FAIL because the charge table and RPCs do not exist.

- [ ] **Step 3: Add the charge ledger and atomic RPCs**

Use a unique `(order_id, shipping_quote_id)` index and an advisory transaction
lock keyed by merchant/order. Store the snapshotted provider cost, margin,
bundled amount, currency, debit/refund transaction IDs, attempt-token digest,
shipment/provider identifiers, failure code, and timestamps. Store only a SHA-256
digest of the attempt token. Use the existing `wallet_transactions` values
`debit` for reservation and `refund` for reversal; no payout pending-balance
movement. Repeated reserve/begin/complete/refund calls must return the existing
state or terminal result without a second debit or provider attempt.

- [ ] **Step 4: Write failing orchestration tests**

Cover these exact cases:

```ts
it('never calls a wallet RPC for customer_checkout funding')
it('reserves once before invoking GIGL for merchant_wallet funding')
it('completes the charge only after the shipment is persisted')
it('refunds and releases the booking lock after a definitive rejection')
it('holds funds and the booking lock after an ambiguous provider timeout')
it('marks reconciliation when GIGL succeeds but local shipment persistence fails')
it('returns MERCHANT_WALLET_INSUFFICIENT without calling GIGL')
it('returns the existing booked shipment on a duplicate confirmation')
```

Use the existing `shouldReleaseBookingLock` classification: release/refund only
when the error is definitive. Never classify `SHIPMENT_SAVE_FAILED`, timeout,
connection loss, or unknown provider response as refundable.

- [ ] **Step 5: Run orchestration tests and verify RED**

```bash
pnpm --filter @baci/web exec vitest run src/lib/shipping/merchant-shipping-charge.test.ts src/lib/shipping/book-wallet-funded-order-shipment.test.ts src/lib/shipping/book-order-shipment.gigl-economics.test.ts src/lib/shipping/book-order-shipment.test.ts
```

Expected: FAIL because wallet reservation is absent.

- [ ] **Step 6: Implement the extracted wallet-funded booking wrapper**

Generate exactly 32 random bytes server-side and encode them as hex for the
attempt token, keep the token out of logs/responses, reserve before the external call,
mark provider submission before GIGL, and pass the persisted shipment ID to
completion. Extend booked shipment persistence with `provider_cost` and
`platform_margin` from the selected quote. Preserve current booking recovery and
quote-price equality for `customer_checkout`; for `merchant_wallet`, compare the
current unexpired quote with its order snapshot and never compare it to the
original customer `shipping_fee`.

Route both order-status booking and direct booking through the wrapper. If the
direct `/api/shipping/book` architecture cannot share the wrapper without
duplicating provider execution, fail closed for `merchant_wallet` orders with
`USE_ORDER_SHIPMENT_BOOKING` and keep the mobile bearer PATCH path as the single
owner; never allow it to bypass wallet reservation.

- [ ] **Step 7: Run focused GREEN booking tests**

```bash
pnpm --filter @baci/web exec vitest run src/lib/merchant-shipping-charges-migration.test.ts src/lib/shipping/merchant-shipping-charge.test.ts src/lib/shipping/book-wallet-funded-order-shipment.test.ts src/lib/shipping/book-order-shipment.gigl-economics.test.ts src/lib/shipping/book-order-shipment.test.ts src/app/api/orders/'[id]'/route.merchant-wallet-booking.test.ts src/app/api/orders/'[id]'/route.booking-validation.test.ts src/app/api/shipping/book/route.merchant-wallet.test.ts src/app/api/shipping/book/route.test.ts
git diff --check
```

Expected: PASS; neither entrypoint can book a merchant-wallet order without one
idempotent reservation.

- [ ] **Step 8: Commit Task 3**

```bash
git add supabase/migrations/20260901192000_add_merchant_shipping_charges.sql apps/web/src/lib/merchant-shipping-charges-migration.test.ts apps/web/src/lib/shipping apps/web/src/app/api/orders/'[id]'/route.ts apps/web/src/app/api/orders/'[id]'/route.booking-validation.test.ts apps/web/src/app/api/shipping/book
git commit -m "feat: reserve merchant wallet for GIGL booking"
```

### Task 4: Fund merchant wallets through a Paystack bank-transfer DVA

**Files:**

- Create: `supabase/migrations/20260901193000_add_merchant_wallet_funding.sql`
- Create: `apps/web/src/lib/merchant-wallet-funding-migration.test.ts`
- Create: `apps/web/src/schemas/merchant-wallet-funding.ts`
- Create: `apps/web/src/schemas/merchant-wallet-funding.test.ts`
- Create: `apps/web/src/lib/merchant-wallet-payment-accounts.ts`
- Create: `apps/web/src/lib/merchant-wallet-payment-accounts.test.ts`
- Create: `apps/web/src/lib/payments/confirm-paystack-merchant-wallet-dva.ts`
- Create: `apps/web/src/lib/payments/confirm-paystack-merchant-wallet-dva.test.ts`
- Create: `apps/web/src/app/api/merchant-wallet/route.ts`
- Create: `apps/web/src/app/api/merchant-wallet/route.test.ts`
- Create: `apps/web/src/app/api/merchant-wallet/funding-account/route.ts`
- Create: `apps/web/src/app/api/merchant-wallet/funding-account/route.test.ts`
- Modify: `apps/web/src/app/api/payments/webhook/route.ts`
- Create: `apps/web/src/app/api/payments/webhook/route.merchant-wallet-dva.test.ts`

**Interfaces:**

- Produces `merchant_wallet_funding_account_requests` and
  `merchant_wallet_payment_accounts`; direct account-table writes are unavailable
  to authenticated/anon roles.
- `POST /api/merchant-wallet/funding-account` accepts `{ consent: true }`, derives
  the owner/merchant, starts or reuses a Paystack customer/DVA assignment with a
  random request ID in provider metadata, and returns `{ account: null, status:
  'pending' }` until the verified assignment webhook persists the account.
- `GET /api/merchant-wallet/funding-account` returns only `{ accountName,
  accountNumber, bankName, currency, status }` for the owner.
- `GET /api/merchant-wallet` returns `{ availableBalance, currency: 'NGN' }`.
- Verified Paystack assignment events persist the DVA only when metadata matches
  one pending request and merchant. Verified `charge.success` calls an
  idempotent funding-credit RPC and returns the new balance.

- [ ] **Step 1: Write failing schema and migration tests**

The Zod schema accepts only literal `true` consent and rejects missing/false or
unknown fields. The SQL contract must assert:

```text
request rows owner-insert/read only, random UUID correlation, one active request
account rows owner-read only, no authenticated insert/update/delete
unique active provider/account and merchant/provider mappings
NGN, active/pending/disabled status checks
service-only persist-assignment and credit-funding RPCs
credit RPC locks by Paystack reference and account, credits full verified amount,
appends wallet_transactions source_type merchant_wallet_topup, and is idempotent
```

- [ ] **Step 2: Run schema/migration tests and verify RED**

```bash
pnpm --filter @baci/web exec vitest run src/schemas/merchant-wallet-funding.test.ts src/lib/merchant-wallet-funding-migration.test.ts
```

Expected: FAIL because the schema and funding contract do not exist.

- [ ] **Step 3: Add the secure funding schema and database contract**

Create the request/account tables, owner read policies, and service-only verified
webhook functions. The credit function accepts verified amount/currency/reference
and account number, rejects non-NGN/non-positive values, requires exactly one
active account, uses a unique Paystack reference ledger key, increments
`merchant_wallets.available_balance` only. Leave `total_earned` unchanged and
document that top-ups are principal, not earnings.

- [ ] **Step 4: Write failing account-route and webhook tests**

Add route tests for 401, malformed JSON, consent false, non-owner 403, existing
account 200, new assignment 202/pending, Paystack failure without persistence,
and response redaction. Add webhook tests for signed assignment persistence,
exact receiver match, duplicate `charge.success`, excess amount credited in full,
wrong currency rejection, order-DVA alias conflict review, and zero/multiple
candidate review. Assert new user-facing routes never construct
`createAdminClient` or `createServiceClient`.

- [ ] **Step 5: Run route/webhook tests and verify RED**

```bash
pnpm --filter @baci/web exec vitest run src/lib/merchant-wallet-payment-accounts.test.ts src/lib/payments/confirm-paystack-merchant-wallet-dva.test.ts src/app/api/merchant-wallet/route.test.ts src/app/api/merchant-wallet/funding-account/route.test.ts src/app/api/payments/webhook/route.merchant-wallet-dva.test.ts
```

Expected: FAIL because merchant DVA matching and APIs are absent.

- [ ] **Step 6: Implement assignment initiation and verified webhook persistence**

Reuse the existing Paystack customer/DVA API helpers, but omit merchant subaccount
splitting because Baci owns the service wallet. Record explicit consent and a
random request correlation before the external assignment call. Put only the
request ID, merchant ID, and source `merchant_wallet_funding` in Paystack
metadata. The user-facing POST returns pending and never persists provider
account data.

In the already signature-verified webhook graph, handle DVA assignment success
before `charge.success`: match metadata to one pending request, validate active
NGN account shape, and call the service-only persist function. For
`charge.success`, match receiver account after order-DVA handling and before the
customer-wallet fallback, enforce alias guards, call the idempotent merchant
funding credit, and return a handled response. Log identifiers only; do not log
account numbers, customer PII, or provider bodies.

- [ ] **Step 7: Run focused GREEN funding tests**

```bash
pnpm --filter @baci/web exec vitest run src/schemas/merchant-wallet-funding.test.ts src/lib/merchant-wallet-funding-migration.test.ts src/lib/merchant-wallet-payment-accounts.test.ts src/lib/payments/confirm-paystack-merchant-wallet-dva.test.ts src/app/api/merchant-wallet/route.test.ts src/app/api/merchant-wallet/funding-account/route.test.ts src/app/api/payments/webhook/route.merchant-wallet-dva.test.ts src/app/api/payments/webhook/route.test.ts
git diff --check
```

Expected: PASS; verified transfers credit the full amount once and user routes
cannot write provider account data.

- [ ] **Step 8: Commit Task 4**

```bash
git add supabase/migrations/20260901193000_add_merchant_wallet_funding.sql apps/web/src/lib/merchant-wallet-funding-migration.test.ts apps/web/src/schemas/merchant-wallet-funding.ts apps/web/src/schemas/merchant-wallet-funding.test.ts apps/web/src/lib/merchant-wallet-payment-accounts.ts apps/web/src/lib/merchant-wallet-payment-accounts.test.ts apps/web/src/lib/payments/confirm-paystack-merchant-wallet-dva.ts apps/web/src/lib/payments/confirm-paystack-merchant-wallet-dva.test.ts apps/web/src/app/api/merchant-wallet apps/web/src/app/api/payments/webhook/route.ts apps/web/src/app/api/payments/webhook/route.merchant-wallet-dva.test.ts
git commit -m "feat: fund merchant wallet by bank transfer"
```

### Task 5: Generate and bind a fresh order-scoped Admin GIGL quote

**Files:**

- Create: `apps/web/src/schemas/order-gigl-shipping.ts`
- Create: `apps/web/src/schemas/order-gigl-shipping.test.ts`
- Create: `apps/web/src/lib/shipping/build-order-gigl-quote-request.ts`
- Create: `apps/web/src/lib/shipping/build-order-gigl-quote-request.test.ts`
- Create: `apps/web/src/app/api/orders/[id]/shipping/gigl-quote/route.ts`
- Create: `apps/web/src/app/api/orders/[id]/shipping/gigl-quote/route.test.ts`

**Interfaces:**

- `orderGiglQuoteSchema` accepts an optional complete receiver override with
  `address`, `city`, `state`, and `phone`; it rejects partial/blank overrides.
- `buildOrderGiglQuoteRequest(order, sender)` loads authoritative order items and
  product weights server-side, converts supported units, and uses the established
  1 kg-per-unit fallback only when a product/custom item has no usable weight.
- `POST /api/orders/:id/shipping/gigl-quote` is bearer/cookie authenticated,
  owner-only, and order-scoped. It returns one cheapest non-station-pickup GIGL
  quote plus `{ availableBalance, shortfall, canBook }`, never internal pricing.
- A protected Admin-order mode on the existing trusted shipping-quote
  persistence edge loads authoritative order/item/sender data, obtains and
  persists the GIGL quote with server-authored order provenance, and returns its
  ID. The new order route must not construct or import an admin/service client.
- The authenticated binding RPC accepts only order ID, persisted quote ID, and
  validated receiver fields. It must never accept quote JSON, price, provider
  cost, margin, currency, pricing version, or expiry from the caller. Under row
  locks it revalidates server-authored Admin-order provenance, merchant, GIGL
  provider, pricing version, NGN currency, expiry, address-delivery mode, and
  concurrent order state before updating the order's selected quote/provider/
  address plus explicit `shipping_funding_source:
  'merchant_wallet'`, and never changes original `shipping_fee`, subtotal, tax,
  discount, or total.

- [ ] **Step 1: Write failing schema/request-builder tests**

Cover complete existing address, missing city/state, a complete override,
kilograms/grams conversion, quantity multiplication, custom item fallback, and
zero-item rejection. Core fallback assertion:

```ts
expect(request.items).toEqual([
  expect.objectContaining({ name: 'iPhone 15', quantity: 1, weight: 1 }),
]);
```

- [ ] **Step 2: Run builder tests and verify RED**

```bash
pnpm --filter @baci/web exec vitest run src/schemas/order-gigl-shipping.test.ts src/lib/shipping/build-order-gigl-quote-request.test.ts
```

Expected: FAIL because the schema/builder do not exist.

- [ ] **Step 3: Implement the schema and server request builder**

Use existing shipping address/item types and weight conversion utilities. The
builder must return a discriminated failure with code
`ORDER_SHIPPING_ADDRESS_INCOMPLETE` and exact missing fields rather than inventing
address data. Sender origin is resolved by `resolveBookingMerchantSender`; the
client never supplies merchant/sender identity, product value, or weight.

- [ ] **Step 4: Write failing route tests**

Required cases:

```text
401 unauthenticated
403 authenticated non-owner or wrong merchant
404 missing order
409 order already shipped/booked
422 missing address fields with exact field names
400 empty items or merchant origin missing
503 no eligible GIGL address-delivery quote
200 cheapest eligible quote selected and stored
200 existing address updated only from validated override
price/internal provider cost and margin persisted but redacted from response
wallet balance/shortfall computed from bundled price
order stamped merchant_wallet without changing original totals
caller cannot forge price/provider cost/margin/currency/expiry/quote provenance
binding rejects a merchant-created or wrong-order quote ID atomically
concurrent order transition or quote expiry rolls back the entire bind
```

- [ ] **Step 5: Run route tests and verify RED**

```bash
pnpm --filter @baci/web exec vitest run src/app/api/orders/'[id]'/shipping/gigl-quote/route.test.ts
```

Expected: FAIL because the endpoint does not exist.

- [ ] **Step 6: Implement the authenticated order-scoped route**

Authenticate before parsing, call `getUserAccess`, require `isOwner` and
`hasPermission(access, 'orders', 'fulfill')`, then use a protected Admin-order
mode on the existing trusted quote edge. That mode independently loads the order
using exact columns including `order_items` and product weight data, resolves the
sender, gets only GIGL quotes through
`shippingService.getProviderQuotes('GIGL', request)`, filters out station pickup,
ranks by bundled price, and persists through Task 1's helper with server-authored
order provenance. The order route then calls the authenticated binding RPC with
only the returned quote ID and validated receiver fields. The RPC must select and
validate the persisted row itself and bind atomically. Read the merchant wallet
through its owner-checked summary RPC and return nonnegative shortfall
`Math.max(0, quote.price - availableBalance)`.

- [ ] **Step 7: Run focused GREEN Admin-backend tests**

```bash
pnpm --filter @baci/web exec vitest run src/schemas/order-gigl-shipping.test.ts src/lib/shipping/build-order-gigl-quote-request.test.ts src/app/api/orders/'[id]'/shipping/gigl-quote/route.test.ts src/app/api/orders/'[id]'/route.booking-validation.test.ts
git diff --check
```

Expected: PASS; a manual order now has a fresh, wallet-funded GIGL quote that the
existing shipped transition can book safely.

- [ ] **Step 8: Commit Task 5**

```bash
git add apps/web/src/schemas/order-gigl-shipping.ts apps/web/src/schemas/order-gigl-shipping.test.ts apps/web/src/lib/shipping/build-order-gigl-quote-request.ts apps/web/src/lib/shipping/build-order-gigl-quote-request.test.ts apps/web/src/app/api/orders/'[id]'/shipping/gigl-quote
git commit -m "feat: quote manual orders with GIGL"
```

### Task 6: Add the Admin Ship-with-GIG quote, funding, and confirmation experience

**Files:**

- Create: `apps/mobile-admin/lib/order-gigl-shipping.ts`
- Create: `apps/mobile-admin/lib/order-gigl-shipping.test.ts`
- Create: `apps/mobile-admin/hooks/orders/useOrderGiglShipping.ts`
- Create: `apps/mobile-admin/hooks/orders/useOrderGiglShipping.test.ts`
- Create: `apps/mobile-admin/components/orders/ShipmentFlowGiglPanel.tsx`
- Create: `apps/mobile-admin/components/orders/ShipmentFlowGiglPanel.test.tsx`
- Modify: `apps/mobile-admin/components/orders/ShipmentFlowMethodStep.tsx`
- Modify: `apps/mobile-admin/components/orders/ShipmentFlowSheet.tsx`
- Create: `apps/mobile-admin/components/orders/ShipmentFlowSheet.gigl.test.tsx`
- Modify: `apps/mobile-admin/components/orders/OrderDetailsScreenModals.tsx`
- Modify: `apps/mobile-admin/hooks/createOrderDetailsShipmentActions.ts`
- Modify: `apps/mobile-admin/hooks/createOrderDetailsShipmentActions.test.ts`
- Modify: `apps/mobile-admin/hooks/useOrderDetailsController.ts`
- Modify: `apps/mobile-admin/lib/order-shipment.ts`
- Modify: `apps/mobile-admin/lib/order-shipment.test.ts`

**Interfaces:**

- `useOrderGiglShipping({ enabled, orderId, initialAddress })` owns quote loading,
  address-completion retry, DVA consent/provisioning, balance refresh, and bounded
  post-transfer polling.
- The hook exposes `{ quote, wallet, fundingAccount, addressDraft, missingFields,
  state, error, requestQuote, updateAddressField, startFunding, startTransferPoll,
  refreshBalance, reset }` with no provider-cost/margin fields.
- Poll every 3 seconds for at most 60 seconds after **I've transferred**, stop on
  sufficient balance, sheet close/unmount, app background, or terminal error.
- The method UI title is exactly **Ship with GIG** and shows one bundled price.
  Insufficient balance shows current balance, exact shortfall, and **Fund wallet**.
  DVA details show bank/account/account-name plus copy actions and **I've
  transferred**. No internal split is displayed.

- [ ] **Step 1: Write failing API parser and hook tests**

Test parsing/redaction, bearer headers, quote-on-method-step enablement, complete
address retry, shortfall state, funding consent, pending DVA, active DVA,
three-second fake-timer polling, sufficient-balance stop, 60-second timeout,
unmount cancellation, and no request while the sheet is closed. Use fake timers
and mocked authenticated fetch; no real timers or network.

- [ ] **Step 2: Run hook tests and verify RED**

```bash
pnpm --filter baci-mobile-admin exec vitest run lib/order-gigl-shipping.test.ts hooks/orders/useOrderGiglShipping.test.ts
```

Expected: FAIL because the parser/hook do not exist.

- [ ] **Step 3: Implement the typed API client and extracted hook**

Use the existing `createAuthenticatedFetch` bearer/session helper. Validate every
JSON response with Zod before state updates. Query keys must include order ID;
invalidate order, orders, counts, dashboard, and merchant-wallet queries after a
successful book or observed funding credit. Do not put polling effects into
`useOrderDetailsController`; keep that controller below 300 lines by delegating
the complete feature state to the new hook.

- [ ] **Step 4: Write failing component and flow regressions**

Required UI behaviors:

```text
manual order no longer shows disabled “No provider-backed shipping quote” only
loading state becomes “Ship with GIG” with bundled price
self fulfil remains selectable throughout
missing city/state renders accessible labeled inputs and Retry quote
insufficient wallet renders exact shortfall and Fund wallet
active DVA renders bank/account details and copy buttons
funding credit does not auto-book; primary action still requires confirmation
expired/replaced quote displays the new amount before confirmation
provider confirmation calls the existing shipped update only when canBook true
non-owner/unsupported error leaves Self Fulfill available
```

- [ ] **Step 5: Run UI tests and verify RED**

```bash
pnpm --filter baci-mobile-admin exec vitest run components/orders/ShipmentFlowGiglPanel.test.tsx components/orders/ShipmentFlowSheet.gigl.test.tsx components/orders/ShipmentFlowSheet.test.tsx hooks/createOrderDetailsShipmentActions.test.ts lib/order-shipment.test.ts
```

Expected: FAIL because the provider card still requires a checkout quote and has
no quote/funding state.

- [ ] **Step 6: Wire the GIGL panel into the existing shipment sheet**

Enable the hook when the sheet is visible on the method step and the order has no
reusable shipment. Preserve existing saved-checkout provider behavior for
already-quoted storefront orders, but render the new GIGL panel for an order with
no provider quote. Selecting GIGL requires a returned quote; Continue is disabled
until `wallet.canBook` and then keeps the existing explicit
`proceedFromShipmentMethod -> updateStatus('shipped')` confirmation. Closing the
sheet resets transient address/funding polling without deleting the server quote.

Add address fields only for server-reported missing fields. Use the order's
existing address as draft input, but never synthesize city/state. Keep the rider
step and self-fulfil endpoint byte-for-byte behaviorally compatible.

- [ ] **Step 7: Run focused GREEN mobile tests**

```bash
pnpm --filter baci-mobile-admin exec vitest run lib/order-gigl-shipping.test.ts hooks/orders/useOrderGiglShipping.test.ts components/orders/ShipmentFlowGiglPanel.test.tsx components/orders/ShipmentFlowSheet.gigl.test.tsx components/orders/ShipmentFlowSheet.test.tsx hooks/createOrderDetailsShipmentActions.test.ts hooks/completeOrderShipment.test.ts hooks/orders/useOrderStatusUpdate.test.ts lib/order-shipment.test.ts
git diff --check
```

Expected: PASS; the screenshot flow can quote, fund, and explicitly book GIGL or
fall back to Self Fulfill.

- [ ] **Step 8: Commit Task 6**

```bash
git add apps/mobile-admin/lib/order-gigl-shipping.ts apps/mobile-admin/lib/order-gigl-shipping.test.ts apps/mobile-admin/hooks/orders/useOrderGiglShipping.ts apps/mobile-admin/hooks/orders/useOrderGiglShipping.test.ts apps/mobile-admin/components/orders/ShipmentFlowGiglPanel.tsx apps/mobile-admin/components/orders/ShipmentFlowGiglPanel.test.tsx apps/mobile-admin/components/orders/ShipmentFlowMethodStep.tsx apps/mobile-admin/components/orders/ShipmentFlowSheet.tsx apps/mobile-admin/components/orders/ShipmentFlowSheet.gigl.test.tsx apps/mobile-admin/components/orders/OrderDetailsScreenModals.tsx apps/mobile-admin/hooks/createOrderDetailsShipmentActions.ts apps/mobile-admin/hooks/createOrderDetailsShipmentActions.test.ts apps/mobile-admin/hooks/useOrderDetailsController.ts apps/mobile-admin/lib/order-shipment.ts apps/mobile-admin/lib/order-shipment.test.ts
git commit -m "feat: ship Admin orders with GIGL"
```

## Final Verification

- [ ] Run every focused test listed in Tasks 1-6 from a clean task HEAD.
- [ ] Run `pnpm turbo lint` and require zero Biome errors.
- [ ] Run `pnpm turbo typecheck` and require zero TypeScript errors.
- [ ] Run `pnpm turbo test`; compare any failures with the clean `origin/main`
  baseline, which showed one pre-existing web failure after 5,723 passes before
  the diagnostic run was stopped. Re-run every reported failure individually.
- [ ] Run `git diff --check`, inspect `git status --short`, and verify no new or
  touched source/test file exceeds 300 lines.
- [ ] Run `coderabbit review --agent -t uncommitted` if the CLI is available and
  resolve every Critical/High finding.
- [ ] Generate a whole-branch review package from the original `origin/main` base
  and dispatch a fresh Luna reviewer for spec compliance, money/security
  correctness, retry safety, and test quality.
- [ ] Apply one bounded fix wave for verified findings, re-run affected tests and
  full gates, then dispatch a scoped Luna re-review before handoff.
