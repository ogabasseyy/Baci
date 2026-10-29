import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import fcntl

import worker_release_quiesce_lease as lease_module
from worker_release_quiesce_lease import QuiesceLeaseRejected, WorkerQuiesceLeaseManager


FENCE = {"run_id": "1234", "run_attempt": 2, "sha": "a" * 40}


class WorkerQuiesceLeaseTests(unittest.TestCase):
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
            patch.object(lease_module, "load_latch", return_value={"fence": FENCE, "phase": "quiescing"}),
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

    def test_same_fence_reuses_one_lease_and_release_waits_for_cleanup(self):
        manager = self.manager()
        lease = manager.acquire(FENCE)
        self.assertIs(manager.acquire(FENCE), lease)
        self.assertIs(manager.require_active(FENCE), lease)
        self.assertTrue(lease.active)
        self.assertFalse(self.marker.exists())
        with self.assertRaisesRegex(QuiesceLeaseRejected, "another authenticated release"):
            manager.acquire({**FENCE, "run_id": "1235"})

        lease.confirm_healthy()
        self.assertEqual(self.marker.read_text(encoding="utf-8"), "cleanup")
        self.assertFalse(lease.active)
        other_fd = os.open(self.lock_path, os.O_RDWR)
        try:
            fcntl.flock(other_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.close(other_fd)
        manager.close()

    def test_broker_owned_lock_survives_service_supervisor_death_during_operation(self):
        manager = self.manager()
        lease = manager.acquire(FENCE)
        probe_fd = os.open(self.lock_path, os.O_RDWR)
        try:
            with lease.operation():
                os.kill(lease._process.pid, signal.SIGKILL)
                lease._process.wait(timeout=3)
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(probe_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(QuiesceLeaseRejected, "not active"):
                manager.require_active(FENCE)
            with self.assertRaisesRegex(QuiesceLeaseRejected, "recovery latch remains"):
                lease.release()
            self.assertTrue(lease._lock_fds, "failed supervisor must not release broker-owned locks")
            with self.assertRaises(BlockingIOError):
                fcntl.flock(probe_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.close(probe_fd)
            for fd in lease._lock_fds:
                os.close(fd)
            lease._lock_fds.clear()

    def test_expiry_closes_the_pipe_and_prevents_use_of_expired_lease(self):
        manager = self.manager()
        with patch.object(lease_module, "LEASE_MAX_SECONDS", 0.05):
            lease = manager.acquire(FENCE)
        deadline = time.monotonic() + 3
        while not self.marker.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(self.marker.exists(), "expired lease should exit through helper cleanup")
        with self.assertRaisesRegex(QuiesceLeaseRejected, "not active"):
            lease.require_active()
        with self.assertRaisesRegex(QuiesceLeaseRejected, "not active"):
            manager.require_active(FENCE)

    def test_expiry_during_mutation_defers_cleanup_until_operation_exits(self):
        manager = self.manager()
        with patch.object(lease_module, "LEASE_MAX_SECONDS", 0.05):
            lease = manager.acquire(FENCE)
        with self.assertRaisesRegex(QuiesceLeaseRejected, "cleanup failed"):
            with lease.operation():
                time.sleep(0.1)
                self.assertFalse(self.marker.exists(), "timer must not release locks mid-operation")
        self.assertTrue(self.marker.exists(), "operation exit should finish deferred lease cleanup")
        with self.assertRaisesRegex(QuiesceLeaseRejected, "not active"):
            manager.require_active(FENCE)

    def test_broker_process_exit_closes_child_pipe_and_runs_helper_cleanup(self):
        holder = self.root / "crash-holder.py"
        broker_ready = self.root / "broker-ready"
        holder.write_text(
            "import fcntl, os, sys, time\n"
            f"sys.path.insert(0, {str(Path(__file__).resolve().parent)!r})\n"
            "import worker_release_quiesce_lease as module\n"
            f"module.LEASE_HELPER_PATH = {str(self.helper)!r}\n"
            f"module.LEASE_SUPPORT_PATHS = {tuple(self.support)!r}\n"
            "module.TRUSTED_ROOT_UID = os.geteuid()\n"
            f"lock_path = {str(self.lock_path)!r}\n"
            "def acquire_lock(**kwargs):\n"
            "  fd = os.open(lock_path, os.O_RDWR)\n"
            "  fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)\n"
            "  return [fd]\n"
            "module.acquire_production_lock_fds = acquire_lock\n"
            f"manager = module.WorkerQuiesceLeaseManager(worker_uid=os.getuid(), worker_gid=os.getgid(), lock_gid=os.getgid(), latch_path={str(self.lock_dir / 'latch')!r}, gate_socket_path={str(self.root / 'gate')!r}, owner_uid=os.geteuid())\n"
            f"manager.acquire({FENCE!r})\n"
            f"open({str(broker_ready)!r}, 'w').close()\n"
            "time.sleep(10)\n",
            encoding="utf-8",
        )
        broker = subprocess.Popen([sys.executable, str(holder)])
        probe = os.open(self.lock_path, os.O_RDWR)
        try:
            deadline = time.monotonic() + 3
            while not broker_ready.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(broker_ready.exists(), "broker must finish service stop and lock acquisition")
            with self.assertRaises(BlockingIOError):
                fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
            broker.kill()
            broker.wait(timeout=3)
        finally:
            os.close(probe)
        deadline = time.monotonic() + 3
        while not self.marker.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(self.marker.exists(), "broker exit should close the lease pipe and invoke helper cleanup")
        released_fd = os.open(self.lock_path, os.O_RDWR)
        try:
            fcntl.flock(released_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.close(released_fd)

    def test_invalid_fence_is_rejected_before_starting_a_helper(self):
        manager = self.manager()
        with self.assertRaisesRegex(QuiesceLeaseRejected, "fence is invalid"):
            manager.acquire({**FENCE, "run_attempt": True})
        self.assertFalse(self.marker.exists())

    def test_partial_ready_frame_times_out_and_closes_the_helper(self):
        # The production helper gets a fixed minimal environment. This fixture
        # uses a literal marker path so the timeout branch can verify cleanup.
        self.helper.write_text(
            "#!/bin/bash\n"
            f"trap 'printf cleanup >> {str(self.marker)!r}' EXIT\n"
            "printf REA\n"
            "cat >/dev/null\n",
            encoding="utf-8",
        )
        self.helper.chmod(0o700)
        manager = self.manager()
        with patch.object(lease_module, "LEASE_READY_SECONDS", 0.05):
            with self.assertRaisesRegex(QuiesceLeaseRejected, "acquisition timed out"):
                manager.acquire(FENCE)
        self.assertEqual(self.marker.read_text(encoding="utf-8"), "cleanup")

    def test_unconfirmed_startup_cleanup_blocks_reacquire_until_child_exits(self):
        self.helper.write_text(
            "#!/bin/bash\n"
            f"trap 'printf cleanup >> {str(self.marker)!r}' EXIT\n"
            "trap 'exit 0' HUP INT TERM\n"
            "printf REA\n"
            "sleep 10\n",
            encoding="utf-8",
        )
        self.helper.chmod(0o700)
        manager = self.manager()
        with patch.object(lease_module, "LEASE_READY_SECONDS", 0.03), patch.object(lease_module, "LEASE_CLEANUP_SECONDS", 0.03):
            with self.assertRaisesRegex(QuiesceLeaseRejected, "acquisition timed out"):
                manager.acquire(FENCE)
            self.assertIsNotNone(manager._orphan)
            with self.assertRaisesRegex(QuiesceLeaseRejected, "cleanup is unconfirmed"):
                manager.acquire(FENCE)
            os.killpg(manager._orphan.pid, signal.SIGTERM)
            self.assertEqual(manager._orphan.wait(timeout=3), 0)

        self.write_protocol_helper()
        lease = manager.acquire(FENCE, recovery=True)
        lease.confirm_healthy()

    def test_installed_shell_wrapper_uses_fixed_root_and_never_dispatches_input(self):
        wrapper = Path(__file__).resolve().parents[1] / "lib" / "worker-release-quiesce-lease.sh"
        source = wrapper.read_text(encoding="utf-8")
        self.assertIn('/usr/bin/systemctl stop "$service"', source)
        self.assertNotIn("strict_worker_release_quiesce", source)
        self.assertIn("while IFS= read -r command", source)
        self.assertIn('HEALTHY)', source)
        self.assertIn('recovery clear', source)
        self.assertIn('Parent death or a broken control pipe never means "restart services"', source)
        self.assertNotRegex(source, r"\beval\b|bash\s+-c|\$\{?[@*]}")


if __name__ == "__main__":
    unittest.main()
