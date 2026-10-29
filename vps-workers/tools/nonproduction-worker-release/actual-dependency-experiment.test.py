import importlib.util
import errno
import json
import os
import sys
import subprocess
import tempfile
import threading
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
from worker_release_actual_dependency_guard import (
    MonitorFailure,
    _resource_category,
    enforce_resource_limits,
    failure_diagnostic,
    run_monitored,
)
from worker_release_actual_dependency_resources import (
    MAX_TREE_BYTES,
    MAX_TREE_ENTRIES,
    MIN_FREE_BYTES,
    MIN_FREE_INODES,
    ResourceEntryLimitExceeded,
    copy_verified_policy_cache,
    make_policy_cache_seed_read_only,
)
from worker_release_dependency_diagnostics import (
    PnpmStepRejected,
    has_fresh_policy_pass,
    has_policy_pass_marker,
    policy_rejection_category,
    pnpm_failure_category,
    read_diagnostic,
    write_diagnostic,
)
from worker_release_dependency_input_cache import OfflineStoreRejected
from worker_release_dependency_evidence_shape import OFFLINE_STORE_SUBTYPES


class ActualDependencyExperimentTests(unittest.TestCase):
    def test_extracted_tree_size_suite_is_part_of_experiment_gate(self):
        for name in ("actual-dependency-tree-size.test.py",
                     "actual-dependency-payload-diagnostics.test.py"):
            suite = Path(__file__).with_name(name)
            result = subprocess.run(
                (sys.executable, str(suite), "-q"), cwd=suite.parent,
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, timeout=30, check=False,
            )
            self.assertEqual(result.returncode, 0, f"{name} regression suite failed")

    def test_resource_scan_emits_only_allowlisted_filesystem_subtype(self):
        category, subtype = _resource_category(
            RuntimeError("experiment contains an unsupported filesystem entry /private/secret")
        )
        self.assertEqual(category, "filesystem-entry-invalid")
        self.assertIsNone(subtype)

        category, subtype = _resource_category(
            RuntimeError("experiment contains an unsupported filesystem entry")
        )
        self.assertEqual(category, "filesystem-entry-invalid")
        self.assertEqual(subtype, "unsupported-filesystem-entry")
        diagnostic = failure_diagnostic(
            "offline-store-validation",
            MonitorFailure("offline-store-validation", category, resource_check=subtype),
        )
        self.assertEqual(
            diagnostic,
            "experiment failure stage=offline-store-validation category=filesystem-entry-invalid "
            "resource_check=unsupported-filesystem-entry",
        )
        self.assertNotIn("/private/secret", diagnostic)

    def test_offline_store_tree_diagnostic_identifies_only_fixed_failure_kind(self):
        self.assertEqual(
            failure_diagnostic(
                "offline-store-validation",
                RuntimeError("measured tree contains a shared file inode"),
            ),
            "experiment failure stage=offline-store-validation category=filesystem-entry-invalid "
            "tree_check=shared-file-inode",
        )
        self.assertEqual(
            failure_diagnostic(
                "offline-store-validation",
                RuntimeError("measured tree contains an unsafe entry or exceeds entry bound"),
            ),
            "experiment failure stage=offline-store-validation category=filesystem-entry-invalid "
            "tree_check=unsafe-entry-or-entry-limit",
        )
        self.assertEqual(
            failure_diagnostic("offline-store-validation", RuntimeError("private path /secret")),
            "experiment failure stage=offline-store-validation category=runtime-error",
        )

    def test_filesystem_diagnostic_exposes_errno_category_but_not_exception_text(self):
        secret = "/private/runner/path"
        output = failure_diagnostic("policy-preverify", OSError(errno.ENOSPC, secret))
        self.assertEqual(output, "experiment failure stage=policy-preverify category=filesystem-no-space")
        self.assertNotIn(secret, output)

    def test_failure_diagnostics_are_fixed_and_never_echo_error_text(self):
        secret_like = "private-token /home/runner/private/path"
        output = failure_diagnostic("policy-preverify", RuntimeError(secret_like))
        self.assertEqual(output, "experiment failure stage=policy-preverify category=runtime-error")
        self.assertNotIn(secret_like, output)
        self.assertEqual(
            failure_diagnostic("web-deploy", MonitorFailure("web-deploy", "process-exit", 23)),
            "experiment failure stage=web-deploy category=process-exit exit=23",
        )

    def test_early_runtime_failures_have_safe_fixed_categories(self):
        self.assertEqual(
            failure_diagnostic("pnpm-pin", RuntimeError("could not identify exactly one pnpm 11.7.0 package entrypoint")),
            "experiment failure stage=pnpm-pin category=runtime-pin-invalid",
        )

    def test_policy_child_diagnostic_is_closed_and_redacted(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "child-diagnostic.json"
            write_diagnostic(path, "preverify-web-install", "lockfile-trust-downgrade", 1)
            self.assertEqual(
                read_diagnostic(path, owner_uid=os.geteuid()),
                {"stage": "preverify-web-install", "category": "lockfile-trust-downgrade", "exit_code": 1},
            )
            path.unlink()
            write_diagnostic(path, "attacker/path", "private token", 1)
            self.assertEqual(
                read_diagnostic(path, owner_uid=os.geteuid()),
                {"stage": "policy-preverify", "category": "operation-error", "exit_code": 1},
            )

    def test_policy_diagnostic_reader_rejects_symlink_and_unknown_schema(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "target"
            target.write_text('{"stage":"policy-preverify","category":"operation-error","exit_code":1}')
            link = root / "diagnostic"
            link.symlink_to(target)
            self.assertIsNone(read_diagnostic(link, owner_uid=os.geteuid()))
            link.unlink()
            link.write_text('{"stage":"policy-preverify","category":"token=secret","exit_code":1}')
            self.assertIsNone(read_diagnostic(link, owner_uid=os.geteuid()))

    def test_pnpm_failure_classifier_is_closed_and_step_error_does_not_echo_output(self):
        output = "ERR_PNPM_TRUST_DOWNGRADE private-token=must-not-escape"
        self.assertEqual(pnpm_failure_category(output), "lockfile-trust-downgrade")
        error = PnpmStepRejected("preverify-web-install", pnpm_failure_category(output), 17)
        self.assertEqual((error.safe_stage, error.safe_category, error.exit_code),
                         ("preverify-web-install", "lockfile-trust-downgrade", 17))
        self.assertNotIn("private-token", str(error))
        self.assertEqual(
            policy_rejection_category("pnpm preverify web-install did not report lockfile supply-chain policy verification"),
            ("preverify-web-install", "policy-pass-marker-missing"),
        )

    def test_policy_pass_marker_requires_exact_line_after_ansi_normalization(self):
        fresh = "\x1b[32m✓ Lockfile passes supply-chain policies (1 entry in 683ms)\x1b[0m\n"
        recent = "✓ Lockfile passes supply-chain policies (verified 647ms ago)\n"
        stale = "✓ Lockfile passes supply-chain policies (verified 601s ago)\n"
        self.assertTrue(has_policy_pass_marker("", fresh))
        self.assertTrue(has_fresh_policy_pass("", fresh))
        self.assertTrue(has_policy_pass_marker(recent, ""))
        self.assertFalse(has_fresh_policy_pass(recent, ""))
        self.assertFalse(has_policy_pass_marker(stale, ""))
        self.assertFalse(has_fresh_policy_pass(
            "✓ Lockfile passes supply-chain policies (1 entry in 241s)\n", ""))
        self.assertFalse(has_policy_pass_marker("✓ Lockfile passes supply-chain policies (0 entries in 2ms)\n", ""))
        self.assertFalse(has_policy_pass_marker("progress: Lockfile passes supply-chain policies passed", ""))
        self.assertFalse(has_policy_pass_marker("Lockfile passes supply-chain policies for package-x", ""))

    def test_policy_child_main_writes_stage_category_without_raw_pnpm_output(self):
        from contextlib import redirect_stderr
        from io import StringIO

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            diagnostic = root / "child.json"
            error_output = StringIO()
            with patch.object(experiment.policy_cli.policy, "preverify",
                              side_effect=PnpmStepRejected("preverify-worker-install",
                                                           "dependency-resolution", 19,
                                                           {"classification": "malformed", "phrase_lines": 1,
                                                            "recognized_lines": 0, "line_shapes": [{
                                                                "prefix_category": "checkmark",
                                                                "prefix_length_bucket": "2",
                                                                "suffix_category": "other",
                                                                "suffix_length_bucket": "3-8",
                                                                "time_has_minutes": False,
                                                                "time_has_decimal": False,
                                                            }]})), \
                 redirect_stderr(error_output):
                result = experiment.policy_cli.main([
                    "--preverify", "--source", str(root), "--store", str(root),
                    "--cache", str(root), "--pnpm", "/fixed/pnpm", "--node", "/fixed/node",
                    "--diagnostic-file", str(diagnostic),
                ])
            self.assertEqual(result, 1)
            self.assertEqual(read_diagnostic(diagnostic, owner_uid=os.geteuid()), {
                "stage": "preverify-worker-install", "category": "dependency-resolution", "exit_code": 19,
                "evidence": {"classification": "malformed", "phrase_lines": 1,
                             "recognized_lines": 0, "line_shapes": [{
                                 "prefix_category": "checkmark", "prefix_length_bucket": "2",
                                 "suffix_category": "other", "suffix_length_bucket": "3-8",
                                 "time_has_minutes": False, "time_has_decimal": False,
                             }]},
            })
            self.assertIn("category=dependency-resolution", error_output.getvalue())
            self.assertIn("line_shape=checkmark:2/other:3-8:minutes=0:decimal=0", error_output.getvalue())
            self.assertNotIn("dependency-resolution failed", error_output.getvalue())
            self.assertNotIn("/fixed/pnpm", error_output.getvalue())

    def test_policy_child_classifies_os_error_without_echoing_path(self):
        from contextlib import redirect_stderr
        from io import StringIO

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            diagnostic = root / "child.json"
            error_output = StringIO()
            with patch.object(experiment.policy_cli.policy, "preverify",
                              side_effect=OSError(errno.ENOSPC, "full", "/private/path")), \
                 redirect_stderr(error_output):
                result = experiment.policy_cli.main([
                    "--preverify", "--source", str(root), "--store", str(root),
                    "--cache", str(root), "--diagnostic-file", str(diagnostic),
                ])
            self.assertEqual(result, 1)
            self.assertEqual(error_output.getvalue(),
                             "experiment failure stage=policy-preverify category=filesystem-no-space "
                             "errno=28 substage=preverify-filesystem\n")
            self.assertNotIn("/private/path", error_output.getvalue())
            self.assertEqual(read_diagnostic(diagnostic, owner_uid=os.geteuid()), {
                "stage": "policy-preverify", "category": "filesystem-no-space", "exit_code": None,
                "os_error": {"errno": 28, "substage": "preverify-filesystem"},
            })

    def test_policy_child_preserves_only_origin_classified_pnpm_launch_error(self):
        from contextlib import redirect_stderr
        from io import StringIO
        from worker_release_bounded_process import ProcessLaunchError

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            diagnostic = root / "child.json"
            error_output = StringIO()
            with patch.object(experiment.policy_cli.policy, "preverify",
                              side_effect=ProcessLaunchError(2)), redirect_stderr(error_output):
                result = experiment.policy_cli.main([
                    "--preverify", "--source", str(root), "--store", str(root),
                    "--cache", str(root), "--diagnostic-file", str(diagnostic),
                ])
            self.assertEqual(result, 1)
            self.assertEqual(error_output.getvalue(),
                             "experiment failure stage=policy-preverify category=filesystem-missing "
                             "errno=2 substage=pnpm-launch\n")
            self.assertEqual(read_diagnostic(diagnostic, owner_uid=os.geteuid()), {
                "stage": "policy-preverify", "category": "filesystem-missing", "exit_code": None,
                "os_error": {"errno": 2, "substage": "pnpm-launch"},
            })

    def test_supervisor_promotes_child_diagnostic_over_generic_process_exit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            diagnostic = root / "child.json"
            write_diagnostic(diagnostic, "preverify-worker-install", "filesystem-error", None,
                             os_error={"errno": 28, "substage": "preverify-filesystem"})
            with patch.object(experiment, "run",
                              side_effect=MonitorFailure("policy-preverify", "process-exit", 1)):
                with self.assertRaises(MonitorFailure) as raised:
                    experiment.run_policy_preverify(
                        ("synthetic",), cwd=root, env={}, timeout=10, resource_root=root,
                        diagnostic_path=diagnostic,
                    )
            self.assertEqual((raised.exception.stage, raised.exception.category,
                              raised.exception.exit_code),
                             ("preverify-worker-install", "filesystem-error", 1))
            self.assertEqual(raised.exception.os_error,
                             {"errno": 28, "substage": "preverify-filesystem"})
            self.assertIn("errno=28 substage=preverify-filesystem",
                          failure_diagnostic("policy-preverify", raised.exception))
        self.assertEqual(
            failure_diagnostic("checkout-identity", RuntimeError("checkout does not match dispatched SHA")),
            "experiment failure stage=checkout-identity category=checkout-mismatch",
        )
        self.assertEqual(
            failure_diagnostic("receipt-validation",
                               RuntimeError("pnpm policy verification receipt metadata cache changed")),
            "experiment failure stage=receipt-validation category=policy-receipt-cache-changed",
        )

    def test_offline_store_diagnostics_emit_only_closed_subtype(self):
        for subtype in sorted(OFFLINE_STORE_SUBTYPES):
            output = failure_diagnostic(
                "offline-store-validation",
                OfflineStoreRejected("private path and package name", subtype),
            )
            self.assertEqual(output,
                             "experiment failure stage=offline-store-validation "
                             f"category=filesystem-entry-invalid store_check={subtype}")
            self.assertNotIn("private path", output)
            self.assertNotIn("package name", output)

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

    def test_live_resource_sample_tolerates_continuous_entry_churn_then_strict_scan_passes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            stop = threading.Event()
            started = threading.Event()

            def churn():
                index = 0
                started.set()
                while not stop.is_set():
                    transient = root / f"transient-{index % 8}"
                    try:
                        transient.write_bytes(b"x" * 128)
                        transient.unlink()
                    except FileNotFoundError:
                        pass
                    index += 1

            worker = threading.Thread(target=churn)
            worker.start()
            try:
                self.assertTrue(started.wait(1))
                for _ in range(25):
                    enforce_resource_limits(root, live_sample=True,
                                             min_free_bytes=0, min_free_inodes=0)
                (root / "stable").write_bytes(b"stable")
            finally:
                stop.set()
                worker.join(timeout=2)
            self.assertFalse(worker.is_alive())
            count, size = enforce_resource_limits(root, min_free_bytes=0, min_free_inodes=0)
            self.assertEqual(count, 1)
            self.assertEqual(size, len(b"stable"))

    def test_live_sample_does_not_tolerate_resource_root_disappearance(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "resource-root"
            root.mkdir()
            original_lstat = Path.lstat

            def remove_root_after_initial_check(path):
                if path == root:
                    root.rmdir()
                    raise FileNotFoundError(path)
                return original_lstat(path)

            with patch.object(Path, "lstat", remove_root_after_initial_check):
                with self.assertRaisesRegex(RuntimeError, "resource root disappeared"):
                    enforce_resource_limits(root, live_sample=True,
                                             min_free_bytes=0, min_free_inodes=0)

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

    def test_entry_cap_reports_bounded_observed_count(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for index in range(3):
                (root / f"entry-{index}").touch()
            with self.assertRaises(ResourceEntryLimitExceeded) as raised:
                enforce_resource_limits(root, max_entries=2, min_free_bytes=0, min_free_inodes=0)
            self.assertEqual((raised.exception.entries_seen, raised.exception.limit), (3, 2))
            self.assertEqual(
                failure_diagnostic("resource-scan", raised.exception),
                "experiment failure stage=resource-scan category=entry-cap "
                "entries_seen=3 entry_limit=2",
            )

    def test_monitored_entry_cap_preserves_only_bounded_count_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            failure = ResourceEntryLimitExceeded(500_001, 500_000)
            with patch("worker_release_actual_dependency_guard.enforce_resource_limits",
                       side_effect=failure), patch("worker_release_actual_dependency_guard.subprocess.Popen") as popen:
                with self.assertRaises(MonitorFailure) as raised:
                    run_monitored(("synthetic",), cwd=root, env={}, timeout=10,
                                  stage="policy-preverify", resource_root=root)
            popen.assert_not_called()
            self.assertEqual(failure_diagnostic("experiment", raised.exception),
                             "experiment failure stage=policy-preverify category=entry-cap "
                             "entries_seen=500001 entry_limit=500000")

    def test_process_deadline_kills_entire_child_group(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker = root / "child-survived"
            child = f"import time; from pathlib import Path; time.sleep(0.8); Path({str(marker)!r}).touch()"
            parent = f"import subprocess,sys,time; subprocess.Popen([sys.executable, '-c', {child!r}]); time.sleep(10)"
            with patch("worker_release_actual_dependency_guard.enforce_resource_limits", return_value=(0, 0)):
                with self.assertRaises(MonitorFailure) as raised:
                    run_monitored((sys.executable, "-c", parent), cwd=root, env=os.environ.copy(),
                                  timeout=0.15, stage="synthetic deadline", resource_root=root,
                                  poll_seconds=0.02)
                self.assertEqual(raised.exception.category, "deadline")
            time.sleep(0.9)
            self.assertFalse(marker.exists())

    def test_resource_failure_terminates_child_group(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker = root / "child-survived"
            child = f"import time; from pathlib import Path; time.sleep(0.8); Path({str(marker)!r}).touch()"
            parent = f"import subprocess,sys,time; subprocess.Popen([sys.executable, '-c', {child!r}]); time.sleep(10)"
            calls = 0

            def resource_check(_root, **_kwargs):
                nonlocal calls
                calls += 1
                if calls == 1:
                    return 0, 0
                raise RuntimeError("experiment disk cap exceeded")

            with patch("worker_release_actual_dependency_guard.enforce_resource_limits", side_effect=resource_check):
                with self.assertRaises(MonitorFailure) as raised:
                    run_monitored((sys.executable, "-c", parent), cwd=root, env=os.environ.copy(),
                                  timeout=10, stage="synthetic resource cap", resource_root=root,
                                  poll_seconds=0.02)
                self.assertEqual(raised.exception.category, "disk-cap")
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
        self.assertIn('"PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES": "false"', source)
        self.assertIn('env={**offline_env, "PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES": "true"}', source)
        self.assertIn('"PNPM_CONFIG_TRUST_LOCKFILE": "false"', source)

    def test_large_measurement_caps_are_scoped_to_disposable_experiment(self):
        self.assertEqual(experiment.policy.MAX_CACHE_BYTES, 256 * 1024 * 1024)
        self.assertEqual(experiment.policy.MAX_EXPERIMENT_CACHE_BYTES, 4 * 1024 * 1024 * 1024)
        self.assertEqual(experiment.EXPERIMENT_CACHE_BYTES, 4 * 1024 * 1024 * 1024)
        self.assertEqual(experiment.EXPERIMENT_STORE_BYTES, 4 * 1024 * 1024 * 1024)
        self.assertEqual(MAX_TREE_BYTES, 12 * 1024 * 1024 * 1024)
        self.assertEqual(MAX_TREE_ENTRIES, 1_000_000)
        self.assertEqual(MIN_FREE_BYTES, 2 * 1024 * 1024 * 1024)
        self.assertEqual(MIN_FREE_INODES, 20_000)
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertEqual(source.count("cache_max_bytes=EXPERIMENT_CACHE_BYTES"), 2)
        self.assertIn('"--experiment-cache-max-bytes", str(EXPERIMENT_CACHE_BYTES)', source)
        self.assertEqual(source.count("validate_receipt(source, cache"), 2)
        self.assertIn("make_policy_cache_seed_read_only(cache)", source)
        self.assertIn('offline_env["PNPM_CONFIG_CACHE_DIR"] = str(build_cache)', source)
        self.assertIn('"monitored_scratch": MAX_TREE_BYTES', source)
        self.assertIn('"payload": EXPERIMENT_PAYLOAD_BYTES', source)
        self.assertEqual(experiment.policy.make_receipt.__kwdefaults__["cache_max_bytes"],
                         256 * 1024 * 1024)
        production_builder = (SCRIPT.parents[3] / "vps-workers/bin/worker_release_dependency_builder.py")
        builder_source = production_builder.read_text(encoding="utf-8")
        self.assertIn("max_entries=MAX_CACHE_ENTRIES, max_bytes=MAX_CACHE_BYTES", builder_source)

    def test_payload_expansion_uses_only_the_disposable_12_gib_monitor(self):
        production_payload_limit = experiment.artifacts.MAX_PAYLOAD_BYTES
        production_materialized_limit = experiment.installer.MAX_MATERIALIZED_BYTES
        self.assertEqual(experiment.EXPERIMENT_PAYLOAD_BYTES, MAX_TREE_BYTES)
        self.assertEqual(production_payload_limit, 1024 * 1024 * 1024)
        self.assertEqual(production_materialized_limit, 1024 * 1024 * 1024)
        smoke = SimpleNamespace(MAX_BYTES=1024 * 1024 * 1024)
        with patch.object(experiment.artifacts, "MAX_PAYLOAD_BYTES", production_payload_limit), \
             patch.object(experiment.installer, "MAX_MATERIALIZED_BYTES", production_materialized_limit):
            experiment.configure_experiment_payload_limits(smoke, materialization_limit=3 * 1024 * 1024 * 1024)
            self.assertEqual(experiment.artifacts.MAX_PAYLOAD_BYTES, MAX_TREE_BYTES)
            self.assertEqual(experiment.installer.MAX_MATERIALIZED_BYTES, 3 * 1024 * 1024 * 1024)
            self.assertEqual(smoke.MAX_BYTES, MAX_TREE_BYTES)
            with self.assertRaisesRegex(RuntimeError, "materialization headroom is invalid"):
                experiment.configure_experiment_payload_limits(materialization_limit=MAX_TREE_BYTES + 1)
        self.assertEqual(experiment.artifacts.MAX_PAYLOAD_BYTES, production_payload_limit)
        self.assertEqual(experiment.installer.MAX_MATERIALIZED_BYTES, production_materialized_limit)

    def test_reclaim_experiment_tree_removes_only_owned_direct_scratch_children(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cache = root / "pnpm-cache"
            cache.mkdir()
            outside = root / "outside"
            outside.mkdir()
            marker = outside / "preserve"
            marker.write_text("outside", encoding="utf-8")
            (cache / "linked").symlink_to(outside, target_is_directory=True)
            (cache / "nested").mkdir()
            (cache / "nested" / "readonly").write_text("temporary", encoding="utf-8")
            (cache / "nested" / "readonly").chmod(0o400)
            (cache / "nested").chmod(0o500)
            cache.chmod(0o500)
            experiment.reclaim_experiment_tree(cache, scratch_root=root)
            self.assertFalse(cache.exists())
            self.assertEqual(marker.read_text(encoding="utf-8"), "outside")
            with self.assertRaisesRegex(RuntimeError, "target is invalid"):
                experiment.reclaim_experiment_tree(outside, scratch_root=root)

    def test_payload_phases_reclaim_large_inputs_before_materialization(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("os.rename(worker_modules, worker_payload)", source)
        self.assertNotIn("shutil.copytree(worker_modules", source)
        self.assertIn("(store, cache, build_cache, source, home)", source)
        self.assertIn("reclaim_experiment_tree(output, scratch_root=base)", source)
        self.assertLess(source.index("reclaim_experiment_tree(output, scratch_root=base)"),
                        source.index("stage = \"payload-materialization\""))

    def test_verified_seed_is_separate_from_mutable_offline_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            (source / ".baci-source-sha").write_text("a" * 40 + "\n", encoding="ascii")
            for relative in experiment.policy.LOCKFILES:
                path = source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("lockVersion: '9.0'\nsettings:\n  injectWorkspacePackages: false\n",
                                encoding="utf-8")
            for relative in experiment.policy.POLICY_FILES:
                path = source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("minimumReleaseAge: 1440\ntrustPolicy: no-downgrade\n",
                                encoding="utf-8")
            seed = root / "verified-seed"
            seed.mkdir(mode=0o700)
            (seed / "metadata.json").write_text("verified registry metadata", encoding="utf-8")
            receipt_path = root / "receipt.json"
            receipt_path.write_text(json.dumps(experiment.policy.make_receipt(
                source, seed, experiment.policy.EXPECTED_PNPM,
                cache_max_bytes=experiment.EXPERIMENT_CACHE_BYTES)), encoding="utf-8")
            receipt_path.chmod(0o400)

            make_policy_cache_seed_read_only(seed)
            mutable = root / "mutable-build-cache"
            seed_digest = copy_verified_policy_cache(
                seed, mutable, max_entries=experiment.policy.MAX_CACHE_ENTRIES,
                max_bytes=experiment.EXPERIMENT_CACHE_BYTES,
            )
            self.assertEqual(seed_digest, experiment.policy._hash_tree(seed,
                                                                        max_bytes=experiment.EXPERIMENT_CACHE_BYTES))
            self.assertEqual((seed / "metadata.json").stat().st_mode & 0o222, 0)
            self.assertNotEqual((mutable / "metadata.json").stat().st_mode & 0o200, 0)
            (mutable / "metadata.json").write_text("pnpm offline mutation", encoding="utf-8")
            experiment.policy.validate_receipt(
                source, seed, receipt_path, expected_sha="a" * 40,
                cache_max_bytes=experiment.EXPERIMENT_CACHE_BYTES,
            )
            with self.assertRaisesRegex(experiment.policy.BuilderRejected, "metadata cache changed"):
                experiment.policy.validate_receipt(
                    source, mutable, receipt_path, expected_sha="a" * 40,
                    cache_max_bytes=experiment.EXPERIMENT_CACHE_BYTES,
                )

    def test_seed_readonly_rejects_hardlink_before_chmod_alias(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            seed = root / "seed"
            seed.mkdir(mode=0o700)
            nested = seed / "nested"
            nested.mkdir(mode=0o700)
            file = nested / "metadata.json"
            file.write_text("metadata", encoding="utf-8")
            alias = root / "outside-alias"
            os.link(file, alias)
            original_mode = file.stat().st_mode & 0o777

            with self.assertRaisesRegex(RuntimeError, "aliased file inode"):
                make_policy_cache_seed_read_only(seed)

            self.assertEqual(file.stat().st_mode & 0o777, original_mode)
            self.assertEqual(alias.stat().st_mode & 0o777, original_mode)

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
                self.assertEqual(experiment.pinned_pnpm("/usr/bin/node", experiment.policy.EXPECTED_PNPM),
                                 str(canonical_package))

    def test_manual_workflow_is_read_only_and_no_secrets_are_injected(self):
        workflow = SCRIPT.parents[3] / ".github/workflows/worker-release-actual-dependency-experiment.yml"
        text = workflow.read_text(encoding="utf-8")
        self.assertIn("worker_release_actual_dependency_guard.py", text)
        self.assertIn("worker_release_actual_dependency_runtime.py", text)
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
