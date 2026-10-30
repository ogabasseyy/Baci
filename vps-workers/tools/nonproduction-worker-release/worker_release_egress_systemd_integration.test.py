from __future__ import annotations

import sys
import os
import builtins
import io
import runpy
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
    _normalized_unit_exit, _run_seed_unit_socket_probe,
    _run_seed_unit_socket_probe_with_synthetic_connector,
    _seed_socket_probe_failure_summary,
)
import worker_release_egress_systemd_integration as integration
import dependency_seed_generation_unit as seed_unit
from worker_release_egress_fixture_staging import FIXTURE_MODULES, stage_fixture_modules


class SystemdIntegrationDiagnosticTests(unittest.TestCase):
    def test_seed_probe_uses_synthetic_connector_and_restores_real_connector(self):
        calls = []

        def real_connector(*_args, **_kwargs):
            raise AssertionError("real network connector must not be used by the fixture")

        def synthetic_connector(*args, **kwargs):
            calls.append((args, kwargs))
            return "synthetic-upstream"

        original_connect = integration.broker_module.connect_public
        with patch.object(integration.broker_module, "connect_public", real_connector), \
             patch.object(integration, "_run_seed_unit_socket_probe") as run_probe:
            def probe(**_kwargs):
                self.assertIs(integration.broker_module.connect_public, synthetic_connector)
                self.assertEqual(integration.broker_module.connect_public("registry.npmjs.org", 443),
                                 "synthetic-upstream")
                return "probe-complete"

            run_probe.side_effect = probe
            result = _run_seed_unit_socket_probe_with_synthetic_connector(
                synthetic_connector, unit_prefix="123", peer_uid=1001, peer_gid=1001,
                socket_path=Path("/run/broker.sock"), fixture_client=Path("/tmp/client.py"),
                hidden_socket=Path("/run/hidden.sock"), fixture_root=Path("/tmp/fixture"),
            )
            self.assertIsNone(result)
            self.assertEqual(len(calls), 1)
            self.assertIs(integration.broker_module.connect_public, real_connector)

            run_probe.side_effect = RuntimeError("synthetic probe failure")
            with self.assertRaisesRegex(RuntimeError, "synthetic probe failure"):
                _run_seed_unit_socket_probe_with_synthetic_connector(
                    synthetic_connector, unit_prefix="123", peer_uid=1001, peer_gid=1001,
                    socket_path=Path("/run/broker.sock"), fixture_client=Path("/tmp/client.py"),
                    hidden_socket=Path("/run/hidden.sock"), fixture_root=Path("/tmp/fixture"),
                )
            self.assertIs(integration.broker_module.connect_public, real_connector)
        self.assertIs(integration.broker_module.connect_public, original_connect)

    def test_seed_client_import_path_uses_fixed_bin_mount_only_when_present(self):
        client = Path(__file__).with_name("worker_release_egress_systemd_client.py")
        original_import = builtins.__import__
        original_is_dir = Path.is_dir

        for mounted in (False, True):
            with self.subTest(seed_bin_mounted=mounted):
                observed_paths = []
                stderr = io.StringIO()

                def is_dir(path):
                    if str(path) == "/run/baci-seed-bin":
                        return mounted
                    return original_is_dir(path)

                def fail_protocol_import(name, *args, **kwargs):
                    if name == "worker_release_egress_protocol":
                        observed_paths.append(tuple(sys.path))
                        raise ImportError("stop after path assertion")
                    return original_import(name, *args, **kwargs)

                with patch.object(Path, "is_dir", is_dir), \
                     patch.object(builtins, "__import__", side_effect=fail_protocol_import), \
                     patch.object(sys, "argv", [str(client), "--client", "/run/broker.sock", "1",
                                                 "/run/hidden.sock"]), \
                     patch("sys.stderr", stderr):
                    with self.assertRaises(SystemExit) as raised:
                        runpy.run_path(str(client), run_name="__main__")

                self.assertEqual(raised.exception.code, 1)
                self.assertEqual(len(observed_paths), 1)
                self.assertIn(str(client.parent.resolve()), observed_paths[0])
                self.assertEqual("/run/baci-seed-bin" in observed_paths[0], mounted)

    def test_seed_client_startup_import_failure_categories_are_fixed_and_redacted(self):
        client = Path(__file__).with_name("worker_release_egress_systemd_client.py")
        original_import = builtins.__import__
        cases = (
            (ModuleNotFoundError("secret /private/path",
                                 name="worker_release_egress_protocol"),
             "startup protocol module unavailable",
             "client-startup-protocol-module-unavailable"),
            (ModuleNotFoundError("secret /private/path", name="some_dependency"),
             "startup import dependency unavailable",
             "client-startup-import-dependency-unavailable"),
            (ImportError("secret /private/path"), "startup import unavailable",
             "client-startup-import-unavailable"),
        )
        for error, marker, expected_summary in cases:
            with self.subTest(marker=marker):
                stderr = io.StringIO()

                def fail_protocol_import(name, *args, **kwargs):
                    if name == "worker_release_egress_protocol":
                        raise error
                    return original_import(name, *args, **kwargs)

                with patch.object(builtins, "__import__", side_effect=fail_protocol_import), \
                     patch.object(sys, "argv", [str(client), "--client", "/run/broker.sock", "1",
                                                 "/run/hidden.sock"]), \
                     patch("sys.stderr", stderr):
                    with self.assertRaises(SystemExit) as raised:
                        runpy.run_path(str(client), run_name="__main__")

                self.assertEqual(raised.exception.code, 1)
                message = stderr.getvalue()
                self.assertEqual(message.strip(),
                                 f"egress client integration failed: {marker}")
                self.assertNotIn("secret", message)
                self.assertNotIn("/private/path", message)
                summary = _seed_socket_probe_failure_summary("", message, "", ())
                self.assertEqual(summary, expected_summary)

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

    def test_seed_socket_probe_diagnostics_query_only_exact_validated_unit(self):
        calls = []

        def capture(command, **_kwargs):
            calls.append(command)
            return type("Result", (), {"stdout": "fixed journal text", "stderr": ""})()

        fake_process = types.ModuleType("worker_release_bounded_process")
        fake_process.run_bounded_capture = capture
        unit = "worker-seed-socket-probe-123"
        with patch.dict(sys.modules, {"worker_release_bounded_process": fake_process}):
            self.assertIn("fixed journal text", _unit_journal_text(unit))
            self.assertEqual(_unit_journal_text(unit + "-extra"), "")
        self.assertTrue(any(f"--unit={unit}.service" in call for call in calls))
        self.assertTrue(any("status" in call and f"{unit}.service" in call for call in calls))
        self.assertFalse(any("--collect" in call for call in calls))

    def test_seed_socket_probe_failure_summary_is_bounded_to_category_and_known_path(self):
        source = Path("/run/baci-worker-egress-approved-123.sock")
        summary = _seed_socket_probe_failure_summary(
            "", "", f"Failed to set up mount namespacing: {source}: "
            "No such file or directory; secret=must-not-escape", (source, Path("/tmp")),
        )
        self.assertEqual(summary, f"namespace-path-missing path={source}")
        self.assertNotIn("secret", summary)
        self.assertNotIn("must-not-escape", summary)

    def test_seed_socket_probe_failure_summary_collapses_client_output(self):
        summary = _seed_socket_probe_failure_summary(
            "", "egress client integration failed: forbidden detail", "",
            (Path("/tmp/fixed.sock"),),
        )
        self.assertEqual(summary, "client-probe-rejected")

    def test_known_client_failure_labels_take_precedence_over_unit_exit(self):
        cases = (
            ("approved synthetic CONNECT was not accepted", "client-approved-connect-rejected"),
            ("broker accepted a forbidden destination request",
             "client-forbidden-broker-request-accepted"),
            ("PrivateNetwork unit obtained direct TCP egress",
             "client-direct-tcp-egress-available"),
            ("host /run Unix socket remained reachable inside the unit",
             "client-host-run-socket-visible"),
        )
        unit_status = "LoadState=loaded\nActiveState=failed\nResult=exit-code\nExecMainCode=1\nExecMainStatus=1\n"
        for message, expected in cases:
            with self.subTest(message=message):
                summary = _seed_socket_probe_failure_summary(
                    "", f"egress client integration failed: {message}", unit_status, (),
                )
                self.assertEqual(summary, expected)
                self.assertNotIn(message, summary)

    def test_unknown_client_failure_keeps_generic_label_over_unit_exit(self):
        unit_status = "LoadState=loaded\nActiveState=failed\nResult=exit-code\nExecMainCode=1\nExecMainStatus=1\n"
        summary = _seed_socket_probe_failure_summary(
            "", "egress client integration failed: secret exception detail", unit_status, (),
        )
        self.assertEqual(summary, "client-probe-rejected")
        self.assertNotIn("secret", summary)

    def test_seed_socket_probe_uses_only_normalized_systemd_exit_fields(self):
        journal = (
            "LoadState=loaded\nActiveState=failed\nSubState=failed\n"
            "Result=exit-code\nExecMainCode=1\nExecMainStatus=13\n"
            "StatusErrno=0\nStatusText=secret diagnostic\n"
            "ControlGroup=/system.slice/private-unit\n"
        )
        summary = _seed_socket_probe_failure_summary("", "", journal, ())
        self.assertEqual(
            summary,
            "unit-state(load=loaded,active=failed,result=exit-code,code=exited,status=13,errno=0)",
        )
        self.assertNotIn("secret", summary)
        self.assertNotIn("private-unit", summary)

    def test_systemd_exit_fields_are_closed_and_numbers_are_bounded(self):
        self.assertEqual(
            _normalized_unit_exit(
                "LoadState=unexpected-secret\nActiveState=failed\n"
                "Result=unexpected-secret\nExecMainCode=9\n"
                "ExecMainStatus=999999999\nStatusErrno=999999999\n"
            ),
            "unit-state(load=other,active=failed,result=other,code=other,status=other,errno=other)",
        )
        self.assertIsNone(_normalized_unit_exit("StatusText=raw-only\nControlGroup=/secret\n"))

    def test_seed_socket_probe_uses_bound_tools_path_with_private_tmp_enabled(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture_root = root / "fixture"
            fixture_root.mkdir()
            fixture_client = fixture_root / "host-only" / "worker_release_egress_systemd_client.py"
            socket_path = root / "broker.sock"
            hidden_socket = root / "hidden.sock"
            commands = []
            original_stat = os.stat

            def fake_stat(path, *args, **kwargs):
                if str(path) == "/proc/self/ns/net":
                    return type("Stat", (), {"st_ino": 123})()
                return original_stat(path, *args, **kwargs)

            def run(command, **_kwargs):
                commands.append(command)
                return type("Result", (), {"returncode": 0, "stdout": "", "stderr": ""})()

            with patch.object(integration.os, "stat", side_effect=fake_stat), \
                 patch.object(integration.subprocess, "run", side_effect=run), \
                 patch.object(integration, "_cleanup_systemd_unit") as cleanup:
                _run_seed_unit_socket_probe(
                    unit_prefix="123", peer_uid=1234, peer_gid=1234,
                    socket_path=socket_path, fixture_client=fixture_client,
                    hidden_socket=hidden_socket, fixture_root=fixture_root,
                )

            cleanup.assert_called_once_with("worker-seed-socket-probe-123")

            self.assertEqual(len(commands), 1)
            command = commands[0]
            self.assertNotIn("--collect", command)
            self.assertIn("--property=PrivateTmp=yes", command)
            self.assertIn("--property=RemainAfterExit=yes", command)
            self.assertIn("/run/baci-seed-tools/worker_release_egress_systemd_client.py", command)
            self.assertNotIn(str(fixture_client), command)
            self.assertTrue(any(
                argument.startswith("--property=BindReadOnlyPaths=")
                and ":/run/baci-seed-tools" in argument
                for argument in command
            ))

    def test_seed_probe_timeout_preserves_unit_state_when_cleanup_fails(self):
        unit_status = (
            "LoadState=loaded\nActiveState=failed\nResult=exit-code\n"
            "ExecMainCode=1\nExecMainStatus=124\nStatusErrno=0\n"
            "StatusText=secret text must not escape\n"
        )
        original_socket = seed_unit.EGRESS_SOCKET
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture_root = root / "fixture"
            fixture_root.mkdir()
            fixture_client = fixture_root / "client.py"
            socket_path = root / "broker.sock"
            hidden_socket = root / "hidden.sock"
            original_stat = os.stat

            def fake_stat(path, *args, **kwargs):
                if str(path) == "/proc/self/ns/net":
                    return type("Stat", (), {"st_ino": 123})()
                return original_stat(path, *args, **kwargs)

            with patch.object(integration.os, "stat", side_effect=fake_stat), \
                 patch.object(integration.subprocess, "run",
                              side_effect=integration.subprocess.TimeoutExpired("systemd-run", 45)), \
                 patch.object(integration, "_unit_journal_text", return_value=unit_status), \
                 patch.object(integration, "_cleanup_systemd_unit",
                              side_effect=RuntimeError("cleanup detail must not replace primary")) as cleanup:
                with self.assertRaisesRegex(
                        RuntimeError,
                        r"seed systemd direct-socket mount probe timed out "
                        r"\(unit-state\(load=loaded,active=failed,result=exit-code,"
                        r"code=exited,status=124,errno=0\)\); cleanup=failed") as raised:
                    _run_seed_unit_socket_probe(
                        unit_prefix="123", peer_uid=1234, peer_gid=1234,
                        socket_path=socket_path, fixture_client=fixture_client,
                        hidden_socket=hidden_socket, fixture_root=fixture_root,
                    )

            cleanup.assert_called_once_with("worker-seed-socket-probe-123")
            self.assertNotIn("secret", str(raised.exception))
            self.assertNotIn("cleanup detail", str(raised.exception))
            self.assertEqual(seed_unit.EGRESS_SOCKET, original_socket)

    def test_empty_run_probe_unit_is_accepted_by_diagnostics_and_cleanup(self):
        unit = "worker-egress-probe-123-empty-run"
        calls = []

        def capture(command, **_kwargs):
            calls.append(command)
            return type("Result", (), {"stdout": "fixed journal text", "stderr": ""})()

        fake_process = types.ModuleType("worker_release_bounded_process")
        fake_process.run_bounded_capture = capture
        with patch.dict(sys.modules, {"worker_release_bounded_process": fake_process}):
            self.assertIn("fixed journal text", _unit_journal_text(unit))

        def run(command, **_kwargs):
            calls.append(command)
            return type("Result", (), {"returncode": 0, "stdout": "loaded\n"})()

        with patch("worker_release_egress_systemd_integration.subprocess.run", side_effect=run):
            _cleanup_systemd_unit(unit)
        self.assertTrue(any(command[-1] == f"{unit}.service" for command in calls))

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

    def test_cleanup_accepts_exact_seed_socket_probe_prefix(self):
        unit = "worker-seed-socket-probe-123"
        calls = []

        def run(command, **_kwargs):
            calls.append(command)
            return type("Result", (), {"returncode": 0, "stdout": "loaded\n"})()

        with patch("worker_release_egress_systemd_integration.subprocess.run", side_effect=run):
            _cleanup_systemd_unit(unit)
        self.assertEqual(calls[-2:], [
            ("/usr/bin/systemctl", "--system", "stop", f"{unit}.service"),
            ("/usr/bin/systemctl", "--system", "reset-failed", f"{unit}.service"),
        ])

    def test_cleanup_rejects_unrecognized_seed_socket_probe_unit(self):
        with self.assertRaisesRegex(RuntimeError, "unit name is invalid"):
            _cleanup_systemd_unit("worker-seed-socket-probe-123-extra")

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
