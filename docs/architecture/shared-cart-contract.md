# Shared server cart contract

Baseline: `origin/main` at `88c83cc672` (12 October 2026), worktree
`codex/shared-server-cart`. All existing paths below were refreshed against
that baseline; the plan's release-checkout snapshots are historical only.

## Purpose

One durable cart per merchant shared by linked ChatGPT, web and mobile
sessions, with guest checkout preserved. PostgreSQL owns state; a
tenant-aware cart service applies authorized, versioned, idempotent
commands. Web, mobile, MCP and UCP are adapters over that service.

## Shared contracts

Location: `packages/shared/src/cart/`, exported as `@baci/shared/cart`.

- `types.ts` — `CartSource`, `CartState`, `CartCondition`,
  `CartItemIdentity`, `CartInputLine`, `CartCommand`, `CartMutationInput`,
  `CreateCartInput`, `CartResult`, `CartWarning`, `CartErrorCode`,
  `CartSnapshot`, `VerifiedCartSession`, `CartCheckoutSnapshot`,
  `CartChangeEvent`, plus inherited limit constants. No runtime
  dependencies; transport Zod schemas stay with each adapter.
- `line-identity.ts` — `cartLineIdentity(item)`. Sorts option keys so
  ordering never splits a line; preserves unknown keys/values verbatim.
  Normalization decides identity, never catalog validity.
- `commands.ts` — `validateCartCommand(command)`. Pure structural checks
  (shape, quantity/line bounds). Merchant, catalog, voucher and
  negotiation rules belong to the authorized service.

`CartChangeEvent` carries only merchant/cart ID, committed version and
operation ID. Snapshots carry no access credential or private buyer
record. Amounts are integers in currency minor units with an
estimated-totals flag; existing storefront prices are floats in major
units, so adapters convert at the boundary.

## Inherited limits and representations

Adopted from existing code, not invented:

| Concern | Inherited value | Source |
| --- | --- | --- |
| Max lines per cart | 20 (`SHARED_CART_MAX_LINES`) | `apps/web/mcp-server/guest-cart-store.ts` `MAX_LINES` |
| Max quantity per line | 10 (`SHARED_CART_MAX_QUANTITY_PER_LINE`) | `apps/web/src/schemas/guest-cart-line.ts` |
| Max legacy validate input | 50 (`SHARED_CART_MAX_VALIDATION_LINES`) | `apps/web/src/schemas/cart.ts`, `storefront-cart-validation.ts` slice |
| Guest cart TTL | 7 days after last update | `guest-cart-store.ts` `TTL`, MCP tool description |
| MCP quantity semantics | Absolute desired total, 0 removes | `mcp-guest-cart.ts` description |
| Condition values | `new`, `used`, `open_box`, `refurbished` | `cart-types.ts`, mobile `cart-store.types.ts` |
| Negotiation fields | `negotiatedPrice`, `negotiationStatus`, stale-basis invalidation | `cart-types.ts`, `cart-store.ts`, `storefront-cart-validation.ts` |
| Voucher fields | `quizAwardId`/`quizVoucherToken`, `voucher_award_id`/`voucher_token`, voucher lines pinned to quantity 1 | `cart-types.ts`, mobile `cart-line.ts` |
| Assurance fields | `hasAssurance`, `assuranceRate` | `cart-types.ts`, mobile `cart-store.types.ts` |
| UCP profile version | `2026-04-08` | `ucp-profile-constants.ts` |

## Existing carts at baseline

- Web: React state plus merchant-scoped localStorage
  (`apps/web/src/hooks/cart/storefront-cart-provider.tsx`,
  `cart-storage.ts`, `cart-persistence.ts`, `cart-types.ts`,
  `find-merging-cart-line.ts`). Line merge key is product + variant +
  color/condition/storage plus sorted extra options
  (`generateCartItemId`). No enforced line-count cap; validation posts at
  most 50 lines to `/api/cart/validate`.
- MCP guest cart: PostgreSQL table `mcp_guest_carts` with capability
  token, expiry and version (`supabase/migrations/
  20261008230000_mcp_guest_carts.sql`); version-gated write RPCs
  (`20261008230100_mcp_guest_cart_write_rpcs.sql`, definer with fixed
  search path, execute revoked from public); store
  (`apps/web/mcp-server/guest-cart-store.ts`) with absolute quantities
  and cart deletion when emptied. Input/output schemas in
  `apps/web/src/schemas/mcp-guest-cart.ts` (no version, operation key
  or line selector today).
- UCP agent carts: `agentic_cart_sessions`
  (`supabase/migrations/20260526193000_add_ucp_cart_sessions.sql`, RLS
  with scoped-client policies plus grants to `authenticated`); routes
  under `apps/web/src/app/api/agentic/carts/` guarded by agentic API
  key, mutation envelope, idempotency/request replay and merchant
  context; storage helpers in `ucp-cart-storage.ts`.
- Mobile: Zustand store with persisted items
  (`apps/mobile-storefront/stores/cart-store.ts`,
  `cart-line.ts`, `cart-store.types.ts`,
  `partialize-cart-store.ts`). Line identity is product + variant +
  color/storage/condition with voucher-aware merging; voucher lines
  stay at quantity 1; per-line `max_quantity` clamps merges.
- Orders: `apps/web/src/app/api/orders/route.ts` is the order boundary
  (idempotency key header, Zod `orderCreateSchema`, storefront order
  RPC client). The shared-cart binding lands in its final transaction
  in Task 11.

## Toolchain versions at baseline

- Next.js `16.3.6`, React `19.2.3`, TypeScript `6.0.3` (repo) /
  `~7.0.2` (`@baci/shared` dev), Tailwind `4.x`, Biome `2.3.10`.
- Supabase: `@supabase/ssr ^0.10.3`, `@supabase/supabase-js ^2.108.2`.
- Mobile: Expo `~57.0.15`, React Native `0.86.2`, Jest + RN Testing
  Library; web/shared use Vitest `^4.1.11`.
- Zod `^4.4.3` (shared peer allows `^3 || ^4`).
- pnpm `11.7.0`, Node `24.x`, Turborepo.

## Task 2 signing/role decision

PASS for the cart authorization path; realtime topic policy stays pending
for Task 8. Proven 12 October 2026 on PostgreSQL 18.6 (disposable) plus
PostgREST v13.0.5 over real HTTP with real HS256 JWTs:

- Dedicated roles `commerce_cart_shopper` / `commerce_cart_receiver` /
  `commerce_cart_worker` (NOLOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS).
  Shopper reads only its merchant/cart/grant while the grant row is live;
  wrong merchant/cart/grant, forged subject, expired/revoked grant,
  missing claims, anon, `authenticated` and receiver are all denied at
  the table or RLS layer. See `supabase/tests/commerce_cart_access.sql`
  (14 sections) and the `/tmp/baci-cart-rest-proof/rest-proof.mjs`
  transcript (9 REST assertions).
- Session proofs are versioned HMAC-SHA256 (`cp1`), bound to merchant,
  cart, grant, principal, environment and audience, with absolute TTLs
  (session 24h capped at grant expiry, bootstrap 15m) and previous-secret
  rotation. Grants keep the 7-day sliding lifecycle; proofs never renew
  past grant expiry. Cookie namespace is `baci-cart-<merchant-slug>` so
  same-host merchant tabs stay separate.
- Scoped PostgREST tokens reuse the existing `signScopedSupabaseJwt`
  infrastructure with role `commerce_cart_shopper` / `commerce_cart_receiver`
  and a 5-minute TTL; the broad `authenticated` role is never minted.
- Enrollment flags `shared_cart` / `shared_cart_realtime` extend the
  existing `merchantHasFeature` mechanism with empty plan tiers: disabled
  by default, explicit `premium_features` grant only.
- Bounded cleanup `cleanup_commerce_carts()` (definer, fixed search path,
  worker-only execute) deletes only past-horizon receipts/events and
  flips only checkout-free expired carts.

Still gated, not proven here: `CART_SESSION_SECRET` production
provisioning (requires explicit environment approval; issuance fails
closed until then); the `realtime.messages` receive policy (Task 8);
worker connection wiring under `SET ROLE` (Task 8); the ES256 JWK
signing path against a full local Supabase stack (HS256 legacy path
proven; full `supabase start` was skipped because a peer stack holds
the default ports).

## Task 3 command and pricing rules

- One RPC per write (`commerce_cart_create`, `commerce_cart_mutate`)
  plus a read-only `commerce_cart_snapshot`; definer with empty search
  path, shopper-only EXECUTE, claim and grant-liveness rechecks inside.
  Lock order everywhere: advisory op-key lock, then cart rows FOR UPDATE
  in `(merchant_id, id)` order.
- Replay before version evaluation. Receipts store the full committed
  raw state with offers; replays return it plus the live
  `currentVersion`. Same key plus different body conflicts; a pruned
  body (digest tombstone) conflicts with the current snapshot rather
  than re-executing. Receipts retained 7 days with the cart.
- No-ops (absent removal, empty clear, same quantity) succeed, preserve
  the version, and still write receipts. Stale versions conflict with
  the current snapshot; the service never rebases.
- Offer resolution mirrors `/api/cart/validate`: active status,
  merchant ownership, variant belonging; unit price is variant override
  else product price, in minor units (`round(major * 100)`). No
  inventory reservation; stock is reported, never blocking.
- Removals and reductions skip availability checks and succeed during
  catalog outages; additions and increases fail `invalid_item`.
  Unavailable lines keep their last known price with `estimatedTotals`
  and a stale-total warning.
- Voucher lines pin quantity 1 and stay distinct per voucher identity;
  quiz voucher lines price at zero (checkout verifies the token).
  Negotiated prices apply only while below the live catalog price;
  otherwise the line reprices to catalog with an invalidation warning.
  A supplied negotiated price without status stores as `accepted`.
- Option values are stored verbatim; variant/condition existence is
  enforced, value-level option validity at checkout (existing
  behavior). `replace` keeps stable line IDs for unchanged identities.
- TS service/repository/pricing import no Next.js runtime modules and
  take an injected client, so the standalone MCP worker can reuse them
  (Task 4 proves the worker boundary separately).

## Task 4 legacy migration and fencing

- `commerce_cart_migrate_legacy(provider, hash, op, lines, version,
  currency)` runs under a bootstrap principal: advisory lock per legacy
  key, convergent mapping in `commerce_cart_legacy_refs`, exactly one
  initial grant, catalog-validated lines with preserved
  identity/quantity and catalog pricing. Unknown handles report
  `not_found`; invalid lines fail `invalid_item` with nothing fenced.
- A principal that already migrated one legacy token gets
  `refresh_required` plus its existing cart for any other token: a
  second legacy cart is never attached and never duplicates. Replays
  require a live grant for the mapped cart, else `unauthorized`.
- Optimistic fencing closes the read-then-migrate window: MCP matches
  the legacy row version, UCP matches `updated_at`; a mismatch returns
  `refresh_required` for re-read and retry. Fencing and creation commit
  atomically in the RPC.
- Retired rows are fenced for every writer by UPDATE triggers on
  `mcp_guest_carts` and `agentic_cart_sessions`; retention DELETEs stay
  allowed. The MCP store checks the fence lookup before validating or
  extending TTL and maps mid-flight fence trips to
  `GuestCartMigratedError`; UCP writes get `UcpCartMigratedError`
  (`refresh_required`, retryable) via the storage guard, wired into
  routes in Task 10.
- MCP tool input accepts only two new optional fields,
  `expectedVersion` and `operationId`, for canonical writes (Task 10).
  Legacy TTL/expiry and guest UX semantics are unchanged.
- Worker boundary proven: service, repository, pricing,
  mutation-errors and legacy-migration import and run in bare Node via
  tsx with no web runtime; `worker-boundary.test.ts` trips on any new
  `server-only`, `@/`, `next` or `zod` import.

## Task 5 HTTP endpoints and route authority

- `POST /api/storefront/cart/bootstrap` mints a 15-minute bootstrap
  proof for the resolved merchant; it creates no cart, account or auth
  session. `GET /api/storefront/cart` returns the authorized snapshot
  for a session proof and sets no cookie. `POST
  /api/storefront/cart` lazily creates one cart per operation id and
  returns the upgraded session proof. `POST
  /api/storefront/cart/commands` consumes `CartMutationInput`.
- Merchant resolution trusts proxy `x-merchant-slug` /
  `x-merchant-domain` headers only when they match the request Host
  (mirroring the shipping-quote trust rule); otherwise a slug/domain
  hint from query or bootstrap body resolves through the established
  `resolve_storefront_auth_merchant` mapping plus the retired-slug
  alias table. Only published stores resolve. Forwarded-host headers
  are never consulted, and body JSON can never override the host.
- Proofs travel in the merchant-namespaced HttpOnly cookie (web) or
  as `Authorization: Bearer cp1…` (native secure storage); only
  `cp1.`-prefixed Bearer values are cart proofs, so Supabase JWTs
  never enter the cart flow. Responses always carry `Cache-Control:
  private, no-store`; two stores on one origin keep separate cookies
  and never share cached state.
- Browser POSTs pass the existing double-submit CSRF check; Bearer
  requests skip it per current policy. Typed `{code, error}` bodies
  map failures to 400/401/403/404/409/429, with outages as 503 —
  never confused with 404 not-found/expiry. Bootstrap proofs read as
  `not_found` on session routes; session proofs are `forbidden` on
  the creation route.
- Quotas layer tenant/principal Redis window counters (bootstrap
  30/h, create 10/h, commands/snapshot 240/min) over the proxy
  per-IP rate limit, which gains a tight 20/min bootstrap bucket.
- `commerce_cart_create` returns the server-minted `grantId` on fresh
  and replayed outcomes (migration 20261012050400, additive key only)
  so routes can issue the session proof; `CartResult` carries it as
  an optional field and routes fail closed when it is absent.
- No proxy changes were needed: `/api/*` already passes through API
  security (rate limit, content-type, origin) on subdomains, custom
  domains and the root host.
