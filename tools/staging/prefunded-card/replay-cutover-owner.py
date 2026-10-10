import fcntl
import json
import os
from pathlib import Path
import stat
import time
from treasury_owner_contract import DEADLINE, DEADLINE_EPOCH, Refused


class CutoverFailure(Refused):
    def __init__(self, stage, old_stopped, enrollment_committed, reason=None):
        super().__init__('Replay cutover incomplete; audit and existing artifacts retained')
        self.stage = stage
        self.old_stopped = old_stopped
        self.enrollment_committed = enrollment_committed
        self.reason = reason


def activate(actions):
    stage = 'preflight'
    old_stopped = False
    committed = False
    try:
        for stage in ('preflight', 'prepare', 'readiness', 'rehearse', 'deadline',
                      'stop_old', 'enroll', 'record_commit', 'start', 'verify'):
            if time.time() >= DEADLINE_EPOCH - 180:
                raise Refused('Fixed staging deadline expired')
            if stage == 'enroll':
                committed = None
            if stage == 'stop_old':
                old_stopped = None
            getattr(actions, stage)()
            if stage == 'stop_old':
                old_stopped = True
            if stage == 'enroll':
                committed = True
        return dict(status='signed-replay-enrolled', cardPaymentsEnabled=False,
                    prefundedReplayEnabled=True, expiresAt=DEADLINE,
                    preservedOpeningPrincipalKobo=10000, approvedTreasuryBudgetKobo=10000)
    except Exception as error:
        raise CutoverFailure(stage, old_stopped, committed, str(error) if isinstance(error, Refused) else None) from None


def main():
    descriptor = None
    try:
        from replay_cutover_installation import Installer
        if os.geteuid() != 0:
            raise Refused('Owner privileges required')
        path = Path('/etc/baci/prefunded-card/runtime-preparation.lock')
        from treasury_owner_io import root_ancestors
        root_ancestors(path)
        descriptor = os.open(path, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600:
            raise Refused('Owner lock refused')
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = activate(Installer(Path(__file__).absolute().parent))
        print(json.dumps(result))
        return 0
    except Exception as error:
        print(json.dumps(dict(status='refused', stage=getattr(error, 'stage', 'owner-preflight'),
            legacyWorkerStopped=getattr(error, 'old_stopped', False),
            enrollmentCommitted=getattr(error, 'enrollment_committed', False),
            reason=getattr(error, 'reason', None), cardPaymentsEnabled=False, redacted=True)))
        return 1
    finally:
        if descriptor is not None:
            os.close(descriptor)


if __name__ == '__main__':
    raise SystemExit(main())
