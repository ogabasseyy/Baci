import fcntl
import json
import os
from pathlib import Path
import stat
import sys
import time
from runtime_worker_installation import PREPARED, WorkerInstaller, place
from treasury_owner_contract import DEADLINE, DEADLINE_EPOCH, Refused
from treasury_owner_io import private_directory, root_ancestors


def activate(installer, progress=lambda stage: None):
    steps = [
        ('preflight', installer.preflight),
        ('private-installation', installer.prepare),
        ('restricted-readiness', lambda: installer.run_once('readiness')),
        ('fixed-deadline', installer.install_units),
        ('database-apply-unconfirmed', installer.apply),
        ('independent-snapshot', lambda: installer.run_once('snapshot')),
        ('initial-background-pass', lambda: installer.run_once('background')),
        ('unchanged-payment-state', installer.verify_no_payment),
        ('schedules', installer.schedule),
    ]
    for stage, operation in steps:
        progress(stage)
        operation()


def main():
    stage = 'owner-bundle'
    applied = False
    installer = None
    lock = None

    def progress(current):
        nonlocal stage, applied
        stage = current
        if current == 'database-apply-unconfirmed':
            applied = None
        elif current == 'independent-snapshot':
            applied = True
        print(json.dumps(dict(stage=stage)), flush=True)

    try:
        if os.geteuid() != 0 or len(sys.argv) != 1 or time.time() >= DEADLINE_EPOCH - 600:
            raise Refused('Root execution within the fixed window required')
        root_ancestors(PREPARED)
        private_directory(PREPARED)
        lock = os.open(PREPARED / 'workers-install.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        metadata = os.fstat(lock)
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_nlink != 1
                or stat.S_IMODE(metadata.st_mode) != 0o600):
            raise Refused('Worker install lock refused')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        bundle = Path(__file__).absolute().parent
        installer = WorkerInstaller(bundle)
        activate(installer, progress)
        report = dict(status='restricted-workers-scheduled', cardPaymentsEnabled=False,
                      prefundedReplayChanged=False, deadline=DEADLINE, approvedBudgetKobo=10000,
                      preservedOpeningPrincipalKobo=10000, initialSnapshotVerified=True,
                      initialBackgroundPass=True, manifestSha256=installer.digest)
        place(bundle / 'workers-result.json', json.dumps(report, sort_keys=True).encode(), mode=0o600)
        print(json.dumps(report))
        return 0
    except Exception as error:
        cleanup = True
        if installer is not None:
            try:
                installer.withdraw()
            except Exception:
                cleanup = False
        print(json.dumps(dict(status='refused', stage=stage, databaseApplied=applied,
                              schedulesWithdrawn=cleanup, cardPaymentsEnabled=False, redacted=True,
                              reason=str(error) if isinstance(error, Refused) else 'Worker installation refused')))
        return 1
    finally:
        if lock is not None:
            os.close(lock)


if __name__ == '__main__':
    sys.exit(main())
