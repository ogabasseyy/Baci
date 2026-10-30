"""Bounded contract tests for the disconnected materialized-runtime verifier."""
from __future__ import annotations

import os
import grp
import errno
import io
import shutil
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

from worker_release_lifecycle import AuthenticatedRun
from worker_release_runtime_verifier import (
    RuntimeVerificationRejected,
    RuntimeVerificationQuiescenceUnproven,
    validate_runtime_receipt,
    verify_materialized_candidate,
)
from worker_release_runtime_verifier_test_support import (
    classify_namespace_failure, cleanup_candidate_after_verifier,
    emit_namespace_failure_diagnostic,
)
from worker_release_runtime_diagnostics import BoundedLauncherStderr, summarize_unit_exit

SHA = "a" * 40
ARCHIVE = "b" * 64


def identity() -> AuthenticatedRun:
    return AuthenticatedRun(repository="ogabasseyy/Baci",
                            workflow=".github/workflows/production-release.yml",
                            ref="refs/heads/main", sha=SHA, run_id="234",
                            run_attempt=1, job_id="567", status="in_progress")


def freeze(path: Path, gid: int) -> None:
    for current, directories, files in os.walk(path, topdown=False, followlinks=False):
        for name in files:
            child = Path(current) / name
            info = child.lstat()
            os.chown(child, os.geteuid(), gid)
            os.chmod(child, 0o550 if info.st_mode & 0o111 else 0o440)
        for name in directories:
            child = Path(current) / name
            os.chown(child, os.geteuid(), gid)
            os.chmod(child, 0o550)
    os.chown(path, os.geteuid(), gid)
    os.chmod(path, 0o550)


class MaterializedRuntimeVerifierTests(unittest.TestCase):
    def test_unit_failure_summary_is_closed_and_redacts_cgroup(self):
        summary = summarize_unit_exit({
            "Result": "success", "ExecMainCode": "1", "ExecMainStatus": "1",
            "MainPID": "0", "ControlGroup": "/system.slice/private-unexpected.service",
        }, expected_cgroup="/system.slice/fixed.service")
        self.assertEqual(summary,
                         "result=success,code=exited,status=1,main_pid=zero,cgroup=system-slice-other")
        self.assertNotIn("private-unexpected", summary)

    def test_linux_verifier_ci_uses_the_production_pinned_node_binary(self):
        workflow = (Path(__file__).resolve().parents[2] / ".github" / "workflows"
                    / "worker-release-runtime-verifier-tests.yml").read_text()
        self.assertIn("node-version: 24.22.2", workflow)
        self.assertIn("node_version=\"$(node --version)\"", workflow)
        self.assertIn("sudo install -o root -g root -m 0755 \"$node_binary\" /usr/bin/node",
                      workflow)
        self.assertIn("$(/usr/bin/node --version)\" != \"$node_version\"", workflow)
        self.assertNotIn("apt-get install --yes nodejs", workflow)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=Path.home())
        self.parent = Path(self.temporary.name) / "releases"
        self.parent.mkdir(mode=0o700)
        self.releases_root_patch = patch("worker_release_candidate_pin.RELEASES_ROOT", self.parent)
        self.releases_root_patch.start()
        self.candidate = self.parent / f".{SHA}.incoming.{('c' * 32)}"
        self.candidate.mkdir(mode=0o700)
        (self.candidate / "apps" / "web" / "node_modules" / ".bin").mkdir(parents=True)
        (self.candidate / "vps-workers" / "bin").mkdir(parents=True)
        (self.candidate / "node_modules" / "dotenv").mkdir(parents=True)
        tsx = self.candidate / "apps" / "web" / "node_modules" / ".bin" / "tsx"
        tsx.write_text("#!/bin/sh\nprintf 'tsx 1.2.3\\n'\n")
        tsx.chmod(0o755)
        (self.candidate / "vps-workers" / "bin" / "worker.mjs").write_text("export {};\n")
        (self.candidate / "node_modules" / "dotenv" / "package.json").write_text(
            '{"name":"dotenv","main":"index.js"}\n')
        (self.candidate / "node_modules" / "dotenv" / "index.js").write_text(
            "exports.config = function config() { return {}; };\n")
        (self.candidate / "node_modules" / "@supabase" / "supabase-js").mkdir(parents=True)
        (self.candidate / "node_modules" / "@supabase" / "supabase-js" / "package.json").write_text(
            '{"name":"@supabase/supabase-js","type":"module","exports":"./index.js"}\n')
        (self.candidate / "node_modules" / "@supabase" / "supabase-js" / "index.js").write_text(
            "export function createClient() { return { from() {} }; }\n")
        (self.candidate / "node_modules" / "expo-server-sdk").mkdir()
        (self.candidate / "node_modules" / "expo-server-sdk" / "package.json").write_text(
            '{"name":"expo-server-sdk","type":"module","exports":"./index.js"}\n')
        (self.candidate / "node_modules" / "expo-server-sdk" / "index.js").write_text(
            "export class Expo { sendPushNotificationsAsync() {} }\n")
        freeze(self.candidate, os.getgid())
        actual_systemd_smoke = (
            self._testMethodName == "test_actual_linux_sandbox_smoke_produces_receipt"
            and os.geteuid() == 0 and sys.platform.startswith("linux")
            and os.environ.get("WORKER_RELEASE_RUNTIME_REQUIRE_SYSTEMD") == "1"
        )
        self.real_systemd = actual_systemd_smoke
        from worker_release_runtime_acl import verifier_gid, verifier_uid
        self.acl_gid = verifier_gid() if actual_systemd_smoke else (
            60000 if os.getgid() != 60000 else 60001)
        self.runtime_uid = verifier_uid() if actual_systemd_smoke else 61000
        self.acl_patches = []
        if not actual_systemd_smoke:
            from worker_release_runtime_acl import expected_access_acl
            def fake_getxattr(target, attribute, *args, **kwargs):
                if attribute == "system.posix_acl_access":
                    info = os.fstat(target) if isinstance(target, int) else os.stat(target)
                    return expected_access_acl(info.st_mode, self.acl_gid)
                if attribute == "system.posix_acl_default":
                    raise OSError(errno.ENODATA, "no default ACL")
                raise OSError(errno.ENODATA, "not present")
            for target in ("worker_release_runtime_acl.verifier_gid",
                           "worker_release_runtime_verifier.verifier_gid",
                           "worker_release_runtime_receipt.verifier_gid"):
                item = patch(target, return_value=self.acl_gid)
                item.start()
                self.acl_patches.append(item)
            for target in ("worker_release_runtime_acl.verifier_uid",
                           "worker_release_runtime_verifier.verifier_uid",
                           "worker_release_runtime_receipt.verifier_uid"):
                item = patch(target, return_value=self.runtime_uid)
                item.start()
                self.acl_patches.append(item)
            item = patch("worker_release_runtime_verifier.grant_candidate_acl",
                         side_effect=lambda *_a, **kwargs: kwargs["gid"])
            item.start()
            self.acl_patches.append(item)
            for target, value in (("worker_release_runtime_acl.os.getxattr", fake_getxattr),
                                  ("worker_release_runtime_acl.os.setxattr", lambda *_a, **_k: None)):
                item = patch(target, side_effect=value, create=True)
                item.start()
                self.acl_patches.append(item)

    def tearDown(self):
        for item in reversed(self.acl_patches):
            item.stop()
        self.releases_root_patch.stop()
        def make_writable(path: Path):
            for current, directories, _files in os.walk(path, topdown=True, followlinks=False):
                os.chmod(current, 0o700)
                for name in directories:
                    child = Path(current) / name
                    if not child.is_symlink():
                        os.chmod(child, 0o700)
        make_writable(Path(self.temporary.name))
        self.temporary.cleanup()

    @patch("worker_release_runtime_verifier._run_fixed_smokes",
           return_value=("web_tsx_version", "worker_production_dependency_imports"))
    def test_receipt_is_bound_to_exact_run_archive_inode_and_tree(self, _smokes):
        receipt = verify_materialized_candidate(
            self.candidate, identity(), archive_sha256=ARCHIVE,
            owner_uid=os.geteuid(), owner_gid=os.getgid())
        self.assertEqual(receipt.verifier_version, "materialized-worker-runtime-v3-dedicated-uid-acl")
        self.assertEqual(receipt.access_policy, "candidate-posix-acl-readonly-v1")
        self.assertEqual(receipt.verifier_gid, self.acl_gid)
        self.assertEqual(receipt.verifier_uid, self.runtime_uid)
        self.assertTrue(validate_runtime_receipt(
            receipt, self.candidate, identity(), ARCHIVE,
            owner_uid=os.geteuid(), owner_gid=os.getgid()))
        self.assertFalse(validate_runtime_receipt(
            receipt, self.candidate, identity(), "c" * 64,
            owner_uid=os.geteuid(), owner_gid=os.getgid()))
        other = AuthenticatedRun(**(identity().__dict__ | {"run_attempt": 2}))
        self.assertFalse(validate_runtime_receipt(
            receipt, self.candidate, other, ARCHIVE,
            owner_uid=os.geteuid(), owner_gid=os.getgid()))
        self.assertFalse(validate_runtime_receipt(
            {"runtime_ready": True}, self.candidate, identity(), ARCHIVE,
            owner_uid=os.geteuid(), owner_gid=os.getgid()))

    @patch("worker_release_runtime_verifier._run_fixed_smokes",
           return_value=("web_tsx_version", "worker_production_dependency_imports"))
    def test_candidate_mutation_after_receipt_invalidates_it(self, _smokes):
        receipt = verify_materialized_candidate(
            self.candidate, identity(), archive_sha256=ARCHIVE,
            owner_uid=os.geteuid(), owner_gid=os.getgid())
        changed = self.candidate / "vps-workers" / "bin" / "worker.mjs"
        os.chmod(changed, 0o600)
        changed.write_text("export const changed = true;\n")
        freeze(self.candidate, os.getgid())
        self.assertFalse(validate_runtime_receipt(
            receipt, self.candidate, identity(), ARCHIVE,
            owner_uid=os.geteuid(), owner_gid=os.getgid()))

    @patch("worker_release_runtime_verifier._run_fixed_smokes",
           return_value=("web_tsx_version", "worker_production_dependency_imports"))
    def test_candidate_links_and_unbound_names_fail_before_smoke(self, smokes):
        target = self.candidate / "node_modules" / "dotenv" / "index.js"
        os.chmod(target.parent, 0o700)
        os.chmod(target, 0o600)
        target.unlink()
        target.symlink_to("/etc/passwd")
        with self.assertRaises(RuntimeVerificationRejected):
            verify_materialized_candidate(
                self.candidate, identity(), archive_sha256=ARCHIVE,
                owner_uid=os.geteuid(), owner_gid=os.getgid())
        smokes.assert_not_called()
        renamed = self.parent / ("." + "d" * 40 + ".incoming." + "e" * 32)
        self.candidate.rename(renamed)
        with self.assertRaises(RuntimeVerificationRejected):
            verify_materialized_candidate(
                renamed, identity(), archive_sha256=ARCHIVE,
                owner_uid=os.geteuid(), owner_gid=os.getgid())

    @patch("worker_release_runtime_smoke.create_runtime_view")
    @patch("worker_release_runtime_verifier._execute_fixed_unit")
    def test_fixed_executor_has_no_credentials_network_or_unbounded_output(self, execute, create_view):
        from worker_release_runtime_verifier import _run_fixed_smokes
        class FakeView:
            def __init__(self, unit, **_kwargs):
                self.path = self.parent / unit
                self.candidate_path = self.path / "candidate"
            def verify_target(self): pass
            def cleanup(self): pass
            def abandon(self): pass
        FakeView.parent = self.parent
        create_view.side_effect = FakeView
        with patch("worker_release_runtime_verifier.sys.platform", "linux"), \
                patch("worker_release_runtime_verifier.os.geteuid", return_value=0), \
                patch("worker_release_runtime_verifier.SYSTEMD_RUN", "/usr/bin/true"), \
                patch("worker_release_runtime_verifier.SYSTEMCTL", "/usr/bin/true"):
            checks = _run_fixed_smokes(self.candidate, "f" * 64)
        self.assertEqual(checks, ("web_tsx_version", "worker_production_dependency_imports"))
        self.assertEqual(execute.call_count, 4)
        all_args = ""
        for call in execute.call_args_list:
            unit, _cwd, command, properties, _index = call.args
            self.assertRegex(unit, r"^baci-worker-runtime-[0-9a-f]{16}-[0-9a-f]{12}-[01]\.service$")
            self.assertEqual(properties["PrivateNetwork"], "yes")
            self.assertEqual(properties["ProtectSystem"], "strict")
            self.assertEqual(properties["ProtectProc"], "invisible")
            self.assertEqual(properties["PrivateTmp"], "no")
            self.assertEqual(properties["TemporaryFileSystem"], "/run:ro")
            self.assertEqual(properties["InaccessiblePaths"], "/tmp /var/tmp /dev/shm /etc /srv /opt /usr/local /var/log /var/cache /var/spool /var/backups")
            inaccessible = properties["InaccessiblePaths"].split()
            self.assertEqual(len(inaccessible), len(set(inaccessible)))
            self.assertNotIn("/root", inaccessible)  # supplied by ProtectHome
            self.assertNotIn("/home", inaccessible)  # supplied by ProtectHome
            if "--input-type=module" in command:
                smoke_script = command[-1]
                self.assertIn("import fs from 'node:fs'", smoke_script)
                self.assertNotIn("spawnSync", smoke_script)
                self.assertNotIn("Promise.race", smoke_script)
                package = {2: "'dotenv'", 3: "'@supabase/supabase-js'",
                           4: "'expo-server-sdk'"}[_index]
                if _index == 2:
                    self.assertIn("createRequire(import.meta.url)('dotenv')", smoke_script)
                    self.assertNotIn("await import('dotenv')", smoke_script)
                else:
                    self.assertIn(f"await import({package})", smoke_script)
                for other_package in {"'dotenv'", "'@supabase/supabase-js'",
                                      "'expo-server-sdk'"} - {package}:
                    self.assertNotIn(f"await import({other_package})", smoke_script)
            self.assertNotIn("/var/run", inaccessible)  # aliases /run on Ubuntu
            self.assertNotIn("/run", inaccessible)  # isolated by a read-only empty tmpfs
            self.assertIn("/srv", inaccessible)  # keep the worker tree masked
            self.assertEqual(properties["SupplementaryGroups"], "")
            self.assertEqual(properties["Group"], str(self.acl_gid))
            self.assertEqual(properties["BindReadOnlyPaths"],
                             f"{self.candidate}:{self.parent / unit / 'candidate'}")
            self.assertEqual(properties["RuntimeMaxSec"], "35" if _index == 1 else "10")
            self.assertEqual(properties["LimitFSIZE"], "4096")
            self.assertIn("-i", command)
            all_args += " ".join(command)
        self.assertNotIn("DATABASE_URL", all_args)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", all_args)
        self.assertIn("@supabase/supabase-js", all_args)
        self.assertIn("expo-server-sdk", all_args)
        self.assertIn("synthetic-smoke-key", all_args)
        self.assertIn("synthetic-smoke-token", all_args)

    @unittest.skipUnless(shutil.which("node"), "Node is required for loader-exit regression")
    def test_unsettled_module_tla_isolated_to_exact_package_check(self):
        """Node's loader exit 13 is scoped to the systemd unit for one package."""
        package = self.parent / "node_modules" / "tla-probe"
        package.mkdir(parents=True)
        (package / "package.json").write_text(
            '{"name":"tla-probe","type":"module","exports":"./index.js"}\n')
        (package / "index.js").write_text(
            "await new Promise(() => {}); export const loaded = true;\n")
        result = __import__("subprocess").run(
            (shutil.which("node"), "--input-type=module", "-e", "await import('tla-probe')"),
            cwd=self.parent, env={"PATH": "/usr/bin:/bin", "NODE_ENV": "production"},
            stdin=__import__("subprocess").DEVNULL,
            stdout=__import__("subprocess").DEVNULL,
            stderr=__import__("subprocess").DEVNULL, timeout=12, check=False)
        self.assertEqual(result.returncode, 13)

    @unittest.skipUnless(shutil.which("node"), "Node is required for generated smoke execution")
    def test_generated_smoke_loads_each_fixed_package_before_path_assertions(self):
        from worker_release_runtime_smoke import run_fixed_smokes

        class FakeView:
            def __init__(self, unit, **_kwargs):
                self.candidate_path = self.candidate
            def verify_target(self): pass
            def cleanup(self): pass
            def abandon(self): pass
        FakeView.candidate = self.candidate
        captured = []

        def execute(_unit, cwd, command, _properties, index):
            if index > 1:
                captured.append((cwd, command))
                # /etc exists on the developer host. The fixed script returns
                # 4 only after this package's API check has completed.
                result = __import__("subprocess").run(
                    (shutil.which("node"), "--input-type=module", "-e", command[-1]),
                    cwd=cwd, env={"PATH": "/usr/bin:/bin", "NODE_ENV": "production"},
                    stdin=__import__("subprocess").DEVNULL,
                    stdout=__import__("subprocess").DEVNULL,
                    stderr=__import__("subprocess").DEVNULL, timeout=30, check=False)
                self.assertEqual(result.returncode, 4, msg=f"fixed package smoke index {index}")

        with patch("worker_release_runtime_smoke.create_runtime_view", side_effect=FakeView), \
                patch("worker_release_runtime_smoke.sys.platform", "linux"), \
                patch("worker_release_runtime_smoke.os.geteuid", return_value=0), \
                patch("pathlib.Path.is_file", return_value=True):
            run_fixed_smokes(self.candidate, "f" * 64, execute_unit=execute,
                             unit_name=lambda *_: "baci-worker-runtime-" + "f" * 16 + "-" + "a" * 12 + "-1.service",
                             rejected=RuntimeVerificationRejected, max_seconds=35,
                             max_output_bytes=4096, systemd_run="/usr/bin/systemd-run",
                             systemctl="/usr/bin/systemctl", runtime_uid=61000,
                             runtime_gid=self.acl_gid)
        self.assertEqual(len(captured), 3)

    @patch("worker_release_runtime_smoke.create_runtime_view")
    @patch("worker_release_runtime_verifier._execute_fixed_unit")
    def test_smoke_rejects_group_mismatch_before_creating_view(self, execute, create_view):
        from worker_release_runtime_verifier import _run_fixed_smokes
        with patch("worker_release_runtime_verifier.sys.platform", "linux"), \
                patch("worker_release_runtime_verifier.os.geteuid", return_value=0), \
                patch("worker_release_runtime_verifier.SYSTEMD_RUN", "/usr/bin/true"), \
                patch("worker_release_runtime_verifier.SYSTEMCTL", "/usr/bin/true"):
            with self.assertRaisesRegex(RuntimeVerificationRejected, "group is invalid"):
                _run_fixed_smokes(self.candidate, "f" * 64, 0)
        create_view.assert_not_called()
        execute.assert_not_called()

    def test_launcher_stderr_is_reduced_to_fixed_category(self):
        capture = BoundedLauncherStderr(io.BytesIO(
            b"Unknown assignment 'MemoryMax' for unit; private-token=must-not-escape"))
        self.assertEqual(capture.category(), "unit-property-rejected")
        self.assertEqual(capture.property_hint(("CPUQuota", "MemoryMax")), "MemoryMax")
        self.assertIsNone(capture.property_hint(("CPUQuota",)))
        self.assertNotIn("private-token", capture.category())
        self.assertNotIn("MemoryMax", capture.category())

    @patch("worker_release_runtime_verifier._run_fixed_smokes",
           side_effect=RuntimeVerificationRejected("fixed runtime check failed"))
    def test_failed_smoke_never_returns_receipt(self, _smokes):
        with self.assertRaises(RuntimeVerificationRejected):
            verify_materialized_candidate(
                self.candidate, identity(), archive_sha256=ARCHIVE,
                owner_uid=os.geteuid(), owner_gid=os.getgid())

    def test_namespace_diagnostic_is_fixed_category_without_journal_text(self):
        category = classify_namespace_failure(
            "Failed to set up mount namespacing: /srv/baci-workers/releases/private-sha: "
            "permission denied token=should-not-appear")
        self.assertEqual(category, "namespace-path-worker-root-mask")
        self.assertNotIn("private-sha", category)
        self.assertNotIn("should-not-appear", category)
        self.assertEqual(classify_namespace_failure("Failed at step NAMESPACE spawning /usr/bin/node"),
                         "namespace-path-unclassified")
        self.assertEqual(classify_namespace_failure("unit loaded, no namespace error"),
                         "namespace-message-unclassified")

    def test_namespace_diagnostic_queries_only_fixed_unit_and_never_emits_journal(self):
        from contextlib import redirect_stdout
        output = io.StringIO()
        unit = "baci-worker-runtime-0123456789abcdef-0123456789ab-0.service"
        with patch("worker_release_bounded_process.run_bounded_capture",
                   return_value=SimpleNamespace(
                       stdout="Failed at step NAMESPACE: /srv is inaccessible\n",
                       stderr="secret=must-not-print\n")) as capture, redirect_stdout(output):
            category = emit_namespace_failure_diagnostic(unit)
        self.assertEqual(category, "namespace-path-worker-root-mask")
        self.assertEqual(output.getvalue(), "RUNTIME_SYSTEMD_DIAGNOSTIC=namespace-path-worker-root-mask\n")
        self.assertEqual(capture.call_args.args[0], (
            "/usr/bin/journalctl", "--no-pager", "--output=short", "--lines=20",
            f"--grep={unit}"))

    @patch("worker_release_runtime_verifier._run_fixed_smokes")
    def test_untrusted_run_identity_fails_before_smoke(self, smokes):
        invalid = AuthenticatedRun(**(identity().__dict__ | {"repository": "attacker/repo"}))
        with self.assertRaises(RuntimeVerificationRejected):
            verify_materialized_candidate(
                self.candidate, invalid, archive_sha256=ARCHIVE,
                owner_uid=os.geteuid(), owner_gid=os.getgid())
        smokes.assert_not_called()

    @patch("worker_release_candidate_pin.MAX_ENTRIES", 2)
    def test_candidate_entry_bound_fails_closed(self):
        with self.assertRaises(RuntimeVerificationRejected):
            verify_materialized_candidate(
                self.candidate, identity(), archive_sha256=ARCHIVE,
                owner_uid=os.geteuid(), owner_gid=os.getgid())

    @unittest.skipUnless(os.geteuid() == 0 and sys.platform.startswith("linux")
                         and os.environ.get("WORKER_RELEASE_RUNTIME_REQUIRE_SYSTEMD") == "1",
                         "requires disposable root/systemd CI and /usr/bin/node")
    def test_actual_linux_sandbox_smoke_produces_receipt(self):
        if not Path("/usr/bin/node").is_file():
            self.fail("disposable Linux verifier job requires /usr/bin/node")
        releases = Path("/srv/baci-workers/releases")
        if not releases.is_dir() or releases.stat().st_uid != 0 or releases.stat().st_mode & 0o022:
            self.fail("disposable Linux verifier job must provision the trusted release parent")
        candidate = releases / f".{SHA}.incoming.{uuid.uuid4().hex}"
        shutil.copytree(self.candidate, candidate, copy_function=shutil.copy2)
        unproven_error = None
        try:
            worker_modules = Path(__file__).resolve().parents[1] / "node_modules"
            for dependency in ("dotenv/package.json", "@supabase/supabase-js/package.json",
                               "expo-server-sdk/package.json"):
                if not (worker_modules / dependency).is_file():
                    self.fail("disposable Linux verifier job must install locked worker runtime dependencies")
            from worker_release_dependency_install import install_payload
            worker_gid = grp.getgrnam("baci-worker").gr_gid
            with tempfile.TemporaryDirectory(prefix="runtime-verifier-payload-", dir=releases) as payload_dir:
                payload = Path(payload_dir)
                (payload / "root").mkdir()
                (payload / "web" / "node_modules" / ".bin").mkdir(parents=True)
                shutil.copytree(worker_modules, payload / "root" / "node_modules", symlinks=True)
                web_tsx = payload / "web" / "node_modules" / ".bin" / "tsx"
                shutil.copy2(candidate / "apps" / "web" / "node_modules" / ".bin" / "tsx", web_tsx)
                shutil.rmtree(candidate / "node_modules")
                shutil.rmtree(candidate / "apps" / "web" / "node_modules")
                install_payload(payload, candidate, owner_uid=os.geteuid())
            freeze(candidate, worker_gid)
            observed_units = []
            from worker_release_runtime_verifier import _unit_name as real_unit_name

            def remember_unit(*args):
                unit = real_unit_name(*args)
                observed_units.append(unit)
                return unit

            with patch("worker_release_candidate_pin.RELEASES_ROOT", releases), \
                    patch("worker_release_runtime_verifier._unit_name", side_effect=remember_unit):
                try:
                    receipt = verify_materialized_candidate(
                        candidate, identity(), archive_sha256=ARCHIVE,
                        owner_uid=os.geteuid(), owner_gid=worker_gid)
                except RuntimeVerificationRejected as error:
                    if "(exit=226)" in str(error):
                        for unit in observed_units:
                            emit_namespace_failure_diagnostic(unit)
                    raise
                self.assertTrue(validate_runtime_receipt(
                    receipt, candidate, identity(), ARCHIVE,
                    owner_uid=os.geteuid(), owner_gid=worker_gid))
        except RuntimeVerificationQuiescenceUnproven as error:
            unproven_error = error
            raise
        finally:
            cleanup_candidate_after_verifier(candidate, unproven_error)



if __name__ == "__main__":
    unittest.main()
