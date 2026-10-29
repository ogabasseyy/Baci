"""Exact-fence and runtime-view recovery contracts."""
from __future__ import annotations

import sys
import subprocess
import unittest
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

import worker_release_authenticated_staging_recovery as recovery
import worker_release_runtime_view_journal as view_journal
import worker_release_runtime_view_recovery as view_recovery
import worker_release_dependency_supervisor_cgroup as cgroup


class StagingRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("/srv/baci-workers")
        self.result_root = Path("/run/baci-worker-release-build/results")
        self.view_root = Path("/var/lib/baci-worker-runtime-views")
        self.fence = {
            "repository": "ogabasseyy/Baci",
            "workflow": ".github/workflows/production-release.yml",
            "ref": "refs/heads/main", "sha": "a" * 40,
            "run_id": "123", "run_attempt": 2, "job_id": "456",
        }
        self.target = {"sha": "a" * 40, "run_id": "123",
                       "run_attempt": 2, "job_id": "456"}
        self.stage = {"fence": self.fence, "transaction_id": "b" * 32,
                      "incoming_name": f".{self.fence['sha']}.incoming.{ 'b' * 32}",
                      "incoming_dev": 1, "incoming_ino": 22}
        self.view = SimpleNamespace(candidate_path=self.root / "releases" / self.stage["incoming_name"],
                                    candidate_identity=(1, 22), unit="baci-worker-runtime-1.service")

    def _journal_mocks(self, *, stage=None, source=None, builder=None):
        class Context:
            def __init__(self, value): self.value = value
            def __enter__(self): return self.value
            def __exit__(self, *_args): return None
        stage_instance = SimpleNamespace(_load=lambda: stage, recover=unittest.mock.Mock())
        source_instance = SimpleNamespace(pending_record=lambda: source,
                                          cleanup=unittest.mock.Mock())
        builder_instance = SimpleNamespace(read=lambda: builder)
        return (patch.object(recovery, "SourceViewJournal", return_value=Context(source_instance)),
                patch.object(recovery, "BuilderUnitJournal", return_value=Context(builder_instance)),
                patch.object(recovery, "StageJournal", return_value=Context(stage_instance)),
                stage_instance, source_instance, builder_instance)

    def test_status_returns_only_exact_stage_fence_when_view_inode_matches(self):
        patches = self._journal_mocks(stage=self.stage)
        with patch("pwd.getpwnam", return_value=SimpleNamespace(pw_uid=1002)), patches[0], patches[1], patches[2], patch.object(
                view_journal, "list_all_runtime_view_records", return_value=(self.view,)):
            status = recovery.stage_recovery_status(self.root, self.result_root,
                                                    worker_gid=81, view_root=self.view_root)
        self.assertEqual(status, {"pending": True, "target": self.target})

    def test_status_fails_closed_for_mismatched_or_orphan_runtime_view(self):
        patches = self._journal_mocks(stage=self.stage)
        wrong = SimpleNamespace(candidate_path=self.view.candidate_path,
                                 candidate_identity=(9, 22), fence_digest="0" * 64)
        with patch("pwd.getpwnam", return_value=SimpleNamespace(pw_uid=1002)), patches[0], patches[1], patches[2], patch.object(
                view_journal, "list_all_runtime_view_records", return_value=(wrong,)):
            with self.assertRaises(recovery.SourceViewRejected):
                recovery.stage_recovery_status(self.root, self.result_root,
                                               worker_gid=81, view_root=self.view_root)

    def test_status_rejects_source_journal_without_its_stage_journal(self):
        source = {"fence": self.fence, "transaction_id": "b" * 32}
        patches = self._journal_mocks(stage=None, source=source)
        with patch("pwd.getpwnam", return_value=SimpleNamespace(pw_uid=1002)), \
                patches[0], patches[1], patches[2]:
            with self.assertRaisesRegex(recovery.SourceViewRejected, "without its stage"):
                recovery._stage_recovery_records(self.root, self.result_root, worker_gid=81)

    def test_recovery_requires_terminal_exact_target_and_clears_view_before_stage(self):
        patches = self._journal_mocks(stage=self.stage)
        stage_instance, _source_instance = patches[3], patches[4]
        events = []
        with patch("pwd.getpwnam", return_value=SimpleNamespace(pw_uid=1002)), patches[0], patches[1], patches[2], \
                patch.object(recovery, "release_lock", return_value=nullcontext()), \
                patch.object(recovery, "_prove_extractor_collected",
                             side_effect=lambda *_args: events.append("extractor-drained")), \
                patch.object(view_journal, "list_all_runtime_view_records",
                             side_effect=lambda _root: tuple() if "view-recovered" in events else (self.view,)), \
                patch.object(view_journal, "list_runtime_view_records_for_candidate",
                             side_effect=lambda *_args, **_kwargs: tuple() if "view-recovered" in events else (self.view,)), \
                patch.object(view_recovery, "recover_runtime_view",
                             side_effect=lambda *_args, **_kwargs: events.append("view-recovered")):
            result = recovery.recover_interrupted_stage(
                self.root, Path("/srv/baci-workers/release.lock"), self.result_root,
                worker_gid=81, terminal_attempt_proven=lambda _fence: True,
                expected_target=self.target,
                view_root=self.view_root,
            )
        self.assertEqual(result, "recovered")
        self.assertEqual(events, ["extractor-drained", "view-recovered"])
        stage_instance.recover.assert_called_once()

    def test_recovery_mismatch_preserves_stage_and_runtime_view(self):
        patches = self._journal_mocks(stage=self.stage)
        with patch("pwd.getpwnam", return_value=SimpleNamespace(pw_uid=1002)), patches[0], patches[1], patches[2], \
                patch.object(recovery, "release_lock", return_value=nullcontext()), \
                patch.object(recovery, "_prove_extractor_collected") as drain, \
                patch.object(view_recovery, "recover_runtime_view") as recover_view:
            with self.assertRaises(recovery.SourceViewRejected):
                recovery.recover_interrupted_stage(
                    self.root, Path("/srv/baci-workers/release.lock"), self.result_root,
                    worker_gid=81, terminal_attempt_proven=lambda _fence: True,
                    expected_target={**self.target, "sha": "c" * 40}, view_root=self.view_root,
                )
        drain.assert_not_called()
        recover_view.assert_not_called()

    def test_extractor_quiescence_uses_only_journal_derived_exact_unit_and_cgroup(self):
        unit = "baci-worker-source-extract@" + "e" * 32 + ".service"
        completed = [SimpleNamespace(stdout="not-found\n"),
                     SimpleNamespace(stdout="inactive\n")]
        with (patch.object(cgroup, "preflight_cgroup_root", return_value=(1, 2, 3, 4)),
              patch.object(cgroup, "stop_unit") as stop,
              patch.object(cgroup, "require_exact_unit_cgroup_absent") as absent,
              patch.object(cgroup, "prove_collected_unit") as prove,
              patch.object(subprocess, "run", side_effect=completed) as command):
            recovery._prove_extractor_collected("e" * 32, 1002)
        stop.assert_called_once_with("/usr/bin/systemctl", unit)
        self.assertEqual(command.call_count, 2)
        absent.assert_called_once_with(Path("/sys/fs/cgroup"), unit,
                                       trusted_root=(1, 2, 3, 4))
        self.assertEqual(prove.call_args.args[:2], (unit, None))
        self.assertEqual(prove.call_args.kwargs["uid"], 1002)
        self.assertEqual(prove.call_args.kwargs["trusted_root"], (1, 2, 3, 4))

    def test_extractor_recovery_rejects_non_journal_unit_identity(self):
        with patch.object(cgroup, "preflight_cgroup_root") as preflight:
            with self.assertRaises(recovery.SourceViewRejected):
                recovery._prove_extractor_collected("../unexpected", 1002)
        preflight.assert_not_called()

    def test_already_clean_recovery_is_idempotent_only_after_terminal_proof(self):
        patches = self._journal_mocks()
        with patch("pwd.getpwnam", return_value=SimpleNamespace(pw_uid=1002)), \
                patches[0], patches[1], patches[2], \
                patch.object(recovery, "release_lock", return_value=nullcontext()), \
                patch.object(view_journal, "list_all_runtime_view_records", return_value=()):
            result = recovery.recover_interrupted_stage(
                self.root, Path("/srv/baci-workers/release.lock"), self.result_root,
                worker_gid=81, terminal_attempt_proven=lambda target: target == self.target,
                expected_target=self.target, view_root=self.view_root,
            )
        self.assertEqual(result, "clean")


if __name__ == "__main__":
    unittest.main()
