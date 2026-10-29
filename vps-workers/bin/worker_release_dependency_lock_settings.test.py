import tempfile
import unittest
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected
from worker_release_dependency_lock_settings import read_injected_workspace_setting


class LockInjectionSettingTests(unittest.TestCase):
    def test_absent_setting_matches_real_lockfile_default_false(self):
        with tempfile.TemporaryDirectory() as temporary:
            lock = Path(temporary) / "pnpm-lock.yaml"
            lock.write_text("lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n", encoding="utf-8")
            self.assertFalse(read_injected_workspace_setting(lock))

    def test_canonical_true_and_false_values(self):
        for value, expected in (("true", True), ("false", False)):
            with self.subTest(value=value), tempfile.TemporaryDirectory() as temporary:
                lock = Path(temporary) / "pnpm-lock.yaml"
                lock.write_text(f"lockfileVersion: '9.0'\n\nsettings:\n  injectWorkspacePackages: {value}\n", encoding="utf-8")
                self.assertIs(read_injected_workspace_setting(lock), expected)

    def test_duplicate_or_noncanonical_setting_fails_closed(self):
        contents = (
            "lockfileVersion: '9.0'\nsettings:\n  injectWorkspacePackages: true\n  injectWorkspacePackages: false\n",
            "lockfileVersion: '9.0'\nsettings:\n  injectWorkspacePackages: yes\n",
            "lockfileVersion: '9.0'\nimporters:\n  injectWorkspacePackages: true\n",
        )
        for content in contents:
            with self.subTest(content=content), tempfile.TemporaryDirectory() as temporary:
                lock = Path(temporary) / "pnpm-lock.yaml"
                lock.write_text(content, encoding="utf-8")
                with self.assertRaises(BuilderRejected):
                    read_injected_workspace_setting(lock)

    def test_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "target"
            target.write_text("settings:\n  injectWorkspacePackages: false\n", encoding="utf-8")
            link = root / "pnpm-lock.yaml"
            link.symlink_to(target)
            with self.assertRaises(BuilderRejected):
                read_injected_workspace_setting(link)


if __name__ == "__main__":
    unittest.main()
