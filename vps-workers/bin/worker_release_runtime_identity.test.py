"""Isolation contract tests for the dedicated verifier user and group."""
from __future__ import annotations

import grp
import os
import pwd
import unittest
from unittest.mock import patch

import worker_release_runtime_identity as identity


class RuntimeVerifierIdentityTests(unittest.TestCase):
    def setUp(self):
        self.group = grp.struct_group((identity.VERIFY_GROUP, "x", 720, []))
        self.user = pwd.struct_passwd((identity.VERIFY_USER, "x", 721, 720, "",
                                      "/nonexistent", identity.NOLOGIN))
        self.other_group = grp.struct_group(("other", "x", 722, []))
        self.other_user = pwd.struct_passwd(("other", "x", 723, 720, "",
                                            "/home/other", "/bin/sh"))

    def _patch_valid(self, *, users=None, groups=None, supplementary=None):
        return (
            patch.object(identity.grp, "getgrnam", return_value=self.group),
            patch.object(identity.grp, "getgrall", return_value=groups or [self.group]),
            patch.object(identity.pwd, "getpwnam", return_value=self.user),
            patch.object(identity.pwd, "getpwall", return_value=users or [self.user]),
            patch.object(identity.os, "getgrouplist", return_value=supplementary or [720]),
            patch.object(identity.grp, "getgrgid",
                         side_effect=lambda gid: self.group if gid == 720 else self.other_group),
        )

    def test_accepts_only_unique_nonlogin_account_and_primary_group(self):
        patches = self._patch_valid()
        for item in patches:
            item.start()
        try:
            self.assertEqual(identity.runtime_verifier_identity(), (721, 720))
            identity.validate_runtime_verifier_provisioning()
        finally:
            for item in reversed(patches):
                item.stop()

    def test_rejects_uid_alias_gid_primary_user_and_supplementary_group(self):
        cases = (
            {"users": [self.user, pwd.struct_passwd(("alias", "x", 721, 723, "", "/x", "/bin/sh"))]},
            {"groups": [self.group, grp.struct_group(("alias", "x", 720, []))]},
            {"users": [self.user, pwd.struct_passwd(("intruder", "x", 724, 720, "", "/x", "/bin/sh"))]},
            {"supplementary": [720, 722]},
        )
        for values in cases:
            with self.subTest(values=values):
                patches = self._patch_valid(**values)
                for item in patches:
                    item.start()
                try:
                    with self.assertRaises(identity.RuntimeIdentityRejected):
                        identity.runtime_verifier_identity()
                finally:
                    for item in reversed(patches):
                        item.stop()

    def test_provisioning_rejects_user_without_group_and_group_with_other_primary_user(self):
        with patch.object(identity.grp, "getgrnam", side_effect=KeyError), \
                patch.object(identity.pwd, "getpwnam", return_value=self.user):
            with self.assertRaises(identity.RuntimeIdentityRejected):
                identity.validate_runtime_verifier_provisioning()

        with patch.object(identity.grp, "getgrnam", return_value=self.group), \
                patch.object(identity.pwd, "getpwnam", side_effect=KeyError), \
                patch.object(identity.grp, "getgrall", return_value=[self.group]), \
                patch.object(identity.pwd, "getpwall", return_value=[self.other_user]):
            with self.assertRaises(identity.RuntimeIdentityRejected):
                identity.validate_runtime_verifier_provisioning()


if __name__ == "__main__":
    unittest.main()
