# Middleware modularization — local evidence

Updated: 2026-09-27. Branch: `codex/middleware-modularization-20260912`.
Local implementation and review evidence only; no deployment or measured bill reduction.

## Implemented scope

- Replaced the large proxy coordinator with a 192-line entrypoint and 32
  responsibility-focused modules, each below 300 lines. Preserved literal matcher,
  routing precedence, security guards, cache TTLs and fail-open verdicts.
- Added merchant trace attributes after existing trusted custom-domain resolution,
  without another lookup.
- Coalesced compatible overlapping cold public preflight RPC calls per instance.
  Keys include function, sorted arguments, empty-result semantics, timeout,
  environment and transport identity. Arguments/options are captured before
  deferred execution. Tracking is bounded; memo and circuit-breaker behavior remain.
- Moved the preview environment guard before memo access.
- Replaced the domain-cache admin fallback with anonymous scalar RPCs. Errors,
  malformed responses and unavailable configuration do not poison negative caches.
  Edge Config precedence, existing TTLs and invalidation fences remain.
- Four middleware consumers use a focused internal-secret accessor, preserving
  runtime override, module-load fallback, browser rejection and authentication.
  Removed obsolete exact credential paths; added no authority exceptions.
- Preserved current-main shared route sets and the recent `/unlock-orders` fix.
  Exact page, retired-alias suffix and API paths have regression coverage.
- Fixed an existing session redirect defect found during review: refreshed/cleared
  Supabase cookies now survive both redirect branches with their attributes.

## Expected cost effect

A deterministic regression reproduces ten simultaneous identical cold calls
starting ten RPCs before the change and one afterward: **90% fewer RPC starts
for that overlapping burst on one warm instance**. All ten incoming middleware
invocations still occur. Sequential reads already use the short memo;
cross-instance bursts are not coalesced.

Module extraction improves auditability; it does not itself demonstrate lower CPU
billing. No production CPU, memory-duration or dollar saving has been measured.

## Current-main integration and checks

Rebased onto `9f98f16a1bbba6ef01fb7ac9fa57d139cf66df03`.
Shared route configuration is unchanged from that base.

- Combined affected routing, cache, RPC, credential and live-boundary checks:
  **621 tests / 56 files passed** before the final redirect-cookie correction.
  Log: `/tmp/baci-middleware-rebase-integration-20260926.log`.
- Final redirect-cookie correction: **421 tests / 2 files passed** (session
  module plus proxy integration); both new tests failed before the fix.
  Independent Terra review passed.
- Affected-web lint/typecheck passed after integration, including Next typegen and
  tools-worker types. Eight unrelated warnings, no errors.
  Log: `/tmp/baci-middleware-rebase-static-final-20260926.log`.
  The later cookie correction passed focused Biome checks; final push gates remain
  separate.
- Inventory input regression: reproduced the obsolete analytics entry introduced
  during conflict resolution; removed it to match current main. All five input-list
  tests and focused Biome checks pass.
- Local CodeRabbit review completed with two findings: the cookie-loss bug was
  fixed and independently reviewed; migration-before-runtime is an open deployment
  prerequisite, not claimed completed.
  Log: `/tmp/baci-middleware-rebase-coderabbit-20260926.log`.

## Inventory authority

Current main already separates repository snapshot regression checks from
operational source qualification. The historical baseline ancestry failure is
therefore not a current squash-merge blocker. Keep this existing design:
repository snapshots compare committed source content, while operational evidence
requires its independently supplied exact source SHA and qualified tooling.

The snapshot was regenerated from committed source
`7db065d8daf8b5b7d9f8ce0fd2c01b02d118e125`: digest
`58a94d11ed03ceffb11aebd53b579e9fc87a40910ac36bb27dea36699a6091d4`,
557 unchanged route decisions. Only source identity, routing-input digest and
inventory digest changed. The repository digest assertion was updated.
No authority guard or provider qualification was weakened.

Final snapshot, operational, squash-history and input-list checks passed: 30 tests
across five files. Log: `/tmp/baci-middleware-final-snapshot-20260926.log`.
Final monorepo typecheck passed all six tasks (five cache hits):
`/tmp/baci-middleware-final-monorepo-types-20260926.log`.

The source-input correction received a zero-finding CodeRabbit review before its
commit. The subsequent review attempt for the generated snapshot and digest
assertion was rate-limited with a 48-minute retry window:
`/tmp/baci-middleware-final-snapshot-review-20260926.log`.
On 2026-09-27 the retry completed with zero findings across the generated artifact,
digest assertion and evidence document. Log:
`/tmp/baci-middleware-final-review-20260927.log`. The 30 tests across five inventory
files passed again: `/tmp/baci-middleware-snapshot-20260927.log`.
No paid-credit review was requested. This completes the local review gate, not
GitHub CI, remote migration verification or deployment approval.

## SQL validation and release gates

The fixture `supabase/tests/public_storefront_domain_resolution.sql` passed on a
disposable local PostgreSQL 18.6 database and rolled back. It checks anon and
authenticated scalar execution, table-access denial, ACLs and fixed search paths.
Independent review verified that an erroneous PUBLIC execution grant makes the
test fail. This is not a full production-schema replay or a remote migration.

Before runtime deployment:

1. Apply `20260926120000_public_storefront_domain_resolution.sql` to each target
   database and verify the scalar RPC privileges and absence of new table grants.
2. Check active-domain Edge Config coverage and domain resolution during rollout.
3. Obtain current-head CI/review and any required migration/release qualification.
4. Use the approved VPS prebuilt deployment flow only with deployment authorization.
5. Measure middleware CPU/duration and outbound RPC counts against a comparable
   production traffic window; do not extrapolate the burst test into bill savings.

No production settings, cache TTLs, durable-PDP activation, credential exceptions,
catalog data or remote database state were changed.

## Historical validation limits

An earlier full-web run (before final fixes and this rebase) reported 33,649 passed,
12 failed and one todo. It included now-fixed boundary/test fixture issues and
date-expired analytics authority tests outside this task. It is retained as
historical evidence, not a current full-suite result:
`/tmp/baci-middleware-full-web-20260926.log`.
The full web suite has not been rerun; current claims are scoped to affected checks.

Earlier public-resolver validation passed 607 tests / 54 files and a zero-finding
CodeRabbit review. Those results predate rebase and do not substitute for
current-head checks.

See [architecture research](2026-09-26-middleware-architecture-research.md) for
Shopify, Cloudflare and Vercel references and applicability limits.
