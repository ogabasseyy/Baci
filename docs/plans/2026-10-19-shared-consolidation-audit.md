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
pass on base `390da149c3` (not re-measured on `0bbde3fd68`; only
the consumer counts above were re-run there) and should be treated
as ±1 file at file boundaries (tests vs fixtures classification).
The sequencing argument rests on the qualitative duplication
evidence in each row, not on exact counts. Bases differ
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
| 5 | Auth session handling | Per-app evidence: web `lib/auth` (6 files / 573 lines, server session); mobile-storefront `lib/auth` (5 non-test files / 661 lines, device session storage — the sampled mobile tree); mobile-admin `lib/auth` is a materially larger, different tree (13 non-test files including `auth-state-controller`, `sign-in-with-apple`/`sign-in-with-google`, password signup/OTP lifecycle, and breach check) and was **not** sampled file-by-file here. The three share vocabulary, not logic: different trust models and storage. **Exception:** both native apps run near-identical `registerAuthRefreshLifecycle` copies (`lib/auth/auth-refresh-lifecycle.ts` in storefront and admin, invoked from each `lib/supabase.ts`) implementing the same AppState start/stop, singleton, and cleanup protocol. | web, storefront, admin | **Keep web/mobile session models platform-specific.** The native refresh-lifecycle exception is inventoried once as row 16 (not double-counted here), with per-app Supabase client wiring local. |
| 6 | Checkout payload shapes | Web holds the server side (`lib/checkout`, 62 files / ~4.9k lines; `src/schemas/orders.ts` 452 lines), **but mobile does reimplement payload construction**: `apps/mobile-storefront/components/checkout/checkout-order-builders.ts` (225 lines) builds the customer/item/total/payment/shipping/discount/shared-cart request, and `services/orders.ts` validates its own `CreateOrderRequestSchema` before POSTing to `/api/orders`. The transport shape is therefore implemented twice. | web, storefront | **Share the transport subshape post-activation** (it is on the cart activation path via the shared-cart fields): one shared order-request schema/types in `@baci/shared`; server validation rules and adapter-specific fields stay local. Server remains canonical for pricing/trust. |
| 7 | Exported-symbol overlap (whole lib) | Only ~20 exported names are shared between web and mobile `lib` trees (`calculateOrderTotals`, `normalizeVariantAttributes`, `getPrimaryProductImage`, `hexToRgba`, …). Duplication is concentrated, not diffuse. | all | Confirms the ranked waves cover most real overlap; a whole-monorepo sweep is not warranted. |
| 8 | VTU pending-reference idempotency core | Same platform-free protocol implemented twice: web `components/storefront/ogabassey/components/utility-pending-vtu-reference-queries.ts` (+ `utility-pending-vtu-reference-registry.ts`, consumed by `utility-pending-idempotency.ts`) and mobile `lib/pending-vtu-reference-queries.ts` (consumed by `lib/pending-vtu-idempotency.ts`) implement the same reference, stale-success, and completion logic, with mirrored persistence/mint-lock registries guarding against double-debit on retry. | web, storefront | **Deferred shared-core candidate (high risk).** Extract the pure reference/completion logic to shared with storage adapters kept local, in its own wave with characterization fixtures first — a duplicated money-movement protocol must not drift. Not in Waves 1–3, but explicitly tracked, not omitted. |
| 9 | Wallet-funding response contract | The order wallet-funding response schema exists on both sides and has already diverged: web `src/schemas/order-wallet-funding-intent.ts:62` accepts PostgREST `+00:00` timestamps via `z.iso.datetime({ offset: true })`, while mobile `schemas/order-wallet-funding-intent.ts:27` uses bare `z.iso.datetime()` for create/poll responses. | web, storefront | **Share the response contract** (own wave, can precede cart waves): one shared response schema in `@baci/shared`; server-only request/auth schemas stay local. The offset divergence should be treated as a latent mobile parsing bug and verified against the actual create/poll HTTP responses during that wave (clients parse `formatIntentResult` output, not PostgREST rows; PostgREST payloads only explain the `expiresAt` offset origin). |
| 10 | Mobile update policy core | Both mobile apps implement the same `MobileReleasePolicy`/`resolveMobileUpdatePrompt` flow in `components/updates/mobile-update-check.ts` (storefront and admin), and have already diverged: when a policy lacks `storeUrl`, admin fails open while storefront creates an unusable prompt — on **both** branches: `nativeUpdateRequired` (admin `mobile-update-check.ts:115-118` returns `kind:'none'`; storefront `:96-102` emits a required prompt with `storeUrl: null`) and `nativeUpdateRecommended` (admin `:127-130` also fails open; storefront `:104-110` also emits a prompt with `storeUrl: null`). | storefront, admin | **Share the pure policy core** in its own wave: policy fetching stays local; gating/decision logic moves to shared with app-specific route/app-name/OTA adapters. The `storeUrl` divergence needs an explicit decision — recorded for **both** the required and recommended branches — with its threat model: fail-open lets a forced-update policy be bypassed when its store link is missing (integrity risk), fail-closed strands users on a dead prompt (availability risk). Neither is asserted here; the wave picks one per branch with the rejected alternative documented. |
| 11 | Sanitization primitives | `apps/web/src/lib/sanitize-core.ts` and `apps/mobile-admin/lib/sanitize.ts` implement the same `stripHtmlTags`, `sanitizeText`, `sanitizeEmail`, `sanitizePhone`, `sanitizeSearchQuery` transformations feeding order schemas and admin requests; independent edits can make accepted input differ by surface. A shared primitive already exists for one piece — `packages/shared/src/lib/sanitize-html-text.ts` — so the wave extends that home rather than starting a new one. | web, admin | **Share the primitives** in a small wave with characterization fixtures, building on the existing shared `sanitize-html-text`; schema-level rules stay local. |
| 12 | Business-type catalog | `apps/mobile-admin/constants/business-types.ts` duplicates the eight id/label pairs from the declared source of truth `apps/web/src/config/business-types.ts` and independently adds `other`; category changes can leave the native selector stale. Note the type domains differ: web's `BusinessTypeId` is declared as `keyof typeof BUSINESS_TYPES`, but `BUSINESS_TYPES` is typed `Record<string, BusinessTypeConfig>`, so the alias actually resolves to `string` — no closed union exists today. A shared contract must build a real union from the **id values**, not reuse the alias. | web, admin | **Share the data contract** built from id values (ids/labels/union) or generate the mobile projection from the web source; web-only templates/icons stay local. Resolve whether `other` belongs in the source of truth during that wave. **Approval gate:** `apps/web/src/config/business-types.ts` is a protected file (CLAUDE.md/AGENTS.md); touching or building on it requires explicit approval recorded in that wave's PR. |
| 13 | Wallet top-up limits | Identical `WALLET_TOP_UP_MIN_AMOUNT` (100) / `WALLET_TOP_UP_MAX_AMOUNT` (500_000) constants duplicated in `apps/web/src/lib/wallet-top-up-constants.ts` (server Zod validation; comment says "must match mobile validation") and `apps/mobile-storefront/lib/wallet-top-up-constants.ts` (UI disable + input validation; comment says "must match server validation"). Changing one side silently makes accepted amounts disagree by surface. | web, storefront | **Share the constants** — a trivial move into `@baci/shared` that can ride with the wallet-funding wave (sequence step 1). |
| 14 | IMEI payment-recovery protocol | Near-verbatim `resolveImeiCheckFailure` implementations in `apps/web/src/components/storefront/ogabassey/pages/imei-checker-resolve-failure.ts` (used by `imei-checker-request.ts`) and `apps/mobile-storefront/components/imei-check/resolve-imei-check-failure.ts`, plus a matching pending-lookup persistence contract, decide whether paid IMEI retries retain or discard an idempotency key for debit/refund-uncertain results (`REFUND_PENDING`, `DEBIT_FAILURE_STATE_SAVE_FAILED`). An independent edit can make one client retry with a fresh key (double-debit risk) while the other preserves it. | web, storefront | **Deferred shared-core candidate (money-safety).** Same treatment as row 8: extract the failure-classification core to shared with persistence adapters local, characterization fixtures first. |
| 15 | Merchant-country catalog | The shared/web `MERCHANT_COUNTRIES` catalog (`packages/shared/src/constants/merchant-countries.ts`) is duplicated by mobile-admin's local `COUNTRIES` (`apps/mobile-admin/constants/countries.ts`), which adds unsupported entries (e.g. Zambia `ZM`/`ZMW`) that the admin settings screen persists via a changed-only column payload (`apps/mobile-admin/components/store-settings/store-settings-payload.ts`, saved through `hooks/useStoreSettingsSaveLifecycle.ts`) with no supported-catalog validation on that path — producing merchant country/currency states web onboarding and provisioning do not support. | web (via shared), admin | **Split the catalog by consumer before changing anything:** the local `COUNTRIES` also feeds phone-country calling codes (`lib/phone-country.ts`), the supported-currency fallback (`lib/merchant-currency.ts`), and currency formatting — those keep the wide catalog. Only the merchant-settings selector gets a projection gated to the shared 22-entry `MERCHANT_COUNTRIES`. The declared market contract must also be enforced at the persistence boundary, not only in the selector: the `update_merchant_identity_settings` RPC currently accepts any country string up to 100 chars and any three-letter payout currency, so older admin builds and direct authenticated callers could still persist unsupported pairs (e.g. `ZM`/`ZMW`) — the wave adds canonical country/currency-pair validation in that RPC (append-only migration) alongside the repair decision below. The RPC check must be **merged-state**, not payload-only: both callers send changed-only payloads (mobile builds a diff in `store-settings-payload.ts`; the web dashboard's `save-settings.ts` sends `country` alone), so the RPC reads the persisted merchant row, normalizes the stored country (consumed as code-or-name today — `getCountryByCode` accepts both) to its canonical code, and validates the post-update country/currency pair; the wave also brings the web country-only caller into scope (send or derive the paired currency from the catalog) so legitimate country changes do not start failing. **Null/repair semantics:** incomplete states stay valid — when neither country nor payout_currency is being changed, or either side of the merged pair is null/blank (the mobile baseline explicitly supports `country = null` / `payout_currency = ''`), unrelated settings updates (phone, business name) must not start failing. Validation bites only when country or payout_currency changes, and then the merged pair must be a supported catalog pair; a merchant with a legacy unsupported stored counterpart repairs it by correcting that one field to a catalog value (a single-field change whose merged pair is valid is always allowed). Before the gate is enabled, already-persisted unsupported complete pairs get an explicit repair/backfill pass (report, merchant correction path) rather than being trapped by the new check. Merchants who already persisted unsupported values (e.g. ZM) need an explicit repair/backfill decision before gating, not a silent selector change. |
| 16 | Native auth refresh lifecycle | Near-duplicate `registerAuthRefreshLifecycle` in both mobile apps' `lib/auth/auth-refresh-lifecycle.ts`: same AppState-driven start/stop, singleton guard, and cleanup; lifecycle fixes can drift between native clients. | storefront, admin | **Share the lifecycle core** in a small wave; Supabase client construction and storage stay per-app. |
| 17 | Native ATT wrapper | Identical 72-line lazy `expo-tracking-transparency` loaders in `apps/mobile-storefront/lib/tracking-transparency.ts` and `apps/mobile-admin/lib/tracking-transparency.ts`: same iOS gate and unavailable/error fallbacks, differing only in the platform predicate. | storefront, admin | **Share the wrapper/core** with the platform predicate injected; consent copy stays per-app. |
| 18 | Saved-address normalization | Exact small duplicate: `normalizeSavedAddresses` (only saved address becomes default) in `apps/web/src/lib/saved-addresses.ts` and `apps/mobile-storefront/lib/saved-addresses.ts` (19 lines each), feeding web address pages and mobile address/checkout flows. | web, storefront | **Share the primitive** in its own small wave (tracked candidates, sequence step 5); trivial enough to ride along opportunistically only if an early wave already touches the same files. |

## Sampled out (explicit)

- `apps/web/src/lib` admin/analytics/AI-storefront subtrees: web-only
  surfaces with no mobile counterpart.
- `packages/shared/src/contracts` (174 files): already shared; no
  action. `receipt` rendering is likewise already shared and out of
  scope — but its money-formatter implementation
  (`packages/shared/src/receipt/receipt-money.ts`) is explicitly in
  scope for the formatting wave per row 1, which must evaluate
  extending/extracting it before creating any new formatter.
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
   leads. **The wave is split into three separately shippable PRs,
   in order:** (1a) the urgent, independent fix — mobile
   `z.iso.datetime({ offset: true })`, the shared top-up constants
   (row 13), and a characterization fixture captured from the actual create/poll HTTP responses (`formatIntentResult` outputs) — not PostgREST rows, which no client parses; no
   server *behavior* or migration change and not blocked by anything
   below — but sharing the constants does touch the web server-side
   constants module (`apps/web/src/lib/wallet-top-up-constants.ts`
   imports or re-exports the shared values, covered by the
   `apps/web/src/schemas/wallet-top-up.ts` schema tests); if only
   mobile moved, the duplication row 13 targets would remain. (1b) the shared
   response subshape, the failure classification below (applied to
   **both** client classifiers — the mobile one and the already
   divergent web one in
   `apps/web/src/components/storefront/ogabassey/pages/checkout/wallet-funded-bank-transfer.ts`,
   which today maps every definite create failure, including consent
   denial, to `fallback`; aligning or extracting a shared classifier
   core from both, with their pinned tests updated to the canonical
   table), and the real consent UI. (1c) the server no-intent proof (new append-only
   migration + RPC, marker lifecycle below). Nothing in 1b/1c delays
   1a. **Sequencing constraint:** 1b must stay fail-closed until 1c is
   deployed — with no proof RPC available, every would-be fallback
   (including `WALLET_DVA_SETUP_FAILED`) resolves to the
   pending/terminal state, never the legacy DVA; legacy-DVA
   initialization is gated on a server capability that only exists
   after 1c deployment, with compatibility tests covering the
   intermediate 1b-only deployment. **Interim stale-client risk
   (explicit):** already-installed mobile clients still run the old
   classifier (every non-consent error invokes `onFallback`) and the
   legacy DVA endpoint is ungated until 1c, so the 1b–1c interval
   does **not** remove the double-funding path for the installed
   base — it removes it only for updated clients. Mitigations
   recorded for the wave: 1b's server deployment adds an interim
   guard at DVA initialization (reject initialization when an active
   wallet intent already exists for the order), and the 1c rollout
   must evaluate a minimum-version/force-update gate (row 10 policy)
   for stale clients rather than silently accepting the window. Share the intent/poll subshape **and** a canonical *order-funding-scoped* account subshape derived from the single server response builder (`wallet-order-funding-intent-response.ts` emits exactly `accountName/accountNumber/bankName/provider` from `result.account`): both clients parse the same order-funding endpoint payload, so for that endpoint the client schemas' divergence (web: nullable names, 120-char caps, `paystack` only; storefront: required names, 200-char caps, `paystack` + `piggyvest`) is drift to align to the server's actual emission, not a legitimate per-app contract. Scope limit: the mobile `WalletFundingAccountSchema` is also reused by the piggyvest primary-wallet snapshot (`piggyvest-primary-wallet.ts` extends it with `provider: z.literal('piggyvest')`, and its 200-char caps mirror the server snapshot schema in `apps/web/src/schemas/piggyvest-primary-wallet-snapshot.ts`) — that is a different payload with its own legitimate contract, so the piggyvest snapshot schema stays distinct (or a separate extension) and is not aligned to the order-funding builder. A third consumer must also be preserved: `WalletFundingAccountResponseSchema` (same schema file) parses the standalone legacy `/wallet/funding-account` GET/POST responses via `lib/wallet-funding-account.ts`, which is outside this wave — so the wave splits out an order-intent-specific account schema, or explicitly includes and characterizes the legacy funding-account response before altering the shared base. The wave adds a characterization fixture for each of the three account payloads (order-funding, piggyvest snapshot, standalone funding-account) before any unification. The wave verifies the subshape against the actual create/poll HTTP responses before adopting it; the wave must also align the create-failure
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
   | Consent required | `WALLET_DVA_CONSENT_REQUIRED` | Require a **real affirmative consent action** before provisioning: the current `requestWalletFundingAccountConsent()` in `components/checkout/checkout-wallet-funded-bank-transfer.ts` is a stub returning `Promise.resolve(true)`, so the wave must add an actual consent prompt. Only an affirmative action posts `consent: true`, creates the funding account (`createWalletFundingAccount`), and retries intent create once; cancellation leaves the account unprovisioned and does not retry. **PiggyVest-primary branch is separate:** for piggyvest-primary merchants, `createWalletFundingAccount` (`lib/wallet-funding-account.ts`) requires BVN *and* `consent === true` before the primary create and otherwise throws 'Your BVN and consent are required for PiggyVest wallet setup', so the consent deliverable must implement a BVN-collection + consent branch feeding the piggyvest primary create — distinct from the legacy Paystack DVA `consent: true` POST; the current checkout caller passes neither BVN nor an explicit consent value, which the wave fixes rather than preserves. **Consent-denied is explicitly not fallback-eligible:** the flow stops for the wallet path (the current client's `WALLET_CONSENT_DENIED` → `onFallback` → gateway fall-through in `wallet-funded-bank-transfer.ts` / `checkout-payment-finalization.ts` is removed); the shopper may explicitly choose a different payment method at checkout, but there is no automatic legacy-DVA fall-through on consent denial. |
   | Confirmed no-intent (safe to fall back) | **Server-verifiable no-intent for the order** — not a client-side attempt count, and not an early intent return. Today this proof is *not obtainable*: settings, eligibility, and account resolution in `createOrderWalletFundingIntent` all run (and can return fallback codes) *before* `findActiveOrderIntent`, and no order-scoped lookup endpoint exists, so no received code — on a first attempt or a retry — proves no intent exists. The wallet wave therefore includes a server change as an explicit deliverable, with a **proof-only design** and a **single issuance point**: the proof is issued only by the authenticated, CSRF-protected POST proof-issuance mutation specified below — it is never attached to the create/fallback response (that earlier alternative is deleted; attaching it there would issue proof before the scoped ownership/eligibility revalidation and without the marker semantics), scoped to the resolved `customerId` and `merchantId`, and revalidating order eligibility inside the same lock (order still payable, no wallet redemption, positive payable amount — the invariants `validateOrderEligibility` checks — repeated at proof time, rejecting or clearing the marker if they no longer hold, so a payment or redemption landing between the fallback response and proof issuance cannot produce a marker for a settled order) — the current `findActiveOrderIntent({ orderId })` filters only `order_id` (`order-wallet-funding-intent-repository.ts:139-147`) and must not be reused unchanged for this, or a shopper could recover another merchant's intent by submitting its order ID. Settings, eligibility, and account checks still run before any intent is returned (the response builder needs `result.account`, which exists only after account resolution), and the pinned tests in `order-wallet-funding-intents.test.ts` ('does not reuse an active intent when the order is no longer payable' / 'already has wallet redemption', asserting `findActiveOrderIntent` is not called before eligibility) must remain green. Only a proof-carrying rejection with a fallback-eligible code qualifies — eligibility keys on the code plus the proof, never on HTTP status class, since `WALLET_DVA_SETUP_FAILED` is emitted as HTTP 502 (see `getFallbackStatus` in the response builder). **Proof issuance point (explicit):** proof issuance is a state-changing operation (it installs the marker below), so it must be implemented as an authenticated, CSRF-protected POST mutation for the resolved customer session — never as a GET or an unguarded lookup; a cross-site request for a known order ID must not be able to install a marker and block that shopper's wallet-intent creation. The proof is issued by that scoped mutation, not by moving `findActiveOrderIntent` inside `createOrderWalletFundingIntent` — the create pipeline's check ordering is unchanged, so no pinned ordering assertion changes (the tests at `order-wallet-funding-intents.test.ts` asserting the lookup is not called on settings/eligibility early-return paths remain green as written). After a received fallback-eligible rejection, the client calls that POST proof-issuance mutation, whose RPC (1) resolves the customer and merchant from the authenticated session, (2) verifies order ownership via the same `getOrderForCustomer(customerId, merchantId, orderId)` scoping eligibility uses, and only then (3) runs the customer/merchant-scoped active-intent lookup and writes the marker in the same transaction, before the response returns the proof. **Atomicity:** a point-in-time no-intent read is not sufficient — an in-flight create from another session could still insert after the proof. Proof issuance and intent insertion must therefore be serialized on the same order-level lock the create RPC already uses (the order row `FOR UPDATE`), and proof issuance must durably record a no-intent/fallback-authorized marker for the order that the create path checks under that same lock, so a create completing after proof issuance cannot insert (it returns the fallback outcome instead). **Named deliverable:** because the lock and re-check live inside the `create_order_wallet_funding_intent_for_customer` RPC (`supabase/migrations/20260526233646_order_wallet_funding_intents.sql:443-449`, invoked from `order-wallet-funding-intent-repository.ts:282`) and migrations are append-only, step 1c is a new timestamped migration (plus registry/count updates per repo convention) that adds (i) durable marker storage for the order and (ii) a proof-issuance RPC that locks the order row `FOR UPDATE`, performs the scoped no-intent check, and writes the marker in the same transaction, together with a guarded replacement of the create RPC that checks the marker under the same lock before inserting, and (iii) a DVA-initialization enforcement point: the legacy initialize request/schema (`PaymentInitRequestSchema`) gains a customer/order-bound proof field, and the DVA branch of `apps/web/src/app/api/payments/initialize/route.ts` (or an equivalent server-side RPC check) validates the proof and atomically consumes the marker under the order-row lock *before* any provider DVA assignment is created or persisted; **every** legacy-DVA start enters the same order-lock protocol, with or without a proof: a proofless start (e.g. a stale client that skips proof issuance) must first prove order ownership more strongly than the public initializer's order_id + email snapshot (which the same route already treats as insufficient for persistent payment state in its REDVAULT fencing) — an authenticated customer context or the existing order tracking-token proof — and then, under the same order-row lock, find no active intent and record a DVA-initializing reservation that the create RPC also honors. The guarded create/proof transaction must also fence **pre-existing legacy DVA assignments**: a non-expired `order_payment_accounts` assignment created before 1c is payable yet invisible to the marker check, so the transaction rejects or adopts such an assignment as a reservation under the same lock (or 1c backfills reservations for active assignments before enabling the new client flow), with a test for this deployment-window case. so a wallet create still resolving its account cannot insert behind it (with a test for the in-flight-create case); initialization with an active wallet intent and no valid marker is rejected, and a lost initialize response recovers idempotently (a consumed marker plus the existing DVA assignment returns that assignment instead of creating a second one), with named tests for the consume, reject, and recovery paths. An ordinary-query lookup endpoint cannot substitute: it would not share the RPC's lock. **Marker lifecycle:** the marker is scoped to (order, customer, merchant); it expires 30 minutes after issuance — a **new step-1c decision, not an existing window**: the only 30-minute constant in the cited code is the wallet intent TTL (`INTENT_TTL_MS` in `apps/web/src/lib/order-wallet-funding-utils.ts`), which does not bound legacy-DVA initiation, so 1c must either cite the actual DVA assignment lifetime as the basis or record this lifetime as its own explicit decision (the consumed tombstone below is honored until the DVA attempt is terminal/expired regardless of the unconsumed-marker expiry); it is single-use — consumed when the legacy DVA payment is initialized for that order. Consumption does not delete the record: it transitions to a **consumed tombstone** that the create RPC continues to honor under the order-row lock until the DVA attempt reaches a terminal or expired state, so wallet-intent creation stays blocked for the life of that payment attempt (expiry of any state is evaluated atomically under the same lock; tests must cover create-after-consume and create-after-30-minutes-while-DVA-pending). If it expires unconsumed, it is cleared and wallet-intent creation for the order is unblocked again, so a failed or abandoned legacy attempt never permanently blocks the wallet path; a failed DVA attempt returns the shopper to checkout payment-method choice rather than silently creating a wallet intent. **Proof security:** the proof is a high-entropy bearer credential — only its hash is stored, it is bound to the authenticated customer (plus order and merchant) at issuance, and at the public, CSRF-exempt initialize endpoint the server resolves the customer from the order snapshot and rejects any proof whose hash does not match the marker bound to that customer/order/merchant; the proof field is added to the initialize route's log redaction (`redactPaymentLogValue`) with a regression test that raw-request logs cannot contain its value. **Issuance recovery:** proof issuance is idempotent for the same customer/order — a retry after a lost issuance response returns a usable unconsumed proof (re-issued or rotated against the same marker, without extending its expiry), with a tested response-loss path. **Consumption revalidation:** the consume transaction repeats the eligibility invariants under the lock (payable, no redemption, positive residual amount) and invalidates the marker if they no longer hold. **Provider-outcome recovery:** consumption first records a durable *initializing* state; if the provider accepts DVA creation but the process dies before the assignment is persisted, recovery reconciles against the provider (lookup by reference/customer) before any new DVA is created, and the marker/tombstone is never cleared while the provider outcome is unknown — with a tested recovery path for that interval. If that atomic marker design is not implemented, fallback stays blocked whenever any create for the order may still be in flight or unconfirmed. **Fallback-eligible codes:** `WALLET_DVA_SETUP_FAILED`, and `WALLET_ORDER_AUTO_DEBIT_DISABLED` only when proof issuance re-reads settings and confirms Paystack and wallet DVA are still enabled (that code is also returned when Paystack itself is disabled, in which case the legacy DVA would fail identically). `WALLET_DVA_DISABLED` is **not** fallback-eligible: the legacy DVA initialization rejects the same disabled setting (`apps/web/src/app/api/payments/initialize/route.ts` returns `GATEWAY_DISABLED` when `wallet_paystack_dva_enabled` is false), so it is a terminal settings-refresh state — stop and refresh the available payment methods. Every other confirmed code is terminal or wallet-only, never DVA: `ORDER_NOT_FOUND` and `ORDER_NOT_PAYABLE` are terminal; `ORDER_ALREADY_HAS_WALLET_REDEMPTION` and `WALLET_BALANCE_COVERS_ORDER` are wallet-only; `CUSTOMER_NAME_REQUIRED` and `CUSTOMER_PHONE_REQUIRED` stop for profile completion, then retry the intent create. | Legacy DVA fallback allowed only with server-verifiable no-intent **and** a fallback-eligible code |
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
   explicit server deliverable of this wave — specifically the step
   1c append-only migration + proof-issuance RPC + create-RPC marker
   check named in the table above. The wave's full scope is
   therefore: steps 1a–1c as split above, the prerequisite Zod
   peer-range decision, the shared subshape, and the client behavior
   (re-create instead of the legacy DVA fallback).
2. **Formatting wave: currency/price formatting.** One shared `Intl`
   formatting module, characterization fixtures pinning each app's
   current outputs, semantic unification decision recorded in the
   wave PR (NGN-only vs merchant-locale vs country-aware per call
   class). All three apps adopt via thin wrappers.
3. **Guardrails alongside the formatting wave:** contributor rule (pure logic with
   ≥2 consumers that is platform-free lands in `packages/shared`
   first) and the decision rule (≥2 consumers, platform-free, ≤~400
   changed lines per PR), recorded in a newly created
   `packages/shared/README.md` (no such file exists today — creating
   it is part of this step). Do not record the rule in `AGENTS.md` or
   `CLAUDE.md`: both are Ruler-generated from `.ruler/` sources and
   direct edits would be overwritten on regeneration; if repo-level
   guidance is also wanted, add it under `.ruler/` and regenerate.
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
