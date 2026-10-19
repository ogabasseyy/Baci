# Shared-cart coordinator review — 13 October 2026

Scope: review and corrective fixes to `codex/shared-server-cart` at
`33a9a265c4`; no remaining implementation tasks, production changes, or live orders.
Worktree: `/Users/mac/Baci-app/.worktrees/shared-server-cart`.

## Review disposition

CodeRabbit committed review completed, covered all 138 changed files, and
reported six issues. Each was checked against source; all six were valid:

- REDVAULT returned before cart binding: reject the unsupported shared-cart
  combination before draft/order creation, with an actionable payment message.
- External storage/session clear did not reach the provider: subscribe the
  provider to the existing generation notification and restart adoption.
- Abandoned checkout pointers kept carts active indefinitely: expiration now
  checks actual active/unexpired checkout sessions instead of pointer presence.
- Missing sliding expiry: version-changing mutations renew only the current
  cart and live principal grant, and the command route returns/sets a renewed
  session proof capped by the authorized cart lifetime.
- Unindexed receipt/reference foreign keys: add the three supporting indexes.
- Line-count schema test used invalid UUIDs: use valid IDs and prove both the
  20-line accepted and 21-line rejected cases.

Independent coordinator review also reproduced and fixed:

- Final submission accepted missing, changed, duplicate, or foreign line items
  despite a correct cart version. The final database transaction now matches
  the complete item multiset by stable line ID, product, variant, condition,
  options, quantity and voucher award before calling any order RPC.
- A first-time handoff visitor had no proof for redemption. Explicit Connect
  now establishes bootstrap identity, preserves it across uncertain retries,
  and scopes redemption by merchant. Read-only preview never bootstraps.
- Destination lookup outages were mistaken for an empty cart: stop the handoff
  instead of offering an unsafe empty-cart choice.
- Shared-origin web requests omitted merchant context after bootstrap: carry
  the merchant hint on reads, creation, commands and checkout preparation.
- Query-selected merchants could override a dedicated storefront host: derive
  tenant context from that host and verify the resolved merchant's host mapping.
  Shared root hosts may select published merchants using the existing hint flow.
- Confirmed option metadata was dropped from checkout variant attributes:
  preserve the full canonical option map in the confirmed display item.
- Expired carts could prepare/finalize checkout: reject them in both boundaries.
- Valid high-value baskets overflowed int32 checkout totals: aggregate minor
  units as bigint (JSON numeric output remains unchanged).

Existing migration files are unchanged; database corrections are in the new
append-only `20261013195818_commerce_cart_review_binding_guards.sql` migration.
All database validation uses a fresh local Unix-socket PostgreSQL cluster and
transactional fixtures with mocked order RPCs. No production credentials,
customer carts, orders, payments, shipments, or deployments were used.

## Verification evidence

Behavioral RED was observed before each runtime correction: unrelated order
items accepted, shared-host hint omissions, guest connect missing bootstrap,
outage offering Connect, generation notification ignored, REDVAULT returned
201, absent renewed proof, abandoned cart remained active, mutation expiry
unchanged, option metadata lost, host mapping bypass/missing fallback, and
`integer out of range` on a ten-unit high-value basket.

Current passing evidence:

- Initial focused cart suites: 411 tests across 37 files.
- Final cart/checkout regression run after dependency restoration and the final
  recovery fix: 1,901 tests across 280 files passed.
- Latest focused changes: 243 tests across five files.
- Monorepo typecheck: six tasks passed.
- Monorepo lint: four tasks passed; existing native warnings remain.
- PostgreSQL access, commands, create-grant, legacy-migration, handoff,
  final order-binding, and coordinator guard suites pass with the corrective
  migration applied; all transactional suites finish with ROLLBACK.
- Real two-session bound submit, prepare, and same-operation prepare races
  all pass with the corrective migration; only mocked fixture order rows exist.
- CodeRabbit first uncommitted pass completed with one message finding, which
  was fixed. Final staged CodeRabbit review completed over all 24 correction files,
  including the new SQL migration/tests. It reported one destination-outage
  messaging/retry issue; corrected with an observed failing regression, then
  all nine handoff component tests passed. No zero-issue rerun is claimed.

## Remaining boundaries

The original Tasks 1–7 and 11A are implemented. Tasks 8–10, 11B and 12–14
remain unimplemented. Realtime, linked MCP/UCP/native behavior, operational
activation, and production QA are not claimed complete. Feature grants and
production signing/role setup remain gated. The original documented group-deal
remote invalidation limitation remains a pilot gate for the later phases.
The independent Muse branch is untouched; do not combine both implementations.

Review corrections are local, staged, and uncommitted. Final web typecheck
(including tools-workers/MCP), focused regression tests, SQL checks and
whitespace checks passed. Monorepo lint/typecheck passed earlier in this review.

The full monorepo test attempt is **not a clean gate**. During a temporary
original-commit comparison, pnpm dependency verification unexpectedly began
rebuilding the shared local dependency directory, invalidating the concurrent
native test run with missing-file errors. It was stopped; the task worktree's
dependencies were restored offline from the frozen lockfile, and final cart
tests plus representative native tests passed. No dependency source/config or
lockfile changes were retained. The temporary comparison worktree was removed
and the private local PostgreSQL cluster stopped.

Three repository integration failures were independently reproduced at the
original unchanged `33a9a265c4` commit (14 passing / 3 failing tests):
`supabase-history-replay-primary-pending-sources.test.ts` (migration registry),
`storefront-edge-inventory-snapshot.repository.test.ts` (frozen inventory), and
`verify-analytics-delivery-authority.repository.test.ts` (authority ledger).
The broader attempt also reported related history replay/authority/inventory
failures noted by the original implementer. They are remaining branch
integration gates, not waived by these focused successes. Completing the
remaining plan/registration gates and obtaining clean final CI are still
required before merge. No remaining implementation phase was started. No merge, deployment, or continuation of the remaining plan is authorized
by this review report itself.


## Owner-approved selective Muse improvements

After comparing the branches, the owner authorized taking UUID normalization
and useful validation regression coverage into `codex/shared-server-cart`.
The Muse worktree remains unchanged; no commits or whole contracts were merged.

- Product/variant IDs now normalize to lowercase in `cartLineIdentity`, matching
  PostgreSQL UUID equality. Option keys/values remain verbatim, including empty
  values and case-sensitive selections; inputs are not mutated.
- Added 17 shared tests covering the UUID regression, identity preservation,
  separator collisions, quantity boundaries and complete replacement validation.
- Added a web reducer regression proving an optimistic uppercase-UUID add can
  resolve a pending quantity edit against the lowercase server line ID.
- Added a transport-boundary regression retaining expectedVersion >= 1 and
  operation IDs <= 128 characters. No Muse version-0/200-character contract
  changes were imported.
- TDD evidence: 2 failing UUID tests / 36 passing shared cart tests before the
  fix; 38/38 shared cart tests after it. Full shared package: 229 files /
  1,591 tests passed. Focused reducer/schema consumers: 63 tests passed.
- Fresh verification completed on 2026-10-14: full monorepo lint (4 tasks)
  and typecheck (6 tasks) passed. CodeRabbit completed review of all 27 changed
  files with 0 issues.
- The full monorepo test run completed in 18m54s: 5 tasks passed and web failed.
  Mobile storefront passed 1,440 suites / 8,572 tests; mobile admin passed
  913 test files. Web passed 7,643 files / 49,142 tests, with 11 failed files
  comprising 13 failed assertions and 2 suite setup failures. Both suite setup
  failures are migration-registry mismatches. Assertion failures concern the
  pending migration registry, frozen source inventory, analytics/event authority,
  and Cloudflare tooling's clean-worktree prerequisite (this patch is intentionally
  uncommitted). The previously reproduced original-commit gates are described
  above; the full suite is not clean and these integration gates remain open.
  No cart regression was reported by the completed run.

This selective improvement does not resume Tasks 8–14 and authorizes no merge,
deployment, production database changes, or live orders.
