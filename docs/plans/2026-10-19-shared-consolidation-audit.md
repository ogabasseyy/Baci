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
`apps/web/src` 460, `apps/mobile-storefront` 147,
`apps/mobile-admin` 121. Uniform
Zod `^4.4.3`; Metro maps the package in both mobile apps; Next.js
consumes it directly. Per-domain subpath exports already exist
(`./cart`, `./schemas`, `./contracts`, …). The pattern is proven; the
work below extends it.

## Ranked inventory

| # | Domain | Evidence (side-by-side) | Consumers | Verdict |
|---|--------|-------------------------|-----------|---------|
| 1 | Currency/price formatting | `formatPrice` is independently defined at least 7 times with *divergent* semantics: mobile-storefront hardcodes an NGN formatter (`types/product.ts:182`), mobile-admin delegates to merchant-locale formatting (`components/orders-screen/format-price.ts`), web is country-aware with a formatter cache (`lib/currency-utils.ts:213`). `formatCurrency` has 4+ separate definitions (web `lib/currency.ts`, `lib/utils.ts`, mobile-admin `utils/format.ts`, …) across 133 call sites. `packages/shared` has **no** formatting module. Date formatting is **out of scope** for this wave: it carries separate decisions (timezone source, `date-fns` dependency on mobile-admin vs `Intl.DateTimeFormat`) and gets its own evidenced audit later. | web, storefront, admin | **Share (first wave, currency/price only).** Off the cart activation path. Requires one semantic decision (locale/currency source of truth) before moving; then one `Intl`-based implementation in shared with per-app thin wrappers preserving call-site signatures. Characterization fixtures must pin current outputs per app first — outputs differ today, so this wave intentionally unifies behavior where divergence is accidental, and records any intentional difference as an explicit option. |
| 2 | Cart pure logic (remainder) | Already largely consolidated: web `lib/cart/merge.ts` is a 6-line re-export of `@baci/shared/cart` (207-line merge, 222-line types, commands, line-identity). Remaining duplication is presentational: web `lib/cart/pricing.ts` (150 lines, server snapshot building — server-canonical, stays) vs mobile `lib/cart/display.ts` (117) + `lib/cart-pricing.ts` (88) display math. | web, storefront | **Share display math only, post-activation** (plan gate). Server pricing stays web-only by design. |
| 3 | Schemas | Web `src/schemas` is 446 files / ~25k lines, overwhelmingly server API input schemas with no mobile consumer — not duplication. Real overlap is narrow: `apps/mobile-storefront/schemas` holds 39 non-test source files (~2.2k lines; 79 files including tests), of which 7 are cart-related (`cart*.ts`: pairing/session/snapshot/pending-request parsing of the same payloads whose types already live in `@baci/shared/cart`). | web, storefront | **Share the cart-payload schemas post-activation;** the rest of web schemas are server-canonical and stay. Most of the apparent schema mass is a false positive. |
| 4 | Product transform/hydration | Mobile `hooks/product-utils.ts` / `product-transform` vs web `lib/normalize-product.ts` and PDP normalizers shape the same product rows differently per surface (display vs indexing). Partially same concept, partially surface-specific. | web, storefront | **Defer.** Extract only the shared row-shaping primitives if a future product change touches both; full unification would force surface compromises. Re-audit after Wave 1. |
| 5 | Auth session handling | Web `lib/auth` (6 files / 573 lines, server session) vs mobile `lib/auth` (5 files / 661 lines, device session storage) share vocabulary, not logic: different trust models and storage. | web, storefront | **Keep platform-specific.** Share only error-code/claim type contracts if the audit of a future auth change shows drift. |
| 6 | Checkout payload shapes | Web holds the server side (`lib/checkout`, 62 files / ~4.9k lines; `src/schemas/orders.ts` 452 lines), **but mobile does reimplement payload construction**: `apps/mobile-storefront/components/checkout/checkout-order-builders.ts` (225 lines) builds the customer/item/total/payment/shipping/discount/shared-cart request, and `services/orders.ts` validates its own `CreateOrderRequestSchema` before POSTing to `/api/orders`. The transport shape is therefore implemented twice. | web, storefront | **Share the transport subshape post-activation** (it is on the cart activation path via the shared-cart fields): one shared order-request schema/types in `@baci/shared`; server validation rules and adapter-specific fields stay local. Server remains canonical for pricing/trust. |
| 7 | Exported-symbol overlap (whole lib) | Only ~20 exported names are shared between web and mobile `lib` trees (`calculateOrderTotals`, `normalizeVariantAttributes`, `getPrimaryProductImage`, `hexToRgba`, …). Duplication is concentrated, not diffuse. | all | Confirms the ranked waves cover most real overlap; a whole-monorepo sweep is not warranted. |
| 8 | VTU pending-reference idempotency core | Same platform-free protocol implemented twice: web `components/storefront/ogabassey/components/utility-pending-vtu-reference-queries.ts` (+ registry) and mobile `lib/pending-vtu-reference-queries.ts` implement the same reference, stale-success, and completion logic, with mirrored persistence/mint-lock registries guarding against double-debit on retry. | web, storefront | **Deferred shared-core candidate (high risk).** Extract the pure reference/completion logic to shared with storage adapters kept local, in its own wave with characterization fixtures first — a duplicated money-movement protocol must not drift. Not in Waves 1–3, but explicitly tracked, not omitted. |
| 9 | Wallet-funding response contract | The order wallet-funding response schema exists on both sides and has already diverged: web `src/schemas/order-wallet-funding-intent.ts:62` accepts PostgREST `+00:00` timestamps via `z.iso.datetime({ offset: true })`, while mobile `schemas/order-wallet-funding-intent.ts:27` uses bare `z.iso.datetime()` for create/poll responses. | web, storefront | **Share the response contract** (own wave, can precede cart waves): one shared response schema in `@baci/shared`; server-only request/auth schemas stay local. The offset divergence should be treated as a latent mobile parsing bug and verified against live PostgREST payloads during that wave. |
| 10 | Mobile update policy core | Both mobile apps implement the same `MobileReleasePolicy`/`resolveMobileUpdatePrompt` flow in `components/updates/mobile-update-check.ts` (storefront and admin), and have already diverged: when a required policy lacks `storeUrl`, admin fails open while storefront creates an unusable blocking prompt. | storefront, admin | **Share the pure policy core** in its own wave: policy fetching stays local; gating/decision logic moves to shared with app-specific route/app-name/OTA adapters. The `storeUrl` divergence must be resolved deliberately (fail-open is the safer default for a required-update gate without a destination). |
| 11 | Sanitization primitives | `apps/web/src/lib/sanitize-core.ts` and `apps/mobile-admin/lib/sanitize.ts` implement the same `stripHtmlTags`, `sanitizeText`, `sanitizeEmail`, `sanitizePhone`, `sanitizeSearchQuery` transformations feeding order schemas and admin requests; independent edits can make accepted input differ by surface. | web, admin | **Share the primitives** in a small wave with characterization fixtures; schema-level rules stay local. |
| 12 | Business-type catalog | `apps/mobile-admin/constants/business-types.ts` duplicates the eight id/label pairs from the declared source of truth `apps/web/src/config/business-types.ts` and independently adds `other`; category changes can leave the native selector and its type union stale. | web, admin | **Share the data contract** (ids/labels/type union) or generate the mobile projection from the web source; web-only templates/icons stay local. Resolve whether `other` belongs in the source of truth during that wave. |

## Sampled out (explicit)

- `apps/web/src/lib` admin/analytics/AI-storefront subtrees: web-only
  surfaces with no mobile counterpart.
- `packages/shared/src/contracts` (174 files) and `receipt`: already
  shared; no action.
- Mobile-admin order-screen formatters beyond price: admin-only
  presentation, covered by Wave 1's shared formatting primitives if
  adopted there. Date formatting is excluded from Wave 1 and from
  this note; it awaits its own evidenced audit.

## Definitions

**Activation gate** (used for post-activation sequencing below): the
cart pilot activation is complete when the 81 registered cart
migrations have applied to production, the final privilege state is
verified (anon cannot execute preview/replay RPCs, no purge job in
`cron.job`), the pilot merchant is enrolled, and the acceptance
matrix in `docs/qa/shared-cart-acceptance.md` passes — per
`docs/deploy/shared-cart-rollout.md`.

## Recommended sequence

1. **Wave 1 (now, off activation path): currency/price formatting.**
   One shared `Intl` formatting module, characterization fixtures
   pinning each app's current outputs, semantic unification decision
   recorded in the wave PR (NGN-only vs merchant-locale vs
   country-aware per call class). All three apps adopt via thin
   wrappers.
2. **Guardrails alongside Wave 1:** contributor rule (pure logic with
   ≥2 consumers that is platform-free lands in `packages/shared`
   first) and the decision rule (≥2 consumers, platform-free, ≤~400
   changed lines per PR) recorded in `packages/shared/README` or
   repo guidance.
3. **Wallet-funding response contract (row 9), before or alongside
   the cart waves:** one shared response schema, including verifying
   the mobile `z.iso.datetime()` offset divergence against live
   PostgREST payloads. Off the cart activation path.
4. **Post-activation (per the gate defined above):** cart display
   math, then cart-payload schemas, then the checkout transport
   subshape (row 6).
5. **Tracked candidates, own waves when scheduled:** VTU
   pending-reference core (row 8), mobile update policy core
   (row 10), sanitization primitives (row 11), business-type catalog
   (row 12).
6. Re-audit after each wave; deferred domains (product, auth) are
   revisited only when a change touches both sides.

## Decision-rule check for Wave 1

≥2 consumers: yes (3). Platform-free: mostly — `Intl` exists in
Next.js, Hermes, and Node, but Node-run fixtures cannot pin Hermes
locale/currency output; the repo already acknowledges runtimes
without full Intl data (`apps/mobile-admin/lib/utils.ts` wraps
`Intl.NumberFormat` in try/catch fallbacks). Wave 1 must therefore
add an on-device/Hermes verification (or a verified locale/currency
allowlist) before relying on fixture parity. Size: one shared module
plus wrapper swaps — fits one PR under ~400 changed lines if call
sites keep their current signatures.
