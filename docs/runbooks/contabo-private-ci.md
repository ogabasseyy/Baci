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
