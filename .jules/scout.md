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
## 2026-11-10 — Test coverage for /api/search

**Learning:** Mocking `@/lib/supabase/server` and `next/headers` lets the Vitest route suite exercise the real `searchStorefrontProducts` helper (including `search_products_v2` / `find_product_search_suggestion_v2` RPC orchestration) alongside query validation and HTTP response mapping.
**Action:** Mock the Supabase client and cookie store at the framework boundary when testing API route handlers that delegate to shared library query helpers.
**Source:** Vitest 4 `/api/search` route test suite, verified 2026-11-10.
