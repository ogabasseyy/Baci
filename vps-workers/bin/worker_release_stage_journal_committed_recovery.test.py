"""Committed journal recovery retains exact proof and active-pointer checks."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from worker_release_stage_journal import StageJournal, StageJournalError

SHA = "a" * 40
FENCE = {"repository": "ogabasseyy/Baci", "workflow": ".github/workflows/production-release.yml",
         "ref": "refs/heads/main", "sha": SHA, "run_id": "123", "run_attempt": 2,
         "job_id": "456"}


class CommittedRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path.home())
        self.root = Path(self.temp.name)
        (self.root / "releases").mkdir(mode=0o700)
        self.resource_root = self.root / "stage-resources"
        self.resource_root.mkdir(mode=0o700)

    def tearDown(self):
        self.temp.cleanup()

    def journal(self):
        return StageJournal(self.root, owner_uid=os.getuid(), resource_root=self.resource_root)

    def leave_committed_journal(self):
        with self.journal() as journal:
            journal.begin(FENCE, "b" * 64)
            for create, remove in ((journal.create_source_snapshot, journal.remove_source_snapshot),
                                   (journal.create_builder_result, journal.remove_builder_result)):
                path = create()
                (path / "temporary").write_text("safe to remove")
                remove()
            incoming = journal.create_incoming()
            (incoming / "release-file").write_text("verified")
            journal.begin_ownership_transfer()
            final = journal.publish()
            (final / "release-file").chmod(0o440)
            final.chmod(0o550)
            journal.commit()
        return final

    def test_committed_recovery_requires_terminal_and_quiescence_proofs(self):
        final = self.leave_committed_journal()
        with self.journal() as journal:
            with self.assertRaisesRegex(StageJournalError, "terminal"):
                journal.recover(terminal_attempt_proven=lambda _fence: False,
                                resources_quiesced=lambda _fence: True)
        self.assertTrue((self.root / "release-stage-journal.json").exists())
        with self.journal() as journal:
            with self.assertRaisesRegex(StageJournalError, "quiescence proof"):
                journal.recover(terminal_attempt_proven=lambda _fence: True)
        self.assertTrue((self.root / "release-stage-journal.json").exists())
        self.assertEqual({path.name for path in self.resource_root.iterdir()}, set())
        self.assertTrue((final / "release-file").exists())

    def test_committed_active_release_keeps_journal_for_owner(self):
        final = self.leave_committed_journal()
        os.symlink(f"releases/{SHA}", self.root / "current")
        with self.journal() as journal:
            with self.assertRaisesRegex(StageJournalError, "active release"):
                journal.recover(terminal_attempt_proven=lambda _fence: True,
                                resources_quiesced=lambda _fence: True)
        self.assertTrue((self.root / "release-stage-journal.json").exists())
        self.assertTrue((final / "release-file").exists())

    def test_committed_journal_with_unremoved_resource_is_rejected(self):
        final = self.leave_committed_journal()
        with self.journal() as journal:
            value = journal._require_journal()
            resource = self.resource_root / value["result_name"]
            resource.mkdir(mode=0o700)
            (resource / "unexpected").write_text("preserve")
            with self.assertRaisesRegex(StageJournalError, "must be removed"):
                journal.recover(terminal_attempt_proven=lambda _fence: True,
                                resources_quiesced=lambda _fence: True)
        self.assertTrue((self.root / "release-stage-journal.json").exists())
        self.assertTrue((final / "release-file").exists())
        self.assertTrue((resource / "unexpected").exists())


if __name__ == "__main__":
    unittest.main()
