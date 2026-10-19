# Shared-code consolidation audit (Step 1)

Date: 2026-10-19. Base: `main` at `390da149c3` (post-#3693).
Scope per the amended consolidation plan: only domains where at least
two apps hold same-concept modules. Method: side-by-side reading of
representative module pairs plus symbol/format inventories. `knip`
output was used only as a supporting signal. No code was moved.

## Consumers and existing shared surface

`@baci/shared` (`packages/shared`, ~265 source files / ~23k lines) is
consumed by all three apps. Counting non-test `.ts`/`.tsx` files that
import `@baci/shared` or any subpath (import-aware count, excluding
comment-only, `jest.mock`, and test-config alias matches):
`apps/web/src` 459, `apps/mobile-storefront` 147,
`apps/mobile-admin` 121. One contract caveat: the shared package's own Zod peer range is `^3.0.0 || ^4.0.0` (dev dependency `^4.4.3`), so Zod-4-only APIs such as `z.iso.datetime` cannot move into `@baci/shared` until the wallet wave either narrows that peer range or records a compatibility decision. Reproduce exactly (one command per base):
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
| 2 | Cart pure logic (remainder) | Already largely consolidated: web `lib/cart/merge.ts` is a 6-line re-export of `@baci/shared/cart` (207-line merge, 222-line types, commands, line-identity). Remaining duplication is presentational: web `lib/cart/pricing.ts` (150 lines, server snapshot building — server-canonical, stays) vs mobile `lib/cart/display.ts` (117) + `lib/cart-pricing.ts` (88) display math. | web, storefront | **Share display math only, post-activation** (plan gate). Server pricing stays web-only by design. |
| 3 | Schemas | Web `src/schemas` is 446 files / ~25k lines, overwhelmingly server API input schemas with no mobile consumer — not duplication. Real overlap is narrow: `apps/mobile-storefront/schemas` holds 39 non-test source files (~2.2k lines; 79 files including tests), of which 7 are cart-related (`cart*.ts`: pairing/session/snapshot/pending-request parsing of the same payloads whose types already live in `@baci/shared/cart`). | web, storefront | **Share the cart-payload schemas post-activation;** the rest of web schemas are server-canonical and stay. Most of the apparent schema mass is a false positive. |
| 4 | Product transform/hydration | Mobile `hooks/product-utils.ts` / `product-transform` vs web `lib/normalize-product.ts` and PDP normalizers shape the same product rows differently per surface (display vs indexing). Partially same concept, partially surface-specific. | web, storefront | **Defer.** Extract only the shared row-shaping primitives if a future product change touches both; full unification would force surface compromises. Re-audit after the formatting wave. |
| 5 | Auth session handling | Web `lib/auth` (6 files / 573 lines, server session) vs mobile `lib/auth` (5 files / 661 lines, device session storage) share vocabulary, not logic: different trust models and storage. **Exception:** both native apps run near-identical `registerAuthRefreshLifecycle` copies (`lib/auth/auth-refresh-lifecycle.ts` in storefront and admin, invoked from each `lib/supabase.ts`) implementing the same AppState start/stop, singleton, and cleanup protocol. | web, storefront, admin | **Keep web/mobile session models platform-specific; track a shared native auth-refresh lifecycle core** (row 16) with per-app Supabase client wiring local. |
| 6 | Checkout payload shapes | Web holds the server side (`lib/checkout`, 62 files / ~4.9k lines; `src/schemas/orders.ts` 452 lines), **but mobile does reimplement payload construction**: `apps/mobile-storefront/components/checkout/checkout-order-builders.ts` (225 lines) builds the customer/item/total/payment/shipping/discount/shared-cart request, and `services/orders.ts` validates its own `CreateOrderRequestSchema` before POSTing to `/api/orders`. The transport shape is therefore implemented twice. | web, storefront | **Share the transport subshape post-activation** (it is on the cart activation path via the shared-cart fields): one shared order-request schema/types in `@baci/shared`; server validation rules and adapter-specific fields stay local. Server remains canonical for pricing/trust. |
| 7 | Exported-symbol overlap (whole lib) | Only ~20 exported names are shared between web and mobile `lib` trees (`calculateOrderTotals`, `normalizeVariantAttributes`, `getPrimaryProductImage`, `hexToRgba`, …). Duplication is concentrated, not diffuse. | all | Confirms the ranked waves cover most real overlap; a whole-monorepo sweep is not warranted. |
| 8 | VTU pending-reference idempotency core | Same platform-free protocol implemented twice: web `components/storefront/ogabassey/components/utility-pending-vtu-reference-queries.ts` (+ registry) and mobile `lib/pending-vtu-reference-queries.ts` implement the same reference, stale-success, and completion logic, with mirrored persistence/mint-lock registries guarding against double-debit on retry. | web, storefront | **Deferred shared-core candidate (high risk).** Extract the pure reference/completion logic to shared with storage adapters kept local, in its own wave with characterization fixtures first — a duplicated money-movement protocol must not drift. Not in Waves 1–3, but explicitly tracked, not omitted. |
| 9 | Wallet-funding response contract | The order wallet-funding response schema exists on both sides and has already diverged: web `src/schemas/order-wallet-funding-intent.ts:62` accepts PostgREST `+00:00` timestamps via `z.iso.datetime({ offset: true })`, while mobile `schemas/order-wallet-funding-intent.ts:27` uses bare `z.iso.datetime()` for create/poll responses. | web, storefront | **Share the response contract** (own wave, can precede cart waves): one shared response schema in `@baci/shared`; server-only request/auth schemas stay local. The offset divergence should be treated as a latent mobile parsing bug and verified against live PostgREST payloads during that wave. |
| 10 | Mobile update policy core | Both mobile apps implement the same `MobileReleasePolicy`/`resolveMobileUpdatePrompt` flow in `components/updates/mobile-update-check.ts` (storefront and admin), and have already diverged: when a required policy lacks `storeUrl`, admin fails open while storefront creates an unusable blocking prompt. | storefront, admin | **Share the pure policy core** in its own wave: policy fetching stays local; gating/decision logic moves to shared with app-specific route/app-name/OTA adapters. The `storeUrl` divergence needs an explicit decision recorded with its threat model: fail-open lets a forced-update policy be bypassed when its store link is missing (integrity risk), fail-closed strands users on a dead prompt (availability risk). Neither is asserted here; the wave picks one with the rejected alternative documented. |
| 11 | Sanitization primitives | `apps/web/src/lib/sanitize-core.ts` and `apps/mobile-admin/lib/sanitize.ts` implement the same `stripHtmlTags`, `sanitizeText`, `sanitizeEmail`, `sanitizePhone`, `sanitizeSearchQuery` transformations feeding order schemas and admin requests; independent edits can make accepted input differ by surface. A shared primitive already exists for one piece — `packages/shared/src/lib/sanitize-html-text.ts` — so the wave extends that home rather than starting a new one. | web, admin | **Share the primitives** in a small wave with characterization fixtures, building on the existing shared `sanitize-html-text`; schema-level rules stay local. |
| 12 | Business-type catalog | `apps/mobile-admin/constants/business-types.ts` duplicates the eight id/label pairs from the declared source of truth `apps/web/src/config/business-types.ts` and independently adds `other`; category changes can leave the native selector stale. Note the type domains differ: web's `BusinessTypeId` is declared as `keyof typeof BUSINESS_TYPES`, but `BUSINESS_TYPES` is typed `Record<string, BusinessTypeConfig>`, so the alias actually resolves to `string` — no closed union exists today. A shared contract must build a real union from the **id values**, not reuse the alias. | web, admin | **Share the data contract** built from id values (ids/labels/union) or generate the mobile projection from the web source; web-only templates/icons stay local. Resolve whether `other` belongs in the source of truth during that wave. **Approval gate:** `apps/web/src/config/business-types.ts` is a protected file (CLAUDE.md/AGENTS.md); touching or building on it requires explicit approval recorded in that wave's PR. |
| 13 | Wallet top-up limits | Identical `WALLET_TOP_UP_MIN_AMOUNT` (100) / `WALLET_TOP_UP_MAX_AMOUNT` (500_000) constants duplicated in `apps/web/src/lib/wallet-top-up-constants.ts` (server Zod validation; comment says "must match mobile validation") and `apps/mobile-storefront/lib/wallet-top-up-constants.ts` (UI disable + input validation; comment says "must match server validation"). Changing one side silently makes accepted amounts disagree by surface. | web, storefront | **Share the constants** — a trivial move into `@baci/shared` that can ride with the wallet-funding wave (sequence step 1). |
| 14 | IMEI payment-recovery protocol | Near-verbatim `resolveImeiCheckFailure` implementations in the web and storefront IMEI checkers, plus a matching pending-lookup persistence contract, decide whether paid IMEI retries retain or discard an idempotency key for debit/refund-uncertain results (`REFUND_PENDING`, `DEBIT_FAILURE_STATE_SAVE_FAILED`). An independent edit can make one client retry with a fresh key (double-debit risk) while the other preserves it. | web, storefront | **Deferred shared-core candidate (money-safety).** Same treatment as row 8: extract the failure-classification core to shared with persistence adapters local, characterization fixtures first. |
| 16 | Native auth refresh lifecycle | Near-duplicate `registerAuthRefreshLifecycle` in both mobile apps' `lib/auth/auth-refresh-lifecycle.ts`: same AppState-driven start/stop, singleton guard, and cleanup; lifecycle fixes can drift between native clients. | storefront, admin | **Share the lifecycle core** in a small wave; Supabase client construction and storage stay per-app. |
| 17 | Native ATT wrapper | Identical 72-line lazy `expo-tracking-transparency` loaders in `apps/mobile-storefront/lib/tracking-transparency.ts` and `apps/mobile-admin/lib/tracking-transparency.ts`: same iOS gate and unavailable/error fallbacks, differing only in the platform predicate. | storefront, admin | **Share the wrapper/core** with the platform predicate injected; consent copy stays per-app. |
| 18 | Saved-address normalization | Exact small duplicate: `normalizeSavedAddresses` (only saved address becomes default) in `apps/web/src/lib/saved-addresses.ts` and `apps/mobile-storefront/lib/saved-addresses.ts` (19 lines each), feeding web address pages and mobile address/checkout flows. | web, storefront | **Share the primitive** — a trivial move; can ride with any early wave. |
| 15 | Merchant-country catalog | The shared/web `MERCHANT_COUNTRIES` catalog (`packages/shared/src/constants/merchant-countries.ts`) is duplicated by mobile-admin's local `COUNTRIES` (`apps/mobile-admin/constants/countries.ts`), which adds unsupported entries (e.g. Zambia `ZM`/`ZMW`) that the admin settings screen can persist through a shape-only RPC check — producing merchant country/currency states web onboarding and provisioning do not support. | web (via shared), admin | **Split the catalog by consumer before changing anything:** the local `COUNTRIES` also feeds phone-country calling codes (`lib/phone-country.ts`), the supported-currency fallback (`lib/merchant-currency.ts`), and currency formatting — those keep the wide catalog. Only the merchant-settings selector gets a projection gated to the shared 22-entry `MERCHANT_COUNTRIES`. Merchants who already persisted unsupported values (e.g. ZM) need an explicit repair/backfill decision before gating, not a silent selector change. |

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

**Activation gate** (used for post-activation sequencing below): the
cart pilot activation is complete when the 81 registered cart
migrations have applied to production, the final privilege state is
verified (anon cannot execute preview/replay RPCs), the terminal
purge has been explicitly scheduled per rollout step 4 (the earlier
"no purge job in `cron.job`" check is an interim pre-enrollment
verification, not the completion state), the pre-enrollment
telemetry/quota gates in the rollout doc are closed — explicitly:
`x-handoff-token` redaction verified like `Authorization` in
proxy/APM/error reporting, database/APM logging proven not to
persist pairing-token RPC arguments, compatible server adapters
deployed, and cart roles/signing material provisioned including a
deployment-unique `CART_PROOF_ENVIRONMENT` — the pilot
merchant is enrolled, and the acceptance
matrix in `docs/qa/shared-cart-acceptance.md` passes — per
`docs/deploy/shared-cart-rollout.md`. The rollout's *expansion*
criteria (second merchant, deployed convergence/checkout-binding/
isolation evidence) gate merchant expansion, not these code
consolidation waves, which enroll nobody; waves still merge only on
green CI and change no activation state.

## Recommended sequence

1. **Wallet-funding contract (rows 9, 13) — first, ahead of
   formatting:** the mobile `z.iso.datetime()` offset divergence is
   a present-tense payment-path bug, not future drift, so this wave
   leads. One shared response schema, verified against live
   PostgREST payloads; the wave must also align the create-failure
   protocol — the failure classifier is
   `apps/mobile-storefront/lib/checkout/wallet-funded-bank-transfer.ts`
   (every non-consent error invokes `onFallback`), and
   `components/checkout/checkout-payment-finalization.ts` is only
   the fall-through site that then starts gateway payment, risking a
   double payment path after timeout/5xx where an intent may
   already exist. Failure classification (consent vs transient vs
   unknown-after-POST) is part of the shared contract.
   Unknown-after-POST cannot poll by intent ID (a lost create
   response means no ID was received, and no order-scoped lookup
   endpoint exists today) — but it does not need one: the server
   create path is already order-keyed
   (`apps/web/src/lib/order-wallet-funding-intents.ts`
   `findActiveOrderIntent` returns the existing active intent for
   the order before inserting), so the correct client behavior is
   an idempotent re-create for the same order, never a parallel
   gateway payment. No server change is needed for the concurrent
   case: the insert path's RPC
   (`create_order_wallet_funding_intent_for_customer`,
   `supabase/migrations/20260526233646_order_wallet_funding_intents.sql`)
   locks the order row `FOR UPDATE` before re-checking for an
   existing active intent, so a second concurrent create waits and
   returns the first intent. The wave's scope is therefore only the
   client behavior: re-create instead of gateway fallback.
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
4. **Post-activation (per the gate defined above):** cart display
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
without full Intl data (the cited fallback,
`apps/mobile-admin/lib/utils.ts`, covers `Intl.NumberFormat`
currency formatting only — no date fallback is claimed or needed
for this currency-only wave). The formatting wave must therefore
add an on-device/Hermes verification (or a verified locale/currency
allowlist) before relying on fixture parity. Size: one shared module
plus wrapper swaps — fits one PR under ~400 changed lines if call
sites keep their current signatures.
