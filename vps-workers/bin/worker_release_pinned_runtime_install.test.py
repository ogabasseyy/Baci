from __future__ import annotations

import io
import hashlib
import os
import tarfile
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import worker_release_pinned_runtime as pins
import worker_release_pinned_runtime_archive as archive_tools
import worker_release_pinned_runtime_install as install


def _archive(entries: list[tuple[str, bytes, int]], mode: str) -> bytes:
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode=mode) as archive:
        for name, payload, file_mode in entries:
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            info.mode = file_mode
            archive.addfile(info, io.BytesIO(payload))
    return output.getvalue()


class _ZeroStream:
    def __init__(self, remaining: int):
        self.remaining = remaining

    def read(self, size: int = -1) -> bytes:
        count = self.remaining if size < 0 else min(self.remaining, size)
        self.remaining -= count
        return b"\0" * count


class PinnedArchivePathTests(unittest.TestCase):
    def test_member_names_must_stay_under_the_expected_root(self):
        self.assertEqual(archive_tools.safe_relative("package/bin/pnpm.cjs", prefix="package").parts,
                         ("package", "bin", "pnpm.cjs"))
        for name in ("/package/file", "outside/file", "package/../escape",
                     "package\\..\\escape"):
            with self.subTest(name=name), self.assertRaises(install.RuntimeInstallRejected):
                archive_tools.safe_relative(name, prefix="package")

    def test_archive_reader_binds_hash_and_rejects_symlink(self):
        payload = b"fixed test archive bytes"
        digest = hashlib.sha256(payload).hexdigest()
        with tempfile.TemporaryDirectory(prefix="baci-runtime-archive-test-") as temp:
            archive_path = Path(temp) / "artifact.tgz"
            archive_path.write_bytes(payload)
            archive_path.chmod(0o600)
            self.assertEqual(archive_tools.read_pinned_archive(
                archive_path, expected_sha256=digest, max_bytes=128,
                owner_uid=os.getuid()), payload)
            with self.assertRaises(install.RuntimeInstallRejected):
                archive_tools.read_pinned_archive(
                    archive_path, expected_sha256="0" * 64, max_bytes=128,
                    owner_uid=os.getuid())
            alias = Path(temp) / "linked.tgz"
            alias.symlink_to(archive_path)
            with self.assertRaises(install.RuntimeInstallRejected):
                archive_tools.read_pinned_archive(
                    alias, expected_sha256=digest, max_bytes=128,
                    owner_uid=os.getuid())


@unittest.skipUnless(os.geteuid() == 0 and Path("/root").is_dir(),
                     "pinned runtime installation contract requires Linux root")
class PinnedRuntimeInstallTests(unittest.TestCase):
    def test_exact_pinned_node_binary_size_is_inside_fixed_bound(self):
        if not (os.geteuid() == 0 and Path("/root").is_dir()):
            self.skipTest("pinned Node extraction requires Linux root")
        expected_size = 126_881_248
        self.assertLessEqual(expected_size, archive_tools.MAX_NODE_MEMBER)
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w:xz") as archive:
            member = tarfile.TarInfo(archive_tools.NODE_MEMBER)
            member.size = expected_size
            member.mode = 0o755
            archive.addfile(member, _ZeroStream(expected_size))
        with tempfile.TemporaryDirectory(prefix="baci-runtime-node-size-test-", dir="/root") as temp:
            destination = Path(temp)
            archive_tools.extract_node(output.getvalue(), destination)
            self.assertEqual((destination / "node/bin/node").stat().st_size, expected_size)

    def test_install_is_hash_bound_atomic_and_idempotent(self):
        node = _archive([(archive_tools.NODE_MEMBER,
                          b"#!/bin/sh\nexit 0\n", 0o755)], "w:xz")
        pnpm = _archive([("package/bin/pnpm.cjs", b"// fixture\n", 0o644),
                         ("package/dist/pnpm.cjs", b"// fixture dist\n", 0o644)], "w:gz")
        node_hash = __import__("hashlib").sha256(node).hexdigest()
        pnpm_hash = __import__("hashlib").sha256(pnpm).hexdigest()
        node_ver, pnpm_ver = "v24.22.2", "11.7.0"

        def runner(command, **_kwargs):
            output = node_ver if command[-1] == "--version" and len(command) == 2 else pnpm_ver
            return SimpleNamespace(returncode=0, stdout=output + "\n")

        with tempfile.TemporaryDirectory(prefix="baci-pinned-runtime-test-", dir="/root") as temp:
            runtime_root = Path(temp) / "runtime"
            with (patch.object(install, "NODE_ARCHIVE_SHA256", node_hash),
                  patch.object(install, "PNPM_ARCHIVE_SHA256", pnpm_hash),
                  patch.object(pins, "NODE_ARCHIVE_SHA256", node_hash),
                  patch.object(pins, "PNPM_ARCHIVE_SHA256", pnpm_hash)):
                first = install._install_bytes(node, pnpm, root=runtime_root, runner=runner)
                second = install._install_bytes(node, pnpm, root=runtime_root, runner=runner)
            self.assertEqual(first, second)
            self.assertTrue(first[0].is_file())
            self.assertEqual(first[1].read_bytes(), b"// fixture\n")
            releases = runtime_root / "releases"
            self.assertEqual([p.name for p in releases.iterdir()], [pins.RELEASE_NAME])

    def test_pnpm_archive_rejects_traversal_and_links(self):
        with tempfile.TemporaryDirectory(prefix="baci-pinned-runtime-test-", dir="/root") as temp:
            root = Path(temp)
            traversal = _archive([("package/../../escape", b"bad", 0o644)], "w:gz")
            with self.assertRaises(install.RuntimeInstallRejected):
                archive_tools.extract_pnpm(traversal, root)
            link = io.BytesIO()
            with tarfile.open(fileobj=link, mode="w:gz") as archive:
                info = tarfile.TarInfo("package/bin/pnpm.cjs")
                info.type = tarfile.SYMTYPE
                info.linkname = "../../outside"
                archive.addfile(info)
            with self.assertRaises(install.RuntimeInstallRejected):
                archive_tools.extract_pnpm(link.getvalue(), root)
            self.assertFalse((root.parent / "escape").exists())


if __name__ == "__main__":
    unittest.main()
