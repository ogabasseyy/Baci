"""Root-only DAC test for the extractor's writable Unix-socket mount."""
from __future__ import annotations

import os
import pwd
import socket
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import worker_release_systemd_extractor as extractor


@unittest.skipUnless(
    os.geteuid() == 0 and sys.platform.startswith("linux")
    and os.environ.get("WORKER_RELEASE_EXTRACT_REQUIRE_SYSTEMD") == "1",
    "requires the disposable root/Linux extractor account fixture",
)
class ExtractorControlDacTests(unittest.TestCase):
    def test_extractor_can_connect_but_cannot_create_or_unlink_control_entries(self):
        account = pwd.getpwnam(extractor.EXTRACTOR)
        control = Path(tempfile.mkdtemp(prefix="control-dac-", dir=extractor.RUNTIME_ROOT))
        os.chown(control, 0, account.pw_gid)
        os.chmod(control, 0o710)
        socket_path = control / "extractor.sock"
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind(str(socket_path))
        os.chown(socket_path, 0, account.pw_gid)
        os.chmod(socket_path, 0o660)
        original = socket_path.lstat()
        listener.listen(1)
        listener.settimeout(5)

        def drop_identity():
            os.setgroups([])
            os.setgid(account.pw_gid)
            os.setuid(account.pw_uid)

        script = """
import os, socket, sys
folder, endpoint = sys.argv[1:]
for operation in (lambda: os.mkdir(os.path.join(folder, 'replacement')),
                  lambda: os.unlink(endpoint)):
    try:
        operation()
    except PermissionError:
        pass
    else:
        raise SystemExit(3)
client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
client.connect(endpoint)
client.sendall(b'connected')
client.close()
"""
        try:
            result = subprocess.run(
                (sys.executable, "-c", script, str(control), str(socket_path)),
                check=False, timeout=10, stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                preexec_fn=drop_identity,
            )
            self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
            connection, _ = listener.accept()
            with connection:
                self.assertEqual(connection.recv(32), b"connected")
            after = socket_path.lstat()
            self.assertEqual((after.st_dev, after.st_ino), (original.st_dev, original.st_ino))
            self.assertEqual({item.name for item in control.iterdir()}, {"extractor.sock"})
        finally:
            listener.close()
            socket_path.unlink(missing_ok=True)
            control.rmdir()


if __name__ == "__main__":
    unittest.main()
