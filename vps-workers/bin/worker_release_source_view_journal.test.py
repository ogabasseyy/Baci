"""Crash and proof-boundary tests for consumer source-view cleanup."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from worker_release_source_view_journal import SourceViewJournal, SourceViewRejected

FENCE = {"repository": "ogabasseyy/Baci", "workflow": "release.yml", "ref": "refs/heads/main",
         "sha": "a" * 40, "run_id": "12", "run_attempt": 1, "job_id": "34"}


class SourceViewJournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path.home())
        self.base = Path(self.temp.name)
        self.worker_root = self.base / "worker"
        self.worker_root.mkdir(mode=0o700)
        self.result_root = self.base / "results"
        self.result_root.mkdir(mode=0o700)

    def tearDown(self):
        self.temp.cleanup()

    def journal(self):
        return SourceViewJournal(self.worker_root, self.result_root, owner_uid=os.getuid())

    def begin(self):
        with self.journal() as journal:
            return journal.begin("b" * 32, FENCE, FENCE["sha"], "c" * 64)

    def test_cleanup_requires_matching_owner_and_process_quiescence(self):
        view = self.begin()
        (view / "source").write_text("test")
        with self.journal() as journal:
            with self.assertRaisesRegex(SourceViewRejected, "owner and quiescence"):
                journal.cleanup(fence=FENCE, current_owner_proven=True,
                                processes_quiesced=False)
        self.assertTrue((view / "source").exists())
        self.assertTrue((self.worker_root / "release-source-view-journal.json").exists())
        with self.journal() as journal:
            journal.cleanup(fence=FENCE, terminal_proven=True, processes_quiesced=True)
        self.assertEqual(list(self.result_root.iterdir()), [])
        self.assertFalse((self.worker_root / "release-source-view-journal.json").exists())

    def test_replaced_view_inode_is_never_removed(self):
        view = self.begin()
        original = view.stat()
        view.rmdir()
        view.mkdir(mode=0o700)
        sentinel = view / "keep"
        sentinel.write_text("replacement")
        with self.journal() as journal:
            with self.assertRaisesRegex(SourceViewRejected, "inode changed"):
                journal.cleanup(fence=FENCE, terminal_proven=True, processes_quiesced=True)
        self.assertTrue(sentinel.exists())
        self.assertTrue((self.worker_root / "release-source-view-journal.json").exists())
        self.assertNotEqual((view.stat().st_dev, view.stat().st_ino),
                            (original.st_dev, original.st_ino))

    def test_cleanup_resumes_after_recorded_view_was_removed_before_journal_unlink(self):
        view = self.begin()
        (view / "source").write_text("already removed in prior cleanup attempt")
        (view / "source").unlink()
        candidate = self.result_root / "candidate"
        candidate.mkdir(mode=0o700)
        (candidate / "partial").write_text("builder output")
        view.rmdir()

        with self.journal() as journal:
            journal.cleanup(fence=FENCE, terminal_proven=True, processes_quiesced=True)

        self.assertEqual(list(self.result_root.iterdir()), [])
        self.assertFalse((self.worker_root / "release-source-view-journal.json").exists())

    def test_stale_record_temp_is_removed_only_when_private_regular_file(self):
        self.begin()
        temp = self.worker_root / f".release-source-view-journal.json.{'b' * 32}.tmp"
        temp.write_text("partial")
        temp.chmod(0o600)
        with self.journal() as journal:
            journal.cleanup(fence=FENCE, terminal_proven=True, processes_quiesced=True)
        self.assertFalse(temp.exists())

        self.begin()
        temp.symlink_to(self.result_root)
        with self.journal() as journal:
            with self.assertRaisesRegex(SourceViewRejected, "temporary journal identity"):
                journal.cleanup(fence=FENCE, terminal_proven=True, processes_quiesced=True)
        self.assertTrue((self.worker_root / "release-source-view-journal.json").exists())


if __name__ == "__main__":
    unittest.main()
