import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import worker_release_quiesce_lease as lease_module
from worker_release_quiesce_lease import QuiesceLeaseRejected, WorkerQuiesceLeaseManager


FENCE = {"run_id": "1234", "run_attempt": 2, "sha": "a" * 40}


class WorkerQuiesceLeaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.root = Path(self.temp.name)
        self.marker = self.root / "cleanup.log"
        self.helper = self.root / "lease-helper.sh"
        self.helper.write_text(
            "#!/bin/bash\n"
            "set -euo pipefail\n"
            f"trap 'printf cleanup >> {str(self.marker)!r}' EXIT\n"
            "trap 'exit 0' HUP INT TERM\n"
            "printf 'READY\\n'\n"
            "while IFS= read -r _line; do exit 1; done\n"
            "exit 0\n",
            encoding="utf-8",
        )
        self.helper.chmod(0o700)
        self.support = []
        for name in ("strict.sh", "keeper.py"):
            path = self.root / name
            path.write_text("# fixed test support\n", encoding="utf-8")
            path.chmod(0o600)
            self.support.append(str(path))
        self.patches = [
            patch.object(lease_module, "LEASE_HELPER_PATH", str(self.helper)),
            patch.object(lease_module, "LEASE_SUPPORT_PATHS", tuple(self.support)),
            patch.object(lease_module, "TRUSTED_ROOT_UID", os.geteuid()),
        ]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def tearDown(self):
        self.temp.cleanup()

    def test_same_fence_reuses_one_lease_and_release_waits_for_cleanup(self):
        manager = WorkerQuiesceLeaseManager()
        lease = manager.acquire(FENCE)
        self.assertIs(manager.acquire(FENCE), lease)
        self.assertIs(manager.require_active(FENCE), lease)
        self.assertTrue(lease.active)
        self.assertFalse(self.marker.exists())
        with self.assertRaisesRegex(QuiesceLeaseRejected, "another authenticated release"):
            manager.acquire({**FENCE, "run_id": "1235"})

        lease.release()
        self.assertEqual(self.marker.read_text(encoding="utf-8"), "cleanup")
        self.assertFalse(lease.active)
        manager.close()

    def test_expiry_closes_the_pipe_and_prevents_use_of_expired_lease(self):
        manager = WorkerQuiesceLeaseManager()
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
        manager = WorkerQuiesceLeaseManager()
        with patch.object(lease_module, "LEASE_MAX_SECONDS", 0.05):
            lease = manager.acquire(FENCE)
        with lease.operation():
            time.sleep(0.1)
            self.assertFalse(self.marker.exists(), "timer must not release locks mid-operation")
        self.assertTrue(self.marker.exists(), "operation exit should finish deferred lease cleanup")
        with self.assertRaisesRegex(QuiesceLeaseRejected, "not active"):
            manager.require_active(FENCE)

    def test_broker_process_exit_closes_child_pipe_and_runs_helper_cleanup(self):
        holder = self.root / "crash-holder.py"
        holder.write_text(
            "import os, sys\n"
            f"sys.path.insert(0, {str(Path(__file__).resolve().parent)!r})\n"
            "import worker_release_quiesce_lease as module\n"
            f"module.LEASE_HELPER_PATH = {str(self.helper)!r}\n"
            f"module.LEASE_SUPPORT_PATHS = {tuple(self.support)!r}\n"
            "module.TRUSTED_ROOT_UID = os.geteuid()\n"
            "manager = module.WorkerQuiesceLeaseManager()\n"
            f"manager.acquire({FENCE!r})\n"
            "os._exit(0)\n",
            encoding="utf-8",
        )
        result = subprocess.run([sys.executable, str(holder)], check=False, timeout=5)
        self.assertEqual(result.returncode, 0)
        deadline = time.monotonic() + 3
        while not self.marker.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(self.marker.exists(), "broker exit should close the lease pipe and invoke cleanup")

    def test_invalid_fence_is_rejected_before_starting_a_helper(self):
        manager = WorkerQuiesceLeaseManager()
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
        manager = WorkerQuiesceLeaseManager()
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
        manager = WorkerQuiesceLeaseManager()
        with patch.object(lease_module, "LEASE_READY_SECONDS", 0.03), patch.object(lease_module, "LEASE_CLEANUP_SECONDS", 0.03):
            with self.assertRaisesRegex(QuiesceLeaseRejected, "acquisition timed out"):
                manager.acquire(FENCE)
            self.assertIsNotNone(manager._orphan)
            with self.assertRaisesRegex(QuiesceLeaseRejected, "cleanup is unconfirmed"):
                manager.acquire(FENCE)
            os.killpg(manager._orphan.pid, signal.SIGTERM)
            self.assertEqual(manager._orphan.wait(timeout=3), 0)

        self.helper.write_text(
            "#!/bin/bash\n"
            f"trap 'printf cleanup >> {str(self.marker)!r}' EXIT\n"
            "printf 'READY\\n'\n"
            "cat >/dev/null\n"
            "exit 0\n",
            encoding="utf-8",
        )
        self.helper.chmod(0o700)
        lease = manager.acquire(FENCE)
        lease.release()

    def test_installed_shell_wrapper_uses_fixed_root_and_never_dispatches_input(self):
        wrapper = Path(__file__).resolve().parents[1] / "lib" / "worker-release-quiesce-lease.sh"
        source = wrapper.read_text(encoding="utf-8")
        self.assertIn("helper_dir='/usr/local/lib/baci-worker-broker'", source)
        self.assertIn("worker_root='/srv/baci-workers'", source)
        self.assertIn("strict_worker_release_quiesce \"$worker_root\"", source)
        self.assertIn("while IFS= read -r _line", source)
        self.assertNotRegex(source, r"\beval\b|bash\s+-c|\$\{?[@*]}")


if __name__ == "__main__":
    unittest.main()
