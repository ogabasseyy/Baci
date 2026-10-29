import os
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from worker_release_stage_journal import StageJournal, StageJournalError


SHA = "a" * 40
DIGEST = "b" * 64
FENCE = {
    "repository": "ogabasseyy/Baci",
    "workflow": ".github/workflows/production-release.yml",
    "ref": "refs/heads/main",
    "sha": SHA,
    "run_id": "123",
    "run_attempt": 2,
    "job_id": "456",
}


class StageJournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path.home())
        self.root = Path(self.temp.name)
        (self.root / "releases").mkdir(mode=0o700)
        self.resource_root = self.root / "stage-resources"
        self.resource_root.mkdir(mode=0o700)
        self.owner = os.getuid()

    def tearDown(self):
        self.temp.cleanup()

    def journal(self, stage_uid=None, *, resources=False):
        return StageJournal(self.root, owner_uid=self.owner, stage_uid=stage_uid,
                            resource_root=self.resource_root if resources else None)

    def begin(self, journal):
        return journal.begin(FENCE, DIGEST)

    def recover_owned(self, journal):
        return journal.recover(terminal_attempt_proven=lambda _fence: True,
                               resources_quiesced=lambda _fence: True)

    def test_interruption_after_durable_intent_recovers_without_touching_unknown_paths(self):
        with self.journal() as journal:
            record = self.begin(journal)
        unknown = self.root / "releases" / f".{SHA}.incoming.unknown"
        unknown.mkdir()

        with self.journal() as journal:
            with self.assertRaisesRegex(StageJournalError, "process-quiescence proof"):
                journal.recover(terminal_attempt_proven=lambda fence: fence == FENCE)
            self.assertTrue((self.root / "release-stage-journal.json").exists())
            result = journal.recover(terminal_attempt_proven=lambda fence: fence == FENCE,
                                     resources_quiesced=lambda fence: fence == FENCE)

        self.assertEqual(result, "discarded")
        self.assertFalse((self.root / "release-stage-journal.json").exists())
        self.assertFalse((self.root / "releases" / record["incoming_name"]).exists())
        self.assertTrue(unknown.is_dir())

    def test_intent_phase_never_authorizes_deleting_an_unrecorded_path(self):
        with self.journal() as journal:
            record = self.begin(journal)
        unrecorded = self.root / "releases" / record["incoming_name"]
        unrecorded.mkdir(mode=0o700)
        sentinel = unrecorded / "keep"
        sentinel.write_text("preserve")

        with self.journal() as journal:
            with self.assertRaisesRegex(StageJournalError, "without its recorded inode"):
                self.recover_owned(journal)

        self.assertTrue(sentinel.exists())
        self.assertTrue((self.root / "release-stage-journal.json").exists())

    def test_interrupted_journal_link_publication_removes_only_its_stale_temp_link(self):
        with self.journal() as journal:
            self.begin(journal)
        journal_path = self.root / "release-stage-journal.json"
        temp_link = self.root / (".stage-journal." + "c" * 32 + ".tmp")
        os.link(journal_path, temp_link)

        with self.journal() as journal:
            result = self.recover_owned(journal)

        self.assertEqual(result, "discarded")
        self.assertFalse(temp_link.exists())
        self.assertFalse(journal_path.exists())

    def test_interruption_after_incoming_creation_discards_only_journal_owned_inode(self):
        with self.journal() as journal:
            record = self.begin(journal)
            incoming = journal.create_incoming()
            (incoming / "partial-file").write_text("partial")
            expected = os.stat(incoming, follow_symlinks=False)

        with self.journal() as journal:
            result = self.recover_owned(journal)

        self.assertEqual(result, "discarded")
        self.assertFalse(incoming.exists())
        self.assertEqual(record["incoming_name"], incoming.name)

    def test_terminal_proof_failure_keeps_journal_and_incoming_tree(self):
        with self.journal() as journal:
            self.begin(journal)
            incoming = journal.create_incoming()
            (incoming / "partial-file").write_text("partial")

        with self.journal() as journal:
            with self.assertRaisesRegex(StageJournalError, "terminal"):
                journal.recover(terminal_attempt_proven=lambda _fence: False)

        self.assertTrue(incoming.is_dir())
        self.assertTrue((self.root / "release-stage-journal.json").exists())

    def test_incoming_inode_replacement_fails_closed_and_preserves_replacement(self):
        with self.journal() as journal:
            record = self.begin(journal)
            incoming = journal.create_incoming()
        incoming.rmdir()
        incoming.mkdir(mode=0o700)
        sentinel = incoming / "keep"
        sentinel.write_text("unowned replacement")

        with self.journal() as journal:
            with self.assertRaisesRegex(StageJournalError, "inode changed"):
                self.recover_owned(journal)

        self.assertTrue(sentinel.exists())
        self.assertTrue((self.root / "release-stage-journal.json").exists())
        self.assertEqual(record["incoming_name"], incoming.name)

    def test_stage_owner_mismatch_fails_closed(self):
        with self.journal() as journal:
            self.begin(journal)
            incoming = journal.create_incoming()
            (incoming / "keep").write_text("preserve")

        with self.journal(stage_uid=self.owner + 1) as journal:
            with self.assertRaisesRegex(StageJournalError, "path or archive identity"):
                journal.recover(terminal_attempt_proven=lambda _fence: True)

        self.assertTrue((incoming / "keep").exists())
        self.assertTrue((self.root / "release-stage-journal.json").exists())

    @unittest.skipUnless(os.geteuid() == 0, "cross-UID ownership requires root")
    def test_incoming_directory_is_transferred_to_configured_stage_identity(self):
        stage_uid = self.owner + 1234
        stage_gid = os.getgid()
        with StageJournal(self.root, owner_uid=self.owner, stage_uid=stage_uid,
                          stage_gid=stage_gid) as journal:
            self.begin(journal)
            incoming = journal.create_incoming()
            metadata = incoming.lstat()
            self.assertEqual(metadata.st_uid, stage_uid)
            self.assertEqual(metadata.st_gid, stage_gid)

        with StageJournal(self.root, owner_uid=self.owner, stage_uid=stage_uid,
                          stage_gid=stage_gid) as journal:
            self.assertEqual(self.recover_owned(journal), "discarded")

    @unittest.skipUnless(os.geteuid() == 0, "cross-UID ownership requires root")
    def test_rename_before_external_chown_is_recoverable_with_exact_inode(self):
        stage_uid = self.owner + 1234
        stage_gid = os.getgid()
        with StageJournal(self.root, owner_uid=self.owner, stage_uid=stage_uid,
                          stage_gid=stage_gid) as journal:
            journal.begin(FENCE, DIGEST)
            incoming = journal.create_incoming()
            journal.begin_ownership_transfer()
            final = self.root / "releases" / SHA
            os.rename(incoming, final)
            self.assertEqual(final.lstat().st_uid, stage_uid)

        with StageJournal(self.root, owner_uid=self.owner, stage_uid=stage_uid,
                          stage_gid=stage_gid) as journal:
            self.assertEqual(self.recover_owned(journal), "discarded")

        self.assertFalse(final.exists())

    def test_crash_after_rename_before_phase_update_discards_matching_final_inode(self):
        with self.journal() as journal:
            record = self.begin(journal)
            incoming = journal.create_incoming()
            (incoming / "partial-file").write_text("partial")
            journal.begin_ownership_transfer()
            os.rename(incoming, self.root / "releases" / SHA)

        with self.journal() as journal:
            result = self.recover_owned(journal)

        self.assertEqual(result, "discarded")
        self.assertFalse((self.root / "releases" / SHA).exists())
        self.assertFalse((self.root / "release-stage-journal.json").exists())
        self.assertEqual(record["phase"], "intent")

    def test_active_pointer_is_never_discarded(self):
        with self.journal() as journal:
            self.begin(journal)
            incoming = journal.create_incoming()
            (incoming / "partial-file").write_text("partial")
        os.symlink(f"releases/{SHA}", self.root / "current")

        with self.journal() as journal:
            with self.assertRaisesRegex(StageJournalError, "active release"):
                self.recover_owned(journal)

        self.assertTrue(incoming.exists())

    def test_committed_release_is_preserved_and_stale_journal_is_clearable(self):
        with self.journal() as journal:
            self.begin(journal)
            incoming = journal.create_incoming()
            (incoming / "release-file").write_text("verified")
            journal.begin_ownership_transfer()
            final = journal.publish()
            (final / "release-file").chmod(0o440)
            final.chmod(0o550)
            journal.commit()

        with self.journal() as journal:
            result = journal.recover(terminal_attempt_proven=lambda _fence: True,
                                     resources_quiesced=lambda _fence: True)

        self.assertEqual(result, "committed")
        self.assertEqual((final / "release-file").read_text(), "verified")
        self.assertFalse((self.root / "release-stage-journal.json").exists())

    def test_commit_refuses_partial_recursive_ownership_transfer(self):
        with self.journal() as journal:
            journal.begin(FENCE, DIGEST)
            incoming = journal.create_incoming()
            (incoming / "not-frozen").write_text("partial")
            journal.begin_ownership_transfer()
            final = journal.publish()
            final.chmod(0o550)
            with self.assertRaisesRegex(StageJournalError, "not fully frozen"):
                journal.commit()

        self.assertTrue((self.root / "release-stage-journal.json").exists())
        self.assertTrue((final / "not-frozen").exists())

    def test_commit_fsyncs_files_then_nested_directories_bottom_up(self):
        with self.journal() as journal:
            journal.begin(FENCE, DIGEST)
            incoming = journal.create_incoming()
            nested = incoming / "nested"
            nested.mkdir()
            leaf = nested / "leaf"
            leaf.write_text("verified")
            journal.begin_ownership_transfer()
            final = journal.publish()
            final_leaf = final / "nested" / "leaf"
            final_leaf.chmod(0o440)
            (final / "nested").chmod(0o550)
            final.chmod(0o550)
            leaf_info = final_leaf.stat()
            nested_info = (final / "nested").stat()
            root_info = final.stat()
            synced_inodes = []
            real_fsync = os.fsync

            def record_fsync(fd):
                info = os.fstat(fd)
                synced_inodes.append((info.st_dev, info.st_ino))
                return real_fsync(fd)

            with patch.object(os, "fsync", side_effect=record_fsync):
                journal.commit()

        self.assertEqual(synced_inodes[:3], [
            (leaf_info.st_dev, leaf_info.st_ino),
            (nested_info.st_dev, nested_info.st_ino),
            (root_info.st_dev, root_info.st_ino),
        ])

if __name__ == "__main__":
    unittest.main()
