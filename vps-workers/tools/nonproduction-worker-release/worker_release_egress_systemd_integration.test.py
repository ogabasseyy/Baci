from __future__ import annotations

import sys
import os
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from worker_release_egress_systemd_integration import (
    _approved_socket_properties, _namespace_failure_category, _safe_diagnostic,
)
from worker_release_egress_fixture_staging import FIXTURE_MODULES, stage_fixture_modules


class SystemdIntegrationDiagnosticTests(unittest.TestCase):
    def test_diagnostic_is_printable_sanitized_and_bounded(self):
        value = _safe_diagnostic("stage\nfailed\x1b[31m", "reason: bad\x00path", limit=24)
        self.assertLessEqual(len(value), 24)
        self.assertNotIn("\x1b", value)
        self.assertNotIn("\x00", value)
        self.assertTrue(value.endswith("reason: bad?path"))

    def test_empty_diagnostic_is_explicit(self):
        self.assertEqual(_safe_diagnostic("", ""), "no diagnostic output")

    def test_approved_socket_is_bound_outside_masked_run(self):
        properties = _approved_socket_properties(
            Path("/run/baci-worker-egress-approved-123.sock"),
            Path("/tmp/worker-egress-fixture/approved.sock"))
        self.assertEqual(properties, (
            "--property=InaccessiblePaths=/run",
            "--property=BindReadOnlyPaths=/run/baci-worker-egress-approved-123.sock:"
            "/tmp/worker-egress-fixture/approved.sock"))
        with self.assertRaisesRegex(RuntimeError, "outside fixed mount policy"):
            _approved_socket_properties(
                Path("/run/baci-worker-egress-approved-123.sock"),
                Path("/run/approved.sock"))
        with self.assertRaisesRegex(RuntimeError, "outside fixed mount policy"):
            _approved_socket_properties(
                Path("/run/baci-worker-egress-approved-123.sock"),
                Path("/var/run/approved.sock"))

    def test_systemd_failure_is_reduced_to_non_sensitive_category(self):
        category = _namespace_failure_category(
            "Failed to set up mount namespacing: /run/private.sock: Operation not permitted "
            "credential=do-not-print")
        self.assertEqual(category, "namespace-permission")
        self.assertNotIn("private.sock", category)
        self.assertEqual(_namespace_failure_category(""), "journal-unavailable")

    def _fixture_source(self, root: Path) -> Path:
        for index, relative in enumerate(FIXTURE_MODULES):
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"fixed fixture module {index}\n", encoding="ascii")
            path.chmod(0o644)
        return root

    def test_staging_copies_only_fixed_modules_into_readable_read_only_tree(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as temporary:
            root = Path(temporary)
            source = self._fixture_source(root / "checkout")
            destination = root / "protected" / "fixture"
            destination.parent.mkdir()
            staged_client = stage_fixture_modules(
                source, destination, owner_uid=os.geteuid(), owner_gid=os.getegid())
            self.assertEqual(staged_client, destination / FIXTURE_MODULES[4])
            self.assertEqual(sorted(str(path.relative_to(destination)) for path in destination.rglob("*.py")),
                             sorted(FIXTURE_MODULES))
            self.assertEqual(destination.stat().st_mode & 0o777, 0o711)
            for index, relative in enumerate(FIXTURE_MODULES):
                staged = destination / relative
                self.assertEqual(staged.read_text(encoding="ascii"),
                                 f"fixed fixture module {index}\n")
                self.assertEqual(staged.stat().st_mode & 0o777, 0o444)
                self.assertEqual(staged.stat().st_uid, os.geteuid())

    def test_staging_rejects_symlinked_source_module(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as temporary:
            root = Path(temporary)
            source = self._fixture_source(root / "checkout")
            selected = source / FIXTURE_MODULES[4]
            selected.unlink()
            selected.symlink_to(source / FIXTURE_MODULES[0])
            with self.assertRaises(OSError):
                stage_fixture_modules(source, root / "protected" / "fixture",
                                       owner_uid=os.geteuid(), owner_gid=os.getegid())

    def test_staging_rejects_group_or_world_writable_source_module(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as temporary:
            root = Path(temporary)
            source = self._fixture_source(root / "checkout")
            (source / FIXTURE_MODULES[4]).chmod(0o664)
            destination = root / "protected" / "fixture"
            destination.parent.mkdir()
            with self.assertRaisesRegex(RuntimeError, "source is unsafe"):
                stage_fixture_modules(source, destination,
                                       owner_uid=os.geteuid(), owner_gid=os.getegid())

    def test_staging_accepts_runner_writable_checkout_ancestor_but_keeps_copy_private(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as temporary:
            root = Path(temporary)
            writable_ancestor = root / "runner-work"
            writable_ancestor.mkdir()
            writable_ancestor.chmod(0o775)
            source = self._fixture_source(writable_ancestor / "checkout")
            destination_parent = root / "protected"
            destination_parent.mkdir()
            destination = destination_parent / "fixture"
            staged_client = stage_fixture_modules(
                source, destination, owner_uid=os.geteuid(), owner_gid=os.getegid())
            self.assertEqual(staged_client.read_text(encoding="ascii"),
                             "fixed fixture module 4\n")
            self.assertEqual(destination.stat().st_mode & 0o777, 0o711)
            self.assertEqual(staged_client.stat().st_mode & 0o777, 0o444)


if __name__ == "__main__":
    unittest.main()
