#!/usr/bin/env python3
"""Synthetic regression for the experiment's descriptor-pinned no-copy move."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest

TOOLS = Path(__file__).resolve().parent
sys.path[:0] = [str(TOOLS), str(TOOLS.parents[1] / "bin")]
SPEC = importlib.util.spec_from_file_location(
    "actual_seed_move_measure", TOOLS / "worker_release_actual_seed_move_measure.py")
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def measure(path: Path) -> tuple[int, int]:
    entries = 0
    size = 0
    for current, dirs, files in os.walk(path, followlinks=False):
        if any((Path(current) / name).is_symlink() for name in dirs + files):
            raise RuntimeError("symlink in measured fixture")
        entries += len(dirs) + len(files)
        size += sum((Path(current) / name).stat(follow_symlinks=False).st_size for name in files)
    return entries, size


class SameFilesystemMeasurementTests(unittest.TestCase):
    def test_moves_real_input_inodes_without_copying(self):
        with tempfile.TemporaryDirectory(prefix="seed-measure-") as temporary:
            base = Path(temporary)
            cache, store = base / "pnpm-cache", base / "pnpm-store"
            cache.mkdir(); store.mkdir()
            (cache / "metadata.json").write_text("cache-data")
            (store / "package.tgz").write_bytes(b"x" * 4096)
            identities = {name: ((base / name).stat().st_dev, (base / name).stat().st_ino)
                          for name in ("pnpm-cache", "pnpm-store")}
            target_parent = base / "seeds"
            target_parent.mkdir()
            result = MODULE.move_inputs_and_measure(
                cache, store, target_parent / ("a" * 40), measure=measure)
            self.assertTrue(result["same_filesystem"])
            self.assertEqual(result["copy_bytes"], 0)
            self.assertFalse(cache.exists())
            self.assertFalse(store.exists())
            self.assertEqual((target_parent / ("a" * 40) / "pnpm-cache").stat().st_ino, identities["pnpm-cache"][1])
            self.assertEqual((target_parent / ("a" * 40) / "pnpm-store").stat().st_ino, identities["pnpm-store"][1])

    def test_callback_failure_has_bounded_safe_reason_and_substage(self):
        with tempfile.TemporaryDirectory(prefix="seed-measure-callback-") as temporary:
            base = Path(temporary)
            (base / "pnpm-cache").mkdir()
            (base / "pnpm-store").mkdir()

            def rejected(_path):
                raise RuntimeError("measured tree contains a shared file inode")

            with self.assertRaises(MODULE.SeedMoveMeasurementRejected) as raised:
                MODULE.move_inputs_and_measure(
                    base / "pnpm-cache", base / "pnpm-store", base / "seeds" / ("c" * 40), measure=rejected)
            self.assertEqual(raised.exception.safe_reason, "tree-shared-inode")
            self.assertEqual(raised.exception.safe_substage, "measure-cache-before")
            self.assertNotIn("measured tree", str(raised.exception))

    def test_rejects_symlinked_input_without_moving_or_following_it(self):
        with tempfile.TemporaryDirectory(prefix="seed-measure-link-") as temporary:
            base = Path(temporary)
            real = base / "real"
            real.mkdir()
            (real / "secret").write_text("fixture")
            (base / "pnpm-cache").symlink_to(real, target_is_directory=True)
            (base / "pnpm-store").mkdir()
            target = base / "seeds" / ("b" * 40)
            (base / "seeds").mkdir()
            with self.assertRaises(MODULE.SeedMoveMeasurementRejected) as raised:
                MODULE.move_inputs_and_measure(base / "pnpm-cache", base / "pnpm-store", target, measure=measure)
            self.assertEqual(raised.exception.safe_reason, "filesystem-error")
            self.assertEqual(raised.exception.safe_substage, "open-inputs")
            self.assertEqual((real / "secret").read_text(), "fixture")
            self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
