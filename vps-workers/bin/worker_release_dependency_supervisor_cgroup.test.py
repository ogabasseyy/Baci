"""Tests for strict cgroup proof and systemd-collected unit fallback."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parent))

import worker_release_dependency_supervisor_cgroup as cgroup
from worker_release_descriptor_cgroup import CgroupProofRejected


UNIT = "baci-worker-deps-aaaaaaaaaaaa-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.service"


class CollectedUnitProofTests(unittest.TestCase):
    def query(self, *, overrides=None):
        values = {"ActiveState": "inactive", "LoadState": "not-found",
                  "SubState": "dead", "MainPID": "0", "ControlGroup": ""}
        values.update(overrides or {})
        return lambda _verb, prop, _value, _unit: values[prop.split("=", 1)[1]]

    def test_collected_cgroup_accepts_only_twice_rechecked_dead_unit(self):
        no_uid = Mock()
        absent = Mock()
        cgroup.prove_collected_unit(UNIT, None, root=Path("/sys/fs/cgroup"), uid=812,
                                    deadline=cgroup.time.monotonic() + 3,
                                    query=self.query(), no_uid_processes=no_uid,
                                    absent_check=absent)
        self.assertEqual(no_uid.call_count, 4)
        self.assertEqual(absent.call_count, 4)

    def test_active_or_still_loaded_unit_is_rejected(self):
        for overrides in ({"LoadState": "loaded"}, {"ActiveState": "active"},
                          {"SubState": "running"}, {"MainPID": "4"},
                          {"ControlGroup": "/system.slice/other.service"}):
            with self.subTest(overrides=overrides), self.assertRaises(CgroupProofRejected):
                cgroup.prove_collected_unit(
                    UNIT, None, root=Path("/sys/fs/cgroup"), uid=812,
                    deadline=cgroup.time.monotonic() + 3,
                    query=self.query(overrides=overrides), no_uid_processes=Mock(),
                    absent_check=Mock())

    def test_uid_process_or_reappearing_exact_cgroup_rejects(self):
        with self.assertRaisesRegex(RuntimeError, "process"):
            cgroup.prove_collected_unit(
                UNIT, None, root=Path("/sys/fs/cgroup"), uid=812,
                deadline=cgroup.time.monotonic() + 3, query=self.query(),
                no_uid_processes=Mock(side_effect=RuntimeError("process remains")),
                absent_check=Mock())
        with self.assertRaisesRegex(CgroupProofRejected, "still exists"):
            cgroup.prove_collected_unit(
                UNIT, None, root=Path("/sys/fs/cgroup"), uid=812,
                deadline=cgroup.time.monotonic() + 3, query=self.query(),
                no_uid_processes=Mock(), absent_check=Mock(
                    side_effect=CgroupProofRejected("unit cgroup still exists")))

    def test_fallback_retains_root_and_slice_inode_contract(self):
        root = SimpleNamespace(st_dev=1, st_ino=2)
        slice_info = SimpleNamespace(st_dev=3, st_ino=4)
        cgroup._verify_trusted_root(root, slice_info, (1, 2, 3, 4))
        with self.assertRaisesRegex(CgroupProofRejected, "identity changed"):
            cgroup._verify_trusted_root(root, slice_info, (1, 2, 8, 9))

    def test_exact_absence_check_rejects_wrong_slice_or_present_unit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            slice_path = root / "system.slice"
            slice_path.mkdir()
            root_info, slice_info = root.stat(), slice_path.stat()
            trusted = (root_info.st_dev, root_info.st_ino,
                       slice_info.st_dev, slice_info.st_ino)
            with patch.object(cgroup, "_require_cgroup2_fd"):
                cgroup.require_exact_unit_cgroup_absent(root, UNIT, trusted_root=trusted)
                (slice_path / UNIT).mkdir()
                with self.assertRaisesRegex(CgroupProofRejected, "still exists"):
                    cgroup.require_exact_unit_cgroup_absent(root, UNIT, trusted_root=trusted)
                with self.assertRaisesRegex(CgroupProofRejected, "identity changed"):
                    cgroup.require_exact_unit_cgroup_absent(root, UNIT,
                                                             trusted_root=(9, 9, 9, 9))
            with self.assertRaises(FileNotFoundError):
                cgroup.require_exact_unit_cgroup_absent(root / "missing", UNIT)

    def test_cgroup_events_enoent_uses_collected_proof_and_journals_no_inode(self):
        with tempfile.TemporaryFile() as stream:
            identity = os.fstat(stream.fileno())
            process = Mock()
            process.poll.return_value = 0
            journal = Mock()
            with patch.object(cgroup, "require_empty_cgroup",
                              side_effect=FileNotFoundError("cgroup.events")), patch.object(
                cgroup, "prove_collected_unit") as collected:
                cgroup.drain_until_proven(
                    UNIT, stream.fileno(), identity, process, systemctl="/bin/false",
                    query=self.query(), rejected=RuntimeError,
                    deadline=cgroup.time.monotonic() + 3,
                    unproven=lambda unit, reason: RuntimeError(reason), journal=journal,
                    root=Path("/sys/fs/cgroup"), uid=812)
            collected.assert_called_once()
            journal.mark_drained.assert_called_once_with(None)

    def test_collected_proof_rejects_unreaped_systemd_run_client(self):
        process = Mock()
        process.wait.side_effect = cgroup.subprocess.TimeoutExpired("systemd-run", 0.1)
        with self.assertRaisesRegex(CgroupProofRejected, "not been reaped"):
            cgroup.prove_collected_unit(
                UNIT, process, root=Path("/sys/fs/cgroup"), uid=812,
                deadline=cgroup.time.monotonic() + 3, query=self.query(),
                no_uid_processes=Mock(), absent_check=Mock())


if __name__ == "__main__":
    unittest.main()
