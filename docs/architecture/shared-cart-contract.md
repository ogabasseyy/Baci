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

Pending. The local Supabase role/token spike (Task 2) records its
pass/fail here before any path activates. Failure of the cart
authorization proof blocks the cart pilot; a realtime-only limitation
permits a fetch-only pilot.
