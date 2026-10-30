#!/usr/bin/env python3
from __future__ import annotations

import fcntl
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from worker_release_retention import prune_worker_releases
import worker_release_retention as retention


REAL_RMTREE = shutil.rmtree
SHAS = [f"{number:040x}" for number in range(1, 20)]


class WorkerReleaseRetentionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="worker-release-retention-")
        self.root = Path(self.temporary.name) / "worker"
        self.releases = self.root / "releases"
        self.releases.mkdir(parents=True)
        self.current = self.root / "current"
        self.worker_gid = os.getgid()
        self.owner_uid = os.getuid()

    def tearDown(self):
        self.temporary.cleanup()

    def add_release(self, sha: str, *, stamp: int | None = None):
        path = self.releases / sha
        path.mkdir()
        (path / "bin").mkdir()
        (path / "bin" / "worker.sh").write_text("#!/bin/sh\n", encoding="utf-8")
        os.chmod(path / "bin" / "worker.sh", 0o550)
        os.chmod(path / "bin", 0o550)
        os.chmod(path, 0o550)
        if stamp is not None:
            os.utime(path, ns=(stamp, stamp))
        return path

    def state(self, status="healthy", sha=SHAS[1], previous=SHAS[0]):
        (self.root / "release-state.json").write_text(json.dumps({
            "version": 1,
            "status": status,
            "sha": sha,
            "previous_sha": previous,
            "fence": {"sha": sha, "run_id": "123", "run_attempt": 1},
        }), encoding="utf-8")
        os.chmod(self.root / "release-state.json", 0o600)

    def healthy_fixture(self, count=8):
        for index, sha in enumerate(SHAS[:count]):
            self.add_release(sha, stamp=1_000_000_000 + index)
        self.current.symlink_to(Path("releases") / SHAS[1])
        self.state()

    def prune(self, **kwargs):
        # Production runs as root and can remove the deliberately immutable
        # 0550 release tree. Make the temporary test tree writable only at the
        # final rmtree boundary so the tests exercise planning on macOS too.
        with patch.object(retention.shutil, "rmtree", side_effect=self.remove_tree):
            return prune_worker_releases(
                self.root, worker_gid=self.worker_gid, owner_uid=self.owner_uid, **kwargs
            )

    @staticmethod
    def remove_tree(path):
        path = Path(path)
        for directory, child_dirs, _files in os.walk(path, topdown=False):
            for child in child_dirs:
                os.chmod(Path(directory) / child, 0o700)
            os.chmod(directory, 0o700)
        REAL_RMTREE(path)

    def test_prunes_old_valid_trees_but_keeps_current_prior_request_and_recent_cushion(self):
        self.healthy_fixture()
        incoming = self.releases / f".{SHAS[8]}.incoming"
        incoming.mkdir()
        (incoming / "partial").write_text("preserve", encoding="utf-8")
        unrelated = self.releases / "manual-not-a-sha"
        unrelated.mkdir()

        result = self.prune(request_sha=SHAS[7], max_retained=4)

        self.assertEqual(result.reason, "pruned")
        self.assertEqual(set(result.deleted), {SHAS[2], SHAS[3], SHAS[4], SHAS[5]})
        self.assertTrue((self.releases / SHAS[0]).is_dir())  # recorded rollback target
        self.assertTrue((self.releases / SHAS[1]).is_dir())  # current release
        self.assertTrue((self.releases / SHAS[7]).is_dir())  # authenticated in-flight request
        self.assertTrue((self.releases / SHAS[6]).is_dir())  # recent cushion
        self.assertTrue((incoming / "partial").is_file())
        self.assertTrue(unrelated.is_dir())

    def test_never_prunes_when_state_is_missing_malformed_or_nonterminal(self):
        self.healthy_fixture()
        (self.root / "release-state.json").unlink()
        result = self.prune()
        self.assertEqual(result.reason, "release_state_or_current_missing")
        self.assertFalse(result.deleted)
        self.state(status="promoted")
        result = self.prune()
        self.assertEqual(result.reason, "release_state_not_terminal")
        self.assertFalse(result.deleted)
        (self.root / "release-state.json").write_text("not json", encoding="utf-8")
        os.chmod(self.root / "release-state.json", 0o600)
        result = self.prune()
        self.assertEqual(result.reason, "untrusted_release_state_or_pointer")
        self.assertFalse(result.deleted)

    def test_never_prunes_when_current_and_terminal_state_disagree(self):
        self.healthy_fixture()
        self.current.unlink()
        self.current.symlink_to(Path("releases") / SHAS[2])
        result = self.prune()
        self.assertEqual(result.reason, "healthy_state_pointer_mismatch")
        self.assertFalse(result.deleted)

    def test_rolled_back_state_keeps_failed_sha_and_restored_current(self):
        for sha in SHAS[:7]:
            self.add_release(sha)
        self.current.symlink_to(Path("releases") / SHAS[0])
        self.state(status="rolled_back", sha=SHAS[1], previous=SHAS[0])

        result = self.prune(max_retained=2)

        self.assertTrue((self.releases / SHAS[0]).is_dir())
        self.assertTrue((self.releases / SHAS[1]).is_dir())
        self.assertEqual(set(result.deleted), set(SHAS[2:7]))

    def test_unsafe_canonical_tree_blocks_all_deletion(self):
        self.healthy_fixture()
        unsafe = self.releases / SHAS[2]
        self.remove_tree(unsafe)
        unsafe.mkdir()
        (unsafe / "link").symlink_to("/etc/passwd")
        os.chmod(unsafe, 0o550)

        result = self.prune(max_retained=2)

        self.assertEqual(result.reason, "unsafe_release_inventory")
        self.assertFalse(result.deleted)
        self.assertTrue(unsafe.is_symlink() is False)
        self.assertTrue((unsafe / "link").is_symlink())

    def test_release_lock_contention_blocks_pruning(self):
        self.healthy_fixture()
        lock_path = self.root / "release.lock"
        fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.prune(max_retained=2)
        finally:
            os.close(fd)

        self.assertEqual(result.reason, "release_lock_unavailable")
        self.assertFalse(result.deleted)

    def test_each_run_removes_at_most_eight_releases(self):
        self.healthy_fixture(count=15)
        first = self.prune(max_retained=3)
        self.assertEqual(len(first.deleted), 8)
        second = self.prune(max_retained=3)
        self.assertLessEqual(len(second.deleted), 8)


if __name__ == "__main__":
    unittest.main()
