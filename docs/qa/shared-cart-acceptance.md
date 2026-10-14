# Shared server cart: acceptance evidence

Status: local implementation evidence only. No deployment, live
migration, customer-cart mutation, order, or payment has occurred.
CodeRabbit review is pending (unavailable in this worktree session).

## Executed locally

| Area | Evidence |
| --- | --- |
| Tenant/guest isolation, atomic commands, handoff, account transactions | Disposable PostgreSQL suites under `supabase/tests/commerce_cart_*.sql` (prior checkpoints; re-run before release) |
| Web cart optimistic sync, fetch recovery, realtime lifecycle | `apps/web/src/hooks/cart/*.test.ts` |
| Native pairing, durable command recovery, single-writer fencing | `apps/mobile-storefront/lib/cart/*.test.ts`, `hooks/use-shared-cart.test.ts` |
| Native account link (separate shopper/cart authority, owner-subject recovery) | `lib/cart/shared-cart-client.test.ts` |
| Native checkout review (preparation only, stale-review refusal, bound submit payload) | `hooks/use-cart-checkout-snapshot.test.ts`, `components/checkout/checkout-submit-order-request.test.ts` |
| UCP migrated-cart gate + caller scoping | `src/app/api/agentic/carts/[id]/route.test.ts`, `src/lib/cart/ucp-adapter.test.ts` |
| UCP canonical replacement planning, version races, caller-scoped receipts, transfer-only creation/readiness | `src/lib/cart/ucp-adapter.test.ts`, `src/lib/agentic/idempotency.test.ts`, `src/lib/agentic/ucp-shopping-profile.test.ts`, cart route tests; caller-scope migration validated on a disposable PostgreSQL cluster (same-caller conflict, cross-caller insert) |
| Order/payment effects in tests | Mocked throughout; no real order was submitted |

## Pending qualification (not executed)

- Two linked real clients (browser + device) converging over the
  private realtime topic; native transport is HTTP recovery only.
- iOS/Android app-link delivery, native CSRF handshake on devices.
- Two-merchant × two-guest live matrix, SEO/canonical comparison, and
  LCP/INP/convergence measurements with the storefront harness.
- UCP: platform-principal delegation into the canonical RPC service
  (needs its own scoped role and SQL proof), two-context browser
  concurrency execution (`tests/checkout-browser/shared-cart-concurrency.pw.ts`
  is authored and listing-verified, not yet run against the fixture
  stack), and official re-verification of the pinned `2026-04-08`
  profile before any external enrollment claim.
- Full monorepo test suite and final review at a reviewed commit.

## Invariants checked by design

- Guest checkout never requires an account; a save-details choice never
  establishes account authority (linking is an explicit button only).
- Signing out revokes only that device's cart grants; the shared cart
  itself is never cleared by sign-out.
- A canonical native cart never downgrades to legacy checkout after an
  error; stale checkout reviews return to the review step.
- Only remaining, available reviewed lines enter a bound order, with
  `shared_cart` and per-item `cart_line_id` preserved through request
  validation, credit freezing, and queued replay.
