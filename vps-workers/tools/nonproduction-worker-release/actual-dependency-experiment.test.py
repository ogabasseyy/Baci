import importlib.util
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("actual-dependency-experiment.py")
SPEC = importlib.util.spec_from_file_location("actual_dependency_experiment", SCRIPT)
assert SPEC and SPEC.loader
experiment = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(experiment)
from worker_release_actual_dependency_guard import enforce_resource_limits, run_monitored


class ActualDependencyExperimentTests(unittest.TestCase):
    def test_resource_guard_retries_transient_child_disappearance(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            entry = root / "pnpm-temporary-entry"
            entry.write_text("synthetic", encoding="utf-8")
            original_lstat = Path.lstat
            vanished_once = False

            def lstat_with_one_transient_race(path):
                nonlocal vanished_once
                if path == entry and not vanished_once:
                    vanished_once = True
                    raise FileNotFoundError(path)
                return original_lstat(path)

            with patch.object(Path, "lstat", lstat_with_one_transient_race):
                count, size = enforce_resource_limits(root, min_free_bytes=0, min_free_inodes=0)
            self.assertTrue(vanished_once)
            self.assertEqual(count, 1)
            self.assertEqual(size, len(b"synthetic"))

    def test_resource_guard_fails_closed_after_repeated_tree_churn(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            entry = root / "pnpm-temporary-entry"
            entry.write_text("synthetic", encoding="utf-8")
            original_lstat = Path.lstat

            def lstat_with_persistent_race(path):
                if path == entry:
                    raise FileNotFoundError(path)
                return original_lstat(path)

            with patch.object(Path, "lstat", lstat_with_persistent_race):
                with self.assertRaisesRegex(RuntimeError, "changed repeatedly"):
                    enforce_resource_limits(root, min_free_bytes=0, min_free_inodes=0)

    def test_resource_guard_enforces_tree_size_and_free_reserves(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "payload").write_bytes(b"12345")
            with self.assertRaisesRegex(RuntimeError, "disk cap"):
                enforce_resource_limits(root, max_bytes=4, min_free_bytes=0, min_free_inodes=0)
            with patch("worker_release_actual_dependency_guard.os.statvfs",
                       return_value=SimpleNamespace(f_bavail=1, f_frsize=1, f_favail=100)):
                with self.assertRaisesRegex(RuntimeError, "free-space reserve"):
                    enforce_resource_limits(root, max_bytes=100, min_free_bytes=2, min_free_inodes=0)
            with patch("worker_release_actual_dependency_guard.os.statvfs",
                       return_value=SimpleNamespace(f_bavail=100, f_frsize=1, f_favail=1)):
                with self.assertRaisesRegex(RuntimeError, "free-inode reserve"):
                    enforce_resource_limits(root, max_bytes=100, min_free_bytes=0, min_free_inodes=2)

    def test_process_deadline_kills_entire_child_group(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker = root / "child-survived"
            child = f"import time; from pathlib import Path; time.sleep(0.8); Path({str(marker)!r}).touch()"
            parent = f"import subprocess,sys,time; subprocess.Popen([sys.executable, '-c', {child!r}]); time.sleep(10)"
            with patch("worker_release_actual_dependency_guard.enforce_resource_limits", return_value=(0, 0)):
                with self.assertRaisesRegex(RuntimeError, "synthetic deadline timed out"):
                    run_monitored((sys.executable, "-c", parent), cwd=root, env=os.environ.copy(),
                                  timeout=0.15, stage="synthetic deadline", resource_root=root,
                                  poll_seconds=0.02)
            time.sleep(0.9)
            self.assertFalse(marker.exists())

    def test_resource_failure_terminates_child_group(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker = root / "child-survived"
            child = f"import time; from pathlib import Path; time.sleep(0.8); Path({str(marker)!r}).touch()"
            parent = f"import subprocess,sys,time; subprocess.Popen([sys.executable, '-c', {child!r}]); time.sleep(10)"
            calls = 0

            def resource_check(_root):
                nonlocal calls
                calls += 1
                if calls == 1:
                    return 0, 0
                raise RuntimeError("experiment disk cap exceeded")

            with patch("worker_release_actual_dependency_guard.enforce_resource_limits", side_effect=resource_check):
                with self.assertRaisesRegex(RuntimeError, "experiment disk cap"):
                    run_monitored((sys.executable, "-c", parent), cwd=root, env=os.environ.copy(),
                                  timeout=10, stage="synthetic resource cap", resource_root=root,
                                  poll_seconds=0.02)
            time.sleep(0.9)
            self.assertFalse(marker.exists())

    def test_monitored_child_output_is_discarded(self):
        from contextlib import redirect_stderr, redirect_stdout
        from io import StringIO

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            stdout, stderr = StringIO(), StringIO()
            with patch("worker_release_actual_dependency_guard.enforce_resource_limits", return_value=(0, 0)), \
                 redirect_stdout(stdout), redirect_stderr(stderr):
                self.assertEqual(run_monitored(
                    (sys.executable, "-c", "print('synthetic-out'); import sys; print('synthetic-err', file=sys.stderr)"),
                    cwd=root, env=os.environ.copy(), timeout=5, stage="synthetic output",
                    resource_root=root), 0)
            self.assertEqual(stdout.getvalue(), "")
            self.assertEqual(stderr.getvalue(), "")

    def test_offline_web_deploy_uses_modern_injected_frozen_path(self):
        command = experiment.web_deploy_command("/usr/bin/node", "/opt/pnpm/pnpm.cjs", Path("/scratch/store"),
                                                Path("/payload/web"), experiment.policy.TRUSTED_REGISTRY)
        self.assertIn("deploy", command)
        self.assertIn("--frozen-lockfile", command)
        self.assertIn("--package-import-method=copy", command)
        self.assertNotIn("--legacy", command)
        self.assertEqual(command[command.index("--registry") + 1], experiment.policy.TRUSTED_REGISTRY)
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('"PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES": "true"', source)
        self.assertIn('"PNPM_CONFIG_TRUST_LOCKFILE": "false"', source)

    def test_deployed_dependency_must_match_exact_source_lock_version(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deploy = root / "deploy"
            manifest = deploy / "node_modules/@vercel/functions/package.json"
            manifest.parent.mkdir(parents=True)
            manifest.write_text(json.dumps({"name": "@vercel/functions", "version": "3.7.5"}), encoding="utf-8")
            lock = root / "pnpm-lock.yaml"
            lock.write_text(
                "packages:\n  '@vercel/functions@3.7.5':\n    resolution: {integrity: sha512-synthetic}\n"
                "snapshots:\n  '@vercel/functions@3.7.5': {}\n",
                encoding="utf-8",
            )
            self.assertEqual(
                experiment.assert_deployed_package_matches_lock(deploy, lock, "@vercel/functions"), "3.7.5"
            )
            manifest.write_text(json.dumps({"name": "@vercel/functions", "version": "3.10.4"}), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "differs from exact source lock"):
                experiment.assert_deployed_package_matches_lock(deploy, lock, "@vercel/functions")

    def test_pinned_pnpm_finds_action_installed_shell_shim_package(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            launcher = root / "node_modules/.bin/pnpm"
            launcher.parent.mkdir(parents=True)
            launcher.write_text("#!/bin/sh\nexec node ../pnpm/bin/pnpm.cjs \"$@\"\n", encoding="utf-8")
            package = root / "node_modules/.pnpm/pnpm@11.7.0/node_modules/pnpm/bin/pnpm.cjs"
            package.parent.mkdir(parents=True)
            package.write_text("// synthetic pinned pnpm entrypoint\n", encoding="utf-8")
            canonical_package = package.resolve()

            def fake_run(command, **kwargs):
                self.assertEqual(command[1], str(canonical_package))
                return type("Result", (), {"returncode": 0, "stdout": "11.7.0\n"})()

            with patch.object(experiment.shutil, "which", return_value=str(launcher)), \
                 patch.object(experiment.subprocess, "run", side_effect=fake_run):
                self.assertEqual(experiment.pinned_pnpm("/usr/bin/node"), str(canonical_package))

    def test_tree_size_measures_regular_content_and_directories(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "sub").mkdir()
            (root / "sub" / "payload").write_bytes(b"synthetic")
            entries, size = experiment.tree_size(root, max_entries=2, max_bytes=100)
            self.assertEqual(entries, 2)
            self.assertEqual(size, len(b"synthetic"))

    def test_tree_size_rejects_symlink_and_hardlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "target"
            target.write_text("synthetic", encoding="utf-8")
            (root / "escape").symlink_to(target)
            with self.assertRaisesRegex(RuntimeError, "unsafe entry"):
                experiment.tree_size(root, max_entries=10, max_bytes=100)
            (root / "escape").unlink()
            os.link(target, root / "second-link")
            with self.assertRaisesRegex(RuntimeError, "shared file inode"):
                experiment.tree_size(root, max_entries=10, max_bytes=100)

    def test_manual_workflow_is_read_only_and_no_secrets_are_injected(self):
        workflow = SCRIPT.parents[3] / ".github/workflows/worker-release-actual-dependency-experiment.yml"
        text = workflow.read_text(encoding="utf-8")
        self.assertIn("worker_release_actual_dependency_guard.py", text)
        self.assertNotIn("workflow_dispatch", text)
        self.assertIn("pull_request:", text)
        self.assertIn("contents: read", text)
        self.assertIn("persist-credentials: false", text)
        self.assertIn("github.event.pull_request.head.sha || github.sha", text)
        self.assertIn("head.ref == 'codex/automatic-worker-release'", text)
        self.assertIn("vps-workers/tools/nonproduction-worker-release/worker_release_actual_dependency_guard.py", text)
        self.assertNotIn("sudo ", text)
        self.assertNotIn("secrets.", text)
        self.assertNotIn("actions/cache", text)


if __name__ == "__main__":
    unittest.main()
