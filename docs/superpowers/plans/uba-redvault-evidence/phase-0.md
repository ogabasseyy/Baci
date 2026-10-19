# Phase 0 — Ogabassey UBA REDVAULT contract freeze

**Status:** REMEDIATED_PENDING_PARENT_REVIEW (parent review pending; this document does not claim parent acceptance or unlock a later phase)  
**Phase write scope:** evidence/contract documentation only. No feature code, migrations, installs, commits, or provider calls.  
**Prohibited operations:** none performed (no commit, push, merge, deploy, production access, remote migrations, real payments, emails, or dependency install).

## Workspace and baseline

| Field | Value |
| --- | --- |
| Implementation workspace | `/Users/mac/Baci-app/.worktrees/ogabassey-uba-redvault-phase-0` |
| Isolation | New **detached** git worktree. No feature branch created (handoff: branch creation needs owner authorization). |
| Baseline HEAD | `449e604c434f7a9996e7284acf0dfd6c190f0187` |
| Baseline subject | `fix(mobile-admin): isolate negotiation realtime subscriptions (#3460)` |
| Tracking ref | `origin/main` at inspection time |
| Planning checkout (not used) | `/Users/mac/.codex/worktrees/5ecb/Baci-app` at `d0d1cbd2fd4b5867a980644acf5e29fd7c451c0c` |
| Dirty parent checkout (not used) | `/Users/mac/Baci-app` on `fix/mobile-admin-signup-skip-owner` at `9e9a95acd8…` with unrelated uncommitted work |
| This worktree dirty/untracked | Copied plans + this report only (see files below) |

Concurrent agents own many other `.worktrees/*` and Codex checkouts. This worker did not reset, check out, or write those trees.

**Already implemented?** No. On this baseline there are zero `redvault` / `REDVAULT` / `Pay with UBA` matches in source. Ordinary discounts, negotiation, and Paystack hosted checkout exist and must be reused.

Copied (untracked) planning files in this worktree:

- `docs/superpowers/plans/2026-09-11-ogabassey-uba-redvault.md`
- `docs/superpowers/plans/2026-09-11-ogabassey-uba-redvault-phased-handoff.md`

## Applicable AGENTS.md / constraints

Inspected and binding:

- Repo root `AGENTS.md` / `CLAUDE.md` (pnpm+turbo, Biome, append-only migrations, no `select('*')`, no user-facing service-role expansion, no `proxy.ts` edits without approval, colocated tests, 300-line extract-on-touch).
- `apps/web/CLAUDE.md` (API/auth/Zod, correct Supabase client, CSRF).
- `apps/mobile-storefront/AGENTS.md` (platform-drift allowlist + `pnpm check:platform-drift` if `Platform.OS` branches are added).
- `apps/mobile-admin/AGENTS.md` is **out of scope** for REDVAULT customer checkout (no merchant-facing activation UI).

Temporary service-role exceptions in root AGENTS.md (analytics/cache/GIGL) **do not** authorize REDVAULT. Payment completion already uses `complete_order_gateway_payment` granted to `service_role` only; Phase 3 may call that existing worker path but must not add a new user-facing admin/service-role capability.

Protected files that Phase 1–5 must not edit unless parent explicitly authorizes: `proxy.ts`, `apps/web/src/config/business-types.ts`, existing `supabase/migrations/*`, `.env*`. Phase 0 found **no required `proxy.ts` change** if identity is the server constant `OGABASSEY_MERCHANT_ID`.

## Confirmed product rules (not reopenable)

- Ogabassey-only. Other merchants cannot activate, configure, or invoke it.
- Website, iOS, Android.
- 5% off negotiable product lines only, using `isProductNegotiable` from `packages/shared/src/lib/negotiation-policy.ts`.
- Reuse existing discount records/RPCs; no parallel campaign platform; no budget/reservation engine.
- Card PAN/CVV/PIN/OTP only on Paystack hosted checkout.
- No invented commercial defaults (dates, caps, per-customer limit, stacking, split-pay, refund usage restoration).
- Feature remains **disabled** until commercial + provider release conditions are recorded.

Immutable Ogabassey merchant id already in-tree:

```ts
// apps/web/src/config/ogabassey.ts
OGABASSEY_MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74'
```

Mobile storefront already defaults `Constants.expoConfig.extra.merchantId` to that same UUID (`apps/mobile-storefront/services/orders.ts`).

---

## Existing seams (as-built)

### Eligibility / negotiation

- `packages/shared/src/lib/negotiation-policy.ts` (+ `.test.ts`): token match on Infinix/Tecno/Vivo/Redmi/Xiaomi/Oppo/Itel/Honor; Samsung A-series regex; empty brand+name is negotiable.
- Server applies catalog brand/name via `apps/web/src/lib/checkout/order-negotiation-discount.ts` → `computeEligibleLineDiscount`.
- Line identity for negotiation: `buildTransactionDiscountLineKey` = `[productId, variantId, condition, variantAttributes]` with sorted attribute keys. **Does not** include unit price, VAT category/rate, or tax basis. REDVAULT grouping must add those fields in a **new** helper without changing negotiation keys.

### Discount codes (ordinary)

- Schema: `apps/web/src/schemas/discount-codes.ts`. Create defaults `usage_limit_per_customer` to **1**, `applies_to` to `'all'`. Owner has **not** agreed those defaults for REDVAULT — ordinary create path must not silently configure the partnership record.
- Merchant CRUD: `apps/web/src/app/api/discount-codes/route.ts` (auth + CSRF + marketing permission). Cannot currently persist a partnership flag (column does not exist). Staff RLS direct writes could still mutate `discount_codes` unless Phase 2 adds a trigger.
- UX preflight: `apps/web/src/app/api/discount-codes/validate/route.ts` and storefront validate schema. **Not** the trust boundary.
- Authoritative redemption: `create_storefront_order_with_discount_code` (`supabase/migrations/20260615182724_storefront_discount_code_redemption.sql`).
  - GRANT: `anon, authenticated, service_role`.
  - Locks code `FOR UPDATE`, calls `create_storefront_order`, then on **fresh** orders: window/active, usage + per-customer (`COALESCE(usage_limit_per_customer, 1)`), minimum purchase, eligibility `EXISTS` any matching item, amount vs **full order subtotal** with **whole-naira `round` and ±1 tolerance**.
  - Increments `usage_count` and inserts `discount_code_usage` at **order creation** (unpaid). Unique `(discount_code_id, order_id)`.
  - Replay (`idempotency_replayed`) skips re-count.
- Route wiring: `/api/orders` looks up `get_storefront_discount_code`, computes `computeDiscountAmountForSubtotal` on canonical **product subtotal**, then calls the wrapper. Discount codes and negotiation share `p_discount_amount`; **code wins and suppresses negotiation** (`route.ts` comment ~1680). Stacking REDVAULT with negotiation is therefore an unresolved commercial decision, not “code wins by default”.
- Combination already rejected in the route: discount code + quiz voucher; discount code + savings.

### Order create / guest auth / direct RPC

- Public API: `POST /api/orders` (`apps/web/src/app/api/orders/route.ts`, 3857 lines). Body `merchant_id` is Zod UUID then loaded from `merchants`. **Host is not the trust source today.**
- `payment_method` is a sanitized string, not a closed enum (`apps/web/src/schemas/orders.ts`). Web normalizes `paystack`/`korapay` → persisted `'card'` (`normalizeOrderPaymentMethod`).
- RPC client: `createStorefrontOrderRpcClient` mints a 5-minute scoped JWT with `storefront_order_context=route` and `storefront_order_merchant_id`. Guests omit `sub` so `auth.uid()` is null.
- Insert trigger `private.enforce_storefront_order_route_context` rejects callers without that JWT (or merchant-staff / service_role / narrow quiz/agentic claims). Direct PostgREST `create_storefront_order*` with anon key fails closed **for inserts**, even though EXECUTE is granted to anon.
- Idempotency / “order version”: the ordinary RPC only persists `checkout_idempotency_key` + `checkout_request_hash` when the client supplied an idempotency key. That nullable ordinary-field behavior is **not** usable as a REDVAULT quote identity.
- Tax: server `computeAgenticOrderTax`; RPC `p_tax_basis` hardcoded `'exclusive'`. Gift wrapping and shipping are separate from product subtotal. Discount-code amount is merchandise subtotal only.

### Signed proofs (reuse machinery, new action)

- Signer: `createQuizRpcServerProof` (`apps/web/src/lib/quiz-proof.ts`), HMAC-SHA256, scope `quiz_phase1a`, envelope version `quiz-rpc-proof:v1`.
- Negotiation action: `storefront_transaction_discount`, payload `{ lineDiscounts, nonce, version: 3 }`, `subjectId = merchantId`.
- DB verifier: `public.quiz_route_proof_valid` + trigger `private.sanitize_storefront_transaction_discount_metadata` (latest: `20260830160000_bind_transaction_discount_replay_payload.sql`). Replay table `private.transaction_discount_proof_replay` keyed by proof signature, bound to `order_id`, `merchant_id`, `payload_hash`. Same-order identical-hash replay allowed; mutated payload rejected.
- **Freeze:** do not extend that trigger to accept REDVAULT. Add a sibling verifier that accepts **only** `storefront_redvault_discount` / payload version `1`. Deploy verifier before emitters.

### Payments

- Init: `POST /api/payments/initialize` (`route.ts` 1620 lines). Amount from `get_order_payment_snapshot(order_id, email)` (SECURITY DEFINER, GRANT anon/authenticated/service_role). Client amount is overwritten. Merchant mismatch → 403. Cancelled → 409.
- Snapshot columns today: `merchant_id, total, currency, tracking_token, shipping_status, payment_status, merchant_country`. Missing for REDVAULT: `payment_method`, `discount_code_id`, `checkout_request_hash`, item snapshot. Prefer **additive snapshot columns** over new admin table reads.
- Init **already** uses `createAdminClient()` for extra order/wallet/savings/gateway-setting reads. Phase 3 must not add further user-facing service-role surface; reuse/extend the snapshot RPC and existing transaction insert.
- Paystack init: kobo amount, `channels` currently card/bank/ussd (NG) or card (intl). `PaymentInitData` has `metadata?: Record<string, unknown>` and `channels`, **no** typed bank/card-brand filters yet.
- Persist attempt: `public.transactions` (`id, merchant_id, order_id, amount, currency, status, gateway, gateway_reference, gateway_response, metadata, …`). Status check: pending/processing/completed/failed/cancelled. No `held` status — captured-but-unapproved must keep **order unpaid** and file review (`fileBlockedOrderPaymentReview` / `reconciliation_review`), not invent a new spendable state.
- Verify: `apps/web/src/app/api/payments/verify/route.ts` (CSRF, `verifyTransaction`, then `finalizeOrderGatewayPayment`).
- Webhook: HMAC-SHA512 + `timingSafeEqual` over raw body (`apps/web/src/app/api/payments/webhook/route.ts`). Missing secret / bad signature reject before process.
- Shared finalizer: `finalizeOrderGatewayPayment` → `complete_order_gateway_payment` (service_role only) → inventory → outbox notifications. All paid transitions must hit the REDVAULT gate (webhook, verify, reconciliation/recovery, admin completion).
- Pre-gateway wallet/savings stamp: `recordPreGatewayRedemption` (admin update, best-effort). REDVAULT + wallet/savings/split is **unresolved**; fail closed until decided.

### Web / mobile entrypoints

| Surface | Files |
| --- | --- |
| Ogabassey web checkout | `apps/web/src/components/storefront/ogabassey/pages/checkout-page.tsx`, `…/checkout/types.ts` (`PaymentMethod` union), `…/checkout/pending-checkout-order.ts`, `…/checkout/handlers/place-order.ts`, `…/checkout/components/PaymentStep.tsx` |
| Mobile checkout | `apps/mobile-storefront/components/checkout/*`, `payment-method-selector/types.ts` (`PaymentMethodType`), `checkout-payment-finalization.ts`, `components/payment-gateway/PaymentGatewayCheckoutView.tsx` |
| Mobile order contract | `apps/mobile-storefront/services/orders.ts`, `orders.schemas.ts`, `orders.payload.ts` — `payment_method: z.string().min(1)`; optional `discount_code` |

Hosted session: clients open server-returned Paystack URL; redirects/WebView messages only trigger verify.

---

## Frozen contracts (for later phases)

### Discriminators (server-authoritative)

| Name | Value | Notes |
| --- | --- | --- |
| Checkout choice (client) | `uba_redvault` | New member of web `PaymentMethod` and mobile `PaymentMethodType`. Not proof of entitlement. |
| Persisted `orders.payment_method` | `uba_redvault` | Must **not** normalize to `card` (today `paystack` → `card`). Method switch must drop REDVAULT pricing. |
| Underlying gateway | `paystack` | Initialize `gateway` stays `paystack`; do not add a new gateway enum value. |
| Partnership key | `uba_redvault` | Server constant. Never accepted from client metadata/filters. |
| Proof envelope action | `storefront_redvault_discount` | Separate from `storefront_transaction_discount`. |
| Proof payload version | `1` (number) | Verifier rejects missing/unknown versions. |
| Proof HMAC envelope | existing `quiz-rpc-proof:v1` / scope `quiz_phase1a` | New **action**, not a new HMAC scheme. |
| Rate | 5% of eligible merchandise | `floor((lineSubtotalKobo * 5 + 50) / 100)` overflow-safe integers. |
| Currency | NGN only | REDVAULT initialize refuses non-NGN snapshots. |
| Guest proof `user_id` | literal `'guest'` | Matches the existing negotiation proof caller when `resolvedUserId` is null; it is not an authenticated identity. |
| VAT-rate proof unit | integer basis points | Convert the authoritative product `vat_rate` percentage exactly: `7.5` percent = `750` bp. `vat_category_code !== 'S'` carries `0` bp; category/rate defaults remain the existing `S` / `7.5` percent behavior. |

Client-supplied `channels`, bank codes, card brands, BIN, eligibility flags, brand/name, prices, or discount amounts confer **no** partnership rights.

### Money units and totals

| Quantity | Unit | Source |
| --- | --- | --- |
| `orders.subtotal` / item `price` | NGN major (numeric) | Existing |
| Canonical product subtotal | NGN major | `computeCanonicalOrderSubtotal` |
| REDVAULT line grouping + rounding + proof + refunds | integer **kobo** | `nairaMajor → kobo = round(naira * 100)` for nonnegative finite 2-decimal catalog money |
| Paystack initialize/verify amounts | integer kobo | Existing |
| `orders.discount_amount` / `orders.total` | NGN major | `discountNaira = discountKobo / 100` exact (integer kobo always ÷ 100) |

**Quote fixture (must appear in Phase 1 tests and Phase 2 SQL):**

| Line | Eligible? | Amount |
| --- | --- | --- |
| Negotiable SKU | yes | ₦100,000.00 = 10_000_000 kobo |
| Excluded SKU | no | ₦50,000.00 = 5_000_000 kobo |
| REDVAULT discount | — | 500_000 kobo = ₦5,000.00 |
| Product total before shipping/gift/tax | — | ₦145,000.00 |

Rounding fixtures (kobo): 100_009 → 5_000; 100_010 → 5_001; two identical 100_005 units = one canonical 200_010 → 10_001 regardless of split/reorder.

**Discount base:** canonical eligible line merchandise totals only. Exclude shipping, gift wrapping, assurance/insurance add-ons, and separately itemized VAT. **Do not** change existing exclusive-VAT item tax computation (VAT remains on catalog item prices; REDVAULT is an order-level `discount_amount` like ordinary codes, plus stored line allocations for refunds).

**All-excluded basket:** no 5% advertising, no REDVAULT discount row, no restricted Paystack session. Mixed basket: server summary must say savings apply to eligible items only.

### Checkout / initialize request-response

Reuse current shapes; additive fields only.

**`POST /api/orders`**

- Recognize `payment_method: 'uba_redvault'` (after sanitize).
- If choice is REDVAULT:
  - `merchant_id === OGABASSEY_MERCHANT_ID` (persisted merchant row), else `403` `{ code: 'REDVAULT_MERCHANT_FORBIDDEN', error: string }`.
  - Do not accept/apply a client `discount_code` for this partnership (manual code / copied code → ordinary path or `400 REDVAULT_CODE_NOT_REDEEMABLE`).
  - Do not call `create_storefront_order_with_discount_code` unchanged (it counts usage immediately and discounts full subtotal).
  - Create only the order-first REDVAULT `draft` application; attach the signed proof and transition it to `pending` only through the protected consume operation defined below (usage **not** incremented).
- Response (existing order payload) plus additive `redvault` summary when applicable:

```ts
type RedvaultQuoteSummary = {
  partnership: 'uba_redvault';
  eligible: boolean;
  mixedBasket: boolean;
  productSubtotalKobo: number;
  eligibleSubtotalKobo: number;
  discountKobo: number;
  taxAmountKobo: number;      // existing exclusive VAT, converted
  shippingFeeKobo: number;
  giftWrappingFeeKobo: number;
  payableTotalKobo: number;   // matches orders.total * 100
};
```

Clients **display** this summary; they must not recompute the authoritative discount.

**`POST /api/payments/initialize`**

- Additive optional `payment_choice: z.literal('uba_redvault').optional()`.
- Authority: snapshot `merchant_id === OGABASSEY_MERCHANT_ID` **and** `orders.payment_method === 'uba_redvault'` **and** pending REDVAULT application bound to that order/hash. Ignore client filters.
- `gateway` must be `paystack`. Other gateways / `payment_type: 'dva'` / generic card init → `409 REDVAULT_GATEWAY_REQUIRED` and must not leave the discounted order payable unrestricted.
- Persist/reuse `transactions` row **before** provider call: reference, merchant/order, mandatory `quoteVersionId` + `quotePayloadHash`, amount kobo, currency `NGN`, metadata snapshot `{ partnership, discountKobo, eligibleSubtotalKobo, proofId, requestedRestrictions }`. `checkout_request_hash` may be retained as ordinary retry metadata only.
- Provider payload (server-selected): `channels: ['card']`; Paystack bank code from `/bank` (do not hardcode); `card_brands: ['verve','visa','mastercard']`. Do not set recurring-only flags. Echoed metadata is audit, not enforcement proof.
- Reuse unresolved attempt with same reference on retry. Supersede old attempts on repricing; late success of superseded attempt → captured-held review, not auto-pay replacement.

**Error codes (closed set for new paths):**  
`REDVAULT_DISABLED` (kill switch / missing binding), `REDVAULT_MERCHANT_FORBIDDEN`, `REDVAULT_NOT_ELIGIBLE`, `REDVAULT_GATEWAY_REQUIRED`, `REDVAULT_PROOF_UNAVAILABLE` (503), `REDVAULT_AMOUNT_MISMATCH`, `REDVAULT_CAPTURE_HELD`, `REDVAULT_CODE_NOT_REDEEMABLE`.

### Proof lifecycle and payload v1 (canonical JSON, sorted keys)

`createQuizRpcServerProof({ action: 'storefront_redvault_discount', subjectId: merchantId, userId, payload })`.

**Required order-first lifecycle:** Phase 2's route-authorized REDVAULT order RPC generates an `orders.id` UUID and a distinct server-generated `quoteVersionId` UUID, persists the canonical order, its immutable order-item rows, and a non-null canonical `quotePayloadHash` **before any proof is consumed**. It returns those three persisted identities only to the route. The route then signs the proof over them and invokes a protected consume/attach operation that locks the same order/application and verifies the signature, `orderId`, `quoteVersionId`, `quotePayloadHash`, merchant, customer binding, and persisted item rows. No order can receive REDVAULT pricing or reach payment initialization until that consume succeeds. A retry may consume the same proof only for the same persisted order and identical canonical payload; it must never mint a second quote version or apply the proof to another order.

`checkout_request_hash` may remain ordinary idempotency metadata, but is neither a REDVAULT version identifier nor a substitute for `quoteVersionId` / `quotePayloadHash`; REDVAULT requires all three order/quote bindings even without a client idempotency key.

`userId`: use `resolvedUserId` for an authenticated checkout; otherwise use the exact existing negotiation-proof sentinel, literal `'guest'`. The scoped storefront-order JWT intentionally omits `sub` for a guest, so this sentinel is signed proof provenance rather than a claim of `auth.uid()`. Bind normalized `customerEmail` (lowercased, trimmed) in the payload and validate it against the persisted order; it prevents email swapping but does not upgrade guest authorization.

Required payload fields (reject if any missing):

```ts
type RedvaultProofPayloadV1 = {
  version: 1;
  nonce: string; // UUID
  partnership: 'uba_redvault';
  merchantId: string;
  customerEmail: string;
  orderId: string;                 // persisted orders.id, never nullable
  quoteVersionId: string;          // persisted server UUID, never nullable
  quotePayloadHash: string;        // SHA-256 of canonical server quote, never nullable
  productSubtotalKobo: number;
  eligibleSubtotalKobo: number;
  discountKobo: number;
  taxBasis: 'exclusive';
  groups: Array<{
    productId: string;
    variantId: string | null;
    condition: string | null;
    variantAttributes: Record<string, string>;
    unitPriceKobo: number;
    vatCategoryCode: string | null;
    vatRateBp: number; // integer basis points: product vat_rate percent × 100; 7.5% = 750
    taxInclusive: false;
    lineSubtotalKobo: number;
    discountKobo: number;
    members: Array<{
      orderItemId: string;      // persisted order_items.id UUID
      lineId: number;           // persisted order_items.line_id, the stable order-local ordinal
      quantity: number;
      allocationKobo: number;
    }>;
  }>;
};
```

Nonce replay: new table `private.redvault_discount_proof_replay` (`proof_id` PK = signature, `payload_hash`, `order_id`, `quote_version_id`, `merchant_id`, `consumed_at`). Insert-on-first-consume; only the same order, quote version, and payload hash can replay; otherwise reject. Do not share rows with `transaction_discount_proof_replay`.

### Persistence / lock order / uniqueness

**Kill switch (default off):** `private.uba_redvault_runtime (partnership PK, enabled boolean, updated_at)`. No merchant dashboard toggle. Ops SQL / service_role only. `enabled=false` blocks **new** attempts; reconciliation/refunds continue.

**Partnership binding:** private table `private.uba_redvault_discount_binding (discount_code_id PK → discount_codes, merchant_id CHECK = Ogabassey UUID, partnership CHECK = 'uba_redvault')`. Ordinary `POST/PATCH /api/discount-codes` and `discount_codes` RLS writes cannot insert/update/delete this table. Trigger on `discount_codes`: block identity mutation of a bound row (code/type/value/applies_to) except via explicit ops path. Do not add `applies_to` value that merchants can select.

**Pending application:** `private.uba_redvault_applications`  
`(id, order_id UNIQUE, discount_code_id, merchant_id, quote_version_id UUID NOT NULL UNIQUE, quote_payload_hash TEXT NOT NULL, discount_kobo, eligible_subtotal_kobo, proof_id, status ∈ {draft, pending, approved, held, void}, created_at)`. The order-first RPC creates `draft` with the persisted order/quote identities; protected proof consumption changes it to `pending`. Neither step writes `discount_code_usage` or increments `usage_count`.

**Persisted allocation mapping:** do not rely on JSON-only allocations. Phase 2 must persist one immutable allocation row per original order item/unit (or a lossless quantity range) with `application_id`, `order_item_id` (FK to `order_items.id`), `line_id`, stable `unit_ordinal`, `allocation_kobo`, and the bound product/variant/condition/tax snapshot. The proof's `members` must match these persisted rows exactly. The existing `line_id` is an order-local ordinal (created from input index when absent), and deterministic remainder distribution is ordered by `(line_id, order_item_id, unit_ordinal)`; the UUID is required to prevent an ordinal-only mapping from drifting after an edit.

**Approval uniqueness:** unique `(discount_code_id, order_id)` on completed redemptions (can reuse `discount_code_usage` for the **approved** row only). Second capture for same order → captured-held review, no second increment.

**Lock order (Phase 3 approval RPC, single transaction):**

1. Lock `transactions` attempt row (`FOR UPDATE`).
2. Lock `private.uba_redvault_applications` by `order_id`.
3. Lock `discount_codes` (`FOR UPDATE`).
4. Lock `orders` (`FOR UPDATE`).
5. Verify provider success, env, amount, currency, partnership, attempt not superseded, **and trustworthy REDVAULT eligibility evidence** bound to this persisted attempt. A provider success status, `card` channel, requested bank/brand filter, or echoed metadata alone is never eligibility evidence.
6. If kill switch off for *new* work but application already pending: still allow this completion path.
7. If configured usage/window (only values explicitly stored on the attempt) would be exceeded: status `held`, do not increment usage, do not mark order paid, file review.
8. If eligibility is unknown, missing, contradictory, or not independently verified, set application `held`, retain the capture for review/refund, and do not increment usage or mark the order paid. Only a verified eligibility decision may insert usage (unique), increment once, set application `approved`, then call the existing `complete_order_gateway_payment` order-paid flip.

**Quote validity:** attempt snapshot is immutable. Catalog/policy changes do not reprice an issued attempt. Method change → new unpaid quote without REDVAULT; void pending application.

### Restricted worker permissions

| RPC / path | GRANT |
| --- | --- |
| Existing `create_storefront_order*` | unchanged (route JWT still required for inserts) |
| New REDVAULT order/validation RPC | `authenticated` via storefront-order JWT only (same `storefront_order_context=route` + merchant id). **REVOKE FROM PUBLIC/anon** if the function can apply the partnership without the route JWT; prefer execute only after trigger+JWT check matching current order RPCs. |
| New approve/redeem RPC | `service_role` only (called from existing finalizer graph). |
| Kill switch / binding tables | no anon/authenticated grants; RLS enabled; no policies for `authenticated`. |
| `complete_order_gateway_payment` | remains service_role; extend internally or wrap — do not GRANT to anon. |

### Paystack restriction request (audit fields)

Store on attempt metadata (not as proof):

```ts
{
  channels: ['card'],
  bankCode: string,          // from Paystack bank list lookup for UBA
  cardBrands: ['verve', 'visa', 'mastercard']
}
```

Provider coverage evidence is **out of Phase 0–4 mocks**. The durable approval record must name the reviewed provider/UBA evidence artifact and its verification time, but Phase 0 deliberately does **not** invent Paystack response fields. Supplied BIN prefixes stay documentation-only; do not collect PANs or shorten 8-digit prefixes. Paystack bank/brand filters are requested restrictions and audit data only: they do not prove exact supplied eight-digit issuer-range enforcement. Until provider release evidence establishes a trustworthy eligibility result for the captured attempt, eligibility is `unknown` and the capture stays held.

### Hold / refund / settlement

- Captured-unapproved: transaction may be `completed` (money at Paystack) while `orders.payment_status` stays unpaid/pending and application `held`. Use existing `reconciliation_review`. Do not credit merchant spendable balance.
- Baci cannot block Paystack subaccount settlement after capture; ops refund uses original capture + **stored** allocations (integer division + remainder in persisted unit order). Refund request ≠ customer receipt.
- Usage restoration: **not implemented as a default**; only if a later owner decision says so, with idempotent restoration rows.

---

## File ownership by phase

Extract focused modules when touching files over 300 lines (`orders/route.ts`, `payments/initialize/route.ts`, ogabassey `checkout-page.tsx`, `paystack.ts`).

### Phase 1 (shared calc only)

**May write**

- `packages/shared/src/lib/redvault-eligibility.ts` (+ test) — composes `isProductNegotiable`, no second brand list
- `packages/shared/src/lib/redvault-pricing.ts` (+ test) — grouping, kobo rounding, allocations
- `packages/shared/src/lib/redvault-refund-allocations.ts` (+ test)
- `packages/shared/src/contracts/redvault-quote.ts` (types only) + `packages/shared/src/lib/index.ts` / `contracts/index.ts` re-exports

**Must not write:** API routes, SQL, web/mobile UI, `negotiation-policy.ts` exclusion list, payment handlers.

### Phase 2 (DB + discount persistence)

**May write**

- New append-only `supabase/migrations/YYYYMMDDHHMMSS_uba_redvault_*.sql` and `supabase/migrations/tests/uba_redvault_*.sql`
- `apps/web/src/lib/checkout/create-redvault-discount-proof.ts` (+ test)
- Discount schema/route **guards** (reject partnership assignment)
- `apps/web/src/app/api/orders/route.ts` (REDVAULT pending-application path only)
- Storefront discount validate: bound codes not redeemable as ordinary codes

**Must not write:** Paystack hosted init/UI.

After parent accepts Phase 2, `orders/route.ts` ownership moves to Phase 3.

### Phase 3 (payments)

**Exclusive:** `apps/web/src/app/api/payments/initialize/route.ts`, `apps/web/src/lib/payments/finalize-order-gateway-payment.ts`, webhook/verify/recovery/refund integration, `apps/web/src/lib/paystack.ts` typed init filters. Further SQL returns through the database review gate.

### Phase 4A web (after Phase 3)

Ogabassey website checkout components/hooks/tests only under `apps/web/src/components/storefront/ogabassey/`. No `packages/shared`, no APIs, no migrations.

### Phase 4B mobile (after Phase 3)

`apps/mobile-storefront` checkout/payment-gateway + `services/orders*.ts` / schemas / payload builders / tests. No shared package, no backend, no lockfile races with 4A (serialize if the tool cannot isolate `pnpm-lock.yaml`).

### Phase 5

Tests/evidence only unless parent assigns a fix-forward.

---

## Test requirements and commands

Do not use real cards or live Paystack. Fixtures must set explicit commercial values (never rely on create-schema defaults).

| Phase | Focused tests | Command |
| --- | --- | --- |
| 1 | Shared eligibility, mixed/all-excluded, rounding, grouping, refund remainder, forged client fields ignored | `pnpm --filter @baci/shared test -- src/lib/redvault-eligibility.test.ts src/lib/redvault-pricing.test.ts src/lib/redvault-refund-allocations.test.ts` plus existing `src/lib/negotiation-policy.test.ts` (ordinary behavior unchanged) |
| 1 quality | lint/typecheck for shared | `pnpm --filter @baci/shared typecheck` and repo `pnpm turbo lint` / `pnpm turbo typecheck` on touched packages |
| 2 | Direct-RPC forgery, cross-merchant, proof substitution/replay, ₦100k+₦50k accepts ₦5k / rejects ₦7.5k, usage not incremented on unpaid, ordinary discount ±1 path unchanged | New SQL under `supabase/migrations/tests/` executed against a **disposable local** Postgres (pattern: `supabase/tests/run-paystack-reference-claim-concurrency-test.sh`). Vitest for proof helpers and discount API guards |
| 3 | Mocked initialize restrictions, bypass attempts, webhook signature, amount/currency/channel mismatch, superseded late capture, duplicate redemption, held-on-limit | `pnpm --filter web test --` targeted `payments/initialize`, `payments/webhook`, `finalize-order-gateway-payment`, new redvault modules |
| 4A | Pay with UBA render, mixed-basket copy, method switch requotes, hosted redirect, pending/cancel | `pnpm --filter web test --` ogabassey checkout files |
| 4B | Same behavior iOS/Android via shared components; platform-drift if needed | `pnpm --filter baci-mobile-storefront test` and `pnpm --filter baci-mobile-storefront check:platform-drift` if platform branches change |
| 5 | Full matrix + `pnpm turbo lint && pnpm turbo typecheck && pnpm turbo test` + `coderabbit review --agent -t uncommitted` | Distinguish pre-existing failures |

SQL tests are **required evidence** for Phase 2; if local DB is unavailable, Phase 2 must be `BLOCKED` for database behavior (not “passed via TypeScript mocks”).

---

## Local tooling inspection (no installs, no services started)

| Tool | Result |
| --- | --- |
| Node | v24.11.1 |
| pnpm | 11.7.0 |
| Supabase CLI | `/opt/homebrew/bin/supabase` present |
| This worktree `node_modules` | **Absent** (fresh worktree). Parent `/Users/mac/Baci-app/node_modules` exists but must not be assumed; Phase 0 did not run `pnpm install` |
| Vitest binary on PATH | not found in this worktree |
| Docker / Colima | daemon **not running** (`Cannot connect to the Docker daemon at unix:///Users/mac/.colima/default/docker.sock`) |
| `pg_isready` | `/tmp:5432 - no response` |
| Local Supabase | `supabase status` failed (no Docker) |

Implication: Phase 1 unit tests need `pnpm install` in this worktree **when implementation is authorized**. Phase 2 SQL cannot be executed here until Docker/local Postgres is available. That is a recorded environment gap, not a contract defect.

---

## Unresolved decisions (must stay unresolved — no production defaults)

1. Campaign `starts_at` / `expires_at` (or explicit absence).
2. Minimum spend / `maximum_discount_amount` / global `usage_limit` / `usage_limit_per_customer` (create-schema default `1` is **not** inherited).
3. Stacking with negotiated prices (today ordinary codes **replace** negotiation discount).
4. Stacking with other discount codes.
5. Wallet, savings, split-payment, BNPL, pay-on-delivery, DVA/bank transfer, PayPal, crypto, invoice, pay-for-me.
6. Funding/fees (who bears Paystack + platform fee on discounted amount).
7. Refund usage restoration.
8. Operations owner for captured-held reviews.
9. Paystack UBA bank code at runtime (must be fetched; not guessed in this freeze).
10. Whether Paystack metadata filters actually enforce issuer ranges (documented bank/brand filters ≠ 8-digit BIN coverage). Escalate to Paystack if tests show a gap; do not reopen UBA journey approval.

Kill-switch **mechanism** is specified (private runtime row, default disabled). Turning it on in production is a release condition, not a Phase 1–4 default.

---

## Known blockers for later phases

- Feature is correctly **not** in the codebase yet.
- No local DB in this worktree environment.
- No `node_modules` in this worktree.
- `POST /api/orders` currently trusts body `merchant_id` after table lookup, not host. REDVAULT gate must additionally require `OGABASSEY_MERCHANT_ID` on the **persisted** order/merchant row. Host matching is optional defense-in-depth for **showing** the payment choice, not a substitute.
- Ordinary discount RPC is unsafe for REDVAULT (full-subtotal ±1 naira, usage at create, anon EXECUTE). New path required.
- `PaymentInitData` cannot yet express bank/brand filters without a Phase 3 type extension.
- Oversized collision files: `orders/route.ts`, `payments/initialize/route.ts`.

## Phase 0 changed files

- `docs/superpowers/plans/uba-redvault-evidence/phase-0.md` (this report)

No feature implementation. Phase 1 remains locked pending parent review.
