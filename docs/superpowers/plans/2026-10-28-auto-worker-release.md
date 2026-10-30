# Automatic worker and application release plan

## Status: blocked; isolated implementation draft is not safe to ship

The changes in this worktree implement a candidate coordinator architecture.
They have not been committed, pushed, or run against production. A P1 credential
isolation issue blocks shipping: worker installation runs as the same OS user
that owns a persisted GitHub CLI credential with repository and workflow scopes
at `/home/bassey/.config/gh/hosts.yml`. `env -i` and non-persisted checkout
credentials cannot protect that file from same-UID lifecycle code. A separate
OS identity or equivalent process/credential boundary must be established and
verified before unattended worker installs can safely run.

## Release flow

`Production Release Coordinator` is the only automatic or manual production
release entry point. Pushes to `main` and an explicit `workflow_dispatch` run
`.github/workflows/production-release.yml`. GitHub concurrency serializes these
runs without cancellation. The workflow checks out the triggering SHA, proves
it is current `main`, creates a private durable lock on the verified `baci-deploy`
host, deploys workers to that exact SHA, and verifies the installed worker SHA.
Only then does the same workflow run call the reusable `deploy.yml`. That app
workflow no longer accepts push or workflow-dispatch events directly.

The worker job has `actions:read`, `contents:write`, and `id-token:write`; the
GitHub token is job-scoped. Vercel and database credentials remain in existing
app jobs. Production Environment configuration is unchanged. The worker
transport keeps SSH as its default; the coordinator opts into the host-local
adapter only on the verified runner. The adapter validates host, user, UID,
home, directory ownership, bus identity, and exact staging rsync operations,
and runs worker lifecycle commands under a minimal environment.

## Provenance and overlap safeguards

The worker overlap guard's sole same-run exception requires a signed GitHub
Actions OIDC token bound to the canonical repository, coordinator workflow,
main ref, exact SHA, event, run attempt, and check-run ID. The verifier joins
those claims to the live GitHub repository, workflow, run, job, runner label,
and current `main` API responses. A standalone worker invocation cannot
provide a valid job identity. The GitHub CLI on the VPS is resolved from the
verified fixed path and checked as a regular executable owned by UID 1001 with
safe mode bits.

The existing in-flight deploy scan, promotion records, per-promotion barrier,
worker smoke, immutable checkout, migration ordering, cron quiescence, rollback
behavior, prebuilt publication, app retries, and post-deploy checks remain in
place. The publisher verifies the exact worker SHA for every app release. Its
overlap record exception is limited to the same OIDC/API-authenticated reusable
publisher job; other active coordinator and deploy runs still block.

## Durable lock and recovery

The lock is `/home/bassey/.local/state/baci/pending-production-release.json`
on `ogabassey` as UID 1001. It binds the coordinator run, attempt, and SHA. It
is created before worker sync and is retained after worker failure, cancellation,
main movement, an unreadable API response, failed post-publish verification, or
any ambiguous publication outcome. A later release fails closed while it
exists.

The lock is removed only after the app workflow proves all publication steps
were skipped, or after the authenticated publisher proves worker SHA, current
main, Vercel project, READY production deployment, stable live alias, and exact
deployed SHA. A failed finalizer leaves the lock in place. Operators must
reconcile the owning run, worker SHA, alias, and deployment before removing a
retained lock and dispatching a new release. No environment variable bypasses
the in-flight, promotion-record, or barrier checks.

## Verified infrastructure evidence

Read-only inspection on the approved `baci-deploy` runner verified that the
runner listener runs as `bassey` on host `ogabassey`, UID 1001; the pinned
`/home/bassey/.local/bin/gh` is a regular executable owned by `bassey`, and
`gh auth status` succeeds. The Actions service PATH omits that directory. The
runner has `node`, `pnpm`, and `rsync` on the adapter's fixed safe PATH; its
user-bus variables and `/run/user/1001/bus` socket are present. Self-SSH is not
available. The Vercel CLI is installed through the existing pinned helper in
the app workflow. These checks establish a plausible host-local transport;
they do not prove the new workflow has run successfully on production.

## Validation performed

- `pnpm --dir vps-workers test`: 897 passed, 4 skipped, 0 failed.
- Coordinator, OIDC verifier, persistent-lock, and trusted-CLI tests: 16 passed.
- `pnpm turbo lint && pnpm turbo typecheck`: exited 0; existing warnings were
  reported by cached lint output.
- `actionlint .github/workflows/deploy.yml .github/workflows/production-release.yml`:
  passed.
- `bash -n` on modified worker/deploy shell entrypoints and `git diff --check`:
  passed.

No production operation was performed from this worktree. The independent
review also raised an operational verification gap: the no-op finalizer must
use an explicit reusable-workflow output rather than assume the Actions jobs
API exposes child job details in a particular shape. The draft now carries
that output, but its live behavior still needs a safe non-production
integration check. The runner API check matches the `baci-deploy` label, while
the host-local guard checks `ogabassey` and UID 1001; verify the approved runner
assignment before relying on the label alone.

Do not commit or push this implementation until credential isolation and the
remaining runner/API contract checks are resolved.
