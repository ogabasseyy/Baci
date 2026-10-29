import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import fcntl

import worker_release_quiesce_lease as lease_module
import worker_release_recovery_latch as recovery_latch
import worker_release_quiesce_lease_manager as lease_manager_module
from worker_release_quiesce_lease import QuiesceLeaseRejected, WorkerQuiesceLeaseManager


FENCE = {"run_id": "1234", "run_attempt": 2, "sha": "a" * 40}


class WorkerQuiesceLeaseFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.root = Path(self.temp.name)
        self.root.chmod(0o710)
        self.lock_dir = self.root / "locks"
        self.lock_dir.mkdir()
        self.lock_dir.chmod(0o710)
        self.managers = []
        self.marker = self.root / "cleanup.log"
        self.lock_path = self.root / "worker.lock"
        self.lock_path.write_text("", encoding="utf-8")
        self.lock_path.chmod(0o600)
        self.helper = self.root / "lease-helper.sh"
        self.write_protocol_helper()
        self.support = []
        for name in ("locks.py", "runtime.py"):
            path = self.root / name
            path.write_text("# fixed test support\n", encoding="utf-8")
            path.chmod(0o600)
            self.support.append(str(path))
        self.patches = [
            patch.object(lease_module, "LEASE_HELPER_PATH", str(self.helper)),
            patch.object(lease_module, "LEASE_SUPPORT_PATHS", tuple(self.support)),
            patch.object(lease_module, "TRUSTED_ROOT_UID", os.geteuid()),
            patch.object(lease_module, "acquire_production_lock_fds", side_effect=self.acquire_test_lock),
            patch.object(lease_module, "create_latch", return_value={"version": 1}),
            patch.object(lease_module, "update_latch", return_value={"version": 1}),
            patch.object(lease_module, "load_latch", return_value=None),
        ]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def acquire_test_lock(self, *, deadline):
        fd = os.open(self.lock_path, os.O_RDWR)
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return [fd]
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    os.close(fd)
                    raise lease_module.LockSetError("worker lock acquisition timed out")
                time.sleep(0.01)

    def manager(self):
        manager = WorkerQuiesceLeaseManager(
            worker_uid=os.getuid(), worker_gid=os.getgid(), lock_gid=os.getgid(),
            latch_path=self.lock_dir / "release-recovery-latch.json",
            gate_socket_path=self.root / "health.sock", owner_uid=os.geteuid(),
        )
        manager._snapshot_active_services = lambda: [
            "baci-domain-event-router", "baci-event-delivery-worker", "baci-quiz-finalization"
        ]
        self.managers.append(manager)
        return manager

    def write_protocol_helper(self):
        self.helper.write_text(
            "#!/bin/bash\nset -euo pipefail\n"
            f"trap 'printf cleanup >> {str(self.marker)!r}' EXIT\n"
            "printf 'READY\\n'\n"
            "while IFS= read -r command; do\n"
            "  case \"$command\" in START_HEALTH) printf 'STARTED\\n' ;; ABORT) printf 'STOPPED\\n' ;; HEALTHY|RESTORE) printf 'DONE\\n'; exit 0 ;; *) exit 9 ;; esac\n"
            "done\nexit 9\n", encoding="utf-8",
        )
        self.helper.chmod(0o700)

    def tearDown(self):
        for manager in self.managers:
            if manager._lease is not None:
                for fd in manager._lease._lock_fds:
                    try:
                        os.close(fd)
                    except OSError:
                        pass
            try:
                manager._gate.close()
            except (OSError, RuntimeError):
                pass
        self.temp.cleanup()


__all__ = ["WorkerQuiesceLeaseFixture", "FENCE", "lease_module", "recovery_latch", "lease_manager_module", "QuiesceLeaseRejected", "WorkerQuiesceLeaseManager", "os", "Path", "signal", "subprocess", "sys", "tempfile", "time", "unittest", "SimpleNamespace", "patch", "fcntl"]
