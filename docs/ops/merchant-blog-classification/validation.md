# Local validation receipt — 2026-10-25

This is an implementation/review receipt, not a production deployment receipt.
Branch: `codex/merchant-blog-classification`. Initial base:
`49c131fd8768f971802a926430397cf642b9afb1`; PR preparation incorporates main at
`def9f0b7a5` before PR creation. The last two fast-forwards contain deployment
tooling/documentation and independent Jumia work, not classification/replay inputs.
No hosted schema change, backfill, credential change or publication was performed.
Implementation commit: `b9b70dd0631aa383d25e53a90cf512a7f6323478`.

## Passed

- Final affected storefront tests: 99/99 across 11 files, including actual listing
  and detail adapters, explicit merchant intent, stale revisions, missing metadata
  and RPC failure fallback. Both listing and detail fixtures assert stable UUID
  revisions rather than mutable `updated_at` timestamps.
- Complete monorepo typechecks passed after incorporating main at `def9f0b7a5`:
  seven Turborepo tasks, including the complete web typecheck chain and Next type
  generation. A test fixture's excess-property error was corrected without a cast
  or changing its behavior; the 13-test loader suite passes.
- Web package lint: passed with six existing unrelated warnings; no new errors.
- Migration/manifest registration subset: 14/14. The additional CI wiring contract
  passes 2/2 including its original registry assertion.
- Broad manifest verifier: isolated retry passed 15/15 in 156 seconds with a
  60-second default test/hook bound and one worker. The earlier parallel batch's
  two timeouts and cleanup error did not recur; no assertions were removed.
- CI test-plan/checkout contracts: 23/23. Workflow YAML parsed successfully and the
  two new SQL invocations resolve to the intended DB quality-gate steps.
- Readiness-runner regression suite: 3/3 after all three failed against the old
  runner. The tests cover temporary-server readiness, missing init completion,
  final-server failure, no SQL on timeout, and cleanup.
- Real isolated PostgreSQL suite: passed after the readiness repair. It exercises
  tenant/source authorization, publication boundaries, priority, CAS, invalidation,
  guide filtering before the bounded limit, metadata snapshots and stable revisions.
- Separate Python writer: 36/36 classification and dashboard tests. Its two
  release-integrity failures were reproduced against the unchanged baseline.
- Packaged writer patch: `git apply --check` against the captured baseline passed;
  all six before/after file digests and the patch digest match the manifest.
- Shell syntax and whitespace checks passed.

## PR preparation follow-up

Parent review found that the isolated fixture granted authenticated clients
private-schema access while existing production migrations revoke it. A seventh,
append-only migration adds five narrowly scoped owner-delegating public RPCs and
revokes direct private execution. The regression first reproduced the failure
with schema access revoked, then passed with the repair; it exercises authorized
calls and tenant/direct-private denials. A second Luna review found no actionable
defect in this repair. None of the original six migration bytes were changed.

The earlier `oidc-provider` typecheck diagnosis was a local setup issue: the
standalone `tools/builder-auth/package.json` and lockfile already declare it.
PR preparation uses that tool's existing frozen-lockfile install, matching CI,
before rerunning the complete typecheck chain. No dependency declaration or
lockfile repair is required.

## Review

An independent Luna review reported no verified actionable issues. CodeRabbit is
separate evidence, not replaced by that review:

1. Initial tracked-files pass: one listing-fixture issue. The exact new listing
   test reproduced it; the fixture and RPC stub were corrected and now assert the
   real adapter output.
2. Full staged pass: all 41 then-present files reviewed, including the migrations,
   new helpers, writer patch and tests. Two low-severity issues: the Docker init
   race and the UUID-default rewrite preflight. The runner was repaired with
   red/green regression coverage. A read-only production measurement confirmed
   1,064 rows and a 3.3 MB heap; the retained migration's locking caveat is documented
   in the rollout guide. No critical/high issues were reported.
3. Final pre-commit pass after the seventh migration: completed with three issues,
   none critical/high. The runner-path and direct-private-helper test gaps were
   corrected by Luna and reviewed by the parent. The runner passes from repository
   root (3/3); the isolated SQL suite passes with owner-context private-helper
   checks. The table-rewrite preflight repeats the measured,
   documented rollout caveat above; no existing migration was rewritten.

The final readiness test and runbook evidence were added after the full review;
this receipt does not claim a clean head-specific PR review or passing hosted CI.

## Outstanding gates

- The pinned Supabase CLI 2.95.4 and native psql 18.3 now pass replay preflight.
  Local Docker's automatic address pools were exhausted. A temporary,
  independently reviewed launcher provisions only the generated replay project's
  exact-name, exact-label network on a route/IPAM-checked unused subnet. All
  default version, ownership, resource, migration and effect assertions remain
  unchanged. The runner initially classified startup as PostgreSQL `28P01`.
  A private diagnostic retry proved SCRAM authentication succeeded, then the
  pinned container's `tini` failed with `PR_SET_CHILD_SUBREAPER is unavailable`.
  This is a local container-runtime failure before migrations, not a database
  credential failure or a completed chronological replay. Generated diagnostic
  authentication material is not included in this receipt.
  Read-only inspection confirms the exact CI PostgreSQL digest is `linux/amd64`,
  while this Colima guest/daemon is `aarch64`. Shared runtime settings and image
  pins were not changed. The existing Linux/AMD64 PR database quality gate must
  supply the authoritative chronological replay result, including the new schema
  assertion; an isolated fixture pass is not a substitute.
- Full monorepo checks and hosted PR CI have not passed for this work.
  The complete web run finished with 56,099 passing tests and six failures.
  The mobile-storefront standalone retry passed all 1,605 Jest suites/9,907 tests
  plus 64 native/config checks after the first concurrent run's process crash.
  Mobile-admin passed 930 suites/4,724 tests; shared passed 294 suites/1,921 tests.
  An event-governance timeout passed on retry; the unrelated browser presentation
  suite still hit its existing 60-second bound. Dirty-source inventory assertions
  passed after the implementation commit and snapshot regeneration (all 14
  inventory/governance tests passed). The deferred crypto-dialog test also passed
  on focused retry. A live event-boundary failure reports five credential paths
  in the newly merged Jumia preflight route, unchanged by this classification PR.
  No assertion was weakened.
- Daily production writes require an approved, finite-expiry merchant-scoped
  authenticated identity and secure token refresh. No such configuration was
  provisioned; the writer deliberately reports unavailable without it.

Use [the rollout guide](../merchant-blog-classification.md) for deployment order
and the separate writer patch. Do not infer production readiness from local tests.

## PR evidence follow-up

[PR #3798](https://github.com/ogabasseyy/Baci/pull/3798) was created from implementation
commit `b9b70dd0631aa383d25e53a90cf512a7f6323478`. Normal pre-commit lint and pre-push
typecheck/behind-base hooks passed. The Linux/AMD64
[DB Replay job](https://github.com/ogabasseyy/Baci/actions/runs/40223313900/job/121259439858)
passed on that exact SHA, as did Disposable SQL Suites, Build, Lint and Typecheck.
Web shard 4 failed only the stale source-bound inventory snapshot assertion;
the live event-boundary test passed in that hosted shard.

The source-bound inventory follow-up (all 584 rows unchanged, source/digest fields
only), its matching expected digest test, and these updated notes are the CI fix.
All 14 inventory/governance tests passed again on 2026-10-25. Their required
CodeRabbit review returned another 43-minute rate
limit at approximately 18:51 UTC and states that no org seat is assigned. The
implementation review above completed successfully, but does not substitute for
that follow-up gate. The owner explicitly approved a one-time CodeRabbit skip for
this evidence-only follow-up on 2026-10-25. Normal Git hooks, CI and all other
review gates remain enabled. New-head CI is required after pushing; the earlier
passing checks certify only the implementation SHA above. Nothing was merged or deployed.

## Review follow-up — linked product guides

All hosted checks, including shard 4 and full DB replay, passed on evidence head
`50739cdfd1f8b4914481c549dfee6774f2670020`. Later review identified a separate
product-linked guide path that did not load classification metadata. Three new
assertions failed before the fix: linked news was returned, comparison metadata
was absent, and a priority news post rendered as a buying guide. The linked path
now loads the safe, revision-bound overlay outside its product-keyed cache and
excludes current news; the renderer also rejects trusted priority news. Missing,
stale and untrusted metadata keep the legacy fallback. An RPC-failure/recovery
regression also verifies fallback followed by correct news exclusion.

Luna strengthened the SQL tenant assertion with valid rules and a classified
second-merchant positive control. The disposable runner now rejects unused
`--before-*` debug arguments before creating resources, while its default path
still applies every migration and executes every suite/schema contract. Its
tests inspect actual SQL payloads sent to the fake database boundary. The real
isolated PostgreSQL suite passed; no migration bytes changed.

The cache-invalidation suggestion was already implemented in both packaged
Python write paths: both call the authenticated revalidation endpoint after CAS.
The classification writer tests passed 24/24 on recheck. The runtime pre-commit
CodeRabbit review completed with one trivial request for an RPC-failure test;
that test was added and passed. It reported no critical/high issues. The earlier
one-time review waiver was not used for these runtime fixes.

Before base refresh, affected storefront suites passed 1,070 tests across 172
files, final focused regressions passed 23/23, inventory contracts passed 7/7,
and web lint/typecheck passed (six existing lint warnings). Main's independent
consent change `4f9e26b86d` was then incorporated, preserving all task changes.
The inventory snapshot was regenerated from committed combined route source
`c774f6f8023d2a12501f7c30e1bf7bf340b29f2b`, retaining all 584 rows. Post-rebase
validation passed 1,079 tests across 174 files (including inventory contracts)
and web lint/typecheck, with the same six existing warnings. Fresh pushed-head
CI/reviews remain required; prior head-specific checks do not certify the
rebased result.
