# PR 3616 — round 12

## Valid findings fixed

- Native product-request success now resets when a new query replaces the closed, idle form. An open or pending form retains its in-flight request identity and edits.
- Native refinement fields have colocated behavior coverage for accordion access, available options, retained brand selections and draft callbacks.
- Missing breadcrumb coverage and incorrectly named hook test extensions are repaired without changing production navigation.
- The two new price-option migrations and restricted intake migration are registered with byte-pinned replay fixtures.
- Owner approved changing the unmerged product-request migration on 2026-10-04: Cron scheduling is guarded when the extension is absent. The complete migration passes a disposable PostgreSQL fixture with Cron absent and present.
- Product-request submission now uses a signed `storefront_intake` role token through the public gateway key. The appended migration grants the intake RPC, revokes other callers, and denies direct request-table access. Regression checks exercise actual submission and inspect permissions.

## Findings not adopted

- A mandatory browser cookie/token for `/api/search/assist` would break the native sessionless public caller. This endpoint uses no authenticated session authority; the existing proxy checks browser origins and distributed IP limits, and the route validates input, resolves its configured tenant and checks a distributed tenant budget. Added proxy regression coverage for foreign browser origins, same-origin callers and native callers without Origin. This follows the current route-specific AGENTS.md contract.
- Native currency labels match the current NGN-only storefront, product formatter, cart and checkout contract. Native merchant metadata has no currency field. A non-NGN native build requires currency support across that contract; changing just the price labels would misrepresent amounts. Web already derives its labels from merchant currency.

## Release prerequisites

Provision the signed restricted-role credential in the existing `SUPABASE_STOREFRONT_INTAKE_KEY` server setting after applying the new migration. No credential or deployment was changed in this review. Missing, malformed or privileged credentials fail closed with the existing safe 503 response. Provision Cron in production for merchant inbox delivery; intake remains queued when Cron is absent. Local fixtures do not establish deployed permissions or delivery.

## Review gate

Full monorepo lint and typecheck pass locally (existing lint warnings remain). CodeRabbit rejected `review --agent -t uncommitted` on this round with `Rate limit exceeded`: all three included reviews are used, the selected organization has no assigned usage-based seat, and the CLI reports a 31-minute wait. The owner explicitly authorized pushing despite this incomplete gate. The preceding PR head was `239bd8cc0503ddc142846e80cc353faafb233a46`; its earlier CI/review does not cover these changes. The committed-source inventory snapshot is regenerated after the fix commit before pushing. A fresh review and CI are still required for the pushed head.

## Local verification

- Full monorepo lint: 4 tasks passed. Full monorepo typecheck: 6 tasks passed.
- Targeted web suites pass: intake helper/route, product-selection hooks, breadcrumb, Origin protection and migration-source fixtures.
- Native request/refinement suites: 9 tests passed on the serial rerun.
- Complete intake migration plus restricted-role migration: actual submission and permission assertions pass with Cron absent and present in disposable PGlite databases. No deployed database was changed.
- Existing native and replay-copy tests timed out under concurrent worktree suite load; serial reruns with extended local timeouts pass. The test timeout configuration in the repository was not changed.
- Web query-reset parity verified at the caller's `key={searchQuery}`.
