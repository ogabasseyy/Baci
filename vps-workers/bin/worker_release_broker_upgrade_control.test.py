"""Membership parsing regressions for broker startup recovery."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from worker_release_broker_upgrade_control import SystemdBrokerControl, _require_only_pid
from worker_release_broker_upgrade_errors import BrokerUpgradeRejected


class BrokerPrestartMembershipTests(unittest.TestCase):
    def test_install_preflight_rejects_active_flat_or_incomplete_service(self):
        control = SystemdBrokerControl.__new__(SystemdBrokerControl)
        active = {"LoadState": "loaded", "ActiveState": "active", "SubState": "running",
                  "MainPID": "321", "ControlGroup": "/system.slice/baci-worker-release-broker.service"}
        with patch.object(control, "_properties", return_value=active), \
                patch.object(control, "wait_ready") as wait:
            with self.assertRaisesRegex(BrokerUpgradeRejected, "not a complete recognized generation"):
                control.prove_installation_safe(current_digest=None, stable_files_complete=False)
            with self.assertRaisesRegex(BrokerUpgradeRejected, "not a complete recognized generation"):
                control.prove_installation_safe(current_digest="a" * 64, stable_files_complete=False)
            wait.assert_not_called()

    def test_install_preflight_allows_absent_or_stopped_unit_and_only_verified_active_generation(self):
        control = SystemdBrokerControl.__new__(SystemdBrokerControl)
        absent = {"LoadState": "not-found", "ActiveState": "inactive", "SubState": "dead",
                  "MainPID": "0", "ControlGroup": ""}
        with patch.object(control, "_properties", return_value=absent):
            self.assertFalse(control.prove_installation_safe(current_digest=None,
                                                             stable_files_complete=False))

        active = {"LoadState": "loaded", "ActiveState": "active", "SubState": "running",
                  "MainPID": "321", "ControlGroup": "/system.slice/baci-worker-release-broker.service"}
        with patch.object(control, "_properties", return_value=active), \
                patch.object(control, "wait_ready") as wait:
            self.assertTrue(control.prove_installation_safe(current_digest="a" * 64,
                                                            stable_files_complete=True))
            wait.assert_called_once()

        with patch.object(control, "_properties", side_effect=[
                {"LoadState": "loaded", "ActiveState": "inactive", "SubState": "dead",
                 "MainPID": "0", "ControlGroup": "/system.slice/baci-worker-release-broker.service"},
                {"LoadState": "loaded", "ActiveState": "inactive", "SubState": "dead",
                 "MainPID": "0", "ControlGroup": "/system.slice/baci-worker-release-broker.service"},
        ]), patch.object(control, "prove_stopped") as stopped:
            self.assertFalse(control.prove_installation_safe(current_digest=None,
                                                             stable_files_complete=False))
            stopped.assert_called_once()

    def test_accepts_only_the_launcher_pid(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "cgroup.procs").write_text(f"{os.getpid()}\n")
            fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            try:
                _require_only_pid(fd, os.getpid())
            finally:
                os.close(fd)

    def test_rejects_other_process_malformed_membership_and_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "cgroup.procs").write_text(f"{os.getpid()}\n999999\n")
            fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            try:
                with self.assertRaisesRegex(BrokerUpgradeRejected, "unexpected process"):
                    _require_only_pid(fd, os.getpid())
                (root / "cgroup.procs").write_text("not-a-pid\n")
                with self.assertRaisesRegex(BrokerUpgradeRejected, "malformed"):
                    _require_only_pid(fd, os.getpid())
                (root / "cgroup.procs").unlink()
                (root / "cgroup.procs").symlink_to("/etc/passwd")
                with self.assertRaisesRegex(BrokerUpgradeRejected, "membership cannot be proven"):
                    _require_only_pid(fd, os.getpid())
            finally:
                os.close(fd)

    def test_full_prestart_proof_binds_exact_systemd_state_and_cgroup_inode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "cgroup.procs").write_text(f"{os.getpid()}\n")
            control = SystemdBrokerControl.__new__(SystemdBrokerControl)
            state = {"LoadState": "loaded", "ActiveState": "activating", "SubState": "start",
                     "MainPID": str(os.getpid()),
                     "ControlGroup": "/system.slice/baci-worker-release-broker.service"}

            def open_same_cgroup():
                fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
                return fd, os.fstat(fd)

            with patch.object(control, "_properties", side_effect=[state, state]), \
                    patch.object(control, "_open_prestart_cgroup", side_effect=open_same_cgroup):
                control.prove_prestart_safe()

    def test_full_prestart_proof_rejects_wrong_unit_state_or_extra_member(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "cgroup.procs").write_text(f"{os.getpid()}\n999999\n")
            control = SystemdBrokerControl.__new__(SystemdBrokerControl)
            state = {"LoadState": "loaded", "ActiveState": "activating", "SubState": "start",
                     "MainPID": str(os.getpid()),
                     "ControlGroup": "/system.slice/baci-worker-release-broker.service"}

            def open_cgroup():
                fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
                return fd, os.fstat(fd)

            with patch.object(control, "_properties", side_effect=[state, state]), \
                    patch.object(control, "_open_prestart_cgroup", side_effect=open_cgroup):
                with self.assertRaisesRegex(BrokerUpgradeRejected, "unexpected process"):
                    control.prove_prestart_safe()

            wrong_state = {**state, "SubState": "running"}
            with patch.object(control, "_properties", return_value=wrong_state), \
                    patch.object(control, "_open_prestart_cgroup") as open_cgroup_mock:
                with self.assertRaisesRegex(BrokerUpgradeRejected, "safe launcher phase"):
                    control.prove_prestart_safe()
                open_cgroup_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
