import importlib.util
import grp
import os
import pwd
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("provision-production-release-lock-status.py")
SPEC = importlib.util.spec_from_file_location("provision_release_lock_status", SCRIPT)
assert SPEC and SPEC.loader
provision = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = provision
SPEC.loader.exec_module(provision)


class ProvisionReleaseLockStatusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="status-service-provision-")
        self.base = Path(self.temp.name)
        self.home_parent = self.base / "home"
        self.home_parent.mkdir(mode=0o755)
        self.home_parent.chmod(0o755)
        self.home = self.home_parent / "baci-release"
        self.lock_dir = self.home / ".local/state/baci"
        self.lock_file = self.lock_dir / "pending-production-release.json"
        self.helper_dir = self.base / "usr/local/lib/baci-worker-broker"
        self.unit_dir = self.base / "etc/systemd/system"
        self.unit_dir.mkdir(parents=True)
        self.source_root = self.base / "source"
        (self.source_root / "vps-workers/bin").mkdir(parents=True)
        (self.source_root / "vps-workers/systemd").mkdir(parents=True)
        shutil.copyfile(provision.SOURCE_ROOT / "vps-workers/bin/production_release_lock_status.py",
                        self.source_root / "vps-workers/bin/production_release_lock_status.py")
        shutil.copyfile(provision.SOURCE_ROOT / "vps-workers/bin/production_release_lock_status_fs.py",
                        self.source_root / "vps-workers/bin/production_release_lock_status_fs.py")
        shutil.copyfile(provision.SOURCE_ROOT / "vps-workers/systemd/baci-production-release-lock-status.service",
                        self.source_root / "vps-workers/systemd/baci-production-release-lock-status.service")
        self.paths = provision.Paths(
            home=self.home, lock_dir=self.lock_dir, lock_file=self.lock_file,
            helper_dir=self.helper_dir, helper_path=self.helper_dir / "production_release_lock_status.py",
            helper_core_path=self.helper_dir / "production_release_lock_status_fs.py",
            unit_dir=self.unit_dir, unit_path=self.unit_dir / provision.UNIT_NAME,
            source_root=self.source_root,
        )
        self.runner_calls = []

    def tearDown(self):
        self.temp.cleanup()

    def test_dry_run_prints_fixed_plan_without_creating_paths(self):
        result = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Dry run only", result.stdout)
        self.assertIn("ProtectHome=tmpfs", (provision.SOURCE_ROOT / "vps-workers/systemd/baci-production-release-lock-status.service").read_text())
        self.assertFalse(self.home.exists())

    def test_unit_exposes_only_lock_state_directory_read_only_and_sockets(self):
        sources = provision._sources(self.paths)
        unit = next(data.decode() for target, data, _mode in sources if target == self.paths.unit_path)
        self.assertIn("ProtectHome=tmpfs", unit)
        self.assertIn("BindReadOnlyPaths=/home/baci-release/.local/state/baci:/run/baci-worker-release-status/lock-state", unit)
        self.assertNotIn("BindReadOnlyPaths=/home/baci-release\n", unit)
        self.assertNotIn("ProtectHome=read-only", unit)
        self.assertIn("RuntimeDirectory=baci-worker-release-status", unit)
        self.assertIn("RuntimeDirectoryMode=0711", unit)
        self.assertNotIn("ReadWritePaths=", unit)
        self.assertIn("RestrictAddressFamilies=AF_UNIX", unit)
        self.assertIn("ProtectSystem=strict", unit)
        self.assertNotIn("AF_INET", unit)
        helper = (provision.SOURCE_ROOT / "vps-workers/bin/production_release_lock_status.py").read_text()
        helper += (provision.SOURCE_ROOT / "vps-workers/bin/production_release_lock_status_fs.py").read_text()
        self.assertIn("LOCK_VIEW_DIRECTORY = Path(\"/run/baci-worker-release-status/lock-state\")", helper)
        self.assertIn("/proc/self/mountinfo", helper)
        self.assertIn('"ro" not in view_mounts[0]["options"]', helper)
        self.assertNotIn("/proc/1/root", helper)
        self.assertIn("/home/baci-release/.local/state/baci", helper)
        self.assertIn("/baci-release/.local/state/baci", helper)
        self.assertIn("os.fstat", helper)

    def test_reviewed_hash_gate_rejects_tampered_helper_or_unit(self):
        helper = self.source_root / "vps-workers/bin/production_release_lock_status.py"
        helper.write_text(helper.read_text() + "# altered\n")
        with self.assertRaisesRegex(RuntimeError, "hash mismatch"):
            provision._sources(self.paths)
        shutil.copyfile(provision.SOURCE_ROOT / "vps-workers/bin/production_release_lock_status.py", helper)
        helper_core = self.source_root / "vps-workers/bin/production_release_lock_status_fs.py"
        helper_core.write_text(helper_core.read_text() + "# altered\n")
        with self.assertRaisesRegex(RuntimeError, "hash mismatch"):
            provision._sources(self.paths)
        shutil.copyfile(provision.SOURCE_ROOT / "vps-workers/bin/production_release_lock_status_fs.py", helper_core)
        unit = self.source_root / "vps-workers/systemd/baci-production-release-lock-status.service"
        unit.write_text(unit.read_text() + "ExecStartPre=/bin/sh -c id\n")
        with self.assertRaisesRegex(RuntimeError, "hash mismatch"):
            provision._sources(self.paths)

    def test_home_chain_created_private_and_existing_lock_body_is_not_read_or_changed(self):
        uid, gid = os.getuid(), os.getgid()
        self.lock_dir.mkdir(parents=True, mode=0o700)
        for path in (self.home, self.home / ".local", self.home / ".local/state", self.lock_dir):
            path.chmod(0o700)
        self.lock_file.write_text("opaque lock bytes\n")
        self.lock_file.chmod(0o600)
        before = self.lock_file.read_bytes()
        provision._prepare_home_chain(self.paths, uid=uid, gid=gid, root_uid=uid)
        for path in (self.home, self.home / ".local", self.home / ".local/state", self.lock_dir):
            info = path.stat()
            self.assertEqual((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)), (uid, gid, 0o700))
        self.assertEqual(self.lock_file.read_bytes(), before)

    def test_home_chain_refuses_unsafe_preexisting_directory_without_repair(self):
        self.home.mkdir(mode=0o700)
        self.home.chmod(0o755)
        before = stat.S_IMODE(self.home.stat().st_mode)
        with self.assertRaisesRegex(RuntimeError, "ownership or mode is unsafe"):
            provision._prepare_home_chain(self.paths, uid=os.getuid(), gid=os.getgid(), root_uid=os.getuid())
        self.assertEqual(stat.S_IMODE(self.home.stat().st_mode), before)

    def test_invalid_existing_lock_fails_closed(self):
        self.lock_dir.mkdir(parents=True, mode=0o700)
        for path in (self.home, self.home / ".local", self.home / ".local/state", self.lock_dir):
            path.chmod(0o700)
        target = self.base / "target"
        target.write_text("unchanged")
        self.lock_file.symlink_to(target)
        with self.assertRaisesRegex(RuntimeError, "lock metadata is unsafe"):
            provision._prepare_home_chain(self.paths, uid=os.getuid(), gid=os.getgid(), root_uid=os.getuid())
        self.assertEqual(target.read_text(), "unchanged")

    def test_install_is_atomic_idempotent_and_refuses_different_file(self):
        target = self.base / "protected/file"
        target.parent.mkdir(mode=0o755)
        with patch.object(provision, "_check_parent_chain", return_value=None):
            provision._install_file(target, b"fixed\n", 0o440, root_uid=os.getuid(), root_gid=os.getgid())
        before_inode = target.stat().st_ino
        with patch.object(provision, "_check_parent_chain", return_value=None):
            provision._install_file(target, b"fixed\n", 0o440, root_uid=os.getuid(), root_gid=os.getgid())
        self.assertEqual(target.stat().st_ino, before_inode)
        with patch.object(provision, "_check_parent_chain", return_value=None), self.assertRaisesRegex(RuntimeError, "refusing overwrite"):
            provision._install_file(target, b"changed\n", 0o440, root_uid=os.getuid(), root_gid=os.getgid())

    def test_atomic_install_link_failure_leaves_no_partial_file_or_temp(self):
        target = self.base / "protected/partial"
        target.parent.mkdir(mode=0o755)
        with patch.object(provision, "_check_parent_chain", return_value=None), \
             patch.object(provision.os, "link", side_effect=OSError("synthetic publish failure")), \
             self.assertRaisesRegex(OSError, "synthetic publish failure"):
            provision._install_file(target, b"partial\n", 0o440, root_uid=os.getuid(), root_gid=os.getgid())
        self.assertFalse(target.exists())
        self.assertEqual(list(target.parent.glob(".baci-lock-status-*")), [])

    def test_apply_installs_before_starting_and_is_idempotent(self):
        current_uid, current_gid = os.getuid(), os.getgid()
        release = pwd.struct_passwd(("baci-release", "x", current_uid, current_gid, "", str(provision.RELEASE_HOME), "/usr/sbin/nologin"))
        bassey = pwd.struct_passwd(("bassey", "x", current_uid + 1, current_gid, "", "/home/bassey", "/bin/bash"))
        worker = pwd.struct_passwd(("baci-worker", "x", current_uid + 2, current_gid, "", "/srv/baci-workers/home", "/usr/sbin/nologin"))
        release_group = grp.struct_group(("baci-release", "x", current_gid, []))
        users = {"baci-release": release, "bassey": bassey, "baci-worker": worker}

        def get_user(name):
            return users[name]

        def get_group(name):
            if name == "baci-release":
                return release_group
            raise KeyError(name)

        def runner(command, **kwargs):
            self.runner_calls.append(tuple(command))
            if tuple(command) == ("systemctl", "daemon-reload"):
                self.assertTrue(self.paths.helper_path.is_file())
                self.assertTrue(self.paths.helper_core_path.is_file())
                self.assertTrue(self.paths.unit_path.is_file())
            return subprocess.CompletedProcess(command, 0)

        with patch.object(provision.os, "geteuid", return_value=current_uid), \
             patch.object(provision.pwd, "getpwnam", side_effect=get_user), \
             patch.object(provision.pwd, "getpwall", return_value=list(users.values())), \
             patch.object(provision.grp, "getgrnam", side_effect=get_group), \
             patch.object(provision.os, "getgrouplist", return_value=[current_gid]), \
             patch.object(provision.grp, "getgrgid", return_value=release_group), \
             patch.object(provision, "_check_parent_chain", return_value=None):
            provision.apply(self.paths, runner=runner, root_uid=current_uid, root_gid=current_gid)
            self.assertTrue(self.lock_dir.is_dir())
            self.assertTrue(self.paths.helper_path.is_file())
            self.assertTrue(self.paths.helper_core_path.is_file())
            self.assertTrue(self.paths.unit_path.is_file())
            self.assertEqual(self.runner_calls, [
                ("systemctl", "daemon-reload"),
                ("systemctl", "enable", "--now", provision.UNIT_NAME),
                ("systemctl", "is-active", "--quiet", provision.UNIT_NAME),
            ])

    def test_apply_refuses_when_systemd_start_fails_after_install(self):
        current_uid, current_gid = os.getuid(), os.getgid()
        release = pwd.struct_passwd(("baci-release", "x", current_uid, current_gid, "", str(provision.RELEASE_HOME), "/usr/sbin/nologin"))
        bassey = pwd.struct_passwd(("bassey", "x", current_uid + 1, current_gid, "", "/home/bassey", "/bin/bash"))
        worker = pwd.struct_passwd(("baci-worker", "x", current_uid + 2, current_gid, "", "/srv/baci-workers/home", "/usr/sbin/nologin"))
        users = {"baci-release": release, "bassey": bassey, "baci-worker": worker}
        group = grp.struct_group(("baci-release", "x", current_gid, []))

        def runner(command, **kwargs):
            self.runner_calls.append(tuple(command))
            returncode = 1 if tuple(command)[1:3] == ("enable", "--now") else 0
            if returncode and kwargs.get("check"):
                raise subprocess.CalledProcessError(returncode, command)
            return subprocess.CompletedProcess(command, returncode)

        with patch.object(provision.os, "geteuid", return_value=current_uid), \
             patch.object(provision.pwd, "getpwnam", side_effect=lambda name: users[name]), \
             patch.object(provision.pwd, "getpwall", return_value=list(users.values())), \
             patch.object(provision.grp, "getgrnam", side_effect=lambda name: group if name == "baci-release" else (_ for _ in ()).throw(KeyError(name))), \
             patch.object(provision.os, "getgrouplist", return_value=[current_gid]), \
             patch.object(provision.grp, "getgrgid", return_value=group), \
             patch.object(provision, "_check_parent_chain", return_value=None):
            with self.assertRaises(subprocess.CalledProcessError):
                provision.apply(self.paths, runner=runner, root_uid=current_uid, root_gid=current_gid)
        self.assertIn(("systemctl", "disable", "--now", provision.UNIT_NAME), self.runner_calls)
        self.assertFalse(self.paths.helper_path.exists())
        self.assertFalse(self.paths.helper_core_path.exists())
        self.assertFalse(self.paths.unit_path.exists())


if __name__ == "__main__":
    unittest.main()
