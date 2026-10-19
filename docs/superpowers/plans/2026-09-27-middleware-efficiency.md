# Middleware efficiency follow-up

## Scope and baseline

Owner authorized five bounded assignments after PR #3513. Baseline:
`58d402a20f1aa5188239cc114e091ebc6020d74d` (current origin/main at start).
Branch: `codex/middleware-efficiency`.

Preserve the older dirty middleware-cost-followups worktree. Carry forward
only changes still needed against the merged security fixes. No deployment,
provider mutation, CSP enforcement, TTL expansion, migration, or protected
`proxy.ts` change is part of this patch.

## Assignments and ownership

1. Request fast paths: platform/subdomain routing and focused tests. Avoid
   unnecessary domain resolution and normalization without changing redirects.
2. Tenant caching: domain-cache helpers and tests. Audit existing TTL,
   coalescing and invalidation; do not add a redundant authority cache.
3. Preflight: storefront preflight coordinator and focused tests. Eliminate
   repeated admission checks for requests already ineligible for preflight.
4. Matcher/cache isolation: audit matcher boundaries; harden public HTML
   admission and response headers without bypassing security or tenant routing.
5. Measurement: reproducible bounded cost evidence and stage measurements.
   Distinguish helper calls, provider calls, elapsed time, CPU and actual billing.

Agents own non-overlapping files. Parent reviews combined behavior and runs
web-package lint/typecheck plus relevant integration tests. Runtime changes
require failing regression evidence before implementation and passing tests
afterwards. No production benchmark or dollar-saving claim without evidence.

## Progress

- Tenant cache audit: no runtime change justified. Existing 60-second positive
  Edge Config cache, five-minute DB fallback, SingleFlight and invalidation
  fences already address this requirement. Parent ran seven suites: 46 passed.
- Request fast paths: implemented, with 10 regression failures before the
  change and 21 focused tests passing afterwards. Optional domain resolution
  drops from one helper call to zero on excluded request classes.
- Preflight admission: implemented, with five regression failures before the
  change and 21 focused tests passing afterwards. Five verdict dispatches
  become zero for non-documents; database calls were already zero.
- Matcher audit: no further exclusion justified. Tenant favicon/sitemap
  rewriting, API security, prefetch routing and configurable relay sanitization
  prevent blanket exclusions. Protected `proxy.ts` remains unchanged.
- Cache isolation: implemented without extending TTLs or eligibility. Header
  admission regressions reproduced before the change; 445 focused/integration
  tests passed afterwards. This is correctness hardening, not claimed savings.
- Measurement harness: 13 offline work-count cases pass. No production logging
  or paid telemetry added. Baseline/candidate provenance is in the evidence doc.
- Parent combined validation: 608 tests across 48 files passed; the additional
  measurement suite has 13 passing cases. All 66 proxy files pass Biome.
- Web package lint/typecheck passed; lint reports eight pre-existing warnings
  outside this patch. Final rerun including the measurement harness also passed.
- CodeRabbit completed the final review of all thirteen patch files with zero
  findings. Parent reviewed combined behavior, evidence and scope decisions.

## Decisions

- Keep existing authority-cache TTLs and miss precedence. Another warm cache
  would change freshness guarantees without a demonstrated incremental benefit.
- Comparison manifest/revision machinery already exists on this baseline; do
  not rebuild it. No catalog graph or database migration is needed for the
  small preflight admission optimization.
- Use offline work-count evidence first. Do not add paid per-request logs or
  production telemetry export as a side effect of investigating hosting cost.

## Release gates

- Relevant regression and proxy integration tests.
- Web lint/typecheck; report baseline failures separately.
- CodeRabbit local review and resolution of valid critical/high findings.
- PR review/merge/deployment remain separate from local completion.

## Safety invariants

- Unknown/degraded preflight results must not become hard missing responses.
- Domain authority freshness and invalidation must remain unchanged.
- Preserve mutation methods, forwarding headers and canonical redirect order.
- Never cache authenticated or RSC/router-data responses as public HTML.
- Do not infer compute or invoice savings from modularity alone.
