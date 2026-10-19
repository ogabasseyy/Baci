# Shared-code consolidation audit (Step 1)

Date: 2026-10-19. Base: `main` at `390da149c3` (post-#3693). Consumer counts below were re-run with the stated pipeline against merge head `0bbde3fd68` and are unchanged (459/147/121).
Scope per the amended consolidation plan: only domains where at least
two apps hold same-concept modules. Method: side-by-side reading of
representative module pairs plus symbol/format inventories. `knip`
output was used only as a supporting signal. No code was moved.

## Consumers and existing shared surface

`@baci/shared` (`packages/shared`, ~265 source files / ~23k lines) is
consumed by all three apps. Consumer counts below are the direct
output of the stated command (files whose text contains an
`@baci/shared` import/require/dynamic-import pattern, `.test.`
paths excluded by the pipeline — no further semantic filtering is
claimed):
`apps/web/src` 459, `apps/mobile-storefront` 147,
`apps/mobile-admin` 121. One contract caveat: the shared package's own Zod peer range is `^3.0.0 || ^4.0.0` (dev dependency `^4.4.3`), so Zod-4-only APIs such as `z.iso.datetime` cannot move into `@baci/shared` until the wallet wave either narrows that peer range or records a compatibility decision. Note the package already uses the same Zod-4-only API in-tree (`z.iso.datetime({ offset: true })` in `packages/shared/src/contracts/piggyvest-device-change.ts:5`), so the de-facto floor is already Zod 4 — the decision is to record that floor, not to migrate code. Reproduce exactly (one command per base):
`grep -rlE "(from[[:space:]]+['\"]@baci/shared|require\(['\"]@baci/shared|import\(['\"]@baci/shared)" --include="*.ts" --include="*.tsx" --exclude-dir=node_modules <base> | grep -v '\.test\.' | wc -l`
with `<base>` = `apps/web/src`, `apps/mobile-storefront`,
`apps/mobile-admin` respectively; other precise
counts in this doc are from the same session's `find`/`wc`/`grep`
pass on this base and should be treated as ±1 file at file
boundaries (tests vs fixtures classification). Bases differ
because the web app keeps nearly all TypeScript under
`apps/web/src`, while both mobile apps keep substantial TypeScript
at the app root (`lib/`, `components/`, `schemas/`, `hooks/`), so
mobile counts cover the app tree excluding `node_modules`.
Uniform
Zod `^4.4.3`; Metro maps the package in both mobile apps; Next.js
consumes it directly. Per-domain subpath exports already exist
(`./cart`, `./schemas`, `./contracts`, …). The pattern is proven; the
work below extends it.

## Inventory (grouped by theme; execution order is the Recommended sequence below, not row number)

| # | Domain | Evidence (side-by-side) | Consumers | Verdict |
|---|--------|-------------------------|-----------|---------|
| 1 | Currency/price formatting | `formatPrice` is independently defined at least 7 times with *divergent* semantics: mobile-storefront hardcodes an NGN formatter (`types/product.ts:182`), mobile-admin delegates to merchant-locale formatting (`components/orders-screen/format-price.ts`), web is country-aware with a formatter cache (`lib/currency-utils.ts:213`). `formatCurrency` has 4+ separate definitions (web `lib/currency.ts`, `lib/utils.ts`, mobile-admin `utils/format.ts`, …) across 133 call sites. `packages/shared` has no general-purpose formatting module — but it does have a receipt-scoped one, `packages/shared/src/receipt/receipt-money.ts` (`createMoneyFormatter`, Intl cache, currency-locale map); the formatting wave must evaluate extending/extracting that implementation first rather than creating a second competing formatter/cache in the same package. Date formatting is **out of scope** for this wave: it carries separate decisions (timezone source, `date-fns` dependency on mobile-admin vs `Intl.DateTimeFormat`) and gets its own evidenced audit later. | web, storefront, admin | **Share (formatting wave; sequence step 2, after the wallet wave).** Off the cart activation path. Requires one semantic decision (locale/currency source of truth) before moving; then one `Intl`-based implementation in shared with per-app thin wrappers preserving call-site signatures. Characterization fixtures must pin current outputs per app first — outputs differ today, so this wave intentionally unifies behavior where divergence is accidental, and records any intentional difference as an explicit option. |
| 2 | Cart pure logic (remainder) | Already largely consolidated: web `lib/cart/merge.ts` is a 6-line re-export of `@baci/shared/cart` (207-line merge, 222-line types, commands, line-identity). Remaining duplication is presentational: web `lib/cart/pricing.ts` (150 lines, server snapshot building — server-canonical, stays) vs mobile `lib/cart-pricing.ts` (88 lines of shareable pricing math: base/negotiated/effective price, catalog subtotal) and `lib/cart/display.ts` (117 lines that are a native input/hydration adapter — `nativeCartInput`, `hydrateNativeCart` — which stays local). | web, storefront | **Share the pricing math (`lib/cart-pricing.ts`) only, post-activation** (plan gate); the display/hydration adapter stays local, and server pricing stays web-only by design. |
| 3 | Schemas | Web `src/schemas` is 446 files / ~25k lines, overwhelmingly server API input schemas with no mobile consumer — not duplication. Real overlap is narrow: `apps/mobile-storefront/schemas` holds 39 non-test source files (~2.2k lines; 79 files including tests), of which 7 are cart-related (`cart*.ts`: pairing/session/snapshot/pending-request parsing of the same payloads whose types already live in `@baci/shared/cart`). | web, storefront | **Share the cart-payload schemas post-activation;** the rest of web schemas are server-canonical and stay. Most of the apparent schema mass is a false positive. |
| 4 | Product transform/hydration | Mobile `hooks/product-utils.ts` / `product-transform` vs web `lib/normalize-product.ts` and PDP normalizers shape the same product rows differently per surface (display vs indexing). Partially same concept, partially surface-specific. | web, storefront | **Defer.** Extract only the shared row-shaping primitives if a future product change touches both; full unification would force surface compromises. Re-audit after the formatting wave. |
| 5 | Auth session handling | Web `lib/auth` (6 files / 573 lines, server session) vs mobile `lib/auth` (5 files / 661 lines, device session storage) share vocabulary, not logic: different trust models and storage. **Exception:** both native apps run near-identical `registerAuthRefreshLifecycle` copies (`lib/auth/auth-refresh-lifecycle.ts` in storefront and admin, invoked from each `lib/supabase.ts`) implementing the same AppState start/stop, singleton, and cleanup protocol. | web, storefront, admin | **Keep web/mobile session models platform-specific.** The native refresh-lifecycle exception is inventoried once as row 16 (not double-counted here), with per-app Supabase client wiring local. |
| 6 | Checkout payload shapes | Web holds the server side (`lib/checkout`, 62 files / ~4.9k lines; `src/schemas/orders.ts` 452 lines), **but mobile does reimplement payload construction**: `apps/mobile-storefront/components/checkout/checkout-order-builders.ts` (225 lines) builds the customer/item/total/payment/shipping/discount/shared-cart request, and `services/orders.ts` validates its own `CreateOrderRequestSchema` before POSTing to `/api/orders`. The transport shape is therefore implemented twice. | web, storefront | **Share the transport subshape post-activation** (it is on the cart activation path via the shared-cart fields): one shared order-request schema/types in `@baci/shared`; server validation rules and adapter-specific fields stay local. Server remains canonical for pricing/trust. |
| 7 | Exported-symbol overlap (whole lib) | Only ~20 exported names are shared between web and mobile `lib` trees (`calculateOrderTotals`, `normalizeVariantAttributes`, `getPrimaryProductImage`, `hexToRgba`, …). Duplication is concentrated, not diffuse. | all | Confirms the ranked waves cover most real overlap; a whole-monorepo sweep is not warranted. |
| 8 | VTU pending-reference idempotency core | Same platform-free protocol implemented twice: web `components/storefront/ogabassey/components/utility-pending-vtu-reference-queries.ts` (+ `utility-pending-vtu-reference-registry.ts`, consumed by `utility-pending-idempotency.ts`) and mobile `lib/pending-vtu-reference-queries.ts` (consumed by `lib/pending-vtu-idempotency.ts`) implement the same reference, stale-success, and completion logic, with mirrored persistence/mint-lock registries guarding against double-debit on retry. | web, storefront | **Deferred shared-core candidate (high risk).** Extract the pure reference/completion logic to shared with storage adapters kept local, in its own wave with characterization fixtures first — a duplicated money-movement protocol must not drift. Not in Waves 1–3, but explicitly tracked, not omitted. |
| 9 | Wallet-funding response contract | The order wallet-funding response schema exists on both sides and has already diverged: web `src/schemas/order-wallet-funding-intent.ts:62` accepts PostgREST `+00:00` timestamps via `z.iso.datetime({ offset: true })`, while mobile `schemas/order-wallet-funding-intent.ts:27` uses bare `z.iso.datetime()` for create/poll responses. | web, storefront | **Share the response contract** (own wave, can precede cart waves): one shared response schema in `@baci/shared`; server-only request/auth schemas stay local. The offset divergence should be treated as a latent mobile parsing bug and verified against live PostgREST payloads during that wave. |
| 10 | Mobile update policy core | Both mobile apps implement the same `MobileReleasePolicy`/`resolveMobileUpdatePrompt` flow in `components/updates/mobile-update-check.ts` (storefront and admin), and have already diverged: when a required policy lacks `storeUrl`, admin fails open while storefront creates an unusable blocking prompt. | storefront, admin | **Share the pure policy core** in its own wave: policy fetching stays local; gating/decision logic moves to shared with app-specific route/app-name/OTA adapters. The `storeUrl` divergence needs an explicit decision recorded with its threat model: fail-open lets a forced-update policy be bypassed when its store link is missing (integrity risk), fail-closed strands users on a dead prompt (availability risk). Neither is asserted here; the wave picks one with the rejected alternative documented. |
| 11 | Sanitization primitives | `apps/web/src/lib/sanitize-core.ts` and `apps/mobile-admin/lib/sanitize.ts` implement the same `stripHtmlTags`, `sanitizeText`, `sanitizeEmail`, `sanitizePhone`, `sanitizeSearchQuery` transformations feeding order schemas and admin requests; independent edits can make accepted input differ by surface. A shared primitive already exists for one piece — `packages/shared/src/lib/sanitize-html-text.ts` — so the wave extends that home rather than starting a new one. | web, admin | **Share the primitives** in a small wave with characterization fixtures, building on the existing shared `sanitize-html-text`; schema-level rules stay local. |
| 12 | Business-type catalog | `apps/mobile-admin/constants/business-types.ts` duplicates the eight id/label pairs from the declared source of truth `apps/web/src/config/business-types.ts` and independently adds `other`; category changes can leave the native selector stale. Note the type domains differ: web's `BusinessTypeId` is declared as `keyof typeof BUSINESS_TYPES`, but `BUSINESS_TYPES` is typed `Record<string, BusinessTypeConfig>`, so the alias actually resolves to `string` — no closed union exists today. A shared contract must build a real union from the **id values**, not reuse the alias. | web, admin | **Share the data contract** built from id values (ids/labels/union) or generate the mobile projection from the web source; web-only templates/icons stay local. Resolve whether `other` belongs in the source of truth during that wave. **Approval gate:** `apps/web/src/config/business-types.ts` is a protected file (CLAUDE.md/AGENTS.md); touching or building on it requires explicit approval recorded in that wave's PR. |
| 13 | Wallet top-up limits | Identical `WALLET_TOP_UP_MIN_AMOUNT` (100) / `WALLET_TOP_UP_MAX_AMOUNT` (500_000) constants duplicated in `apps/web/src/lib/wallet-top-up-constants.ts` (server Zod validation; comment says "must match mobile validation") and `apps/mobile-storefront/lib/wallet-top-up-constants.ts` (UI disable + input validation; comment says "must match server validation"). Changing one side silently makes accepted amounts disagree by surface. | web, storefront | **Share the constants** — a trivial move into `@baci/shared` that can ride with the wallet-funding wave (sequence step 1). |
| 14 | IMEI payment-recovery protocol | Near-verbatim `resolveImeiCheckFailure` implementations in `apps/web/src/components/storefront/ogabassey/pages/imei-checker-resolve-failure.ts` (used by `imei-checker-request.ts`) and `apps/mobile-storefront/components/imei-check/resolve-imei-check-failure.ts`, plus a matching pending-lookup persistence contract, decide whether paid IMEI retries retain or discard an idempotency key for debit/refund-uncertain results (`REFUND_PENDING`, `DEBIT_FAILURE_STATE_SAVE_FAILED`). An independent edit can make one client retry with a fresh key (double-debit risk) while the other preserves it. | web, storefront | **Deferred shared-core candidate (money-safety).** Same treatment as row 8: extract the failure-classification core to shared with persistence adapters local, characterization fixtures first. |
| 15 | Merchant-country catalog | The shared/web `MERCHANT_COUNTRIES` catalog (`packages/shared/src/constants/merchant-countries.ts`) is duplicated by mobile-admin's local `COUNTRIES` (`apps/mobile-admin/constants/countries.ts`), which adds unsupported entries (e.g. Zambia `ZM`/`ZMW`) that the admin settings screen persists via a changed-only column payload (`apps/mobile-admin/components/store-settings/store-settings-payload.ts`, saved through `hooks/useStoreSettingsSaveLifecycle.ts`) with no supported-catalog validation on that path — producing merchant country/currency states web onboarding and provisioning do not support. | web (via shared), admin | **Split the catalog by consumer before changing anything:** the local `COUNTRIES` also feeds phone-country calling codes (`lib/phone-country.ts`), the supported-currency fallback (`lib/merchant-currency.ts`), and currency formatting — those keep the wide catalog. Only the merchant-settings selector gets a projection gated to the shared 22-entry `MERCHANT_COUNTRIES`. Merchants who already persisted unsupported values (e.g. ZM) need an explicit repair/backfill decision before gating, not a silent selector change. |
| 16 | Native auth refresh lifecycle | Near-duplicate `registerAuthRefreshLifecycle` in both mobile apps' `lib/auth/auth-refresh-lifecycle.ts`: same AppState-driven start/stop, singleton guard, and cleanup; lifecycle fixes can drift between native clients. | storefront, admin | **Share the lifecycle core** in a small wave; Supabase client construction and storage stay per-app. |
| 17 | Native ATT wrapper | Identical 72-line lazy `expo-tracking-transparency` loaders in `apps/mobile-storefront/lib/tracking-transparency.ts` and `apps/mobile-admin/lib/tracking-transparency.ts`: same iOS gate and unavailable/error fallbacks, differing only in the platform predicate. | storefront, admin | **Share the wrapper/core** with the platform predicate injected; consent copy stays per-app. |
| 18 | Saved-address normalization | Exact small duplicate: `normalizeSavedAddresses` (only saved address becomes default) in `apps/web/src/lib/saved-addresses.ts` and `apps/mobile-storefront/lib/saved-addresses.ts` (19 lines each), feeding web address pages and mobile address/checkout flows. | web, storefront | **Share the primitive** in its own small wave (tracked candidates, sequence step 5); trivial enough to ride along opportunistically only if an early wave already touches the same files. |

## Sampled out (explicit)

- `apps/web/src/lib` admin/analytics/AI-storefront subtrees: web-only
  surfaces with no mobile counterpart.
- `packages/shared/src/contracts` (174 files) and `receipt`: already
  shared; no action.
- Mobile-admin order-screen formatters beyond price: admin-only
  presentation, covered by the formatting wave's shared primitives if
  adopted there. Date formatting is excluded from that wave and from
  this note; it awaits its own evidenced audit.

## Definitions

**Activation gate** (used for post-activation sequencing below):
the cart pilot activation is complete only when **every** item in
this checklist is done, in this order:

1. The 81 registered cart migrations have applied to production.
2. The final privilege state is verified (anon cannot execute
   preview/replay RPCs).
3. The pre-enrollment telemetry/quota gates in the rollout doc are
   closed: `x-handoff-token` redaction verified like `Authorization`
   in proxy/APM/error reporting; database/APM logging proven not to
   persist pairing-token RPC arguments; compatible server adapters
   deployed; cart roles/signing material provisioned including a
   deployment-unique `CART_PROOF_ENVIRONMENT`; an operator alert on
   the `Cart quota store degraded` warning, with the per-instance
   budget multiplication during Redis degradation explicitly
   accepted for the pilot; outbox publisher qualification during the
   authorized release; and the rollout's dashboards/observability in
   place. (This incorporates the rollout doc's pre-enrollment gates;
   if that doc adds gates, they are included by reference.)
4. The terminal purge has been explicitly scheduled per rollout
   step 4. The earlier "no purge job in `cron.job`" check is an
   interim pre-enrollment verification, not the completion state;
   scheduling precedes enrollment.
5. The pilot merchant is enrolled.
6. The acceptance matrix in `docs/qa/shared-cart-acceptance.md`
   passes.

All six are conjunctive completion criteria, per
`docs/deploy/shared-cart-rollout.md`. The rollout's *expansion*
criteria (second merchant, deployed convergence/checkout-binding/
isolation evidence) gate merchant expansion, not these code
consolidation waves, which enroll nobody; waves still merge only on
green CI and change no activation state.

## Recommended sequence

1. **Wallet-funding contract (rows 9, 13) — first, ahead of
   formatting:** the mobile `z.iso.datetime()` offset divergence is
   a present-tense payment-path bug, not future drift, so this wave
   leads. Share the intent/poll subshape **and** a canonical *order-funding-scoped* account subshape derived from the single server response builder (`wallet-order-funding-intent-response.ts` emits exactly `accountName/accountNumber/bankName/provider` from `result.account`): both clients parse the same order-funding endpoint payload, so for that endpoint the client schemas' divergence (web: nullable names, 120-char caps, `paystack` only; storefront: required names, 200-char caps, `paystack` + `piggyvest`) is drift to align to the server's actual emission, not a legitimate per-app contract. Scope limit: the mobile `WalletFundingAccountSchema` is also reused by the piggyvest primary-wallet snapshot (`piggyvest-primary-wallet.ts` extends it with `provider: z.literal('piggyvest')`, and its 200-char caps mirror the server snapshot schema in `apps/web/src/schemas/piggyvest-primary-wallet-snapshot.ts`) — that is a different payload with its own legitimate contract, so the piggyvest snapshot schema stays distinct (or a separate extension) and is not aligned to the order-funding builder. A third consumer must also be preserved: `WalletFundingAccountResponseSchema` (same schema file) parses the standalone legacy `/wallet/funding-account` GET/POST responses via `lib/wallet-funding-account.ts`, which is outside this wave — so the wave splits out an order-intent-specific account schema, or explicitly includes and characterizes the legacy funding-account response before altering the shared base. The wave adds a characterization fixture for each of the three account payloads (order-funding, piggyvest snapshot, standalone funding-account) before any unification. The wave verifies the subshape against live PostgREST payloads before adopting it; the wave must also align the create-failure
   protocol — the failure classifier is
   `apps/mobile-storefront/lib/checkout/wallet-funded-bank-transfer.ts`
   (every non-consent error invokes `onFallback`), and
   `components/checkout/checkout-payment-finalization.ts` is only
   the fall-through site that then starts gateway payment, risking a
   double-funding path after timeout/5xx where an intent may
   already exist: the fallback is not a generic gateway charge but
   the legacy Paystack DVA bank-transfer flow
   (`checkout-payment-initialize.ts` initializes a `dva` payment
   and routes to the standard bank-transfer screen), so a customer
   can end up funding the same order twice — once into the created
   wallet intent and once into the legacy DVA. Failure classification (consent vs transient vs
   unknown-after-POST) is part of the shared contract.
   Unknown-after-POST cannot poll by intent ID (a lost create
   response means no ID was received, and no order-scoped lookup
   endpoint exists today) — but it does not need one: the server
   create path is already order-keyed
   (`apps/web/src/lib/order-wallet-funding-intents.ts`
   `findActiveOrderIntent` returns the existing active intent for
   the order before inserting), so the correct client behavior is
   an idempotent re-create for the same order — sequenced *after*
   the mobile parser fix (a re-create returns the same intent, and
   an unfixed parser would just fail on its `+00:00` `expiresAt`
   again), bounded to a small retry count with backoff.
   **Unknown-after-POST is terminal for fallback:** if the bounded
   re-creates still cannot confirm the intent (or obtain the
   server-verifiable no-intent proof above), the flow must stop
   in a resumable pending/recovery state for that order — it must
   never fall through to the legacy DVA fallback, which is exactly
   the double-funding path this wave removes. Only a confirmed
   create failure with no possible intent may proceed to fallback.
   The wave must implement this explicit classification (server
   error code on a *received* response is the classifier input;
   `getWalletFundingErrorDetails` in
   `wallet-funded-bank-transfer.ts` is the current extraction
   point):

   | Class | Examples | Behavior |
   |---|---|---|
   | Consent required | `WALLET_DVA_CONSENT_REQUIRED` | Require a **real affirmative consent action** before provisioning: the current `requestWalletFundingAccountConsent()` in `components/checkout/checkout-wallet-funded-bank-transfer.ts` is a stub returning `Promise.resolve(true)`, so the wave must add an actual consent prompt. Only an affirmative action posts `consent: true`, creates the funding account (`createWalletFundingAccount`), and retries intent create once; cancellation leaves the account unprovisioned and does not retry. |
   | Confirmed no-intent (safe to fall back) | **Server-verifiable no-intent for the order** — not a client-side attempt count, and not an early intent return. Today this proof is *not obtainable*: settings, eligibility, and account resolution in `createOrderWalletFundingIntent` all run (and can return fallback codes) *before* `findActiveOrderIntent`, and no order-scoped lookup endpoint exists, so no received code — on a first attempt or a retry — proves no intent exists. The wallet wave therefore includes a server change as an explicit deliverable, with a **proof-only design**: the lookup attaches a `noActiveIntent` proof to the fallback result (or an order-scoped lookup endpoint returns that proof), scoped to the resolved `customerId` and `merchantId` — the current `findActiveOrderIntent({ orderId })` filters only `order_id` (`order-wallet-funding-intent-repository.ts:139-147`) and must not be reused unchanged for this, or a shopper could recover another merchant's intent by submitting its order ID. Settings, eligibility, and account checks still run before any intent is returned (the response builder needs `result.account`, which exists only after account resolution), and the pinned tests in `order-wallet-funding-intents.test.ts` ('does not reuse an active intent when the order is no longer payable' / 'already has wallet redemption', asserting `findActiveOrderIntent` is not called before eligibility) must remain green. Only a proof-carrying rejection with a fallback-eligible code qualifies — eligibility keys on the code plus the proof, never on HTTP status class, since `WALLET_DVA_SETUP_FAILED` is emitted as HTTP 502 (see `getFallbackStatus` in the response builder). **Fallback-eligible codes:** `WALLET_DVA_DISABLED`, `WALLET_ORDER_AUTO_DEBIT_DISABLED`, `WALLET_DVA_SETUP_FAILED`. Every other confirmed code is terminal or wallet-only, never DVA: `ORDER_NOT_FOUND` and `ORDER_NOT_PAYABLE` are terminal; `ORDER_ALREADY_HAS_WALLET_REDEMPTION` and `WALLET_BALANCE_COVERS_ORDER` are wallet-only; `CUSTOMER_NAME_REQUIRED` and `CUSTOMER_PHONE_REQUIRED` stop for profile completion, then retry the intent create. | Legacy DVA fallback allowed only with server-verifiable no-intent **and** a fallback-eligible code |
   | Unknown-after-POST | Transport failure, timeout, or any failure with **no received response** after the mutating POST (a received 5xx is classified by its server code first, per the row above) | Bounded idempotent re-create; on exhaustion, resumable pending state — **never** DVA |
   | Unparseable received response | Response received but fails schema parsing | Treat as unknown-after-POST (an intent may exist); re-create to fetch the canonical intent |
   | Unenumerated received code (default) | Any server code not enumerated above | **Fail closed:** treat as unknown-after-POST; never fall back on an unclassified code |

   For concurrent-insert safety only, no server change is needed:
   the insert path's RPC
   (`create_order_wallet_funding_intent_for_customer`,
   `supabase/migrations/20260526233646_order_wallet_funding_intents.sql`)
   locks the order row `FOR UPDATE` before re-checking for an
   existing active intent, so a second concurrent create waits and
   returns the first intent. That concurrency proof does **not**
   supply the no-intent proof above, so the proof-only no-intent
   lookup (scoped to the resolved customer and merchant) remains an
   explicit server deliverable of this wave. The wave's full scope
   is therefore: that server change, the prerequisite Zod
   peer-range decision above, the shared subshape, and the client
   behavior (re-create instead of the legacy DVA fallback).
2. **Formatting wave: currency/price formatting.** One shared `Intl`
   formatting module, characterization fixtures pinning each app's
   current outputs, semantic unification decision recorded in the
   wave PR (NGN-only vs merchant-locale vs country-aware per call
   class). All three apps adopt via thin wrappers.
3. **Guardrails alongside the formatting wave:** contributor rule (pure logic with
   ≥2 consumers that is platform-free lands in `packages/shared`
   first) and the decision rule (≥2 consumers, platform-free, ≤~400
   changed lines per PR) recorded in `packages/shared/README` or
   repo guidance.
4. **Post-activation (per the gate defined above):** cart pricing
   math, then cart-payload schemas, then the checkout transport
   subshape (row 6).
5. **Tracked candidates, own waves when scheduled:** VTU
   pending-reference core (row 8), mobile update policy core
   (row 10), sanitization primitives (row 11), business-type catalog
   (row 12), IMEI recovery protocol (row 14), merchant-country
   catalog (row 15), native auth refresh lifecycle (row 16),
   ATT wrapper (row 17), saved-address normalization (row 18).
6. Re-audit after each wave; deferred domains (product, auth) are
   revisited only when a change touches both sides.

## Decision-rule check for the formatting wave

≥2 consumers: yes (3). Platform-free: mostly — `Intl` exists in
Next.js, Hermes, and Node, but Node-run fixtures cannot pin Hermes
locale/currency output; the repo already acknowledges runtimes
without full Intl data (see the `Intl.NumberFormat` try/catch
fallback in `formatCurrencyCompactNotation`,
`apps/mobile-admin/lib/utils.ts:177-215`, currency formatting only — no date fallback is claimed or needed
for this currency-only wave). The formatting wave must therefore
add an on-device/Hermes verification (or a verified locale/currency
allowlist) before relying on fixture parity. Size: one shared module
plus wrapper swaps. Size is an estimate to confirm at wave start
(shared module ~150 lines + fixtures ~100 + three thin wrappers);
if the wrapper swaps push the PR over the ~400-line decision-rule
budget, split by app (shared module + one app per PR).
