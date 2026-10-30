import importlib.util
import ast
import os
import grp
import stat
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("provision-worker-release-boundary.py")
FIXTURE_PARENT = Path("/run") if os.geteuid() == 0 and sys.platform.startswith("linux") else SCRIPT.parent
SPEC = importlib.util.spec_from_file_location("provision_worker_release_boundary", SCRIPT)
assert SPEC and SPEC.loader
provision = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = provision
SPEC.loader.exec_module(provision)

from provision_worker_release_install import ensure_root_directory, read_trusted_source
from worker_release_broker_common import BROKER_CLIENT_TIMEOUT_SECONDS


class ProvisionWorkerReleaseBoundaryTests(unittest.TestCase):
    def test_active_legacy_broker_is_rejected_before_stable_file_writer_runs(self):
        item = provision.InstallFile("launcher", b"new", 0o550,
                                      Path("/fixed/helper/start-broker.sh"), "root")
        writes = []

        class ActiveLegacyControl:
            def prove_installation_safe(self, *, current_digest, stable_files_complete):
                self.asserted = (current_digest, stable_files_complete)
                if current_digest is None or not stable_files_complete:
                    raise RuntimeError("active broker is not a complete recognized generation")

        with self.assertRaisesRegex(RuntimeError, "not a complete recognized generation"):
            provision.install_preflight.install_stable_files(
                (item,), current_digest=None, control=ActiveLegacyControl(),
                read_existing=lambda _path: None, writer=writes.append)
        self.assertEqual(writes, [])

    def test_install_preflight_rejects_mismatched_stable_state_before_any_write(self):
        item = provision.InstallFile("stable", b"new", 0o550,
                                      Path("/fixed/helper/start-broker.sh"), "root")
        metadata = SimpleNamespace(st_uid=0, st_gid=0, st_mode=stat.S_IFREG | 0o550)
        with patch.object(provision, "_read_existing", return_value=(b"legacy", metadata)), \
                patch.object(provision.grp, "getgrnam", return_value=SimpleNamespace(gr_gid=0)):
            with self.assertRaisesRegex(RuntimeError, "not an exact recognized install"):
                provision.preflight_install_files((item,))

    def test_install_preflight_accepts_only_exact_existing_stable_file(self):
        item = provision.InstallFile("stable", b"fixed", 0o550,
                                      Path("/fixed/helper/start-broker.sh"), "root")
        metadata = SimpleNamespace(st_uid=0, st_gid=0, st_mode=stat.S_IFREG | 0o550)
        with patch.object(provision, "_read_existing", return_value=(b"fixed", metadata)), \
                patch.object(provision.grp, "getgrnam", return_value=SimpleNamespace(gr_gid=0)):
            provision.preflight_install_files((item,))

    def test_broker_stop_timeout_allows_inflight_client_budget_to_drain(self):
        configured = next(line for line in provision.UNIT.splitlines()
                         if line.startswith("TimeoutStopSec="))
        timeout_seconds = int(configured.split("=", 1)[1].removesuffix("s"))
        self.assertGreaterEqual(timeout_seconds, BROKER_CLIENT_TIMEOUT_SECONDS + 60)

    def test_broker_initial_stop_signal_only_targets_main_process(self):
        self.assertIn("KillMode=mixed", provision.UNIT.splitlines())

    def test_broker_unit_write_allowlist_is_exact_and_includes_only_fixed_runtime_roots(self):
        lines = [line for line in provision.UNIT.splitlines()
                 if line.startswith("ReadWritePaths=")]
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0].split("=", 1)[1].split(), [
            "/srv/baci-workers",
            "/run/baci-worker-release",
            "/run/baci-worker-release-gate",
            "/run/baci-worker-release-build",
            "/var/lib/baci-worker-runtime-views",
            "/var/lib/baci-worker-broker/pointer",
            "/var/lib/baci-worker-broker/transaction",
        ])
        self.assertIn("ProtectSystem=strict", provision.UNIT)
        self.assertNotIn("/var/cache", lines[0])
        self.assertNotIn("/home", lines[0])

    def test_dependency_builder_prerequisites_require_isolated_identity_and_mounted_fixed_roots(self):
        group = SimpleNamespace(gr_gid=2300, gr_mem=[], gr_name=provision.BUILD_GROUP)
        builder = SimpleNamespace(pw_uid=2301, pw_gid=2300,
                                  pw_shell=provision.BUILD_NOLOGIN,
                                  pw_dir="/nonexistent", pw_name=provision.BUILD_USER)
        worker = SimpleNamespace(pw_uid=2302, pw_gid=2302, pw_name=provision.WORKER)
        release = SimpleNamespace(pw_uid=2303, pw_gid=2303, pw_name=provision.RELEASE)
        worker_group = SimpleNamespace(gr_gid=2302, gr_mem=[], gr_name=provision.WORKER)
        release_group = SimpleNamespace(gr_gid=2303, gr_mem=[], gr_name=provision.RELEASE)
        build_root = Path("/fixed-test-build")
        results_root = build_root / "results"
        build_info = os.stat_result((stat.S_IFDIR | 0o710, 11, 12, 2, 0, 2300, 0, 0, 0, 0))
        results_info = os.stat_result((stat.S_IFDIR | 0o700, 13, 12, 2, 0, 2300, 0, 0, 0, 0))

        def account(name):
            return {provision.BUILD_USER: builder,
                    provision.WORKER: worker,
                    provision.RELEASE: release}[name]

        def group_for(name):
            return {provision.BUILD_GROUP: group,
                    provision.WORKER: worker_group,
                    provision.RELEASE: release_group}[name]

        def path_stat(path):
            return build_info if Path(path) == build_root else results_info

        with patch.object(provision.grp, "getgrnam", side_effect=group_for), \
                patch.object(provision.pwd, "getpwnam", side_effect=account), \
                patch.object(provision.os, "getgrouplist", return_value=[2300]), \
                patch.object(provision.pwd, "getpwall", return_value=[builder, worker, release]), \
                patch.object(provision.grp, "getgrall", return_value=[group, worker_group, release_group]), \
                patch.object(Path, "lstat", autospec=True, side_effect=lambda self: path_stat(self)), \
                patch.object(provision.os.path, "ismount", return_value=True):
            provision._validate_dependency_builder_prerequisites(
                build_root=build_root, results_root=results_root)

        with patch.object(provision.grp, "getgrnam", side_effect=group_for), \
                patch.object(provision.pwd, "getpwnam", side_effect=account), \
                patch.object(provision.os, "getgrouplist", return_value=[2300]), \
                patch.object(provision.pwd, "getpwall", return_value=[builder, worker, release]), \
                patch.object(provision.grp, "getgrall", return_value=[group, worker_group, release_group]), \
                patch.object(Path, "lstat", autospec=True, side_effect=lambda self: path_stat(self)), \
                patch.object(provision.os.path, "ismount", return_value=False):
            with self.assertRaisesRegex(RuntimeError, "fixed mount"):
                provision._validate_dependency_builder_prerequisites(
                    build_root=build_root, results_root=results_root)

        with patch.object(provision.grp, "getgrnam", side_effect=group_for), \
                patch.object(provision.pwd, "getpwnam", side_effect=account), \
                patch.object(provision.os, "getgrouplist", return_value=[2300, 2304]), \
                patch.object(provision.pwd, "getpwall", return_value=[builder, worker, release]), \
                patch.object(provision.grp, "getgrall", return_value=[group, worker_group, release_group]), \
                patch.object(Path, "lstat", autospec=True, side_effect=lambda self: path_stat(self)), \
                patch.object(provision.os.path, "ismount", return_value=True):
            with self.assertRaisesRegex(RuntimeError, "not isolated"):
                provision._validate_dependency_builder_prerequisites(
                    build_root=build_root, results_root=results_root)

    def test_trusted_source_rejects_final_symlink(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            root = Path(directory) / "repo"
            root.mkdir()
            outside = Path(directory) / "outside.py"
            outside.write_bytes(b"outside\n")
            (root / "source.py").symlink_to(outside)
            with self.assertRaisesRegex(RuntimeError, "symlink"):
                read_trusted_source(root, "source.py", source_uid=os.getuid())
            self.assertEqual(outside.read_bytes(), b"outside\n")

    def test_trusted_source_detects_final_path_swap_after_open(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            root = Path(directory) / "repo"
            root.mkdir()
            source = root / "source.py"
            source.write_bytes(b"pinned source\n")
            outside = Path(directory) / "outside.py"
            outside.write_bytes(b"attacker source\n")
            original_read = os.read
            swapped = False

            def replace_then_read(fd, size):
                nonlocal swapped
                if not swapped:
                    swapped = True
                    source.unlink()
                    source.symlink_to(outside)
                return original_read(fd, size)

            with patch("provision_worker_release_install.os.read", side_effect=replace_then_read):
                with self.assertRaisesRegex(RuntimeError, "path changed"):
                    read_trusted_source(root, "source.py", source_uid=os.getuid())
            self.assertEqual(outside.read_bytes(), b"attacker source\n")

    def test_trusted_source_detects_ancestor_swap_during_open(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            root = Path(directory) / "repo"
            source_dir = root / "nested"
            source_dir.mkdir(parents=True)
            (source_dir / "source.py").write_bytes(b"pinned source\n")
            outside = Path(directory) / "outside"
            outside.mkdir()
            (outside / "source.py").write_bytes(b"attacker source\n")
            moved = root / "nested-original"
            original_open = os.open
            swapped = False

            def replace_ancestor(name, flags, *args, **kwargs):
                nonlocal swapped
                if name == "source.py" and not swapped:
                    swapped = True
                    source_dir.rename(moved)
                    source_dir.symlink_to(outside, target_is_directory=True)
                return original_open(name, flags, *args, **kwargs)

            with patch("provision_worker_release_install.os.open", side_effect=replace_ancestor):
                with self.assertRaisesRegex(RuntimeError, "ancestor path changed"):
                    read_trusted_source(root, "nested/source.py", source_uid=os.getuid())
            self.assertEqual((moved / "source.py").read_bytes(), b"pinned source\n")
            self.assertEqual((outside / "source.py").read_bytes(), b"attacker source\n")

    @unittest.skipUnless(os.geteuid() == 0, "installer ownership contract requires root")
    def test_install_one_is_idempotent_for_exact_root_owned_file(self):
        with tempfile.TemporaryDirectory(dir=FIXTURE_PARENT) as directory:
            destination = Path(directory) / "protected.py"
            item = provision.InstallFile("fixture", b"trusted module\n", 0o440,
                                        destination, "root")

            provision._install_one(item)
            first = destination.lstat()
            provision._install_one(item)
            second = destination.lstat()

            self.assertEqual(destination.read_bytes(), item.content)
            self.assertEqual((second.st_uid, second.st_gid, stat.S_IMODE(second.st_mode)),
                             (0, grp.getgrnam("root").gr_gid, 0o440))
            self.assertEqual((first.st_dev, first.st_ino), (second.st_dev, second.st_ino))

    @unittest.skipUnless(os.geteuid() == 0, "installer ownership contract requires root")
    def test_install_one_refuses_mismatched_existing_file(self):
        with tempfile.TemporaryDirectory(dir=FIXTURE_PARENT) as directory:
            destination = Path(directory) / "protected.py"
            item = provision.InstallFile("fixture", b"trusted module\n", 0o440,
                                        destination, "root")
            provision._install_one(item)

            mismatches = [
                ("contents", lambda: destination.write_bytes(b"different contents\n")),
                ("mode", lambda: os.chmod(destination, 0o444)),
            ]
            other_group = next((group for group in grp.getgrall()
                                if group.gr_gid != grp.getgrnam("root").gr_gid), None)
            if other_group is not None:
                mismatches.append(("group", lambda: os.chown(destination, 0, other_group.gr_gid)))

            for label, mutate in mismatches:
                with self.subTest(mismatch=label):
                    destination.unlink(missing_ok=True)
                    provision._install_one(item)
                    mutate()
                    before = destination.lstat()
                    contents = destination.read_bytes()
                    with self.assertRaisesRegex(RuntimeError, "existing protected file differs"):
                        provision._install_one(item)
                    after = destination.lstat()
                    self.assertEqual((after.st_dev, after.st_ino), (before.st_dev, before.st_ino))
                    self.assertEqual(destination.read_bytes(), contents)

    @unittest.skipUnless(os.geteuid() == 0, "installer ownership contract requires root")
    def test_install_one_rejects_symlink_target_without_following_or_replacing_it(self):
        with tempfile.TemporaryDirectory(dir=FIXTURE_PARENT) as directory:
            root = Path(directory)
            destination = root / "protected.py"
            target = root / "outside.py"
            target.write_bytes(b"outside contents\n")
            destination.symlink_to(target)
            item = provision.InstallFile("fixture", b"trusted module\n", 0o440,
                                        destination, "root")

            with self.assertRaisesRegex(RuntimeError, "root-owned regular file"):
                provision._install_one(item)

            self.assertTrue(destination.is_symlink())
            self.assertEqual(target.read_bytes(), b"outside contents\n")

    def test_root_broker_installs_exact_python_import_closure(self):
        source_root = SCRIPT.parents[2] / "vps-workers" / "bin"
        seed_source_root = SCRIPT.parents[2] / "vps-workers" / "tools" / "nonproduction-worker-release"
        pending = ["worker_release_broker", "worker_release_broker_dispatch",
                   "worker_release_broker_launcher", "worker_release_archive_extract_child",
                   "worker_release_archive_extract_launcher"]
        reachable = set()
        while pending:
            module = pending.pop()
            if module in reachable:
                continue
            path = source_root / f"{module}.py"
            if module.startswith("dependency_seed_"):
                path = seed_source_root / f"{module}.py"
            self.assertTrue(path.is_file(), f"local broker import {module} has no source")
            reachable.add(module)
            tree = ast.parse(path.read_text(encoding="utf-8"))
            imported = []
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    imported.extend(alias.name for alias in node.names)
                elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                    imported.append(node.module)
            pending.extend(
                name for name in imported
                if name.startswith("worker_release_")
                and (source_root / f"{name}.py").is_file()
                and name not in reachable
            )
            pending.extend(
                name for name in imported
                if name.startswith("dependency_seed_")
                and (seed_source_root / f"{name}.py").is_file()
                and name not in reachable
            )

        self.assertEqual(set(provision.BROKER_RUNTIME_MODULES), reachable)
        files = provision.install_files()
        destinations = [file.destination for file in files]
        self.assertEqual(len(destinations), len(set(destinations)))
        installed = {file.destination.name: file for file in files
                     if file.destination.parent == provision.HELPER_ROOT}
        for module in provision.BROKER_RUNTIME_MODULES:
            with self.subTest(module=module):
                item = installed[f"{module}.py"]
                if module == "worker_release_recovery_latch":
                    expected_group = "baci-locks"
                elif module == "worker_release_archive_extract_launcher":
                    expected_group = "baci-release-extractor"
                else:
                    expected_group = "root"
                expected_mode = (0o550 if module in {"worker_release_broker",
                                                     "worker_release_archive_extract_launcher"}
                                 else 0o440)
                self.assertEqual(item.group, expected_group)
                self.assertEqual(item.mode, expected_mode)
                module_root = seed_source_root if module.startswith("dependency_seed_") else source_root
                self.assertEqual(item.content, (module_root / f"{module}.py").read_bytes())

    def test_runtime_view_root_is_created_exactly_and_idempotently(self):
        with tempfile.TemporaryDirectory(dir=FIXTURE_PARENT) as directory:
            path = Path(directory) / "runtime-views"
            ensure_root_directory(path, uid=os.geteuid(), gid=os.getegid(), mode=0o711)
            first = path.lstat()
            ensure_root_directory(path, uid=os.geteuid(), gid=os.getegid(), mode=0o711)
            second = path.lstat()

            self.assertEqual((second.st_uid, second.st_gid, stat.S_IMODE(second.st_mode)),
                             (os.geteuid(), os.getegid(), 0o711))
            self.assertEqual((first.st_dev, first.st_ino), (second.st_dev, second.st_ino))

    def test_runtime_view_root_rejects_symlink_and_wrong_permissions(self):
        with tempfile.TemporaryDirectory(dir=FIXTURE_PARENT) as directory:
            root = Path(directory)
            target = root / "actual"
            target.mkdir(mode=0o711)
            symlink = root / "runtime-views-link"
            symlink.symlink_to(target, target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError, "symlink or non-directory"):
                ensure_root_directory(
                    symlink, uid=os.geteuid(), gid=os.getegid(), mode=0o711
                )
            self.assertTrue(symlink.is_symlink())
            self.assertEqual(stat.S_IMODE(target.lstat().st_mode), 0o711)

            wrong_mode = root / "wrong-mode"
            wrong_mode.mkdir(mode=0o700)
            with self.assertRaisesRegex(RuntimeError, "ownership or mode"):
                ensure_root_directory(
                    wrong_mode, uid=os.geteuid(), gid=os.getegid(), mode=0o711
                )

    def test_runtime_view_root_refuses_to_create_missing_parent(self):
        with tempfile.TemporaryDirectory(dir=FIXTURE_PARENT) as directory:
            path = Path(directory) / "missing-parent" / "runtime-views"
            with self.assertRaisesRegex(RuntimeError, "parent is missing"):
                ensure_root_directory(
                    path, uid=os.geteuid(), gid=os.getegid(), mode=0o711
                )
            self.assertFalse(path.parent.exists())

    def test_dry_run_is_complete_and_does_not_change_host(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "marker"
            result = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Dry run only", result.stdout)
            self.assertIn("groupadd --system baci-release", result.stdout)
            self.assertIn("baci-worker-release-broker.service", result.stdout)
            self.assertIn("worker_release_broker_common.py sha256=", result.stdout)
            self.assertIn("worker_release_quiesce_lease_identity.py sha256=", result.stdout)
            self.assertIn("worker_release_authenticated_staging.py sha256=", result.stdout)
            self.assertIn("worker_release_runtime_verifier.py sha256=", result.stdout)
            self.assertIn("install -d -o root -g root -m 0711 /var/lib/baci-worker-runtime-views", result.stdout)
            self.assertFalse(marker.exists())

    def test_install_plan_contains_only_fixed_protected_runtime_files(self):
        files = provision.install_files()
        destinations = {file.destination for file in files}
        self.assertIn(provision.HELPER_ROOT / "worker_release_broker.py", destinations)
        self.assertIn(provision.HELPER_ROOT / "worker_release_readiness.py", destinations)
        self.assertIn(provision.HELPER_ROOT / "worker_release_quiesce_lease_identity.py", destinations)
        # Every local import in the root broker facade and its helper modules
        # must be installed beside it, with immutable root-owned file modes.
        broker_modules = (
            "worker_release_broker_common.py",
            "worker_release_archive.py",
            "worker_release_broker_dispatch.py",
            "worker_release_staging.py",
            "worker_release_state.py",
            "worker_release_gigl.py",
            "worker_release_recovery_latch.py",
            "worker_release_recovery_dispatch.py",
            "worker_release_recovery_lifecycle.py",
            "worker_release_quiesce_gate.py",
            "worker_release_quiesce_lease_core.py",
            "worker_release_quiesce_lease_manager.py",
        )
        for module in broker_modules:
            self.assertIn(provision.HELPER_ROOT / module, destinations)
        installed = {file.destination.name: file for file in files if file.destination.parent == provision.HELPER_ROOT}
        for module in broker_modules:
            self.assertEqual(installed[module].mode, 0o440)
            self.assertTrue(installed[module].content)
        self.assertEqual(installed["worker_release_recovery_latch.py"].group, "baci-locks")
        launch_gate = next(file for file in files if file.relative == "launch-gate")
        self.assertEqual((launch_gate.mode, launch_gate.group), (0o550, "baci-locks"))
        self.assertIn(provision.HELPER_ROOT / "worker-release-health-check", destinations)
        self.assertIn(provision.HELPER_ROOT / "worker-release-launch-gate", destinations)
        self.assertIn(provision.HELPER_ROOT / "bin/worker-release-broker-dispatch.mjs", destinations)
        self.assertIn(provision.HELPER_ROOT / "lib/worker-release-broker.mjs", destinations)
        self.assertIn(provision.HELPER_ROOT / "lib/worker-release-github-proof.mjs", destinations)
        proof = next(file for file in files if file.relative == "github-proof.mjs")
        self.assertEqual(proof.destination, provision.HELPER_ROOT / "lib/worker-release-github-proof.mjs")
        self.assertEqual(proof.mode, 0o440)
        self.assertIn(provision.UNIT_PATH, destinations)
        self.assertTrue(all(str(file.destination).startswith((str(provision.HELPER_ROOT), "/etc/systemd/system/")) for file in files))
        self.assertTrue(all(file.mode & 0o022 == 0 for file in files))
        self.assertTrue(all("token" not in file.content.decode("utf-8", errors="ignore").lower() for file in files if file.relative in {"broker-start", "systemd-unit"}))

    def test_installer_builds_generation_and_keeps_only_fixed_launcher_control_files_stable(self):
        from worker_release_broker_generation_install import split_install_records, STABLE_FILES

        files = provision.install_files()
        stable, generation = split_install_records(files, provision.HELPER_ROOT,
                                                   lambda _group: 0)
        stable_names = {item.destination.relative_to(provision.HELPER_ROOT).as_posix()
                        for item in stable if item.destination.is_relative_to(provision.HELPER_ROOT)}
        generation_paths = {item.path for item in generation}
        self.assertTrue(STABLE_FILES.issubset(stable_names))
        self.assertIn("worker_release_broker.py", generation_paths)
        self.assertIn("worker-release-broker-dispatch.mjs", generation_paths)
        self.assertNotIn("start-broker.sh", generation_paths)
        self.assertTrue(all(item.destination == provision.UNIT_PATH or
                            item.destination.parent == provision.HELPER_ROOT and
                            item.destination.name in STABLE_FILES for item in stable))
        start = next(item.content.decode() for item in files if item.relative == "broker-start")
        self.assertIn("worker_release_broker_launcher.py", start)
        self.assertNotIn("worker_release_broker.py \\", start)

    def test_provisioning_install_helpers_are_available_from_checkout(self):
        helper = SCRIPT.with_name("provision_worker_release_install.py")
        self.assertTrue(helper.is_file())
        self.assertFalse(helper.is_symlink())

    def test_release_plan_separates_nologin_account_groups_and_broker_service(self):
        actions = provision.provisioning_plan()
        self.assertEqual(actions[0], ("groupadd", "--system", "baci-release"))
        self.assertEqual(actions[1][-2:], ("/usr/sbin/nologin", "baci-release"))
        self.assertIn(("systemctl", "enable", "--now", "baci-worker-release-broker.service"), actions)
        self.assertIn(("install", "-d", "-o", "root", "-g", "root", "-m", "0711",
                       "/var/lib/baci-worker-runtime-views"), actions)
        self.assertIn("NoNewPrivileges=yes", provision.UNIT)
        self.assertIn("ProtectHome=yes", provision.UNIT)
        self.assertIn("RuntimeDirectoryMode=0710", provision.UNIT)
        self.assertIn("RuntimeDirectoryGroup=baci-release", provision.UNIT)
        self.assertIn("ReadWritePaths=/srv/baci-workers", provision.UNIT)
        self.assertIn("/var/lib/baci-worker-broker", provision.UNIT)
        self.assertIn(("install", "-d", "-o", "root", "-g", "root", "-m", "0700",
                       "/var/lib/baci-worker-broker/transaction"), actions)
        self.assertIn(("install", "-d", "-o", "root", "-g", "root", "-m", "0711",
                       "/var/lib/baci-worker-broker/pointer"), actions)

    def test_dispatcher_layout_preserves_relative_module_imports(self):
        actual_dispatcher = next(file for file in provision.install_files() if file.relative == "dispatcher.mjs")
        wrapper = next(file for file in provision.install_files() if file.relative == "dispatcher-wrapper")
        self.assertIn("../lib/worker-release-broker.mjs", actual_dispatcher.content.decode())
        self.assertIn("./bin/worker-release-broker-dispatch.mjs", wrapper.content.decode())

    def test_broker_lock_owner_module_is_installed_root_owned_read_only(self):
        locks = next(file for file in provision.install_files() if file.relative == "lease-locks.py")
        self.assertEqual(locks.destination, provision.HELPER_ROOT / "worker_release_quiesce_locks.py")
        self.assertEqual(locks.mode, 0o440)
        install_source = SCRIPT.with_name("provision_worker_release_install.py").read_text(encoding="utf-8")
        self.assertIn("metadata.st_uid != 0", install_source)
        self.assertIn("metadata.st_gid != expected_gid", install_source)
        self.assertIn("os.chown(temporary, 0, grp.getgrnam(file.group).gr_gid)", install_source)
        self.assertIn("os.chmod(temporary, file.mode)", install_source)

    def test_cron_identity_must_be_in_protected_lock_group(self):
        with patch.object(provision.pwd, "getpwnam", return_value=type("User", (), {"pw_gid": 1000})()), \
             patch.object(provision.os, "getgrouplist", return_value=[1000, 2000]):
            provision._validate_bassey_lock_group(2000)
        with patch.object(provision.pwd, "getpwnam", return_value=type("User", (), {"pw_gid": 1000})()), \
             patch.object(provision.os, "getgrouplist", return_value=[1000]):
            with self.assertRaisesRegex(RuntimeError, "bassey is missing"):
                provision._validate_bassey_lock_group(2000)

    def test_worker_health_check_binds_active_pointer_and_fixed_services(self):
        health = next(file for file in provision.install_files() if file.relative == "health-check").content.decode()
        self.assertIn("readonly root='/srv/baci-workers'", health)
        self.assertIn('[[ "$(readlink "$root/current")" == "releases/$expected" ]]', health)
        self.assertIn('[[ -d "$root/releases/$expected" && ! -L "$root/releases/$expected" ]]', health)
        self.assertIn("baci-domain-event-router baci-event-delivery-worker baci-quiz-finalization", health)
        self.assertNotIn('"$@"', health)

    def test_partial_release_identity_fails_without_repair(self):
        with patch.object(provision.grp, "getgrnam", return_value=object()), patch.object(
            provision.pwd, "getpwnam", side_effect=KeyError
        ):
            with self.assertRaisesRegex(RuntimeError, "partial baci-release identity"):
                provision._existing_identity_state()

    def test_release_home_without_existing_identity_is_never_adopted(self):
        with patch.object(provision.Path, "lstat") as lstat:
            lstat.return_value = provision.os.stat_result((0o40755, 1, 0, 2, 501, 20, 0, 0, 0, 0))
            with self.assertRaisesRegex(RuntimeError, "refusing to adopt"):
                provision._check_release_home(account_exists=False)

    def test_missing_required_source_fails_closed(self):
        with patch.object(provision, "_source", side_effect=RuntimeError("required trusted source is missing")):
            with self.assertRaisesRegex(RuntimeError, "required trusted source"):
                provision.install_files()


if __name__ == "__main__":
    unittest.main()
