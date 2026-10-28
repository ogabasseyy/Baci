# Automatic worker host provisioning and migration runbook

This runbook sequences the existing fail-closed host tools for a Baci worker
host. It is an operator procedure, not permission to change production. No
command below was run as part of authoring this document. Run the apply and
migration steps only in an approved host window, from the reviewed checkout on
the target host, after an operator has established access and captured the
pre-change evidence.

The scripts default to plans where supported. They intentionally do not form a
single all-or-nothing transaction: identity provisioning, broker setup, runner
registration, lock namespace migration, and cron-to-systemd migration have
different rollback boundaries. Stop on any nonzero exit and preserve the
diagnostic. Do not skip a failed gate or continue to the next phase.

## Scope and fixed boundaries

- The supported worker root is `/srv/baci-workers`; the legacy worker tree is
  `/home/bassey/baci-workers`.
- `baci-worker` runs workload services. `baci-release` is a separate
  non-login identity. The release broker is root-owned. Neither identity may
  belong to `sudo` or `docker`; the release account must have only its own
  primary group, while `baci-worker` additionally uses `baci-locks`.
- The GitHub runner migration adds the isolated `baci-release` runner and label.
  It does not remove or modify `baci-deploy` and does not change workflow files.
- Lock namespace and event/quiz cron migrations are explicit, root-only,
  separately invoked operations. They are not part of `deploy.sh`.
- This runbook does not authorize database migrations, secret creation or
  rotation, production deployment, workflow routing changes, DNS/network
  changes, or removal of legacy identities/services.

## 0. Establish the change record and baseline

Before touching the host, record the approved change identifier, operator,
window, target hostname, repository revision, and rollback owner. Do not infer
that root or SSH access exists. If the operator cannot establish the approved
access path, stop and request it through the normal operations process.

On the target host, from the reviewed repository checkout:

```sh
cd /path/to/reviewed/Baci-app
git status --short
git rev-parse HEAD
hostname -f
id
uname -srm
python3 --version
systemctl is-active cron.service
systemctl --no-pager --full status baci-gigl-tracking.timer baci-cache-invalidation-drain.timer baci-domain-event-router.service baci-event-delivery-worker.service baci-quiz-finalization.service baci-gigl-tracking.service baci-cache-invalidation-drain.service
crontab -u bassey -l
stat -c '%U:%G:%a %n' /home/bassey/baci-workers /home/bassey/baci-workers/locks
if [ -e /var/lib/baci-workers ]; then df -Pk /var/lib/baci-workers; else df -Pk /var/lib; fi
```

Capture outputs in the change record after redacting host-specific data that
policy classifies as sensitive. Never capture `.env`, runner `.credentials`,
tokens, full process environments, or secret-bearing command output. Establish
which listed units are expected to exist on this host; an inability to
distinguish absent from unobservable state is a stop condition.

Require a clean reviewed checkout and confirm no deployment, manual crontab
edit, or other worker migration is in progress. Save the exact current user
crontab and service states in a protected operator evidence location. The
migration scripts create their own protected snapshots, but those are not a
substitute for a change record. Do not edit existing database migration files.

## 1. Review plans and repository tests

Run read-only plan and focused script tests on the reviewed checkout:

```sh
python3 vps-workers/bin/provision-baci-worker.py
python3 vps-workers/bin/provision-worker-release-boundary.py
python3 vps-workers/bin/migrate-baci-release-runner.py
python3 vps-workers/bin/provision-baci-worker.test.py
python3 vps-workers/bin/provision-worker-release-boundary.test.py
python3 vps-workers/bin/migrate-baci-release-runner.test.py
python3 vps-workers/bin/migrate-worker-lock-namespace.test.py
python3 vps-workers/bin/migrate-event-workers-to-system-services.test.py
python3 vps-workers/bin/migrate-cache-invalidation-system-service.test.py
```

The runner plan prints a pinned artifact version, URL and SHA-256; compare the
artifact against that pin. A nonzero test, changed source revision, dirty
checkout, missing reviewed artifact, or unexpected host state blocks the
change. The GitHub runner apply also requires Linux x86_64. Record test exit
codes and the source SHA, not credentials.

## 2. Provision isolated identities and release broker

This step is additive, but it changes host accounts, directories, a systemd
unit, and broker helper files. First review the dry-run output. Then, only in
the approved window and with root explicitly available, run in this order:

```sh
sudo python3 vps-workers/bin/provision-baci-worker.py --apply
sudo python3 vps-workers/bin/provision-worker-release-boundary.py --apply
```

The first command provisions `baci-worker`, `baci-locks`, and the empty
`/srv/baci-workers` layout. The second requires that layout and provisions
`baci-release`, the root-owned broker helper set, and the broker service. It
does not configure the GitHub runner, credentials, cron, or workload services.
Do not use `--apply` if an existing identity, group membership, directory,
ownership, or mode differs from the tool's contract; investigate rather than
repairing it manually.

Verify without exposing secrets:

```sh
getent passwd baci-worker baci-release
id baci-worker
id baci-release
stat -c '%U:%G:%a %n' /srv/baci-workers /srv/baci-workers/releases /srv/baci-workers/shared /srv/baci-workers/locks /srv/baci-workers/logs /srv/baci-workers/runtime /srv/baci-workers/home /home/baci-release
systemctl is-active baci-worker-release-broker.service
systemctl is-enabled baci-worker-release-broker.service
```

Expected layout: `/srv/baci-workers` and `locks` are `root:baci-locks 710`,
`releases` is `root:baci-worker 750`, workload-owned directories are
`baci-worker:baci-worker` with the modes printed by the provisioner, and the
release home is `baci-release:baci-release 700`. Check the exact account group
membership and the broker's installed helper digests against the reviewed
plan. Any mismatch blocks the next phase.

## 3. Install the isolated GitHub release runner (optional, separate change)

The runner is optional and separate from worker identity provisioning. Before
applying, verify the pinned official runner archive is staged locally as a
regular non-symlink file with the expected SHA-256. A GitHub administrative
credential is needed by the script only to request short-lived runner tokens.
Use the approved secret injection mechanism; do not place a token in shell
history, a process argument, a log, or this change record. The script removes
`BACI_RUNNER_ADMIN_TOKEN` from its environment and does not print it.

Review the plan, then run the apply from a controlled root shell whose
environment securely contains the short-lived admin credential. The plan
command can run unprivileged:

```sh
python3 vps-workers/bin/migrate-baci-release-runner.py
python3 vps-workers/bin/migrate-baci-release-runner.py --apply --archive /protected/staging/actions-runner-linux-x64-PINNED_VERSION.tar.gz
```

Substitute the actual filename matching the repository pin. Do not copy a
credential into the command line. The apply operation requires root and Linux
x86_64, verifies the archive checksum, requests registration/removal tokens,
registers the unique `baci-release` label with default labels disabled, checks
credential isolation, and starts only the new service. If the required secure
environment cannot be supplied without exposing the credential, defer this
phase. No workflow should be routed to `baci-release` until a separate reviewed
workflow change and runner readiness evidence exist.

Verify the runner service and the GitHub repository's runner inventory using
the approved UI/API path. Confirm exactly one `baci-release-01` with only the
`baci-release` label, active service state, and no change to the legacy runner.
Record identity, labels, service state, artifact pin, and revision only.

## 4. Migrate worker cron lock namespace (explicit maintenance step)

This operation is not safe to fold into normal deployment. Preconditions:
the `/srv` worker tree and required system services are already installed;
`baci-locks` membership and lock-file ownership/modes match policy; the legacy
user manager is observable; no deployment or crontab edit is in progress; and
the current user crontab and service state have been recorded. Read
`worker-lock-namespace-migration.md` before proceeding.

Run the script from the reviewed checkout as root. It suspends only recognized
Baci cron lines, drains old locks, installs the rewritten root-owned lock
namespace, verifies the crontab, then resumes services:

```sh
sudo python3 vps-workers/bin/migrate-worker-lock-namespace.py
```

On nonzero exit, do not manually restart units or continue to the next phase.
The tool attempts to restore the original crontab and service states on
pre-commit failures. Preserve its diagnostic and inspect live crontab, unit,
lock, and process state before retrying.

Post-migration evidence:

```sh
crontab -u bassey -l | grep -E 'flock.*(/home/bassey/baci-workers/locks|/srv/baci-workers/locks)'
stat -c '%U:%G:%a %n' /srv/baci-workers /srv/baci-workers/locks
find /srv/baci-workers/locks -maxdepth 1 -type f -name '*.lock' -exec stat -c '%U:%G:%a %n' {} \;
systemctl --no-pager --full status baci-gigl-tracking.timer baci-cache-invalidation-drain.timer baci-domain-event-router.service baci-event-delivery-worker.service baci-quiz-finalization.service baci-gigl-tracking.service baci-cache-invalidation-drain.service
```

Every active Baci cron lock operand must use `/srv/baci-workers/locks`; the
lock directory and lock files must match `root:baci-locks` and `0710`/`0660`.
The output must show no old lock path. If the grep finds old paths, or any
service cannot be confirmed healthy, stop and reconcile before deployment.

This migration has no automatic `rollback` subcommand. Its own interruption
handler restores the original crontab before successful commit. After a
successful commit, do not hand-edit crontab or move lock files to simulate a
rollback: use the reviewed recovery procedure with the recorded pre-change
crontab and exact current service/lock state, preserving active lock inodes.
If a rollback is required after commit, have the operator review the host's
then-current state and command-level plan before any restore; never overwrite
a changed crontab or replace a lock inode under a live worker.

## 5. Migrate event and quiz cron jobs to system services (separate step)

This root-only migration requires the complete `baci-worker` runtime and
protected lock files, observable legacy user services, exact reviewed system
unit sources, and no concurrent host release or cron edit. It creates a
protected snapshot containing prior crontab/service states and unit hashes.
Inspect free space using the baseline `df -Pk` result. If
`/var/lib/baci-workers` did not exist at baseline, that command checks
`/var/lib`, the parent filesystem on which the migration creates its snapshot
root; if it already existed, it checks the exact snapshot filesystem.
The migration snapshot root is `/var/lib/baci-workers/event-unit-migration`;
ensure this filesystem has room to retain a protected crontab and migration
record before starting.

```sh
sudo python3 vps-workers/bin/migrate-event-workers-to-system-services.py migrate
```

Save the exact snapshot path printed by a successful run. Verify the event and
quiz cron rows are gone, the expected system services are enabled and active,
the legacy user services are stopped/disabled, and lock inodes still match
their pre-migration device/inode identities. Do not treat an active unit alone
as proof of successful worker execution; inspect its bounded logs and the
worker's intended health evidence without printing environment values.

If rollback is required, use the exact protected snapshot path emitted by the
migration and only after checking no newer migration or operator change has
altered the crontab, unit files, or protected lock inodes:

```sh
sudo python3 vps-workers/bin/migrate-event-workers-to-system-services.py rollback /var/lib/baci-workers/event-unit-migration/event-units-RECORDED_TIMESTAMP-PID
```

The tool verifies snapshot ownership, hashes, crontab identity, unit hashes,
and lock inode identity; it must refuse if those have drifted. Preserve a
refusal and reconcile state manually with the host operator. Do not delete the
snapshot as cleanup until the rollback window is closed and the change record
is complete.

## 6. Migrate cache invalidation cron schedule (separate step)

Run only if the host's reviewed change specifically includes migration of the
cache invalidation scheduler. This migration has its own snapshot and rollback
contract; it does not replace the event/quiz migration above.

```sh
sudo python3 vps-workers/bin/migrate-cache-invalidation-system-service.py migrate
```

Inspect free space using the baseline `df -Pk` result before starting. If
`/var/lib/baci-workers` did not exist at baseline, the command checks
`/var/lib`, the parent filesystem on which this migration creates its snapshot
root; if it already existed, it checks the exact snapshot filesystem. The
snapshot root is `/var/lib/baci-workers/cache-invalidation-migration-backups`;
ensure that filesystem has room for the protected cron and unit snapshots.
Record the printed rollback snapshot path. Verify the timer/service state and
that the legacy cache cron row is absent. To roll back, first confirm the unit
and cron state still match the migration snapshot contract, then run:

```sh
sudo python3 vps-workers/bin/migrate-cache-invalidation-system-service.py rollback /var/lib/baci-workers/cache-invalidation-migration-backups/RECORDED_CACHE_BACKUP_DIRECTORY
```

The script refuses rollback if the units changed since migration or the
snapshot is unsafe/incomplete. Do not force it or restore a broad crontab
backup over concurrent changes.

## 7. Completion record and stop conditions

The host change is complete only when every explicitly selected phase has its
own recorded result: source SHA and clean status, test exit codes, reviewed
plan, apply/migration exit code, generated snapshot locations, identity/group
and mode checks, crontab diff, unit enable/active state, runner inventory if
selected, and bounded workload health evidence. Keep local script tests,
host-side provisioning, GitHub runner readiness, worker runtime health,
database migration state, and production workflow routing as separate claims.

Stop immediately on any unobservable or contradictory state, unexpected
existing identity or path, checksum/hash mismatch, concurrent release, unclean
checkout, failed test, failed command, incomplete rollback, changed snapshot,
or secret exposure. Do not declare success based only on provisioner output or
an active systemd unit. Preserve all protected snapshots until the authorized
rollback window closes.
