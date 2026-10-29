"""Crash and replacement tests for journal-owned staging auxiliaries."""
from __future__ import annotations

import importlib.util
import os
import stat
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
_path = Path(__file__).with_name("worker_release_stage_journal.test.py")
_spec = importlib.util.spec_from_file_location("stage_journal_fixtures", _path)
_fixtures = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _fixtures
_spec.loader.exec_module(_fixtures)


class StageResourceJournalTests(unittest.TestCase):
    setUp = _fixtures.StageJournalTests.setUp
    tearDown = _fixtures.StageJournalTests.tearDown
    journal = _fixtures.StageJournalTests.journal
    begin = _fixtures.StageJournalTests.begin
    recover_owned = _fixtures.StageJournalTests.recover_owned

    def test_transfer_preflight_uses_resource_root_group_before_stage_group_chown(self):
        resource_gid = self.resource_root.stat().st_gid
        stage_gid = resource_gid + 12345
        with _fixtures.StageJournal(self.root, owner_uid=self.owner, stage_gid=stage_gid,
                                    resource_root=self.resource_root) as journal:
            journal.begin(_fixtures.FENCE, _fixtures.DIGEST)
            source = journal.create_source_snapshot()
            self.assertEqual(source.stat().st_gid, resource_gid)
            journal.begin_source_transfer()
            self.assertEqual(journal._require_journal()["source_state"], "transfer")
            journal.recover(terminal_attempt_proven=lambda fence: fence == _fixtures.FENCE,
                            resources_quiesced=lambda fence: fence == _fixtures.FENCE)
        self.assertFalse(source.exists())

    def test_incoming_identity_and_mode_are_fsynced_before_journal_phase_advance(self):
        synced_directories = set()
        real_fsync, original_write = os.fsync, _fixtures.StageJournal._write

        def record_fsync(fd):
            info = os.fstat(fd)
            if stat.S_ISDIR(info.st_mode):
                synced_directories.add((info.st_dev, info.st_ino))
            return real_fsync(fd)

        def check_before_phase_write(journal, value, *, create=False):
            if value.get("phase") == "incoming":
                info = (self.root / "releases" / value["incoming_name"]).lstat()
                self.assertIn((info.st_dev, info.st_ino), synced_directories)
            return original_write(journal, value, create=create)

        with patch.object(os, "fsync", side_effect=record_fsync), \
             patch.object(_fixtures.StageJournal, "_write", new=check_before_phase_write):
            with self.journal() as journal:
                self.begin(journal)
                journal.create_incoming()

    def test_source_and_result_resources_require_exact_terminal_and_quiescence_proofs(self):
        with self.journal(resources=True) as journal:
            journal.begin(_fixtures.FENCE, _fixtures.DIGEST)
            source = journal.create_source_snapshot()
            result = journal.create_builder_result()
            (source / "partial-source").write_text("source")
            (result / "payload").mkdir()
            (result / "payload" / "partial").write_text("result")
            record = journal._require_journal()
            source_inode, result_inode = source.stat(), result.stat()

        with self.journal(resources=True) as journal:
            with self.assertRaisesRegex(_fixtures.StageJournalError, "terminal"):
                journal.recover(terminal_attempt_proven=lambda _fence: False,
                                resources_quiesced=lambda _fence: True)
            with self.assertRaisesRegex(_fixtures.StageJournalError, "quiescence proof"):
                journal.recover(terminal_attempt_proven=lambda fence: fence == _fixtures.FENCE)

        calls = []
        with self.journal(resources=True) as journal:
            result_state = journal.recover(
                terminal_attempt_proven=lambda fence: fence == _fixtures.FENCE,
                resources_quiesced=lambda fence: calls.append(fence) or fence == _fixtures.FENCE,
            )
        self.assertEqual(result_state, "discarded")
        self.assertEqual(calls, [_fixtures.FENCE])
        self.assertFalse(source.exists())
        self.assertFalse(result.exists())
        self.assertEqual((source_inode.st_dev, source_inode.st_ino),
                         (record["source_dev"], record["source_ino"]))
        self.assertEqual((result_inode.st_dev, result_inode.st_ino),
                         (record["result_dev"], record["result_ino"]))
        self.assertEqual(record["source_state"], "created")

    def test_reserved_empty_resource_crash_window_uses_rmdir_and_preserves_siblings(self):
        with self.journal(resources=True) as journal:
            record = journal.begin(_fixtures.FENCE, _fixtures.DIGEST)
        source = self.resource_root / record["source_name"]
        source.mkdir(mode=0o700)
        unknown = self.resource_root / "unrelated-resource"
        unknown.mkdir(mode=0o700)

        with self.journal(resources=True) as journal:
            journal.recover(terminal_attempt_proven=lambda fence: fence == _fixtures.FENCE,
                            resources_quiesced=lambda fence: fence == _fixtures.FENCE)

        self.assertFalse(source.exists())
        self.assertTrue(unknown.is_dir())

    @_fixtures.unittest.skipUnless(os.geteuid() == 0, "group ownership transfer requires root")
    def test_reserved_empty_resource_after_fchown_before_journal_record_is_recoverable(self):
        stage_gid = os.getgid() + 12345
        with _fixtures.StageJournal(self.root, owner_uid=self.owner, stage_gid=stage_gid,
                                    resource_root=self.resource_root) as journal:
            record = journal.begin(_fixtures.FENCE, _fixtures.DIGEST)
        source = self.resource_root / record["source_name"]
        source.mkdir(mode=0o700)
        os.chown(source, self.owner, stage_gid)

        with _fixtures.StageJournal(self.root, owner_uid=self.owner, stage_gid=stage_gid,
                                    resource_root=self.resource_root) as journal:
            journal.recover(terminal_attempt_proven=lambda fence: fence == _fixtures.FENCE,
                            resources_quiesced=lambda fence: fence == _fixtures.FENCE)

        self.assertFalse(source.exists())

    @_fixtures.unittest.skipUnless(os.geteuid() == 0, "cross-identity ownership requires root")
    def test_extractor_owned_resource_transfer_crash_is_cleanable_after_quiescence(self):
        import pwd

        extractor = pwd.getpwnam("nobody")
        worker_gid = os.getgid() + 12345
        os.chown(self.resource_root, extractor.pw_uid, extractor.pw_gid)
        self.resource_root.chmod(0o700)
        kwargs = dict(owner_uid=0, stage_uid=extractor.pw_uid, stage_gid=worker_gid,
                      resource_root=self.resource_root, resource_uid=extractor.pw_uid)
        with _fixtures.StageJournal(self.root, **kwargs) as journal:
            record = journal.begin(_fixtures.FENCE, _fixtures.DIGEST)
            source = journal.create_source_snapshot()
            file = source / "source"
            file.write_text("frozen source")
            file.chmod(0o440)
            os.chown(file, extractor.pw_uid, extractor.pw_gid)
            journal.begin_source_transfer()
            record = journal._require_journal()
            os.chown(source, extractor.pw_uid, worker_gid)
            source.chmod(0o550)
            inode = source.stat().st_ino

        with _fixtures.StageJournal(self.root, **kwargs) as journal:
            self.assertEqual(journal._require_journal()["source_state"], "transfer")
            journal.recover(terminal_attempt_proven=lambda fence: fence == _fixtures.FENCE,
                            resources_quiesced=lambda fence: fence == _fixtures.FENCE)
        self.assertFalse(source.exists())
        self.assertEqual(record["source_ino"], inode)

    @_fixtures.unittest.skipUnless(os.geteuid() == 0, "cross-identity ownership requires root")
    def test_frozen_resource_state_survives_restart_and_removes_exact_inode(self):
        import pwd

        extractor = pwd.getpwnam("nobody")
        worker_gid = os.getgid() + 23456
        os.chown(self.resource_root, extractor.pw_uid, extractor.pw_gid)
        self.resource_root.chmod(0o700)
        kwargs = dict(owner_uid=0, stage_uid=extractor.pw_uid, stage_gid=worker_gid,
                      resource_root=self.resource_root, resource_uid=extractor.pw_uid)
        with _fixtures.StageJournal(self.root, **kwargs) as journal:
            journal.begin(_fixtures.FENCE, _fixtures.DIGEST)
            source = journal.create_source_snapshot()
            file = source / "source"
            file.write_text("frozen")
            file.chmod(0o440)
            os.chown(file, extractor.pw_uid, extractor.pw_gid)
            journal.begin_source_transfer()
            os.chown(file, extractor.pw_uid, worker_gid)
            os.chown(source, extractor.pw_uid, worker_gid)
            source.chmod(0o550)
            journal.mark_source_frozen()
            inode = source.stat().st_ino

        with _fixtures.StageJournal(self.root, **kwargs) as journal:
            self.assertEqual(journal._require_journal()["source_state"], "frozen")
            journal.recover(terminal_attempt_proven=lambda fence: fence == _fixtures.FENCE,
                            resources_quiesced=lambda fence: fence == _fixtures.FENCE)
        self.assertFalse(source.exists())
        self.assertGreater(inode, 0)

    def test_incoming_cleanup_requires_quiescence_even_without_resource_root(self):
        with self.journal() as journal:
            journal.begin(_fixtures.FENCE, _fixtures.DIGEST)
            incoming = journal.create_incoming()
            (incoming / "partial").write_text("must remain until proof")

        with self.journal() as journal:
            with self.assertRaisesRegex(_fixtures.StageJournalError, "process-quiescence proof"):
                journal.recover(terminal_attempt_proven=lambda fence: fence == _fixtures.FENCE)

        self.assertTrue(incoming.is_dir())
        self.assertTrue((incoming / "partial").exists())
        with self.journal() as journal:
            result = journal.recover(
                terminal_attempt_proven=lambda fence: fence == _fixtures.FENCE,
                resources_quiesced=lambda fence: fence == _fixtures.FENCE,
            )
        self.assertEqual(result, "discarded")
        self.assertFalse(incoming.exists())

    def test_reserved_nonempty_resource_is_preserved_without_recursive_delete(self):
        with self.journal(resources=True) as journal:
            record = journal.begin(_fixtures.FENCE, _fixtures.DIGEST)
        source = self.resource_root / record["source_name"]
        source.mkdir(mode=0o700)
        sentinel = source / "keep"
        sentinel.write_text("unknown contents")

        with self.journal(resources=True) as journal:
            with self.assertRaisesRegex(_fixtures.StageJournalError, "empty private directory"):
                journal.recover(terminal_attempt_proven=lambda fence: fence == _fixtures.FENCE,
                                resources_quiesced=lambda fence: fence == _fixtures.FENCE)

        self.assertTrue(sentinel.exists())
        self.assertTrue((self.root / "release-stage-journal.json").exists())

    def test_recorded_resource_inode_replacement_is_never_deleted(self):
        with self.journal(resources=True) as journal:
            journal.begin(_fixtures.FENCE, _fixtures.DIGEST)
            source = journal.create_source_snapshot()
        source.rmdir()
        source.mkdir(mode=0o700)
        sentinel = source / "preserve"
        sentinel.write_text("replacement")

        with self.journal(resources=True) as journal:
            with self.assertRaisesRegex(_fixtures.StageJournalError, "inode changed"):
                journal.recover(terminal_attempt_proven=lambda fence: fence == _fixtures.FENCE,
                                resources_quiesced=lambda fence: fence == _fixtures.FENCE)

        self.assertTrue(sentinel.exists())
        self.assertTrue((self.root / "release-stage-journal.json").exists())

    def test_resource_root_replacement_fails_closed_and_preserves_original_resource(self):
        with self.journal(resources=True) as journal:
            journal.begin(_fixtures.FENCE, _fixtures.DIGEST)
            source = journal.create_source_snapshot()
            (source / "keep").write_text("preserve")
        moved = self.resource_root.with_name("stage-resources-original")
        self.resource_root.rename(moved)
        self.resource_root.mkdir(mode=0o700)
        try:
            with self.journal(resources=True) as journal:
                with self.assertRaisesRegex(_fixtures.StageJournalError, "root inode changed"):
                    journal.recover(terminal_attempt_proven=lambda fence: fence == _fixtures.FENCE,
                                    resources_quiesced=lambda fence: fence == _fixtures.FENCE)
            self.assertTrue((moved / source.name / "keep").exists())
        finally:
            self.resource_root.rmdir()
            moved.rename(self.resource_root)


if __name__ == "__main__":
    unittest.main()
