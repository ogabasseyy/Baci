from __future__ import annotations

import os
import pwd
import sys
import struct
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "tools" / "nonproduction-worker-release"))

from worker_release_dependency_artifacts import BuilderRejected
from worker_release_source_snapshot import pin_source_snapshot
from worker_release_source_view_access import (
    SourceViewAccessRejected, _acl, fixed_reader_uids, grant_source_view_access,
)


class SourceViewAccessTests(unittest.TestCase):
    def test_acl_bytes_are_exactly_per_uid_and_not_group_or_other(self):
        acl = _acl(0o5, (1202, 1201))
        self.assertEqual(len(acl), 4 + 6 * 8)
        self.assertEqual(acl[:4], b"\x02\x00\x00\x00")
        entries = [struct.unpack_from("<HHI", acl, 4 + offset * 8)
                   for offset in range(6)]
        self.assertEqual([entry[2] for entry in entries[1:3]], [1201, 1202])
        self.assertEqual(entries[3], (0x04, 0, 0xFFFFFFFF))
        self.assertEqual(entries[-1], (0x20, 0, 0xFFFFFFFF))
        self.assertEqual(acl[-8:], b"\x20\x00\x00\x00\xff\xff\xff\xff")
        with self.assertRaises(SourceViewAccessRejected):
            _acl(0o5, (0,))

    @unittest.skipUnless(os.geteuid() == 0 and sys_platform_linux(), "requires root Linux ACLs")
    def test_fixed_accounts_can_read_view_and_pin_binds_acl(self):
        readers = fixed_reader_uids()
        users = [pwd.getpwuid(uid) for uid in readers]
        temp = tempfile.TemporaryDirectory(prefix="baci-source-view-acl-", dir="/run")
        root = Path(temp.name)
        try:
            root.chmod(0o711)
            anchor = root / "private"
            view = anchor / "candidate"
            anchor.mkdir(mode=0o700)
            view.mkdir(mode=0o700)
            (view / "pkg").mkdir(mode=0o700)
            (view / "pkg" / "package.json").write_text("{\"private\":true}\n")
            for current, directories, files in os.walk(view, topdown=False):
                for filename in files:
                    (Path(current) / filename).chmod(0o440)
                for directory in directories:
                    (Path(current) / directory).chmod(0o550)
                Path(current).chmod(0o550)
            grant_source_view_access(view, read_uids=readers)
            with pin_source_snapshot(view, trusted_root=anchor, owner_uid=0,
                                     read_uids=readers) as pin:
                pin.verify_unchanged()
                root_fd = os.open(view, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                try:
                    for account in users:
                        read_as(root_fd, account.pw_uid, account.pw_gid)
                    file_fd = os.open("pkg/package.json", os.O_RDONLY | os.O_NOFOLLOW,
                                      dir_fd=root_fd)
                    try:
                        os.setxattr(file_fd, "system.posix_acl_access",
                                    _acl(0o4, (readers[0],)))
                    finally:
                        os.close(file_fd)
                    with self.assertRaisesRegex(BuilderRejected, "reader ACL|contents changed"):
                        pin.verify_unchanged()
                finally:
                    os.close(root_fd)
        finally:
            make_writable(view if "view" in locals() else root)
            temp.cleanup()


def sys_platform_linux() -> bool:
    return os.name == "posix" and Path("/proc/self/status").exists()


def read_as(directory_fd: int, uid: int, gid: int) -> None:
    pid = os.fork()
    if pid == 0:
        try:
            os.setgroups([])
            os.setgid(gid)
            os.setuid(uid)
            os.fchdir(directory_fd)
            fd = os.open("pkg/package.json", os.O_RDONLY | os.O_NOFOLLOW)
            try:
                if os.read(fd, 128) != b"{\"private\":true}\n":
                    os._exit(12)
            finally:
                os.close(fd)
            os._exit(0)
        except BaseException:
            os._exit(13)
    _pid, status = os.waitpid(pid, 0)
    if not os.WIFEXITED(status) or os.WEXITSTATUS(status) != 0:
        raise AssertionError("fixed reader UID could not read the frozen source view")


def make_writable(path: Path) -> None:
    if not path.exists():
        return
    for current, directories, files in os.walk(path, topdown=True, followlinks=False):
        for name in files:
            item = Path(current) / name
            if not item.is_symlink():
                item.chmod(0o600)
        for name in directories:
            item = Path(current) / name
            if not item.is_symlink():
                item.chmod(0o700)
        Path(current).chmod(0o700)


if __name__ == "__main__":
    unittest.main()
