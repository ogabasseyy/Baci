from __future__ import annotations

import unittest
from io import BytesIO

from dependency_builder_fixture_systemd_diagnostics import (
    BoundedOutputDrain, cleanup_unit, collect_unit_diagnostics,
    summarize_child_output, summarize_status,
)


class BuilderSystemdDiagnosticsTests(unittest.TestCase):
    def test_child_output_is_bounded_drained_and_reduced_to_category(self):
        drain = BoundedOutputDrain(BytesIO(b"private-prefix" + b"x" * 40 + b"Traceback"),
                                   max_bytes=32)
        tail = drain.read()
        self.assertLessEqual(len(tail), 32)
        self.assertTrue(tail.endswith(b"Traceback"))
        category = summarize_child_output(b"", b"Traceback (most recent call last): secret")
        self.assertEqual(category, "python-exception")
        self.assertNotIn("secret", category)

    def test_summary_returns_only_closed_categories_and_fixed_fields(self):
        summary = summarize_status(
            "LoadState=loaded\nActiveState=failed\nSubState=failed\nResult=exit-code\n"
            "ExecMainCode=exited\nExecMainStatus=226\nStatusText=Failed at step NAMESPACE /private/token\n",
            "Failed to set up mount namespacing: /private/token: No such file or directory",
        )
        self.assertEqual(summary["load_state"], "loaded")
        self.assertEqual(summary["active_state"], "failed")
        self.assertEqual(summary["result"], "exit-code")
        self.assertEqual(summary["exec_main_status"], "226")
        self.assertEqual(summary["status_category"], "namespace")
        self.assertEqual(summary["journal_category"], "namespace")
        self.assertNotIn("token", repr(summary))
        self.assertEqual(set(summary), {
            "load_state", "active_state", "sub_state", "result", "exec_main_code",
            "exec_main_status", "status_errno", "status_category", "journal_category",
        })

    def test_collection_queries_only_exact_unit_bounded_commands(self):
        commands = []

        def run(command, **kwargs):
            commands.append((command, kwargs))
            if "show" in command:
                return type("Result", (), {"returncode": 0, "stdout": "Result=exit-code\nExecMainStatus=1\nStatusText=Failed at step NAMESPACE\n"})()
            return type("Result", (), {"returncode": 0, "stdout": "Failed at step NAMESPACE\n"})()

        result = collect_unit_diagnostics("baci-worker-deps-aaaaaaaaaaaa-0123456789", run=run)
        self.assertEqual(len(commands), 2)
        self.assertTrue(any("baci-worker-deps-aaaaaaaaaaaa-0123456789.service" in cmd
                            for cmd, _ in commands))
        self.assertTrue(all(kwargs["max_stream_bytes"] == 4096 for _, kwargs in commands))
        self.assertEqual(result["status_category"], "namespace")
        self.assertEqual(result["journal_category"], "namespace")

    def test_invalid_unit_is_rejected_before_commands(self):
        with self.assertRaisesRegex(ValueError, "unit name"):
            collect_unit_diagnostics("baci-worker-deps-aaaaaaaaaaaa-../../x", run=lambda *_a, **_k: None)

    def test_cleanup_stops_and_resets_only_the_exact_loaded_unit(self):
        commands = []

        def run(command, **kwargs):
            commands.append(command)
            output = "loaded\n" if "show" in command else ""
            return type("Result", (), {"returncode": 0, "stdout": output})()

        cleanup_unit("baci-worker-deps-aaaaaaaaaaaa-0123456789.service", run=run)
        self.assertEqual([command[2] for command in commands], [
            "show", "stop", "reset-failed",
        ])
        self.assertTrue(all(command[-1] == "baci-worker-deps-aaaaaaaaaaaa-0123456789.service"
                            for command in commands))

    def test_cleanup_leaves_absent_unit_alone(self):
        commands = []

        def run(command, **kwargs):
            commands.append(command)
            return type("Result", (), {"returncode": 0, "stdout": "not-found\n"})()

        cleanup_unit("baci-worker-deps-aaaaaaaaaaaa-0123456789", run=run)
        self.assertEqual(len(commands), 1)


if __name__ == "__main__":
    unittest.main()
