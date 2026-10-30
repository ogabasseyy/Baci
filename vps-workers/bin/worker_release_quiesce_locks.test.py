import fcntl
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

import worker_release_quiesce_locks as locks
from worker_release_quiesce_locks import LockSetError, acquire_lock_fds


class BrokerOwnedLockTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.root = Path(self.temp.name)
        self.root.chmod(0o710)
        self.first = self.root / "first.lock"
        self.second = self.root / "second.lock"
        for path in (self.first, self.second):
            path.write_bytes(b"")
            path.chmod(0o660)

    def tearDown(self):
        self.temp.cleanup()

    def acquire(self, paths, timeout=1):
        return acquire_lock_fds(
            paths, expected_uid=os.geteuid(), expected_gid=os.getegid(),
            deadline=time.monotonic() + timeout, directory=self.root,
        )

    def test_broker_owned_descriptor_excludes_other_open_descriptions_until_close(self):
        held = self.acquire([self.first])
        probe = os.open(self.first, os.O_RDWR)
        try:
            self.assertTrue(fcntl.fcntl(held[0], fcntl.F_GETFD) & fcntl.FD_CLOEXEC)
            with self.assertRaises(LockSetError):
                self.acquire([self.first], timeout=0.1)
        finally:
            os.close(probe)
            os.close(held[0])
        released = self.acquire([self.first], timeout=1)
        os.close(released[0])

    def test_partial_acquisition_failure_closes_previously_locked_descriptors(self):
        link = self.root / "linked.lock"
        link.symlink_to(self.second)
        with self.assertRaises(LockSetError):
            self.acquire([self.first, link])
        acquired = self.acquire([self.first], timeout=1)
        os.close(acquired[0])

    def test_untrusted_mode_is_rejected(self):
        self.first.chmod(0o666)
        with self.assertRaises(LockSetError):
            self.acquire([self.first])

    def test_dotenv_reader_resolves_from_staged_current_release_layout(self):
        sha = "a" * 40
        releases = self.root / "releases"
        releases.mkdir(mode=0o750)
        release = releases / sha
        (release / "bin").mkdir(parents=True)
        (release / "bin/gigl-dotenv.sh").write_text("# staged dotenv reader\n", encoding="utf-8")
        (release / "bin/gigl-dotenv.sh").chmod(0o440)
        release.chmod(0o550)
        current = self.root / "current"
        current.symlink_to(Path("releases") / sha)
        require_metadata = locks._require_metadata
        def portable_metadata(path, *, uid, gid, mode, regular):
            return require_metadata(path, uid=os.geteuid() if uid == 0 else uid,
                                    gid=gid, mode=mode, regular=regular)
        with patch.object(locks, "WORKER_ROOT", self.root), \
             patch.object(locks, "RELEASES_DIR", releases), \
             patch.object(locks, "CURRENT_LINK", current), \
             patch.object(locks, "_require_metadata", side_effect=portable_metadata):
            self.assertEqual(
                locks._trusted_current_dotenv_reader(os.getegid()),
                release / "bin/gigl-dotenv.sh",
            )

    def test_dotenv_reader_rejects_noncanonical_current_target(self):
        releases = self.root / "releases"
        releases.mkdir()
        current = self.root / "current"
        current.symlink_to(Path("../outside/bin"))
        with patch.object(locks, "WORKER_ROOT", self.root), \
             patch.object(locks, "RELEASES_DIR", releases), \
             patch.object(locks, "CURRENT_LINK", current):
            with self.assertRaises(LockSetError):
                locks._trusted_current_dotenv_reader(os.getegid())


if __name__ == "__main__":
    unittest.main()
