import importlib.util
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("provision-baci-worker.py")
SPEC = importlib.util.spec_from_file_location("provision_baci_worker", SCRIPT)
assert SPEC and SPEC.loader
provision = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = provision
SPEC.loader.exec_module(provision)


class ProvisionBaciWorkerTests(unittest.TestCase):
    def test_plan_uses_fixed_nologin_identity_and_private_empty_directories(self):
        actions = provision.provisioning_plan()
        commands = [action.argv for action in actions]
        self.assertEqual(commands[0], ("groupadd", "--system", "baci-worker"))
        self.assertEqual(commands[1], ("groupadd", "--system", "baci-locks"))
        self.assertEqual(commands[2][-2:], ("/usr/sbin/nologin", "baci-worker"))
        self.assertIn(("usermod", "--append", "--groups", "baci-locks", "baci-worker"), commands)
        self.assertIn(("usermod", "--append", "--groups", "baci-locks", "bassey"), commands)
        self.assertIn(("install", "-d", "-o", "baci-worker", "-g", "baci-worker", "-m", "0700", "/srv/baci-workers/runtime"), commands)
        self.assertIn(("install", "-d", "-o", "root", "-g", "baci-worker", "-m", "0750", "/srv/baci-workers/releases"), commands)
        self.assertIn(("install", "-d", "-o", "root", "-g", "baci-locks", "-m", "0710", "/srv/baci-workers"), commands)
        self.assertIn(("install", "-d", "-o", "root", "-g", "baci-locks", "-m", "0710", "/srv/baci-workers/locks"), commands)
        self.assertIn(("ensure-lock", "/srv/baci-workers/locks/cache-invalidations.lock"), commands)
        self.assertFalse(any("secret" in value.lower() or "env" in value.lower() for command in commands for value in command))

    def test_cache_lock_creation_is_safe_and_idempotent_without_replacing_held_inode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "worker"
            (root / "locks").mkdir(parents=True)
            provision.ensure_cache_lock_file(
                str(root), owner_uid=os.geteuid(), worker_gid=os.getegid()
            )
            lock = root / "locks" / "cache-invalidations.lock"
            first = lock.stat()
            self.assertEqual(stat.S_IMODE(first.st_mode), 0o660)
            self.assertEqual((first.st_uid, first.st_gid), (os.geteuid(), os.getegid()))
            provision.ensure_cache_lock_file(
                str(root), owner_uid=os.geteuid(), worker_gid=os.getegid()
            )
            self.assertEqual(lock.stat().st_ino, first.st_ino)

    def test_cache_lock_provisioning_rejects_unsafe_existing_inode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "worker"
            locks = root / "locks"
            locks.mkdir(parents=True)
            lock = locks / "cache-invalidations.lock"
            lock.write_text("held")
            lock.chmod(0o600)
            with self.assertRaisesRegex(RuntimeError, "unexpected ownership or mode"):
                provision.ensure_cache_lock_file(
                    str(root), owner_uid=os.geteuid(), worker_gid=os.getegid()
                )
            self.assertEqual(lock.read_text(), "held")

    def test_cache_lock_provisioning_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "worker"
            locks = root / "locks"
            locks.mkdir(parents=True)
            target = Path(directory) / "target"
            target.write_text("untouched")
            (locks / "cache-invalidations.lock").symlink_to(target)
            with self.assertRaisesRegex(RuntimeError, "not a private regular inode"):
                provision.ensure_cache_lock_file(
                    str(root), owner_uid=os.geteuid(), worker_gid=os.getegid()
                )
            self.assertEqual(target.read_text(), "untouched")

    def test_dry_run_prints_plan_without_touching_filesystem(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "worker"
            result = subprocess.run(
                ["python3", str(SCRIPT), "--root", str(root)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Dry run only", result.stdout)
            self.assertFalse(root.exists())

    def test_rejects_relative_and_whitespace_paths(self):
        for root in ("relative/path", "/srv/worker data"):
            with self.subTest(root=root), self.assertRaises(ValueError):
                provision.provisioning_plan(root)

    def test_apply_skips_existing_identity_and_reapplies_directory_modes_idempotently(self):
        actions = provision.provisioning_plan()
        executed = []
        lock_actions = []
        group = provision.grp.struct_group(("baci-worker", "x", os.getegid(), []))

        with patch.object(provision, "_has_group", return_value=True), patch.object(
            provision, "_has_user", return_value=True
        ), patch.object(provision.grp, "getgrnam", return_value=group):
            provision.apply_plan(
                actions,
                identity_check=lambda: None,
                runner=lambda argv, **kwargs: executed.append((argv, kwargs)),
                lock_provisioner=lambda root, **kwargs: lock_actions.append((root, kwargs)),
            )

        self.assertEqual(len(executed), len(actions) - 4)
        self.assertTrue(all(call[0][0] in {"install", "usermod"} for call in executed))
        self.assertTrue(all(call[1]["check"] is True for call in executed))
        self.assertTrue(all(call[1]["stdin"] == subprocess.DEVNULL for call in executed))
        self.assertEqual(lock_actions, [("/srv/baci-workers", {"owner_uid": 0, "worker_gid": os.getegid()})])

    def test_apply_rejects_conflicting_identity_before_running_commands(self):
        executed = []
        with self.assertRaisesRegex(RuntimeError, "identity does not match"):
            provision.apply_plan(
                provision.provisioning_plan(),
                identity_check=lambda: (_ for _ in ()).throw(RuntimeError("existing baci-worker identity does not match the isolated account contract")),
                runner=lambda argv, **kwargs: executed.append(argv),
            )
        self.assertEqual(executed, [])

    def test_identity_preflight_rejects_an_unlisted_primary_gid_user(self):
        worker = provision.pwd.struct_passwd(("baci-worker", "x", 710, 710, "", "/srv/baci-workers/home", provision.NOLOGIN))
        other = provision.pwd.struct_passwd(("unexpected", "x", 711, 710, "", "/home/unexpected", "/bin/bash"))
        group = provision.grp.struct_group(("baci-worker", "x", 710, []))
        with patch.object(provision.pwd, "getpwnam", return_value=worker), patch.object(
            provision.pwd, "getpwall", return_value=[worker, other]
        ), patch.object(provision.grp, "getgrnam", return_value=group):
            with self.assertRaisesRegex(RuntimeError, "unexpected primary members"):
                provision._identity_preflight()

    def test_identity_preflight_rejects_duplicate_uid_passwd_entry(self):
        worker = provision.pwd.struct_passwd(("baci-worker", "x", 710, 710, "", "/srv/baci-workers/home", provision.NOLOGIN))
        duplicate = provision.pwd.struct_passwd(("other-name", "x", 710, 711, "", "/home/other", "/bin/bash"))
        group = provision.grp.struct_group(("baci-worker", "x", 710, []))
        with patch.object(provision.pwd, "getpwnam", return_value=worker), patch.object(
            provision.pwd, "getpwall", return_value=[worker, duplicate]
        ), patch.object(provision.grp, "getgrnam", return_value=group):
            with self.assertRaisesRegex(RuntimeError, "UID is shared"):
                provision._identity_preflight()

    def test_directory_preflight_preserves_populated_mismatched_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "worker"
            root.mkdir(mode=0o755)
            marker = root / "existing-data"
            marker.write_text("keep")
            original_mode = root.stat().st_mode & 0o777
            worker = provision.pwd.struct_passwd(("baci-worker", "x", 710, 710, "", str(root / "home"), provision.NOLOGIN))
            group = provision.grp.struct_group(("baci-worker", "x", 710, []))
            with patch.object(provision.pwd, "getpwnam", return_value=worker), patch.object(
                provision.grp, "getgrnam", return_value=group
            ):
                with self.assertRaisesRegex(RuntimeError, "unexpected ownership or mode"):
                    provision._directory_preflight(str(root))
            self.assertEqual(marker.read_text(), "keep")
            self.assertEqual(root.stat().st_mode & 0o777, original_mode)

    def test_fresh_identity_rejects_preexisting_populated_layout(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "worker"
            root.mkdir()
            marker = root / "existing-worker-data"
            marker.write_text("keep")
            original_mode = root.stat().st_mode & 0o777
            with patch.object(provision.pwd, "getpwnam", side_effect=KeyError), patch.object(
                provision.grp, "getgrnam", side_effect=KeyError
            ):
                with self.assertRaisesRegex(RuntimeError, "exists without the complete"):
                    provision._directory_preflight(str(root))
            self.assertEqual(marker.read_text(), "keep")
            self.assertEqual(root.stat().st_mode & 0o777, original_mode)


if __name__ == "__main__":
    unittest.main()
