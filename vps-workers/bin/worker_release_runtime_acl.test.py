"""Linux root DAC regression for the dedicated verifier candidate ACL."""
from __future__ import annotations

import grp
import os
import pwd
import stat
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

from worker_release_runtime_acl import RuntimeAclRejected, grant_candidate_acl
from worker_release_candidate_pin import pin_candidate

SHA = "a" * 40
VERIFY_GID = 60000
WORKER_GID = 60001
VERIFY_USER = "baci-worker-runtime-verify"


class RuntimeAclContractTests(unittest.TestCase):
    def test_acl_encodes_readonly_directory_and_file_permissions(self):
        from worker_release_runtime_acl import ACL_ENTRY, expected_access_acl
        directory = expected_access_acl(0o550, VERIFY_GID)
        file_acl = expected_access_acl(0o440, VERIFY_GID)
        self.assertEqual(len(directory), 4 + 5 * ACL_ENTRY.size)
        directory_entries = [ACL_ENTRY.unpack_from(directory, 4 + i * ACL_ENTRY.size)
                             for i in range(5)]
        file_entries = [ACL_ENTRY.unpack_from(file_acl, 4 + i * ACL_ENTRY.size)
                        for i in range(5)]
        self.assertEqual([entry[1] for entry in directory_entries], [5, 5, 5, 5, 0])
        self.assertEqual([entry[1] for entry in file_entries], [4, 4, 4, 4, 0])
        self.assertEqual(directory_entries[2][2], VERIFY_GID)
        self.assertEqual(file_entries[2][2], VERIFY_GID)

    def test_verifier_group_rejects_alias_or_account_membership(self):
        from worker_release_runtime_acl import RuntimeAclRejected, verifier_gid
        group = grp.struct_group(("baci-worker-runtime-verify", "x", VERIFY_GID, []))
        alias = grp.struct_group(("unexpected-alias", "x", VERIFY_GID, []))
        user = pwd.struct_passwd((VERIFY_USER, "x", 61000, VERIFY_GID, "", "/nonexistent", "/usr/sbin/nologin"))
        with patch("worker_release_runtime_identity.grp.getgrnam", return_value=group), \
                patch("worker_release_runtime_identity.grp.getgrall", return_value=[group, alias]), \
                patch("worker_release_runtime_identity.pwd.getpwnam", return_value=user), \
                patch("worker_release_runtime_identity.pwd.getpwall", return_value=[user]), \
                patch("worker_release_runtime_identity.os.getgrouplist", return_value=[VERIFY_GID]), \
                self.assertRaisesRegex(RuntimeAclRejected, "not isolated"):
            verifier_gid()


@unittest.skipUnless(os.geteuid() == 0 and sys.platform.startswith("linux"),
                     "requires Linux root and POSIX ACL support")
class RuntimeCandidateAclTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=Path.home())
        self.root = Path(self.temporary.name)
        verifier = pwd.getpwnam(VERIFY_USER)
        self.verify_uid = verifier.pw_uid
        self.verify_gid = verifier.pw_gid
        self.releases = self.root / "releases"
        self.releases.mkdir(mode=0o711)
        self.candidate = self.releases / f".{SHA}.incoming.{uuid.uuid4().hex}"
        self.candidate.mkdir(mode=0o750)
        (self.candidate / "nested").mkdir(mode=0o750)
        (self.candidate / "nested" / "readme.txt").write_text("candidate-only\n")
        executable = self.candidate / "nested" / "check.sh"
        executable.write_text("#!/bin/sh\nexit 0\n")
        executable.chmod(0o750)
        self.outside = Path(tempfile.gettempdir()) / f"worker-group-secret-{uuid.uuid4().hex}"
        self.outside.write_text("must-not-be-readable\n")
        self.nobody_owned = Path(tempfile.gettempdir()) / f"nobody-owned-secret-{uuid.uuid4().hex}"
        self.nobody_owned.write_text("must-not-be-readable-by-verifier\n")
        os.chown(self.nobody_owned, 65534, 65534)
        os.chmod(self.nobody_owned, 0o400)
        self._freeze(self.candidate)
        os.chown(self.outside, 0, WORKER_GID)
        os.chmod(self.outside, 0o440)
        group = grp.struct_group(("baci-worker-runtime-verify", "x", self.verify_gid, []))
        self.group_patches = (
            patch("worker_release_runtime_identity.grp.getgrnam", return_value=group),
            patch("worker_release_runtime_identity.grp.getgrall", return_value=[group]),
            patch("worker_release_runtime_identity.grp.getgrgid", return_value=group),
            patch("worker_release_runtime_identity.pwd.getpwnam", return_value=pwd.getpwnam(VERIFY_USER)),
            patch("worker_release_runtime_identity.pwd.getpwall", return_value=[pwd.getpwnam(VERIFY_USER)]),
            patch("worker_release_runtime_identity.os.getgrouplist", return_value=[self.verify_gid]),
            patch("worker_release_runtime_acl.RELEASES_ROOT", self.releases),
            patch("worker_release_candidate_pin.RELEASES_ROOT", self.releases),
        )
        for item in self.group_patches:
            item.start()

    @staticmethod
    def _freeze(root: Path) -> None:
        for current, directories, files in os.walk(root, topdown=False, followlinks=False):
            for name in files:
                path = Path(current) / name
                mode = 0o550 if path.stat().st_mode & 0o111 else 0o440
                os.chown(path, 0, WORKER_GID)
                os.chmod(path, mode)
            for name in directories:
                path = Path(current) / name
                os.chown(path, 0, WORKER_GID)
                os.chmod(path, 0o550)
        os.chown(root, 0, WORKER_GID)
        os.chmod(root, 0o550)

    def tearDown(self):
        for item in reversed(self.group_patches):
            item.stop()
        for current, directories, _files in os.walk(self.root, topdown=True, followlinks=False):
            os.chmod(current, 0o700)
            for name in directories:
                path = Path(current) / name
                if not path.is_symlink():
                    os.chmod(path, 0o700)
        self.outside.unlink(missing_ok=True)
        self.nobody_owned.unlink(missing_ok=True)
        self.temporary.cleanup()

    def test_verifier_gid_reads_only_the_acl_granted_candidate(self):
        granted_gid = grant_candidate_acl(
            self.candidate, expected_sha=SHA, owner_uid=0, owner_gid=WORKER_GID,
            releases_root=self.releases)
        self.assertEqual(granted_gid, self.verify_gid)
        self.assertEqual(stat.S_IMODE(self.candidate.stat().st_mode), 0o550)
        with pin_candidate(self.candidate, expected_sha=SHA, owner_uid=0,
                           owner_gid=WORKER_GID, verifier_gid=self.verify_gid) as pin:
            pin.verify_unchanged()

        code = (
            "from pathlib import Path; import sys; "
            "Path(sys.argv[1]).read_text(); "
            "\nfor name in sys.argv[2:]:\n"
            " try: Path(name).read_text()\n"
            " except PermissionError: continue\n"
            " raise SystemExit(12)\n"
            "raise SystemExit(0)"
        )
        def drop_identity():
            os.setgroups([])
            os.setgid(self.verify_gid)
            os.setuid(self.verify_uid)
        result = subprocess.run(
            (sys.executable, "-c", code,
             str(self.candidate / "nested" / "readme.txt"), str(self.outside),
             str(self.nobody_owned)),
            check=False, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, preexec_fn=drop_identity,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_unexpected_acl_is_rejected_instead_of_repaired(self):
        from worker_release_runtime_acl import expected_access_acl
        descriptor = os.open(self.candidate, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.setxattr(descriptor, "system.posix_acl_access",
                        expected_access_acl(os.fstat(descriptor).st_mode, self.verify_gid + 1))
        finally:
            os.close(descriptor)
        with self.assertRaisesRegex(RuntimeAclRejected, "unexpected access ACL"):
            grant_candidate_acl(self.candidate, expected_sha=SHA,
                                owner_uid=0, owner_gid=WORKER_GID,
                                releases_root=self.releases)


if __name__ == "__main__":
    unittest.main()
