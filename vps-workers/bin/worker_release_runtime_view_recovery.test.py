"""Durable abandoned-view recovery and exact-systemd proof regressions."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

from worker_release_runtime_view import RuntimeViewRejected, create_runtime_view
from worker_release_runtime_view_journal import (
    RuntimeViewJournalRejected, list_all_runtime_view_records,
    list_runtime_view_records_for_candidate,
)
from worker_release_runtime_view_recovery import (
    RuntimeViewRecoveryRejected, recover_runtime_view,
)


@unittest.skipUnless(os.geteuid() == 0, "requires root-owned runtime-view fixture")
class RuntimeViewRecoveryTests(unittest.TestCase):
    def setUp(self):
        from worker_release_runtime_acl import verifier_uid
        self.runtime_uid = (verifier_uid() if os.environ.get(
            "WORKER_RELEASE_RUNTIME_REQUIRE_SYSTEMD") == "1" else 61000)
        self.identity_patch = patch("worker_release_runtime_view.runtime_verifier_identity",
                                     return_value=(self.runtime_uid, 61000))
        self.identity_patch.start()
        self.recovery_identity_patch = patch(
            "worker_release_runtime_view_recovery.runtime_verifier_identity",
            return_value=(self.runtime_uid, 61000))
        self.recovery_identity_patch.start()
        self.temporary = tempfile.TemporaryDirectory(dir=Path.home())
        self.base = Path(self.temporary.name)
        self.views = self.base / "views"
        self.views.mkdir(mode=0o711)
        self.candidate = self.base / ("." + "a" * 40 + ".incoming." + "b" * 32)
        self.candidate.mkdir()
        self.fence = "a" * 16 + "c" * 48
        self.unit = f"baci-worker-runtime-{self.fence[:16]}-{uuid.uuid4().hex[:12]}-0.service"
        info = self.candidate.lstat()
        self.identity = (info.st_dev, info.st_ino)
        self.view = create_runtime_view(
            self.unit, candidate_path=self.candidate, fence_digest=self.fence,
            runtime_uid=self.runtime_uid,
            candidate_identity=self.identity, view_root=self.views)
        self.view.abandon()
        records = list_runtime_view_records_for_candidate(
            self.candidate, *self.identity, view_root=self.views)
        self.assertEqual(len(records), 1)
        self.record = records[0]

    def tearDown(self):
        self.recovery_identity_patch.stop()
        self.identity_patch.stop()
        for current, directories, _files in os.walk(self.base, topdown=True, followlinks=False):
            os.chmod(current, 0o700)
            for name in directories:
                path = Path(current) / name
                if not path.is_symlink():
                    os.chmod(path, 0o700)
        self.temporary.cleanup()

    def test_candidate_query_is_exact_and_global_query_keeps_record(self):
        self.assertEqual(list_all_runtime_view_records(self.views), (self.record,))
        self.assertEqual(list_runtime_view_records_for_candidate(
            self.candidate, self.identity[0], self.identity[1] + 1,
            view_root=self.views), ())

    def test_recovery_removes_only_the_recorded_empty_view_after_unit_proof(self):
        with patch("worker_release_runtime_view_recovery._prove_unit_gone") as proof:
            recover_runtime_view(self.record, view_root=self.views)
        proof.assert_called_once_with(self.unit, self.runtime_uid)
        self.assertEqual(list_all_runtime_view_records(self.views), ())
        self.assertFalse((self.views / self.unit).exists())
        with self.assertRaises(RuntimeViewRecoveryRejected):
            recover_runtime_view(self.record, view_root=self.views)

    def test_recovery_handles_crash_after_unit_directory_before_mountpoint(self):
        (self.views / self.unit / "candidate").rmdir()
        with patch("worker_release_runtime_view_recovery._prove_unit_gone") as proof:
            recover_runtime_view(self.record, view_root=self.views)
        proof.assert_called_once_with(self.unit, self.runtime_uid)
        self.assertEqual(list_all_runtime_view_records(self.views), ())
        self.assertFalse((self.views / self.unit).exists())

    def test_recovery_refuses_nonempty_mountpoint_without_clearing_record(self):
        (self.view.candidate_path / "mounted-content").write_text("still mounted")
        with patch("worker_release_runtime_view_recovery._prove_unit_gone"):
            with self.assertRaisesRegex(RuntimeViewRecoveryRejected, "mountpoint is not empty"):
                recover_runtime_view(self.record, view_root=self.views)
        self.assertEqual(list_all_runtime_view_records(self.views), (self.record,))

    def test_malformed_or_orphan_runtime_view_entry_fails_closed(self):
        record_path = self.views / f"{self.unit}.json"
        record_path.chmod(0o600)
        record_path.write_text("{}\n")
        with self.assertRaises(RuntimeViewJournalRejected):
            list_all_runtime_view_records(self.views)

    @unittest.skipUnless(os.geteuid() == 0 and sys.platform.startswith("linux")
                         and os.environ.get("WORKER_RELEASE_RUNTIME_REQUIRE_SYSTEMD") == "1",
                         "requires disposable root/systemd/cgroup-v2 CI")
    def test_actual_systemd_recovery_proves_unstarted_unit_absent(self):
        recover_runtime_view(self.record, view_root=self.views)
        self.assertEqual(list_all_runtime_view_records(self.views), ())


if __name__ == "__main__":
    unittest.main()
