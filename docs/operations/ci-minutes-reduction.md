# CI minutes reduction — first pass

Prepared 31 October 2026. Baci stays public. No merge, deployment, visibility,
branch protection, approval requirement, or queue activation is part of this change.

## Evidence and selected changes

The seven-day sample contains 559 completed runs from 22,577 run records. Its
estimated largest hosted compute consumer is CI Quality Gate. A representative
successful run on 27 October (`40496963679`) spent 6m19s in the Typecheck command
and 13m30s in one web test shard; dependency setup took roughly 40–55 seconds.
The typecheck job averaged about 8.2 minutes across its 36 sampled executions.
The six test shards were actually dividing the suite, not duplicating it.

This pass retains all test execution and targets compiler recomputation:

- Keep running `next typegen` and all five web TypeScript programs. Enable
  incremental compilation for the four auxiliary programs with separate explicit
  `.tsbuildinfo` paths. Strictness, include/exclude lists, and every existing
  command stay unchanged. Do not enable `assumeChangesOnlyAffectDirectDependencies`.
- Publish only compiler state from successful main-push typechecks, retained for
  three days. Restore only matching artifacts from successful `main` push runs
  of `ci.yml`, verifying run/repository/commit/artifact identity. The artifact name
  includes OS, architecture, lockfile, package/toolchain and TypeScript config
  hashes. PRs, merge groups and dispatches never publish state.
- Artifact lookup/download failure or an expired/missing artifact falls back to
  the normal cold typecheck. A state hit never bypasses the typecheck command.
  TypeScript invalidates stale program information for source/config changes.
  An ordinary branch-scoped Actions cache is not used for diagnostic state.
- Move only the API-only Diff Guardian coordinator to `ubuntu-slim`, retaining
  its existing script, triggers, permissions, voters, quorum and 15-minute
  timeout. The image provides Bash, gh, jq and curl. Jules stays on its current
  runner because its two/six-hour polling windows exceed slim's 15-minute cap.

Compiler reuse is intended to reduce elapsed checking minutes. The slim runner
reduces the coordinator's per-minute price, not necessarily its elapsed minutes.
At published rates, unchanged coordinator runtime costs $0.002/min instead of
$0.006/min. The historical sample suggests about $15/week in gross equivalent
coordinator savings at identical runtime; this is an estimate, not money saved
on the currently public repository.

## Protections retained

No test job, test shard, PostgreSQL suite, browser regression, test-plan scope,
security scanner, CI trigger or required check is removed. Build, Quality Gate,
Semgrep SAST, CODEOWNERS, approval requirements and strict/up-to-date protection
retain their existing contracts. No test-result or passing-check cache is added.

Regression coverage verifies that a warm compiler still rejects changed imported
source types, changed compiler options and a corrupted state file. Provenance
fixtures reject PR/other-branch/failed-run/unrelated-workflow/repository/expired/
wrong-key artifacts. Guardian fixtures exercise passing, blocking quorum,
pending reviews, stale heads, bypass removal and a changed fork head.

## Qualification and follow-up

The first PR run is cold: the trusted artifact cannot exist until this lands in
`main` and a successful main CI run publishes it. No elapsed-time reduction is
claimed from local unit tests. After a separately authorized merge, compare warm
and cold typecheck durations over several PRs, cache hit/miss logs, artifact size
and storage retention. A slow or failed cache remains optional.

All existing tests still run, including the expensive full web suite whenever
its current planner selects it. Further large savings require measured test
startup/transform work or provably redundant trigger/result handling; dropping
coverage, loosening the planner or reducing reviewer polling timeouts is excluded.
Do not move untrusted PR execution onto production VPS runners to save minutes.

## References

- [TypeScript incremental compilation](https://www.typescriptlang.org/tsconfig/incremental.html)
- [Incremental graph invalidation](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-4.html)
- [GitHub Actions runner prices](https://docs.github.com/en/billing/reference/actions-runner-pricing)
- [Single-CPU runner constraints](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [Official slim image tool inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu-slim/ubuntu-slim-Readme.md)
