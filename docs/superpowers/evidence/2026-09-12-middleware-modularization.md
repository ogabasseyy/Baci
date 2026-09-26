# Middleware modularization — local evidence

Updated: 2026-09-26. Branch: `codex/middleware-modularization-20260912`.
This is uncommitted local work, not a deployed cost reduction.

## Implemented scope

- Replaced the large proxy coordinator with a 192-line entrypoint and 32
  responsibility-focused modules, each below 300 lines. The literal matcher,
  routing precedence, security guards, cache policies and fail-open verdicts
  remain unchanged.
- Added custom-domain merchant trace attributes after existing trusted merchant
  resolution, without another lookup.
- Shared compatible overlapping cold public preflight RPC calls within an
  instance. The flight key includes function, sorted arguments, empty-result
  semantics, timeout, environment and transport identity. Arguments and relevant
  options are captured before deferred execution. Existing bounded SingleFlight
  tracking discards settled promises; existing memo and breaker semantics remain.
- Moved the preview environment guard before memo access so previews cannot
  borrow production verdicts.

## Observed work reduction

The deterministic regression reproduced ten simultaneous identical cold calls
starting ten RPCs before the change, versus one after it: 90% fewer RPC starts
for that particular overlapping burst on one warm instance. The ten inbound
middleware invocations still occur. Sequential calls already benefit from the
existing short memo; cross-instance bursts are not coalesced by this change.

Splitting files is an auditability improvement, not evidence of cheaper compute.
No production CPU, memory-duration or dollar reduction has been measured. No
claim of a 90% Vercel bill reduction follows from the RPC test.

## Validation and review

- Parent: combined proxy, preflight RPC and SingleFlight suite — 491 tests in
  11 files passed.
- Parent: `pnpm turbo lint typecheck --filter=@baci/web` passed. Two existing
  unrelated lint warnings remained (`noImgElement` in a blog fixture and a hook
  dependency warning); no errors.
- Independent helper, coordinator and RPC reviews passed. RPC reviewer also
  independently ran its 54 focused tests.
- Parent: inventory input/generator and both credential-path suites — 14 tests
  in four files passed after integration. Final affected-web lint/typecheck also
  passed with the same two warnings.
- Whole-change independent review passed, including the inventory input list and
  mechanical credential-path updates. No actionable findings.
- Added meaningful colocated tests for all 32 extracted proxy modules and the
  RPC-flight helper, as required by the existing repository contract. Updated
  one comparison concurrency assertion to flush the newly deferred microtask,
  preserving its eight-slot limit.
- Parent combined final affected run: 581 passed, one failed (582 tests in 50
  files). The only failure reports the pre-existing temporary analytics
  authority expiry of 2026-09-16. All 33 missing-test findings are resolved and
  the compare timing regression passes. No expiry/authority guard was changed.
- Full web run completed: 33,649 passed, 12 failed, one todo; 5,486 files passed,
  ten failed and one skipped. It began before the final credential fixture and
  colocated-test edits; targeted final reruns resolved those stale fixture,
  missing-test and microtask-assertion findings. It is not a green full-suite
  result. Remaining categories include expired analytics authority, source
  inventory/clean-tree prerequisites and the boundary blocker below.
- The Cloudflare evidence process-isolation test was separately reproduced:
  its child qualification tool stops at `tooling worktree is not clean`, before
  inventory validation. Current uncommitted changes explain that precondition;
  the clean-tree guard was not weakened. Rerun after reviewed commits.

## Boundary failure found during integration

The live event-pipeline boundary suite reported extracted-module import paths
reaching the admin client through `domain-cache-simple.ts`, plus credential
paths. The domain-cache database fallback actually calls `createAdminClient`;
this is not just an internal-API-secret accounting issue. It predates the
extraction, but new sibling import paths do not inherit historical exceptions.
Current instructions declare those exceptions expired. Do not add allowlist
entries or renew exceptions to ship this refactor. Before the approved resolver
extension, a rerun reported 89 findings (one failed test; 77.76 seconds), recorded in
`/tmp/baci-middleware-event-boundaries-live-current-20260926.log`.

The source audit found no drop-in public resolver for both directions:
`resolve_storefront_auth_merchant` can support reverse lookup, but its forward
primary-domain selection differs from the current custom/purchased selection
and single non-primary fallback. Public snapshot and direct anon queries also
differ on publication/verification filters. Separating pure host predicates
alone leaves actual domain-stage admin calls intact. The owner subsequently
approved a dedicated public resolver on 2026-09-26. No source commit,
ready-to-ship claim or deployment follows from unit tests alone.

### Approved public-domain resolver extension

The cache fallback now uses anonymous scalar RPCs, with no admin-client import.
The new migration preserves active-domain and primary-or-sole selection,
including unpublished merchants and active unverified domains, without granting
table access. RPC errors, malformed data and missing configuration fail open
but do not create negative cache entries. Existing TTLs, Edge Config precedence,
in-flight coalescing and invalidation fences remain covered.

Parent verification: 36 domain-cache tests passed across four files; the SQL
fixture executed on a disposable local PostgreSQL database and rolled back.
Independent Terra review passed and verified that temporarily granting PUBLIC
execution makes the permissions assertion fail. This is targeted local SQL
validation, not a full production-schema replay or remote migration application.
The migration must be applied before releasing the new application fallback.

### Final integrated boundary verification

Four middleware consumers now read the internal API secret through a focused
accessor, preserving runtime override, module-load fallback, browser rejection,
authentication and missing-secret preflight behavior. The broad `env.ts` module,
credential-reader hashes and expiry gates are unchanged. Obsolete exact
credential paths were removed; no new authority exception was introduced.

Parent integrated run passed **607 tests across 54 files**, including the live
event-pipeline boundary check that previously reported 89 violations. Log:
`/tmp/baci-middleware-integrated-public-resolver-20260926.log`. A final correction
made the retired-path assertion inspect complete path entries rather than a
basename; its five-test file passed again. Final affected-web lint/typecheck
passed with the same two pre-existing warnings. Logs:
`/tmp/baci-middleware-credential-assertion-final-20260926.log` and
`/tmp/baci-middleware-public-resolver-static-final-20260926.log`.

The earlier full-web run is retained above; it was not repeated wholesale after
this bounded extension. Unrelated date-expired analytics authority/fanout tests
are not claimed fixed. After the reviewed source/evidence commits, the clean-tree
Cloudflare process-isolation and checked-in inventory tests passed: 13 tests
across two files. Log: `/tmp/baci-middleware-clean-tree-final-20260926.log`.

## Remaining release evidence and review

The integrated CodeRabbit review completed with **zero findings**, including the
new public adapter, migration, SQL fixture and focused secret accessor. Log:
`/tmp/baci-middleware-public-resolver-coderabbit-20260926.log`. Parent's subsequent
test-assertion correction and two import-order-only fixes received scoped Terra
rereview with no findings and passed their relevant tests/static checks.

CodeRabbit was actually attempted using its installed CLI syntax:
`coderabbit review --agent --uncommitted --include-untracked`. It failed with a
rate-limit response: all three included reviews used, and no assigned seat for
the selected organization. After its retry window elapsed, a later attempt
completed, including all untracked modules. It returned two duplicate major
comments about the unchanged broad preview-origin allowance. Independent review
and parent inspection found the predicate is unchanged from the original proxy;
middleware explicitly uses SameSite=Lax, and installed Supabase SSR defaults to
Lax for the other clients. The claimed SameSite=None condition is absent. The
comments are not treated as a demonstrated regression; preview-policy hardening
is a separate behavior change, not silently included in this refactor.

A parent-run review before the public-resolver extension, after adding the colocated tests, completed with
**zero findings** and included every untracked source/test module. Its complete
output is `/tmp/baci-middleware-coderabbit-final-20260926.log`. This satisfies
the earlier local reviewer gate; a new review covers the resolver extension.

The checked-in edge inventory already failed its ancestor check at baseline:
`61aede483779abf8e37e22170f803987e38e2841` is not an ancestor of the current
squash-merged source baseline. The refactor also requires new source-byte
evidence. The guard remains intact. Source commit and artifact regeneration are
pending the mandatory review gate; an uncommitted Git tree is not authority.
A branch-only source commit would again lose ancestry under squash/rebase, so
the merge/evidence workflow needs to preserve a reachable authority explicitly.
The final inventory regression rerun confirmed the same baseline failure:
17 tests passed and one failed at the ancestry assertion, before content
validation. Log: `/tmp/baci-middleware-inventory-final-20260926.log`. No authority
was fabricated or ancestry check weakened to make the result pass.

No PR, push, merge, deployment, provider setting, durable-PDP activation, TTL
increase, credential exception or production catalog mutation was performed.

## Decisions made during execution

1. Keep source uncommitted until required reviews, using private immutable review
   trees for task reviews. Tradeoff: delayed commit checkpoints.
2. Continue safe local implementation despite the existing inventory ancestry
   failure, without weakening the guard. Tradeoff: release remains blocked until
   the source evidence is refreshed against valid reachable history.

See [architecture research](2026-09-26-middleware-architecture-research.md) for
the referenced Shopify, Cloudflare and Vercel guidance and the limits of applying
those architectures here.
