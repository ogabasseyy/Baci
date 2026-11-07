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
lint and typecheck queue behind each other. Remove the typecheck variable to
route subsequently scheduled typechecks back to GitHub-hosted runners.

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

The web build has its own `BACI_PRIVATE_BUILD_ENABLED` opt-in. Enable it only
after a complete cold build succeeds on Contabo with placeholder credentials
and the existing private CI switch enabled. The hosted-only SDK cleanup must
never run on the VPS. Monitor build duration and available disk; a single
runner queues builds behind other jobs. Remove this variable to route newly
scheduled builds back to GitHub-hosted runners, subject to the Actions budget.
