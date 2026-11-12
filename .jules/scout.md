# Scout Notes

## 2026-06-28 — Test-only guardrails rollup

**Learning:** Small route/schema/security utility tests can be safely folded together when they add coverage without changing runtime behavior. Avoid importing stale PR branch runtime files wholesale; cherry-pick only the intended test files to prevent silent reverts.
**Action:** For stale Scout branches, reapply the test intent on top of current `main`, then run the specific test files and inspect the resulting diff before closing duplicates.
**Source:** PRs #2747, #2786, #2807, and #2826, verified against current main on 2026-06-28.

## 2026-07-01 — Testing hooks through React renderHook

**Learning:** Simple config hooks still run inside React's dispatcher contract and should be tested with React Testing Library's `renderHook` instead of direct function calls.
**Action:** Use `renderHook(() => useHook(...))` for hook test coverage, including no-argument fallback cases and representative valid keys.
**Source:** React Testing Library `renderHook` API, verified 2026-07-01.

## 2026-07-01 — Test-only folds must stay runtime-clean

**Learning:** Coverage-only branches are safe to fold when they add isolated tests and do not import stale runtime changes from their source branches.
**Action:** Cherry-pick only the intended test files for notification routes and performance hooks, then run those exact tests before closing the source PRs.
**Source:** PRs #2892 and #2859, verified against current branch on 2026-07-01.
2024-11-10 — Test coverage for /api/search
Learning: When mocking Next.js API routes, it's necessary to mock the underlying Supabase helpers (`searchStorefrontProducts`, `createClient`) as well as `next/headers` to isolate the validation and HTTP response mapping layer.
Action: Apply standard Next.js route handler mocking approach when testing APIs that interact directly with Supabase via library functions.
Source: Vitest 4
