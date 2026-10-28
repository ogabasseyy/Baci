import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("provision-worker-release-boundary.py")
SPEC = importlib.util.spec_from_file_location("provision_worker_release_boundary", SCRIPT)
assert SPEC and SPEC.loader
provision = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = provision
SPEC.loader.exec_module(provision)


class ProvisionWorkerReleaseBoundaryTests(unittest.TestCase):
    def test_dry_run_is_complete_and_does_not_change_host(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "marker"
            result = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Dry run only", result.stdout)
            self.assertIn("groupadd --system baci-release", result.stdout)
            self.assertIn("baci-worker-release-broker.service", result.stdout)
            self.assertIn("worker_release_broker_common.py sha256=", result.stdout)
            self.assertIn("worker_release_quiesce_lease_identity.py sha256=", result.stdout)
            self.assertFalse(marker.exists())

    def test_install_plan_contains_only_fixed_protected_runtime_files(self):
        files = provision.install_files()
        destinations = {file.destination for file in files}
        self.assertIn(provision.HELPER_ROOT / "worker_release_broker.py", destinations)
        self.assertIn(provision.HELPER_ROOT / "worker_release_readiness.py", destinations)
        self.assertIn(provision.HELPER_ROOT / "worker_release_quiesce_lease_identity.py", destinations)
        # Every local import in the root broker facade and its helper modules
        # must be installed beside it, with immutable root-owned file modes.
        broker_modules = (
            "worker_release_broker_common.py",
            "worker_release_archive.py",
            "worker_release_broker_dispatch.py",
            "worker_release_staging.py",
            "worker_release_state.py",
            "worker_release_gigl.py",
        )
        for module in broker_modules:
            self.assertIn(provision.HELPER_ROOT / module, destinations)
        installed = {file.destination.name: file for file in files if file.destination.parent == provision.HELPER_ROOT}
        for module in broker_modules:
            self.assertEqual(installed[module].mode, 0o440)
            self.assertTrue(installed[module].content)
        self.assertIn(provision.HELPER_ROOT / "worker-release-health-check", destinations)
        self.assertIn(provision.HELPER_ROOT / "bin/worker-release-broker-dispatch.mjs", destinations)
        self.assertIn(provision.HELPER_ROOT / "lib/worker-release-broker.mjs", destinations)
        self.assertIn(provision.UNIT_PATH, destinations)
        self.assertTrue(all(str(file.destination).startswith((str(provision.HELPER_ROOT), "/etc/systemd/system/")) for file in files))
        self.assertTrue(all(file.mode & 0o022 == 0 for file in files))
        self.assertTrue(all("token" not in file.content.decode("utf-8", errors="ignore").lower() for file in files if file.relative in {"broker-start", "systemd-unit"}))

    def test_provisioning_install_helpers_are_available_from_checkout(self):
        helper = SCRIPT.with_name("provision_worker_release_install.py")
        self.assertTrue(helper.is_file())
        self.assertFalse(helper.is_symlink())

    def test_release_plan_separates_nologin_account_groups_and_broker_service(self):
        actions = provision.provisioning_plan()
        self.assertEqual(actions[0], ("groupadd", "--system", "baci-release"))
        self.assertEqual(actions[1][-2:], ("/usr/sbin/nologin", "baci-release"))
        self.assertIn(("systemctl", "enable", "--now", "baci-worker-release-broker.service"), actions)
        self.assertIn("NoNewPrivileges=yes", provision.UNIT)
        self.assertIn("ProtectHome=yes", provision.UNIT)
        self.assertIn("RuntimeDirectoryMode=0710", provision.UNIT)
        self.assertIn("RuntimeDirectoryGroup=baci-release", provision.UNIT)

    def test_dispatcher_layout_preserves_relative_module_imports(self):
        actual_dispatcher = next(file for file in provision.install_files() if file.relative == "dispatcher.mjs")
        wrapper = next(file for file in provision.install_files() if file.relative == "dispatcher-wrapper")
        self.assertIn("../lib/worker-release-broker.mjs", actual_dispatcher.content.decode())
        self.assertIn("./bin/worker-release-broker-dispatch.mjs", wrapper.content.decode())

    def test_worker_health_check_binds_active_pointer_and_fixed_services(self):
        health = next(file for file in provision.install_files() if file.relative == "health-check").content.decode()
        self.assertIn("readonly root='/srv/baci-workers'", health)
        self.assertIn('[[ "$(readlink "$root/current")" == "$expected" ]]', health)
        self.assertIn("baci-domain-event-router baci-event-delivery-worker baci-quiz-finalization", health)
        self.assertNotIn('"$@"', health)

    def test_partial_release_identity_fails_without_repair(self):
        with patch.object(provision.grp, "getgrnam", return_value=object()), patch.object(
            provision.pwd, "getpwnam", side_effect=KeyError
        ):
            with self.assertRaisesRegex(RuntimeError, "partial baci-release identity"):
                provision._existing_identity_state()

    def test_release_home_without_existing_identity_is_never_adopted(self):
        with patch.object(provision.Path, "lstat") as lstat:
            lstat.return_value = provision.os.stat_result((0o40755, 1, 0, 2, 501, 20, 0, 0, 0, 0))
            with self.assertRaisesRegex(RuntimeError, "refusing to adopt"):
                provision._check_release_home(account_exists=False)

    def test_missing_required_source_fails_closed(self):
        with patch.object(provision, "_source", side_effect=RuntimeError("required trusted source is missing")):
            with self.assertRaisesRegex(RuntimeError, "required trusted source"):
                provision.install_files()


if __name__ == "__main__":
    unittest.main()
