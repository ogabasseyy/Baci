"""Journal ownership and fence regressions for the builder systemd supervisor."""
from __future__ import annotations

import os
import pwd
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from worker_release_dependency_supervisor_journal import BuilderJournalRejected, BuilderUnitJournal

SHA = "a" * 40
FENCE = {"repository": "org/repo", "workflow": "release.yml", "ref": "refs/heads/main",
         "sha": SHA, "run_id": "123", "run_attempt": 1, "job_id": "456"}
UNIT = f"baci-worker-deps-{SHA[:12]}-{'b' * 32}.service"


class BuilderUnitJournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path.home())
        self.root = Path(self.temp.name)
        self.worker_root = self.root / "worker"
        self.worker_root.mkdir(mode=0o700)
        self.source = self.root / "input" / "source"
        self.source.mkdir(parents=True, mode=0o700)
        self.source.chmod(0o550)
        self.scratch = self.root / f"{SHA}.scratch"
        self.scratch.mkdir(mode=0o700)
        if os.geteuid() == 0:
            account = pwd.getpwnam("nobody")
            self.uid, self.gid = account.pw_uid, account.pw_gid
            os.chown(self.scratch, self.uid, self.gid)
        else:
            self.uid, self.gid = os.getuid(), os.getgid()

    def tearDown(self):
        self.temp.cleanup()

    def test_fence_unit_and_inode_are_durable_until_cleanup_proof(self):
        with BuilderUnitJournal(self.worker_root, owner_uid=os.getuid()) as journal:
            record = journal.begin(FENCE, UNIT, self.source, self.scratch, self.uid, self.gid)
            self.assertEqual(record["phase"], "prepared")
            cgroup = SimpleNamespace(st_dev=7, st_ino=8)
            journal.mark_running(cgroup)
            stale_temp = self.worker_root / f".dependency-builder-unit.json.{'b' * 32}.tmp"
            stale_temp.write_text("interrupted update")
            stale_temp.chmod(0o600)
            journal.mark_drained(cgroup)
            journal.mark_drained(cgroup)  # recovery may replay after an interrupted response
            with self.assertRaisesRegex(BuilderJournalRejected, "identity changed"):
                journal.mark_drained(SimpleNamespace(st_dev=8, st_ino=9))
            self.assertFalse(stale_temp.exists())
            with self.assertRaisesRegex(BuilderJournalRejected, "exact resource cleanup proof"):
                journal.clear({**FENCE, "job_id": "wrong"}, resources_removed=lambda _item: True)
            with self.assertRaisesRegex(BuilderJournalRejected, "exact resource cleanup proof"):
                journal.clear(FENCE, resources_removed=lambda _item: False)
            self.assertEqual(journal.read()["fence"], FENCE)
            journal.clear(FENCE, resources_removed=lambda item: item["scratch_ino"] == self.scratch.stat().st_ino)
            self.assertIsNone(journal.read())

    def test_unresolved_journal_prevents_a_second_builder_unit(self):
        with BuilderUnitJournal(self.worker_root, owner_uid=os.getuid()) as journal:
            journal.begin(FENCE, UNIT, self.source, self.scratch, self.uid, self.gid)
            with self.assertRaisesRegex(BuilderJournalRejected, "unresolved prior run"):
                journal.begin(FENCE, UNIT, self.source, self.scratch, self.uid, self.gid)

    def test_temporary_record_symlink_cannot_be_used_for_recovery(self):
        with BuilderUnitJournal(self.worker_root, owner_uid=os.getuid()) as journal:
            journal.begin(FENCE, UNIT, self.source, self.scratch, self.uid, self.gid)
            temp = self.worker_root / f".dependency-builder-unit.json.{'b' * 32}.tmp"
            temp.symlink_to(self.source)
            with self.assertRaisesRegex(BuilderJournalRejected, "temporary state"):
                journal.mark_drained(None)
            self.assertEqual(journal.read()["phase"], "prepared")


if __name__ == "__main__":
    unittest.main()
