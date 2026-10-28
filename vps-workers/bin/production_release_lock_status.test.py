import importlib.util
import os
import socket
import tempfile
import threading
import unittest
from contextlib import contextmanager
from unittest.mock import patch
from pathlib import Path

MODULE = Path(__file__).with_name("production_release_lock_status.py")
SPEC = importlib.util.spec_from_file_location("production_release_lock_status", MODULE)
status = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(status)


class ReleaseLockStatusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="release-lock-status-")
        self.root = Path(os.path.realpath(self.temp.name))
        self.uid = os.getuid()
        self.runtime_dir = self.root / "run/baci-worker-release-status"
        self.view_dir = self.runtime_dir / "lock-state"
        self.lock_path = self.view_dir / status.LOCK_FILENAME
        self.socket_path = self.root / "status.sock"
        self.view_dir.mkdir(parents=True, mode=0o700)
        for directory in (self.root / "run", self.runtime_dir, self.view_dir):
            directory.chmod(0o700)

    def tearDown(self):
        self.temp.cleanup()

    @contextmanager
    def fixture_view(self):
        with patch.object(status, "LOCK_VIEW_DIRECTORY", self.view_dir), \
                patch.object(status, "LOCK_PATH", self.lock_path), \
                patch.object(status, "STATUS_RUNTIME_DIRECTORY", self.runtime_dir), \
                patch.object(status, "_verify_readonly_bind_view"):
            yield

    def serve_once(self, *, deploy_uid=None):
        listener = status.bind_status_socket(str(self.socket_path), root_uid=self.uid)
        result = {}

        def accept_one():
            connection, _ = listener.accept()
            with connection:
                status.serve_connection(
                    connection,
                    deploy_uids={self.uid if deploy_uid is None else deploy_uid},
                    release_uid=self.uid,
                    root_uid=self.uid,
                )
            listener.close()

        thread = threading.Thread(target=accept_one)
        thread.start()
        with self.fixture_view():
            try:
                result["status"] = status.query_status(str(self.socket_path))
            except status.StatusError as error:
                result["error"] = str(error)
        thread.join(timeout=3)
        self.assertFalse(thread.is_alive(), "status handler did not finish")
        return result

    def test_reports_only_unlocked_when_private_namespace_is_valid_and_file_is_absent(self):
        with self.fixture_view():
            self.assertEqual(status.read_lock_status(release_uid=self.uid, root_uid=self.uid), "unlocked")
            self.assertEqual(self.serve_once(), {"status": "unlocked"})

    def test_reports_boolean_only_for_a_valid_private_lock(self):
        self.lock_path.write_text('{"run_id":"123","sha":"secret-detail"}\n')
        self.lock_path.chmod(0o600)

        with self.fixture_view():
            result = self.serve_once()

        self.assertEqual(result, {"status": "locked"})
        self.assertNotIn("run_id", str(result))
        self.assertNotIn("secret-detail", str(result))

    def test_refuses_untrusted_lock_metadata_instead_of_reporting_unlocked(self):
        self.lock_path.write_text("x\n")
        self.lock_path.chmod(0o640)

        with self.assertRaisesRegex(status.StatusError, "metadata is untrusted"):
            with self.fixture_view():
                status.read_lock_status(release_uid=self.uid, root_uid=self.uid)

    def test_refuses_symlinked_lock_and_unsafe_parent(self):
        target = self.root / "lock-target"
        target.write_text("x\n")
        self.lock_path.symlink_to(target)
        with self.assertRaisesRegex(status.StatusError, "cannot be inspected"):
            with self.fixture_view():
                status.read_lock_status(release_uid=self.uid, root_uid=self.uid)

        self.lock_path.unlink()
        self.view_dir.chmod(0o770)
        with self.assertRaisesRegex(status.StatusError, "mode is untrusted"):
            with self.fixture_view():
                status.read_lock_status(release_uid=self.uid, root_uid=self.uid)

    def test_parent_swap_after_open_cannot_redirect_lock_inspection(self):
        self.lock_path.write_text('{"run_id":"123"}\n')
        self.lock_path.chmod(0o600)
        moved_view = self.root / "lock-state-original"
        decoy_view = self.root / "decoy" / "lock-state"
        decoy_view.mkdir(parents=True, mode=0o700)
        for directory in (self.root / "decoy", decoy_view):
            directory.chmod(0o700)

        original_open = os.open
        swapped = False

        def open_then_swap(path, flags, *args, **kwargs):
            nonlocal swapped
            descriptor = original_open(path, flags, *args, **kwargs)
            if path == "lock-state" and kwargs.get("dir_fd") is not None and not swapped:
                self.view_dir.rename(moved_view)
                self.view_dir.symlink_to(decoy_view)
                swapped = True
            return descriptor

        with self.fixture_view():
            with patch.object(status.os, "open", side_effect=open_then_swap):
                actual = status.read_lock_status(release_uid=self.uid, root_uid=self.uid)

        self.assertTrue(swapped, "test did not race the lock-state view component")
        self.assertEqual(actual, "locked")

    def test_final_lock_replacement_after_open_uses_fstat_of_pinned_inode(self):
        self.lock_path.write_text('{"run_id":"123"}\n')
        self.lock_path.chmod(0o600)
        target = self.root / "attacker-lock"
        target.write_text("attacker data\n")
        original_open = os.open
        swapped = False

        def open_then_swap(path, flags, *args, **kwargs):
            nonlocal swapped
            descriptor = original_open(path, flags, *args, **kwargs)
            if path == self.lock_path.name and kwargs.get("dir_fd") is not None and not swapped:
                self.lock_path.unlink()
                self.lock_path.symlink_to(target)
                swapped = True
            return descriptor

        with self.fixture_view():
            with patch.object(status.os, "open", side_effect=open_then_swap):
                with self.assertRaisesRegex(status.StatusError, "metadata is untrusted"):
                    status.read_lock_status(release_uid=self.uid, root_uid=self.uid)

        self.assertTrue(swapped, "test did not replace the final lock pathname")

    def test_rejects_an_unapproved_kernel_peer_uid(self):
        result = self.serve_once(deploy_uid=self.uid + 1)
        self.assertEqual(result, {"error": "release lock status response is invalid"})

    def test_client_fails_closed_when_endpoint_is_unavailable(self):
        with self.assertRaisesRegex(status.StatusError, "endpoint is unavailable"):
            status.query_status(str(self.root / "missing.sock"), timeout=0.1)

    def test_refuses_non_status_request(self):
        listener = status.bind_status_socket(str(self.socket_path), root_uid=self.uid)

        def accept_one():
            connection, _ = listener.accept()
            with connection:
                status.serve_connection(connection, deploy_uids={self.uid}, release_uid=self.uid,
                                        root_uid=self.uid)
            listener.close()

        thread = threading.Thread(target=accept_one)
        thread.start()
        with self.fixture_view():
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.connect(str(self.socket_path))
                client.sendall(b"dump-lock\n")
                self.assertEqual(client.recv(64), b"unavailable\n")
        thread.join(timeout=3)
        self.assertFalse(thread.is_alive(), "status handler did not finish")

    def test_mountinfo_accepts_root_or_separate_home_filesystem_layout(self):
        line = (
            "1 0 0:44 / / rw,relatime - ext4 /dev/root rw,relatime\n"
            "2 1 0:45 / /home rw,nosuid,nodev - tmpfs tmpfs rw\n"
            "3 1 8:1 /baci-release/.local/state/baci "
            "/run/baci-worker-release-status/lock-state ro,nosuid,nodev "
            "- ext4 /dev/home rw,relatime"
        )
        status._validate_mountinfo(line)
        with self.assertRaisesRegex(status.StatusError, "unique read-only mount"):
            status._validate_mountinfo(line.replace("ro,nosuid", "rw,nosuid"))
        with self.assertRaisesRegex(status.StatusError, "unique read-only mount"):
            status._validate_mountinfo(line + "\n" + line.splitlines()[-1])

    def test_mountinfo_rejects_unexpected_source_root_and_accepts_root_filesystem_path(self):
        base = (
            "1 0 0:44 / / rw - ext4 /dev/root rw\n"
            "2 1 8:1 {root} /run/baci-worker-release-status/lock-state "
            "ro - ext4 /dev/home rw"
        )
        status._validate_mountinfo(base.format(root="/home/baci-release/.local/state/baci"))
        status._validate_mountinfo(base.format(root="/baci-release/.local/state/baci"))
        with self.assertRaisesRegex(status.StatusError, "source root"):
            status._validate_mountinfo(base.format(root="/other/baci-release/.local/state/baci"))
        with self.assertRaisesRegex(status.StatusError, "source root"):
            status._validate_mountinfo(base.format(root="/"))

    def test_mountinfo_field_unescaping_handles_kernel_escapes(self):
        self.assertEqual(status._unescape_mountinfo_field(r"/home/lock\040state"), "/home/lock state")


if __name__ == "__main__":
    unittest.main()
