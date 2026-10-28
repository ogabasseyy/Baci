# Worker lock namespace migration

The worker lock namespace migration is a root-only host operation. It is not
run by `deploy.sh`, release workflows, or ordinary provisioning. Run it only
after the fixed `/srv/baci-workers` worker layout and `baci-worker` system
services are provisioned and the host has been checked by an operator.

## Preconditions

Before the migration, confirm on the VPS that:

- `/srv/baci-workers` is a real directory with the reviewed release tree and
  runtime environment; the `baci-worker` account and its system services are
  installed.
- The `baci-locks` group has only `bassey` and `baci-worker` as members.
- The root-run migration script is from the reviewed application revision.
- No production deploy or manual crontab change is in progress.

The migration itself verifies the release user's crontab, worker units, old
lock inodes, active processes, and new lock paths. It fails closed if the
crontab changes during the operation, it cannot drain a legacy lock, an
unrecognized lock path appears, user units cannot be inspected, or the new
crontab cannot be read back. It restores the original crontab on a pre-commit
failure and does not automatically run from deployment automation.

## Operator sequence

From the reviewed repository checkout on the VPS, run as root:

```sh
python3 vps-workers/bin/migrate-worker-lock-namespace.py
```

Do not bypass a nonzero exit or manually restart units after a failed
migration. Capture the diagnostic, inspect the exact crontab and unit state,
then rerun only after the cause is corrected.

After a successful migration, verify the installed state:

```sh
crontab -u bassey -l | grep -E 'flock.*(/home/bassey/baci-workers/locks|/srv/baci-workers/locks)'
stat -c '%U:%G:%a %n' /srv/baci-workers /srv/baci-workers/locks
find /srv/baci-workers/locks -maxdepth 1 -type f -name '*.lock' -exec stat -c '%U:%G:%a %n' {} \;
```

Every active Baci worker cron lock operand must use `/srv/baci-workers/locks`.
The fixed root and lock directories and every provisioned lock file must remain
owned by `root:baci-locks`; their modes are `0710` for directories and `0660`
for files. Confirm the migration's reported worker services are healthy before
resuming normal deployment activity.

`deploy.sh` and its cron/service generators now use the fixed protected lock
namespace and refuse to recreate the legacy user event/quiz services. This
code change does not prove that a host migration has run; retain the successful
operator command result and the live verification output as separate evidence.
