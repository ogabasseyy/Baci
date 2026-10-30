from __future__ import annotations

import sys
import os
import tempfile
import types
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from worker_release_egress_systemd_integration import (
    _approved_socket_properties, _namespace_failure_category, _safe_diagnostic,
    _socket_bind_mount_command, _namespace_missing_path,
    _unit_journal_text, _cleanup_systemd_unit, _namespace_probe_steps,
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

    def test_approved_socket_is_bound_outside_isolated_run(self):
        properties = _approved_socket_properties(
            Path("/run/baci-worker-egress-approved-123.sock"),
            Path("/tmp/worker-egress-fixture/approved-source.sock"),
            Path("/tmp/worker-egress-fixture/approved.sock"))
        self.assertEqual(properties, (
            "--property=TemporaryFileSystem=/run:ro",
            "--property=BindReadOnlyPaths=/tmp/worker-egress-fixture/approved-source.sock:"
            "/tmp/worker-egress-fixture/approved.sock"))
        with self.assertRaisesRegex(RuntimeError, "outside fixed mount policy"):
            _approved_socket_properties(
                Path("/run/baci-worker-egress-approved-123.sock"),
                Path("/tmp/worker-egress-fixture/approved-source.sock"),
                Path("/run/approved.sock"))
        with self.assertRaisesRegex(RuntimeError, "outside fixed mount policy"):
            _approved_socket_properties(
                Path("/run/baci-worker-egress-approved-123.sock"),
                Path("/tmp/worker-egress-fixture/approved-source.sock"),
                Path("/var/run/approved.sock"))
        with self.assertRaisesRegex(RuntimeError, "outside fixed mount policy"):
            _approved_socket_properties(
                Path("/run/baci-worker-egress-approved-123.sock"),
                Path("/var/run/approved-source.sock"),
                Path("/tmp/worker-egress-fixture/approved.sock"))

    def test_source_alias_uses_cross_filesystem_bind_mount_not_hardlink(self):
        command = _socket_bind_mount_command(
            Path("/run/baci-worker-egress-approved-123.sock"),
            Path("/tmp/worker-egress-fixture/approved-source.sock"))
        self.assertEqual(command, (
            "/usr/bin/mount", "--bind",
            "/run/baci-worker-egress-approved-123.sock",
            "/tmp/worker-egress-fixture/approved-source.sock"))
        with self.assertRaisesRegex(RuntimeError, "outside fixed mount policy"):
            _socket_bind_mount_command(
                Path("/run/baci-worker-egress-approved-123.sock"),
                Path("/var/run/approved-source.sock"))

    def test_systemd_failure_is_reduced_to_non_sensitive_category(self):
        category = _namespace_failure_category(
            "Failed to set up mount namespacing: /run/private.sock: Operation not permitted "
            "credential=do-not-print")
        self.assertEqual(category, "namespace-permission")
        self.assertNotIn("private.sock", category)
        self.assertEqual(_namespace_failure_category(""), "journal-unavailable")

    def test_missing_path_diagnostic_returns_only_an_exact_known_fixture_path(self):
        expected = Path("/tmp/worker-egress-fixture/approved-source.sock")
        journal = ("Failed to set up mount namespacing: "
                   f"{expected}: No such file or directory; token=must-not-escape")
        self.assertEqual(_namespace_missing_path(journal, (expected,)), str(expected))
        self.assertIsNone(_namespace_missing_path(
            "Failed to set up mount namespacing: /root/private: No such file or directory",
            (expected,)))
        self.assertIsNone(_namespace_missing_path(
            f"permission denied: {expected}", (expected,)))

    def test_unit_diagnostics_query_exact_unit_and_systemctl_status(self):
        calls = []

        def capture(command, **_kwargs):
            calls.append(command)
            return type("Result", (), {"stdout": "fixed journal text", "stderr": ""})()

        fake_process = types.ModuleType("worker_release_bounded_process")
        fake_process.run_bounded_capture = capture
        with patch.dict(sys.modules, {"worker_release_bounded_process": fake_process}):
            text = _unit_journal_text("worker-egress-prototype-123")
        self.assertIn("fixed journal text", text)
        self.assertTrue(any("--unit=worker-egress-prototype-123.service" in call for call in calls))
        self.assertTrue(any("status" in call and "worker-egress-prototype-123.service" in call
                            for call in calls))
        self.assertTrue(any("--property=StatusText" in call
                            and "--property=ExecMainStatus" in call for call in calls))
        self.assertFalse(any("--collect" in call for call in calls))

    def test_namespace_probes_progress_from_base_to_full_mount_policy(self):
        steps = _namespace_probe_steps(
            "--property=TemporaryFileSystem=/run:ro",
            "--property=BindReadOnlyPaths=/tmp/source.sock:/tmp/target.sock")
        self.assertEqual([step[0] for step in steps],
                         ["base", "empty-run", "bind", "combined"])
        self.assertNotIn("--property=InaccessiblePaths=/run", steps[0])
        self.assertIn("--property=TemporaryFileSystem=/run:ro", steps[1])
        self.assertIn("--property=BindReadOnlyPaths=/tmp/source.sock:/tmp/target.sock", steps[2])
        self.assertIn("--property=TemporaryFileSystem=/run:ro", steps[3])
        self.assertIn("--property=BindReadOnlyPaths=/tmp/source.sock:/tmp/target.sock", steps[3])

    def test_cleanup_stops_and_resets_only_exact_fixture_unit(self):
        calls = []

        def run(command, **_kwargs):
            calls.append(command)
            return type("Result", (), {"returncode": 0, "stdout": "loaded\n"})()

        with patch("worker_release_egress_systemd_integration.subprocess.run", side_effect=run):
            _cleanup_systemd_unit("worker-egress-prototype-123")
        self.assertEqual(calls, [
            ("/usr/bin/systemctl", "--system", "show", "--property=LoadState", "--value",
             "worker-egress-prototype-123.service"),
            ("/usr/bin/systemctl", "--system", "stop", "worker-egress-prototype-123.service"),
            ("/usr/bin/systemctl", "--system", "reset-failed", "worker-egress-prototype-123.service"),
        ])

    def test_cleanup_does_not_stop_an_unloaded_unit(self):
        calls = []

        def run(command, **_kwargs):
            calls.append(command)
            return type("Result", (), {"returncode": 0, "stdout": "not-found\n"})()

        with patch("worker_release_egress_systemd_integration.subprocess.run", side_effect=run):
            _cleanup_systemd_unit("worker-egress-prototype-123")
        self.assertEqual(len(calls), 1)

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
