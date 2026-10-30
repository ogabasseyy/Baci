#!/usr/bin/env python3
"""Root-only tests for release-lock coordinated seed eviction."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import stat
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parent
sys.path[:0] = [str(TOOLS.parents[1] / "bin"), str(TOOLS)]
import dependency_seed_retention as retention
import dependency_seed_retention_journal as retention_journal
from worker_release_dependency_artifacts import BuilderRejected

CURRENT = "a" * 40
OLD_RELEASE = "b" * 40
ORPHAN = "c" * 40
RETAINED_RELEASE = "e" * 40


class ReferencedReleaseShaTests(unittest.TestCase):
    @staticmethod
    def _scandir_for(*names):
        class Entry:
            def __init__(self, name):
                self.name = name

            def stat(self, *, follow_symlinks=True):
                return SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0)

        class Scan:
            def __enter__(self):
                return iter(Entry(name) for name in names)

            def __exit__(self, *_args):
                return False

        return lambda _path: Scan()

    def test_valid_current_and_previous_are_returned_and_request_sha_is_allowed(self):
        with tempfile.TemporaryDirectory(prefix="seed-reference-") as temporary:
            releases = Path(temporary) / "releases"
            releases.mkdir()
            (releases / CURRENT).mkdir()
            (releases / OLD_RELEASE).mkdir()
            with (patch.object(retention_journal, "_read_state", return_value={
                    "sha": CURRENT, "previous_sha": OLD_RELEASE}),
                  patch.object(retention_journal, "_current_sha", return_value=CURRENT),
                  patch.object(retention_journal.os, "scandir",
                               self._scandir_for(CURRENT, OLD_RELEASE, RETAINED_RELEASE))):
                result = retention_journal.referenced_release_shas(
                    Path(temporary), request_sha="d" * 40)
        self.assertEqual(result, {CURRENT, OLD_RELEASE, RETAINED_RELEASE, "d" * 40})

    def test_missing_referenced_release_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="seed-reference-missing-") as temporary:
            releases = Path(temporary) / "releases"
            releases.mkdir()
            (releases / CURRENT).mkdir()
            with (patch.object(retention_journal, "_read_state", return_value={
                    "sha": CURRENT, "previous_sha": OLD_RELEASE}),
                  patch.object(retention_journal, "_current_sha", return_value=CURRENT),
                  patch.object(retention_journal.os, "scandir",
                               self._scandir_for(CURRENT))):
                with self.assertRaisesRegex(BuilderRejected, "referenced release is missing"):
                    retention_journal.referenced_release_shas(Path(temporary))

    def test_malformed_previous_sha_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="seed-reference-malformed-") as temporary:
            releases = Path(temporary) / "releases"
            releases.mkdir()
            (releases / CURRENT).mkdir()
            with (patch.object(retention_journal, "_read_state", return_value={
                    "sha": CURRENT, "previous_sha": "../escape"}),
                  patch.object(retention_journal, "_current_sha", return_value=CURRENT),
                  patch.object(retention_journal.os, "scandir",
                               self._scandir_for(CURRENT))):
                with self.assertRaisesRegex(BuilderRejected, "previous SHA is malformed"):
                    retention_journal.referenced_release_shas(Path(temporary))


@unittest.skipUnless(sys.platform == "linux" and os.geteuid() == 0,
                     "requires root-owned lifecycle and seed trees")
class SeedRetentionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="seed-retention-")
        self.base = Path(self.temp.name)
        self.worker = self.base / "worker"
        self.releases = self.worker / "releases"
        self.releases.mkdir(parents=True)
        (self.releases / CURRENT).mkdir()
        (self.releases / OLD_RELEASE).mkdir()
        (self.releases / RETAINED_RELEASE).mkdir()
        (self.worker / "current").symlink_to(f"releases/{CURRENT}")
        state = {"version": 1, "status": "healthy", "sha": CURRENT,
                 "previous_sha": OLD_RELEASE, "fence": {"sha": CURRENT}}
        state_path = self.worker / "release-state.json"
        state_path.write_text(json.dumps(state), encoding="ascii")
        state_path.chmod(0o600)
        (self.worker / "release.lock").touch(mode=0o600)
        self.seeds = self.base / "seeds"
        self.seeds.mkdir(mode=0o700)
        (self.seeds / ".publish.lock").touch(mode=0o600)
        for name in (CURRENT, OLD_RELEASE, RETAINED_RELEASE, ORPHAN):
            seed = self.seeds / name
            seed.mkdir(mode=0o555)
            (seed / "placeholder").write_text("fixture", encoding="ascii")
            (seed / "placeholder").chmod(0o444)

    def tearDown(self):
        self.temp.cleanup()

    def test_only_verified_seed_unreferenced_by_any_release_is_removed(self):
        # The retention journal has its own verifier import. Stub both verifier
        # boundaries here: these tests exercise lock/journal/deletion behavior,
        # while seed-manifest authenticity is covered by recovery tests.
        with patch.object(retention, "_verify_preserved_canonical") as verify, \
             patch.object(retention_journal, "_verify_preserved_canonical"):
            removed = retention.prune_unreferenced_seeds(self.worker, self.seeds,
                                                         request_sha="d" * 40)
        self.assertEqual(removed, (ORPHAN,))
        self.assertTrue((self.seeds / CURRENT).exists())
        self.assertTrue((self.seeds / OLD_RELEASE).exists())
        self.assertTrue((self.seeds / RETAINED_RELEASE).exists())
        self.assertFalse((self.seeds / ORPHAN).exists())
        self.assertEqual(verify.call_count, 2)

    def test_unknown_release_entry_fails_closed_before_seed_deletion(self):
        (self.releases / "incoming-candidate").mkdir()
        with self.assertRaisesRegex(BuilderRejected, "not quiescent"):
            retention.prune_unreferenced_seeds(self.worker, self.seeds)
        self.assertTrue((self.seeds / ORPHAN).exists())

    def test_inflight_seed_publication_fails_closed(self):
        (self.seeds / ".publish-inflight.json").write_text("{}", encoding="ascii")
        with self.assertRaisesRegex(BuilderRejected, "inflight"):
            retention.prune_unreferenced_seeds(self.worker, self.seeds)
        self.assertTrue((self.seeds / ORPHAN).exists())

    def test_tombstone_survives_delete_failure_and_restores_if_new_release_references_sha(self):
        with patch.object(retention, "_verify_preserved_canonical"), \
             patch.object(retention_journal, "_verify_preserved_canonical"), \
             patch.object(retention_journal, "remove_tree", side_effect=OSError("injected crash")):
            with self.assertRaisesRegex(OSError, "injected crash"):
                retention.prune_unreferenced_seeds(self.worker, self.seeds)
        tombstones = [path for path in self.seeds.iterdir() if path.name.startswith(".prune-")]
        self.assertEqual(len(tombstones), 1)
        self.assertTrue((self.seeds / retention_journal.JOURNAL).is_file())
        (self.releases / ORPHAN).mkdir()
        with patch.object(retention, "_verify_preserved_canonical") as verify, \
             patch.object(retention_journal, "_verify_preserved_canonical"):
            removed = retention.prune_unreferenced_seeds(self.worker, self.seeds)
        self.assertEqual(removed, ())
        self.assertTrue((self.seeds / ORPHAN).is_dir())
        self.assertFalse((self.seeds / retention_journal.JOURNAL).exists())
        self.assertFalse(tombstones[0].exists())
        self.assertEqual(verify.call_count, 1)

    def test_unreferenced_partial_tombstone_delete_resumes_and_clears_journal(self):
        with patch.object(retention, "_verify_preserved_canonical"), \
             patch.object(retention_journal, "_verify_preserved_canonical"), \
             patch.object(retention_journal, "remove_tree", side_effect=OSError("injected crash")):
            with self.assertRaisesRegex(OSError, "injected crash"):
                retention.prune_unreferenced_seeds(self.worker, self.seeds)
        tombstone = next(path for path in self.seeds.iterdir() if path.name.startswith(".prune-"))
        (tombstone / "placeholder").unlink()
        with patch.object(retention, "_verify_preserved_canonical"), \
             patch.object(retention_journal, "_verify_preserved_canonical"):
            removed = retention.prune_unreferenced_seeds(self.worker, self.seeds)
        self.assertEqual(removed, ())
        self.assertFalse(tombstone.exists())
        self.assertFalse((self.seeds / retention_journal.JOURNAL).exists())


if __name__ == "__main__":
    unittest.main()
