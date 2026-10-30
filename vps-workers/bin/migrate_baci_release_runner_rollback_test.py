from migrate_baci_release_runner_test_support import (
    migration, make_archive, FakeResponse, ReleaseRunnerTestFixture, SimpleNamespace, patch, Path, os, json, io, stat, tarfile, tempfile, unittest,
)


class ReleaseRunnerRollbackTests(ReleaseRunnerTestFixture):

    def test_failed_isolation_rolls_back_only_the_new_runner(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            home, old_runner, archive, verifier = self._prepare_apply_fixture(base)
            calls = []
            service_dir = base / "systemd"
            service_dir.mkdir()

            def run(command, **kwargs):
                calls.append(command)
                if any(str(arg).endswith("config.sh") for arg in command):
                    for name in (".runner", ".credentials"):
                        artifact = home / "actions-runner" / name
                        artifact.write_text("mocked private runner state", encoding="utf-8")
                        os.chmod(artifact, 0o600)
                if "install" in command:
                    (service_dir / "actions.runner.ogabasseyy-Baci.baci-release-01.service").write_text(
                        "[Service]\nUser=baci-release\nWorkingDirectory=" + str(home / "actions-runner") + "\n", encoding="utf-8"
                    )
                if command[0] == str(verifier):
                    return SimpleNamespace(returncode=1, stdout="", stderr="")
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            patches = self._patch_apply_host(home)
            patches += (patch.object(migration.platform, "system", return_value="Linux"), patch.object(migration.platform, "machine", return_value="x86_64"))
            for item in patches:
                item.start()
            try:
                with patch.object(migration, "_safe_chown_tree"), patch.object(migration, "runner_artifact", return_value=("2.335.1", "https://github.com/actions/runner/releases/download/v2.335.1/actions-runner-linux-x64-2.335.1.tar.gz", migration.hashlib.sha256(archive.read_bytes()).hexdigest())), patch.dict(os.environ, {"BACI_RUNNER_ADMIN_TOKEN": "admin-secret"}, clear=False):
                    with self.assertRaisesRegex(RuntimeError, "runner migration command failed"):
                        migration.apply_migration(
                            archive_path=archive, repo_root=base, runner=run, credential_verifier=verifier, service_dir=service_dir,
                            token_provider=lambda kind, token: "registration" if kind == "registration-token" else "removal",
                            registration_verifier=lambda _token: None,
                        )
            finally:
                for item in reversed(patches):
                    item.stop()
            self.assertFalse((home / "actions-runner").exists())
            self.assertTrue((old_runner / "keep.txt").is_file())
            rollback_call = next(command for command in calls if "remove" in command)
            self.assertIn("removal", rollback_call)

    def test_partial_service_install_failure_rolls_back_attempted_side_effects(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            home, old_runner, archive, verifier = self._prepare_apply_fixture(base)
            calls = []
            service_dir = base / "systemd"
            service_dir.mkdir()
            unit = service_dir / "actions.runner.ogabasseyy-Baci.baci-release-01.service"

            def run(command, **kwargs):
                calls.append(command)
                if any(str(arg).endswith("config.sh") and "remove" not in command for arg in command):
                    for name in (".runner", ".credentials"):
                        artifact = home / "actions-runner" / name
                        artifact.write_text("mocked private runner state", encoding="utf-8")
                        os.chmod(artifact, 0o600)
                if "install" in command:
                    unit.write_text(
                        "[Service]\nUser=baci-release\nWorkingDirectory=" + str(home / "actions-runner") + "\n", encoding="utf-8"
                    )
                    return SimpleNamespace(returncode=1, stdout="", stderr="partial install")
                if "uninstall" in command:
                    unit.unlink(missing_ok=True)
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            patches = self._patch_apply_host(home)
            patches += (patch.object(migration.platform, "system", return_value="Linux"), patch.object(migration.platform, "machine", return_value="x86_64"))
            for item in patches:
                item.start()
            try:
                with patch.object(migration, "_safe_chown_tree"), patch.object(migration, "runner_artifact", return_value=("2.335.1", "https://github.com/actions/runner/releases/download/v2.335.1/actions-runner-linux-x64-2.335.1.tar.gz", migration.hashlib.sha256(archive.read_bytes()).hexdigest())), patch.dict(os.environ, {"BACI_RUNNER_ADMIN_TOKEN": "admin-secret"}, clear=False):
                    with self.assertRaisesRegex(RuntimeError, "runner migration command failed"):
                        migration.apply_migration(
                            archive_path=archive, repo_root=base, runner=run, credential_verifier=verifier, service_dir=service_dir,
                            token_provider=lambda kind, token: "registration" if kind == "registration-token" else "removal",
                            registration_verifier=lambda _token: None,
                        )
            finally:
                for item in reversed(patches):
                    item.stop()

            self.assertFalse((home / "actions-runner").exists())
            self.assertTrue((old_runner / "keep.txt").is_file())
            self.assertFalse(unit.exists())
            self.assertTrue(any("stop" in command for command in calls))
            self.assertTrue(any("remove" in command for command in calls))
            self.assertTrue(any("uninstall" in command for command in calls))

    def test_partial_config_failure_attempts_runner_removal(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            home, old_runner, archive, verifier = self._prepare_apply_fixture(base)
            calls = []
            service_dir = base / "systemd"
            service_dir.mkdir()

            def run(command, **kwargs):
                calls.append(command)
                if any(str(arg).endswith("config.sh") for arg in command):
                    if "remove" not in command:
                        for name in (".runner", ".credentials"):
                            artifact = home / "actions-runner" / name
                            artifact.write_text("mocked partial config", encoding="utf-8")
                            os.chmod(artifact, 0o600)
                        return SimpleNamespace(returncode=1, stdout="", stderr="partial config")
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            patches = self._patch_apply_host(home)
            patches += (patch.object(migration.platform, "system", return_value="Linux"), patch.object(migration.platform, "machine", return_value="x86_64"))
            for item in patches:
                item.start()
            try:
                with patch.object(migration, "_safe_chown_tree"), patch.object(migration, "runner_artifact", return_value=("2.335.1", "https://github.com/actions/runner/releases/download/v2.335.1/actions-runner-linux-x64-2.335.1.tar.gz", migration.hashlib.sha256(archive.read_bytes()).hexdigest())), patch.dict(os.environ, {"BACI_RUNNER_ADMIN_TOKEN": "admin-secret"}, clear=False):
                    with self.assertRaisesRegex(RuntimeError, "runner migration command failed"):
                        migration.apply_migration(
                            archive_path=archive, repo_root=base, runner=run, credential_verifier=verifier, service_dir=service_dir,
                            token_provider=lambda kind, token: "registration" if kind == "registration-token" else "removal",
                            registration_verifier=lambda _token: None,
                        )
            finally:
                for item in reversed(patches):
                    item.stop()

            remove_call = next(command for command in calls if any(str(arg).endswith("config.sh") for arg in command) and "remove" in command)
            self.assertIn("removal", remove_call)
            self.assertFalse((home / "actions-runner").exists())
            self.assertTrue((old_runner / "keep.txt").is_file())


if __name__ == "__main__":
    unittest.main()
