#!/usr/bin/env python3
"""Descriptor-pinned source binding tests for seed generation."""
from __future__ import annotations

import os
from pathlib import Path
import tempfile
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "bin"))

from dependency_seed_generation_contract import SeedGenerationRejected
from dependency_seed_generation_source import digest_pinned_stage_source
from worker_release_source_snapshot import pin_source_snapshot
from worker_release_source_view_access import grant_source_view_access


@unittest.skipUnless(os.geteuid() == 0, "requires disposable root-owned frozen files")
class PinnedStageSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="seed-stage-source-", dir="/run")
        self.root = Path(self.temp.name)
        os.chmod(self.root, 0o700)
        self.source = self.root / "view"
        self.source.mkdir(mode=0o700)
        (self.source / "pnpm-lock.yaml").write_text("lockfileVersion: '9.0'\n")
        (self.source / "pnpm-lock.yaml").chmod(0o440)
        self.source.chmod(0o550)

    def tearDown(self):
        self.source.chmod(0o700)
        for current, dirs, files in os.walk(self.source):
            for name in files:
                Path(current, name).chmod(0o600)
            for name in dirs:
                Path(current, name).chmod(0o700)
        self.temp.cleanup()

    def test_digest_comes_from_the_exact_live_stage_pin(self):
        # This unit test checks that seed generation consumes the exact pin.
        # Use isolated synthetic reader UIDs and real ACLs so it does not
        # depend on system accounts provisioned by the separate host workflow.
        readers = (61001, 61002)
        grant_source_view_access(self.source, read_uids=readers)
        with (patch("worker_release_source_view_access.fixed_reader_uids",
                    return_value=readers),
              pin_source_snapshot(self.source, trusted_root=self.root, owner_uid=0,
                                  read_uids=readers) as pin):
            digest = digest_pinned_stage_source(self.source, pin)
            self.assertEqual(len(digest), 64)
            pin.verify_unchanged()

    def test_rejects_a_different_view_even_if_it_is_frozen(self):
        other = self.root / "other"
        other.mkdir(mode=0o700)
        (other / "pnpm-lock.yaml").write_text("different\n")
        (other / "pnpm-lock.yaml").chmod(0o440)
        other.chmod(0o550)
        try:
            with pin_source_snapshot(self.source, trusted_root=self.root, owner_uid=0) as pin:
                with self.assertRaises(SeedGenerationRejected):
                    digest_pinned_stage_source(other, pin)
        finally:
            other.chmod(0o700)
            (other / "pnpm-lock.yaml").chmod(0o600)

    def test_rejects_replaced_path_after_pin(self):
        moved = self.root / "moved"
        with pin_source_snapshot(self.source, trusted_root=self.root, owner_uid=0) as pin:
            self.source.rename(moved)
            replacement = self.root / "view"
            replacement.mkdir(mode=0o700)
            (replacement / "pnpm-lock.yaml").write_text("different\n")
            (replacement / "pnpm-lock.yaml").chmod(0o440)
            replacement.chmod(0o550)
            with self.assertRaises(Exception):
                digest_pinned_stage_source(self.source, pin)
        moved.chmod(0o700)
        (moved / "pnpm-lock.yaml").chmod(0o600)
        replacement.chmod(0o700)
        (replacement / "pnpm-lock.yaml").chmod(0o600)


if __name__ == "__main__":
    unittest.main()
