# Shared server cart: implementation progress

Worktree: `/Users/mac/Baci-app/.worktrees/shared-server-cart`
Branch: `codex/shared-server-cart`
Baseline: `origin/main` `88c83cc672d7716cb55e05132d95dc14582a8d43`
  (12 October 2026; release checkout `ebfd7e6e7f` is 2 commits behind).
Plan SHA-256 at copy: `1fda75a15f3848ab03388c80ecc1e68351433e6cd47b7bac7bd6f0adbbaf98c2`
  (matches the Luna review integrity record; originals preserved).

Product requirements: guest checkout, safe continuity across merchants,
ChatGPT, web and mobile. No merge, deploy or live orders from this work.

## Task status

- [x] Task 1: baseline + shared contract (see evidence below)
- [x] Task 2: scoped guest access + canonical schema (see evidence below)
- [ ] Tasks 3–14 per dependency order
  (1 → 2 → 3 → 4 → 5 → 6 → 7 → 11A → 8 → 9 → 10 → 11B → 12 → 13 → 14)

## Task 1 evidence

Source references: `docs/architecture/shared-cart-contract.md` (paths,
limits, grants, route protection refreshed against baseline).

TDD:
- RED: `pnpm --filter @baci/shared exec vitest run
  src/cart/line-identity.test.ts src/cart/commands.test.ts` →
  2 files failed, 14 tests failed / 5 passed. Failures were behavioral
  assertion failures against naive stubs (product-only identity key,
  accept-all command validator), not syntax/runner errors.
- GREEN: implemented `line-identity.ts` (sorted-option JSON identity
  key, unknown values preserved) and `commands.ts` (structural
  validation with inherited 20-line / 10-per-line bounds).
  `vitest run src/cart` → 2 files, 19 tests passed.
- `pnpm --filter @baci/shared typecheck` → clean.
- Full `@baci/shared` suite + Biome check on changed paths → see phase
  commit message for results.

Decisions:
- Shared contracts are dependency-free TypeScript; Zod stays with
  adapters (plan's `packages/shared` vs `apps/web/src/schemas` split).
- Canonical bounds adopt the strictest enforced existing values
  (MCP 20 lines / 10 per line / 7-day TTL); the web 50-line validate
  slice stays a legacy transport bound.
- Amounts in minor units; adapters convert from existing float prices.

## Task 2 evidence

New modules: `apps/web/src/lib/cart/{cart-runtime-env,session-proof,
principal,scoped-client}.ts` with colocated tests; migrations
`20261012050000_commerce_cart_core.sql` (8 tables, RLS enabled, indexed
FKs) and `20261012050100_commerce_cart_roles.sql` (3 dedicated roles,
narrow grants, claim-checked RLS policies, `cleanup_commerce_carts()`);
`supabase/tests/commerce_cart_access.sql` (14 isolation sections);
`shared_cart`/`shared_cart_realtime` enrollment flags via
`merchantHasFeature` (disabled for all plans; explicit grant only) plus
required `FEATURE_MESSAGES` entries.

TDD:
- JS RED: 23 behavioral failures on naive stubs (accept-all verifier,
  unnamespaced cookie, broad-role minter).
- JS GREEN: 25/25 pass (`session-proof`, `principal`, `scoped-client`
  suites, incl. a wrong-secret forgery test added from review feedback);
  `merchant-has-feature` + 2 consumer suites pass.
- SQL RED: first assertion failed under the policy-less roles stub
  (`permission denied`, legit shopper denied).
- SQL GREEN: all 14 sections pass on disposable PostgreSQL 18.6 with
  real roles (`psql -X -v ON_ERROR_STOP=1 ... -f
  supabase/tests/commerce_cart_access.sql` → ROLLBACK, no residue).
- REST GREEN: 9/9 assertions over real HTTP against PostgREST v13.0.5
  with real HS256 JWTs (own-cart read, wrong-merchant empty, receiver/
  anon/broad-authenticated denied, expired JWT 401, bootstrap insert
  accepted with owner-verified row, cross-merchant insert denied).
  Harness kept under `/tmp/baci-cart-rest-proof/` (throwaway probe, not
  committed); durable collateral is the SQL test above.
- `pnpm --filter @baci/web typecheck` clean (incl. tools-workers, mcp);
  `@baci/shared` typecheck + 19 cart tests still green after the
  `VerifiedCartSession.grantId: string | null` bootstrap correction;
  Biome clean on all touched files.
- CodeRabbit (uncommitted): 2 minor findings, both fixed and re-proven —
  composite FK now `ON DELETE SET NULL (cart_id)` (SQL §15 pins the
  receipt survives with merchant intact); cleanup fn follows the MCP
  precedent (no vacuous definer caller check, explicit
  `REVOKE ... FROM PUBLIC, anon, authenticated`, owner postgres).
  SQL suite extended to 15 sections, still green.

Decisions:
- Proofs are HMAC-SHA256 `cp1` with env/aud binding, absolute TTLs
  (24h session capped at grant expiry, 15m bootstrap), rotation via
  previous secrets; DB grant liveness is rechecked per statement by RLS.
- Session grants allow add/set_quantity/remove/clear; `replace` stays
  reserved for platform adapters with preconditions (Tasks 3/12).
- No direct shopper writes except bootstrap cart/receipt creation; no
  grant minting outside the Task 3 creation RPC; receiver has zero table
  access until Task 8's topic policy.
- Proof replay within TTL is inherent to bearer proofs; mitigated by
  short TTLs, per-statement RLS rechecks and (Tasks 5–6) Secure/HttpOnly
  host-only cookies. JWT `exp` is enforced by PostgREST (proven 401).
- Existing customer/merchant sessions untouched: new modules make no
  auth calls, use a separate `baci-cart-<slug>` cookie namespace, and
  cart roles hold no grants on customers/orders (proven in SQL §13).

Review handoffs: Phase A packet after Task 2 (Task 1 commits stay
reviewable per task; coordinator reviews per phase).
