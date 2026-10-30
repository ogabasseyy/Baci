from __future__ import annotations

import os
import pwd
import socket
import stat
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

BIN = Path(__file__).parent
TOOLS = BIN.parent / "tools" / "nonproduction-worker-release"
sys.path[:0] = [str(BIN), str(TOOLS)]

import worker_release_egress_host_service as host
from worker_release_egress_host_service import EgressHostRejected, start_egress_broker
from worker_release_egress_identity import egress_identity


class EgressHostServiceTests(unittest.TestCase):
    @unittest.skipUnless(os.geteuid() == 0 and sys.platform.startswith("linux"), "requires root Linux Unix sockets")
    def test_broker_socket_is_group_restricted_and_lifecycle_bound(self):
        _uid, gid = egress_identity()
        with tempfile.TemporaryDirectory(prefix="baci-egress-host-", dir="/run") as tmp:
            directory = Path(tmp) / "broker"
            directory.mkdir(mode=0o700)
            directory.chmod(0o711)
            path = directory / "broker.sock"
            with patch.object(host, "EGRESS_DIRECTORY", directory), \
                 patch.object(host, "EGRESS_SOCKET", path):
                stopping = threading.Event()
                service = start_egress_broker(stopping)
                info = path.lstat()
                self.assertTrue(stat.S_ISSOCK(info.st_mode))
                self.assertEqual((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)),
                                 (0, gid, 0o660))
                client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                try:
                    client.settimeout(2)
                    client.connect(str(path))
                    self.assertEqual(client.recv(1), b"\x01")
                finally:
                    client.close()
                egress_uid, egress_gid = egress_identity()
                egress_user = pwd.getpwuid(egress_uid)
                connect_as(path, egress_user.pw_uid, egress_user.pw_gid, expect_allowed=True)
                builder = pwd.getpwnam("baci-release-build")
                connect_as(path, builder.pw_uid, builder.pw_gid, expect_allowed=False)
                service.close()
                self.assertFalse(path.exists())

    @unittest.skipUnless(os.geteuid() == 0 and sys.platform.startswith("linux"), "requires root Linux Unix sockets")
    def test_directory_with_broader_access_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="baci-egress-host-", dir="/run") as tmp:
            directory = Path(tmp) / "broker"
            directory.mkdir(mode=0o700)
            with patch.object(host, "EGRESS_DIRECTORY", directory), \
                 patch.object(host, "EGRESS_SOCKET", directory / "broker.sock"):
                with self.assertRaisesRegex(EgressHostRejected, "directory ownership or mode"):
                    start_egress_broker(threading.Event())

    def test_socket_parent_and_path_are_fixed(self):
        self.assertEqual(host.EGRESS_DIRECTORY, Path("/run/baci-worker-egress"))
        self.assertEqual(host.EGRESS_SOCKET, Path("/run/baci-worker-egress/broker.sock"))
        self.assertEqual(host.DIRECTORY_MODE, 0o711)
        self.assertEqual(host.SOCKET_MODE, 0o660)


def connect_as(path: Path, uid: int, gid: int, *, expect_allowed: bool) -> None:
    pid = os.fork()
    if pid == 0:
        try:
            os.setgroups([])
            os.setgid(gid)
            os.setuid(uid)
            client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            client.settimeout(2)
            try:
                try:
                    client.connect(str(path))
                except PermissionError:
                    os._exit(0 if not expect_allowed else 11)
                if not expect_allowed:
                    os._exit(12)
                client.sendall(b"\x00\x00\x00\x01x")
                if client.recv(1) != b"\x01":
                    os._exit(13)
            finally:
                client.close()
            os._exit(0)
        except BaseException:
            os._exit(14)
    _pid, status = os.waitpid(pid, 0)
    if not os.WIFEXITED(status) or os.WEXITSTATUS(status) != 0:
        raise AssertionError("egress socket peer DAC did not match the fixed account policy")


if __name__ == "__main__":
    unittest.main()
