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

- [x] Task 1: baseline + shared contract (this phase; see evidence below)
- [ ] Task 2: scoped guest access + canonical schema
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

Review handoffs: Phase A packet after Task 2 (Task 1 commits stay
reviewable per task; coordinator reviews per phase).
