"""Root-only regression tests for stage-owned builder journal cleanup."""
from __future__ import annotations

import os
import pwd
import shutil
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from worker_release_dependency_supervisor_journal import BuilderUnitJournal
from worker_release_dependency_supervisor_lifecycle import (
    BuilderLifecycleRejected, clear_completed_builder, recover_and_clear_builder,
    invoke_builder_runner,
)
import worker_release_dependency_supervisor_journal as journal_module
from worker_release_dependency_supervisor_cgroup import UnitCgroupAbsent


SHA = "a" * 40
FENCE = {"repository": "org/repo", "workflow": "release.yml", "ref": "refs/heads/main",
         "sha": SHA, "run_id": "11", "run_attempt": 1, "job_id": "12"}
UNIT = f"baci-worker-deps-{SHA[:12]}-{'b' * 32}.service"
COLLECTED_UNIT = {"LoadState": "not-found", "ActiveState": "inactive",
                  "SubState": "dead", "MainPID": "0", "ControlGroup": ""}


def collected_systemctl(*args, **_kwargs):
    """Model systemd's complete properties after collecting the exact unit."""
    prop = args[1].removeprefix("--property=")
    return COLLECTED_UNIT.get(prop, "")


class BuilderRunnerAdapterTests(unittest.TestCase):
    def test_resource_fields_are_passed_only_to_explicit_supervised_adapter(self):
        calls = []

        def supervised(*args, **kwargs):
            calls.append((args, kwargs))

        supervised.accepts_build_resources = True
        invoke_builder_runner(supervised, ("cmd",), Path("/scratch"), "unit",
                              input_root=Path("/input"), result_dir=Path("/result"))
        self.assertEqual(calls[0][1], {
            "input_root": Path("/input"), "result_dir": Path("/result"),
        })
        legacy = lambda *args, **kwargs: calls.append((args, kwargs))
        invoke_builder_runner(legacy, ("cmd",), Path("/scratch"), "unit",
                              input_root=Path("/input"), result_dir=Path("/result"))
        self.assertEqual(calls[1][1], {})


@unittest.skipUnless(os.geteuid() == 0, "requires root-owned private builder resources")
class BuilderJournalStageLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.worker = self.root / "worker"
        self.worker.mkdir(mode=0o700)
        self.build = self.root / "build"
        self.build.mkdir(mode=0o710)
        self.results = self.build / "results"
        self.results.mkdir(mode=0o700)
        self.account = pwd.getpwnam("nobody")
        self.input = self.build / f"{SHA}.input.123"
        self.input.mkdir(mode=0o700)
        self.source = self.input / "source"
        self.source.mkdir(mode=0o700)
        self.source.chmod(0o550)
        self.input.chmod(0o555)
        self.scratch = self.build / f"{SHA}.scratch"
        self.scratch.mkdir(mode=0o700)
        os.chown(self.scratch, self.account.pw_uid, self.account.pw_gid)
        self.result = self.results / f"{SHA}.candidate"
        self.result.mkdir(mode=0o700)
        self.journal = BuilderUnitJournal(self.worker, owner_uid=0)
        self.journal.begin(
            FENCE, UNIT, self.source, self.scratch, self.account.pw_uid,
            self.account.pw_gid, input_root=self.input, result_dir=self.result,
        )

    def tearDown(self):
        self.journal.close()
        self.temp.cleanup()

    def test_successful_stage_clears_only_after_all_builder_resources_are_absent(self):
        self.journal.mark_running(SimpleNamespace(st_dev=5, st_ino=6))
        self.journal.mark_drained(SimpleNamespace(st_dev=5, st_ino=6))
        with self.assertRaisesRegex(BuilderLifecycleRejected, "cleanup is not proven"):
            clear_completed_builder(self.journal, FENCE, build_root=self.build,
                                    result_root=self.results)
        shutil.rmtree(self.scratch)
        shutil.rmtree(self.input)
        shutil.rmtree(self.result)
        clear_completed_builder(self.journal, FENCE, build_root=self.build,
                                result_root=self.results)
        self.assertIsNone(self.journal.read())

    def test_terminal_recovery_drains_then_removes_exact_recorded_resources(self):
        with patch.object(journal_module, "_systemctl", side_effect=collected_systemctl), patch.object(
            journal_module, "_open_cgroup", side_effect=UnitCgroupAbsent
        ):
            with self.assertRaisesRegex(BuilderLifecycleRejected, "terminal attempt"):
                recover_and_clear_builder(
                    self.journal, FENCE,
                    terminal_attempt_proven=lambda _fence: False,
                    other_resources_quiesced=lambda _fence: True,
                    build_root=self.build, result_root=self.results,
                )
            self.assertTrue(self.scratch.exists())
            result = recover_and_clear_builder(
                self.journal, FENCE,
                terminal_attempt_proven=lambda _fence: True,
                other_resources_quiesced=lambda _fence: True,
                build_root=self.build, result_root=self.results,
            )
        self.assertEqual(result, "recovered")
        self.assertTrue(all(not path.exists() for path in (
            self.scratch, self.input, self.result,
        )))
        self.assertIsNone(self.journal.read())

    def test_resource_inode_replacement_blocks_recovery_and_preserves_journal(self):
        original = self.scratch
        held = self.build / f"{SHA}.held"
        original.rename(held)
        original.mkdir(mode=0o700)
        os.chown(original, self.account.pw_uid, self.account.pw_gid)
        with patch.object(journal_module, "_systemctl", side_effect=collected_systemctl), patch.object(
            journal_module, "_open_cgroup", side_effect=UnitCgroupAbsent
        ):
            with self.assertRaisesRegex(BuilderLifecycleRejected, "inode changed"):
                recover_and_clear_builder(
                    self.journal, FENCE,
                    terminal_attempt_proven=lambda _fence: True,
                    other_resources_quiesced=lambda _fence: True,
                    build_root=self.build, result_root=self.results,
                )
        self.assertIsNotNone(self.journal.read())
        shutil.rmtree(held)


if __name__ == "__main__":
    unittest.main()
