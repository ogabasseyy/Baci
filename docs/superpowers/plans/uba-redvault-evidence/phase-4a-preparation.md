# Phase 4A — Web REDVAULT preparation

**Status:** READY FOR PARENT REVIEW — WEB PREPARATION. This is not Phase 4 acceptance or a live feature.

## Scope completed

- Added an isolated `RedvaultPaymentOption` presentational component and colocated tests only.
- The component accepts explicit availability, selection, pending/held/error state, callback, and the frozen server quote summary fields.
- It formats and displays server-provided totals without calculating discounts, makes no provider/network calls, contains no card input or brand list, and is not imported into checkout.
- Unavailable options are hidden; mixed baskets say savings apply only to eligible items; all-excluded baskets cannot select REDVAULT; held capture state directs customers not to pay again while approval remains pending.
- Parent-review copy and token follow-up: status and focus styles use semantic/storefront tokens, savings copy avoids internal server terminology, and held capture copy tells customers not to pay again while verification is pending.

## Validation

- `pnpm --filter @baci/web exec vitest run src/components/storefront/ogabassey/pages/checkout/components/redvault/RedvaultPaymentOption.test.tsx` — 1 file / 7 tests passed.
- The repository Biome configuration intentionally excludes Ogabassey storefront paths, so direct path checks report them ignored. Scoped stdin-file checks were run against both new source files with `pnpm exec biome check --stdin-file-path` from `apps/web`.

No checkout integration, shared/backend/SQL change, activation, provider call, card handling, branch, commit, push, deploy, production access, payment, or email was performed.
