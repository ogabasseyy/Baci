import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("provision-worker-dependency-builder.py")
sys.path.insert(0, str(SCRIPT.parents[1] / "tools" / "nonproduction-worker-release"))
SPEC = importlib.util.spec_from_file_location("provision_worker_dependency_builder", SCRIPT)
assert SPEC and SPEC.loader
provision = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = provision
SPEC.loader.exec_module(provision)


class ProvisionBuilderTests(unittest.TestCase):
    def test_default_invocation_only_prints_fixed_plan(self):
        result = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("baci-release-build", result.stdout)
        self.assertIn("/run/baci-worker-release-build/results", result.stdout)
        self.assertIn("provide --device-uuid", result.stdout)
        self.assertIn("seed root", result.stdout)
        self.assertIn("Do not generate, authenticate, download, preverify, or publish", result.stdout)
        self.assertIn("Current builder capacity cap is below the observed graph footprint", result.stdout)
        self.assertIn("--check --source-sha", result.stdout)
        self.assertNotIn("systemctl", result.stdout)

    def test_dry_run_with_uuid_describes_mount_and_preserves_capacity_rejection(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "--device-uuid",
                                 "01234567-89ab-cdef-0123-456789abcdef"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("fixed persistent systemd mount", result.stdout)
        self.assertIn("nosuid,nodev,noexec", result.stdout)
        self.assertIn("below the observed graph footprint", result.stdout)
        self.assertIn("Do not generate", result.stdout)

    def test_apply_requires_explicit_partition_uuid(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "--apply"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("ProvisionRejected", result.stderr)

    def test_apply_capacity_guard_precedes_all_host_mutations(self):
        calls = []
        with patch.object(provision.os, "geteuid", return_value=0), patch.object(
            provision.worker_release_dependency_mount_provision,
            "require_capacity_policy", side_effect=RuntimeError("blocked")
        ), patch.object(provision, "_identity_state", side_effect=lambda: calls.append("identity")), patch.object(
            provision.worker_release_dependency_mount_provision, "install_builder_mount",
            side_effect=lambda *_args, **_kwargs: calls.append("mount")
        ), patch.object(provision.dependency_seed_provision, "provision_seed_root",
                         side_effect=lambda: calls.append("seed")):
            with self.assertRaisesRegex(provision.ProvisionRejected, "capacity policy"):
                provision.apply(device_uuid="01234567-89ab-cdef-0123-456789abcdef",
                                runner=lambda *args, **kwargs: calls.append("runner"))
        self.assertEqual(calls, [])

    def test_check_without_exact_source_sha_fails_closed(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "--check"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("ProvisionRejected", result.stderr)
        self.assertNotIn("seed entry are present", result.stdout)

    def test_partial_identity_is_rejected_without_repair(self):
        with patch.object(provision.grp, "getgrnam", return_value=object()), patch.object(
            provision.pwd, "getpwnam", side_effect=KeyError
        ):
            with self.assertRaisesRegex(provision.ProvisionRejected, "partial"):
                provision._identity_state()

    def test_builder_must_be_distinct_no_login_and_have_no_supplementary_groups(self):
        group = type("Group", (), {"gr_gid": 2100, "gr_mem": [], "gr_name": provision.GROUP})()
        locks = type("Group", (), {"gr_gid": 2104, "gr_name": "baci-locks"})()
        user = type("User", (), {"pw_uid": 2101, "pw_gid": 2100,
                                  "pw_shell": provision.NOLOGIN, "pw_dir": provision.HOME,
                                  "pw_name": provision.USER})()
        worker = type("User", (), {"pw_uid": 2102, "pw_gid": 2102,
                                    "pw_name": provision.WORKER})()
        with patch.object(provision.grp, "getgrnam", side_effect=lambda name: locks if name == "baci-locks" else group), patch.object(
            provision.pwd, "getpwnam", side_effect=[user, worker]
        ), patch.object(provision.os, "getgrouplist", return_value=[2100]), patch.object(
            provision.pwd, "getpwall", return_value=[user]
        ), patch.object(provision.grp, "getgrall", return_value=[group, locks]):
            self.assertEqual(provision._validate_identity(), (2101, 2100))
        with patch.object(provision.grp, "getgrnam", side_effect=lambda name: locks if name == "baci-locks" else group), patch.object(
            provision.pwd, "getpwnam", side_effect=[user, worker]
        ), patch.object(provision.os, "getgrouplist", return_value=[2100, 2103]):
            with self.assertRaisesRegex(provision.ProvisionRejected, "isolated contract"):
                provision._validate_identity()

    def test_builder_gid_cannot_be_shared_by_another_passwd_user(self):
        group = type("Group", (), {"gr_gid": 2100, "gr_mem": [], "gr_name": provision.GROUP})()
        locks = type("Group", (), {"gr_gid": 2104, "gr_name": "baci-locks"})()
        alias = type("User", (), {"pw_uid": 2110, "pw_gid": 2100,
                                   "pw_name": "unrelated-user"})()
        user = type("User", (), {"pw_uid": 2101, "pw_gid": 2100,
                                  "pw_shell": provision.NOLOGIN, "pw_dir": provision.HOME,
                                  "pw_name": provision.USER})()
        worker = type("User", (), {"pw_uid": 2102, "pw_gid": 2102,
                                    "pw_name": provision.WORKER})()
        with patch.object(provision.grp, "getgrnam", side_effect=lambda name: locks if name == "baci-locks" else group), patch.object(
            provision.pwd, "getpwnam", side_effect=[user, worker]
        ), patch.object(provision.os, "getgrouplist", return_value=[2100]), patch.object(
            provision.pwd, "getpwall", return_value=[user, alias]
        ), patch.object(provision.grp, "getgrall", return_value=[group, locks]):
            with self.assertRaisesRegex(provision.ProvisionRejected, "isolated contract"):
                provision._validate_identity()

    def test_builder_gid_cannot_be_aliased_by_another_group_name(self):
        group = type("Group", (), {"gr_gid": 2100, "gr_mem": [], "gr_name": provision.GROUP})()
        locks = type("Group", (), {"gr_gid": 2104, "gr_name": "baci-locks"})()
        alias = type("Group", (), {"gr_gid": 2100, "gr_name": "other-builder-alias"})()
        user = type("User", (), {"pw_uid": 2101, "pw_gid": 2100,
                                  "pw_shell": provision.NOLOGIN, "pw_dir": provision.HOME,
                                  "pw_name": provision.USER})()
        worker = type("User", (), {"pw_uid": 2102, "pw_gid": 2102,
                                    "pw_name": provision.WORKER})()
        with patch.object(provision.grp, "getgrnam", side_effect=lambda name: locks if name == "baci-locks" else group), patch.object(
            provision.pwd, "getpwnam", side_effect=[user, worker]
        ), patch.object(provision.os, "getgrouplist", return_value=[2100]), patch.object(
            provision.pwd, "getpwall", return_value=[user]
        ), patch.object(provision.grp, "getgrall", return_value=[group, locks, alias]):
            with self.assertRaisesRegex(provision.ProvisionRejected, "isolated contract"):
                provision._validate_identity()

    def _write_seed_manifest(self, seed_root: Path, path_sha: str = "a" * 40,
                             manifest_sha: str | None = None):
        manifest_sha = manifest_sha or path_sha
        seed = seed_root / path_sha
        seed.mkdir(parents=True, mode=0o700)
        receipt = {"sourceSha": manifest_sha, "pnpmVersion": provision.EXPECTED_PNPM}
        manifest = {
            "schema": 1, "authenticatedSourceSha": manifest_sha,
            "pnpmVersion": provision.EXPECTED_PNPM,
            "lockfiles": {}, "policyFiles": {}, "metadataCacheSha256": "a" * 64,
            "packageStoreSha256": "b" * 64, "sourceTreeSha256": "c" * 64,
            "verificationReceipt": receipt,
        }
        path = seed / provision.SEED_MANIFEST
        path.write_text(__import__("json").dumps(manifest), encoding="utf-8")
        path.chmod(0o444)
        seed.chmod(0o555)

    def test_seed_readiness_requires_exact_sha_and_never_falls_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed_root = Path(tmp) / "seeds"
            seed_root.mkdir(mode=0o700)
            self._write_seed_manifest(seed_root)
            with patch.object(provision.seed_readiness, "trusted_path_ancestry"), patch.object(
                provision.seed_readiness, "verify_bounded_seed_workspace"
            ):
                provision._seed_ready("a" * 40, seed_root=seed_root, owner_uid=os.getuid())
                with self.assertRaisesRegex(provision.ProvisionRejected, "unavailable"):
                    provision._seed_ready("b" * 40, seed_root=seed_root, owner_uid=os.getuid())

    def test_seed_readiness_rejects_manifest_for_another_sha(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed_root = Path(tmp) / "seeds"
            seed_root.mkdir(mode=0o700)
            self._write_seed_manifest(seed_root, "b" * 40, "a" * 40)
            with patch.object(provision.seed_readiness, "trusted_path_ancestry"), patch.object(
                provision.seed_readiness, "verify_bounded_seed_workspace"
            ):
                with self.assertRaisesRegex(provision.ProvisionRejected, "identity does not match"):
                    provision._seed_ready("b" * 40, seed_root=seed_root, owner_uid=os.getuid())

    def test_seed_readiness_requires_bounded_mount_before_opening_seed_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed_root = Path(tmp) / "seeds"
            with patch.object(
                provision.seed_readiness, "verify_bounded_seed_workspace",
                side_effect=RuntimeError("mount proof unavailable"),
            ) as verify, patch.object(provision.seed_readiness, "trusted_path_ancestry") as ancestry:
                with self.assertRaisesRegex(provision.ProvisionRejected, "bounded seed workspace"):
                    provision._seed_ready("a" * 40, seed_root=seed_root)
            verify.assert_called_once_with()
            ancestry.assert_not_called()

    def test_seed_readiness_rejects_invalid_sha_instead_of_legacy_cache(self):
        with self.assertRaisesRegex(provision.ProvisionRejected, "exact source SHA is required"):
            provision._seed_ready("not-a-sha")

    def test_prerequisites_do_not_infer_a_sha(self):
        with self.assertRaisesRegex(provision.ProvisionRejected, "exact source SHA is required"):
            provision.validate_prerequisites()

    def test_build_root_requires_bounded_mount(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(
            provision, "MAX_BUILD_FILESYSTEM_BYTES", provision.OBSERVED_GRAPH_FLOOR_BYTES + 1024 ** 3
        ), patch.object(provision.os.path, "ismount", return_value=False):
            with self.assertRaisesRegex(provision.ProvisionRejected, "fixed bounded root-owned mount"):
                provision._mounted_build_root(path=Path(tmp))

    def test_current_capacity_policy_is_below_real_graph_evidence(self):
        self.assertLessEqual(provision.MAX_BUILD_FILESYSTEM_BYTES,
                             provision.OBSERVED_GRAPH_FLOOR_BYTES)
        with self.assertRaisesRegex(provision.ProvisionRejected, "below the observed dependency graph"):
            provision._mounted_build_root()

    @unittest.skipUnless(os.geteuid() == 0, "requires root-owned ext4 recovery fixture")
    def test_ext4_lost_found_is_accepted_only_when_empty_and_root_private(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            recovery = root / "lost+found"
            recovery.mkdir(mode=0o700)
            recovery.chmod(0o700)
            with patch.object(provision, "BUILD_ROOT", root):
                self.assertTrue(provision._validate_lost_found())
                (recovery / "unexpected").touch()
                with self.assertRaisesRegex(provision.ProvisionRejected, "recovery directory is unsafe"):
                    provision._validate_lost_found()


if __name__ == "__main__":
    unittest.main()
