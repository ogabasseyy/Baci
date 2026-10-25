# Local validation receipt — 2026-10-25

This is an implementation/review receipt, not a production deployment receipt.
Branch: `codex/merchant-blog-classification`. Initial base:
`49c131fd8768f971802a926430397cf642b9afb1`; PR preparation incorporates main at
`def9f0b7a5` before PR creation. The last two fast-forwards contain deployment
tooling/documentation and independent Jumia work, not classification/replay inputs.
No hosted schema change, backfill, credential change, publication, commit or push
was performed during these checks.

## Passed

- Final affected storefront tests: 99/99 across 11 files, including actual listing
  and detail adapters, explicit merchant intent, stale revisions, missing metadata
  and RPC failure fallback. Both listing and detail fixtures assert stable UUID
  revisions rather than mutable `updated_at` timestamps.
- Complete monorepo typechecks passed after incorporating main at `7f711eea1f`:
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
- Full monorepo checks and hosted PR CI have not passed for this uncommitted work.
  The mobile-storefront standalone retry passed all 1,605 Jest suites/9,907 tests
  plus 64 native/config checks after the first concurrent run's process crash.
  Mobile-admin passed 930 suites/4,724 tests; shared passed 294 suites/1,921 tests.
  An event-governance timeout passed on retry; the unrelated browser presentation
  suite still hit its existing 60-second bound. Dirty-source inventory assertions
  require rechecking after the implementation commit; no assertion was weakened.
- Daily production writes require an approved, finite-expiry merchant-scoped
  authenticated identity and secure token refresh. No such configuration was
  provisioned; the writer deliberately reports unavailable without it.

Use [the rollout guide](../merchant-blog-classification.md) for deployment order
and the separate writer patch. Do not infer production readiness from local tests.
