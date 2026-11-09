# Contabo private CI rollout

The dedicated Contabo runner is separate from the production deployment and
worker host. Its first Baci workload is the lint job. Other jobs remain on their
current runners; moving lint alone does not eliminate hosted Actions usage or
charges from other services.

Do not register a persistent self-hosted runner to Baci while Baci is public.
Before enabling this route, verify that Baci is private, review who can push and
run workflows, and register a dedicated repository-scoped Linux X64 runner with
the `baci-private-ci` label. Same-repository pull requests can execute their code
on this persistent machine; repository membership is a trust boundary. Keep
production credentials and deployment access off the runner. The runner's
Docker access must not be treated as an isolation boundary from its own user.
The workflow routing predicate is not an access-control boundary: before
registering the runner, verify private-fork workflow settings and ensure every
principal able to run or modify workflows is trusted with the persistent host.
Do not approve untrusted fork code to run on this runner. Recheck those settings
when access changes.

After the runner is online and a representative job has passed, set the Baci
Actions variable `BACI_PRIVATE_CI_ENABLED` to `true`. The lint job uses Contabo
only when the repository is private and the variable is enabled. Pull requests
from a different repository and merge-queue groups use GitHub-hosted runners.
Merge groups can combine PRs without exposing each source in the event payload,
so they remain hosted until their provenance can be established. If the private runner is
offline, matching lint jobs queue instead of silently switching to paid compute.
The lint job does not receive `TURBO_TOKEN` or `TURBO_TEAM` on a self-hosted runner.

To roll back, remove the variable or set it to `false`; subsequently scheduled
lint jobs use GitHub-hosted runners and may consume included minutes. Already
queued jobs do not change runners; cancel and rerun them if needed. Keep the
account's spending limit in place. Check that the required Quality Gate reports
lint failures and that pending jobs complete after a runner outage or cancellation.

Typechecking has a separate opt-in. After the complete production typecheck
sequence passes on Contabo, set `BACI_PRIVATE_TYPECHECK_ENABLED` to `true` in
addition to the existing private CI switch. Fork PRs and merge groups remain GitHub-hosted and
self-hosted typechecks receive no remote-cache credentials. With one runner,
lint and typecheck queue behind each other. Builder-auth PostgreSQL and
PostgREST fixtures are labelled per run, attempt, job, and scope and have scoped
cleanup on normal completion, failure, or ordinary cancellation. Before
enabling typecheck, verify that cleanup on the runner, including cancellation
and the recovery procedure below. Remove the typecheck variable to route
subsequently scheduled typechecks back to GitHub-hosted runners.

Full web-test shards have a third opt-in. After representative full shards
pass on the isolated Contabo runner, set `BACI_PRIVATE_WEB_TEST_ENABLED` to
`true` alongside `BACI_PRIVATE_CI_ENABLED`. The six shards retain full Git
history and reference no configured repository secrets; each uses at most four Vitest workers.
Fork PRs and merge groups continue on GitHub-hosted runners. With one Contabo
runner the six shards run sequentially, so monitor total queue time, disk
usage, test isolation and cancellation cleanup before enabling it broadly.
Remove the web-test variable to send newly scheduled shards back to hosted
runners. A zero Actions budget can prevent hosted jobs from starting when
included usage is exhausted; do not increase the budget without owner approval.

CodeQL is unavailable for this private personal repository under its current
license. Its workflow reports that limitation rather than running the scanner.
Semgrep continues separately, with different coverage; review its artifacts
and do not treat it as a like-for-like replacement for CodeQL.

The miscellaneous quality gate remains GitHub-hosted. It includes a live Quiz
approval step with production credentials, privileged package installation on
some paths, and database fixtures whose cleanup is not covered by the shipping
cleanup below. Do not route this job to the persistent runner as a whole. Any
future split must keep the credentialed step hosted, preserve its required-gate
semantics, and prove cleanup of every moved fixture after cancellation and
runner loss before enabling the moved work.

The non-web quality job has a separate `BACI_PRIVATE_QUALITY_TEST_ENABLED`
opt-in. Enable it alongside `BACI_PRIVATE_CI_ENABLED` only after the complete
shipping PostgreSQL and non-web test sequence passes on Contabo, including the
targeted test plans. Verify the runner service uses its rootless Docker socket,
has no access to the rootful socket or sudo, and can recover after reboot. The
job does not reference Turbo cache secrets, including on hosted fallback; check
that a cold hosted run fits its 45-minute timeout. Contabo has a 60-minute
timeout and uses the runner's rootless Docker configuration.

The shipping fixture labels its containers with the run, attempt, and job.
The self-hosted job invokes scoped cleanup after that fixture step, including
ordinary cancellation. A forced cancellation, timeout, runner crash, or a late
Docker create can bypass cleanup. Before enabling this route, establish and
test an operator recovery procedure that identifies stale labelled containers
and removes them only after confirming no matching job is active. Do not run
unscoped Docker prune commands. Remove the quality-test variable to route new
jobs back to GitHub-hosted runners, subject to the Actions budget.

For recovery, first pause new jobs on the runner and confirm in GitHub Actions
that the affected run and attempt have finished and the runner is idle. Allow
any in-flight Docker operations to finish. As `baci-runner`, using the same
rootless Docker socket as the runner, list candidates with all three labels:

```sh
docker ps -a --no-trunc \
  --filter 'label=io.baci.shipping-ci.run=RUN_ID' \
  --filter 'label=io.baci.shipping-ci.attempt=ATTEMPT' \
  --filter 'label=io.baci.shipping-ci.job=JOB_ID'
```

Replace the placeholders with the exact numeric run ID and attempt and the job
ID from the affected workflow. Inspect each candidate with `docker inspect
CONTAINER_ID` and verify all three labels and its identity before removing that
specific container with `docker rm -fv CONTAINER_ID`. Re-list the same labels
afterward to verify removal, then resume the runner. Never remove a container
if its run may still be active or its identity is uncertain. If a container is
created after the re-list, repeat the inspection and scoped removal once the
runner and Docker operations are confirmed idle.

For builder-auth fixtures, use the same procedure and replace the three
`io.baci.shipping-ci` label prefixes above with `io.baci.builder-ci`. Add the
fourth filter `--filter 'label=io.baci.builder-ci.scope=SCOPE'`. The scope is
`single` for `quality-typecheck` and `quality-test`, or the shard number for
`quality-test-web`. Inspect all four labels and the container identity before
removing any candidate.

Contabo's CI jobs do not opt in to saving the shared pnpm cache, and its web
build does not save the shared Next.js cache. The trusted production deployment
workflow explicitly preserves its existing pnpm cache-save behavior. These
workflow guards do not prevent code with cache API access from writing caches;
runner access controls remain required.

The web build has its own `BACI_PRIVATE_BUILD_ENABLED` opt-in. Enable it only
after a complete cold build succeeds on Contabo with placeholder credentials
and the existing private CI switch enabled. The hosted-only SDK cleanup must
never run on the VPS. Monitor build duration and available disk; a single
runner queues builds behind other jobs. Remove this variable to route newly
scheduled builds back to GitHub-hosted runners, subject to the Actions budget.
