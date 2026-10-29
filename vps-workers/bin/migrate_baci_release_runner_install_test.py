from migrate_baci_release_runner_test_support import (
    migration, make_archive, FakeResponse, ReleaseRunnerTestFixture, SimpleNamespace, patch, Path, os, json, io, stat, tarfile, tempfile, unittest,
)


class ReleaseRunnerInstallTests(ReleaseRunnerTestFixture):

    def test_adds_dedicated_runner_without_touching_legacy_runner(self):
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
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            patches = self._patch_apply_host(home)
            patches += (patch.object(migration.platform, "system", return_value="Linux"), patch.object(migration.platform, "machine", return_value="x86_64"))
            for item in patches:
                item.start()
            try:
                with patch.object(migration, "_safe_chown_tree"), patch.object(migration, "runner_artifact", return_value=("2.335.1", "https://github.com/actions/runner/releases/download/v2.335.1/actions-runner-linux-x64-2.335.1.tar.gz", migration.hashlib.sha256(archive.read_bytes()).hexdigest())), patch.dict(os.environ, {"BACI_RUNNER_ADMIN_TOKEN": "admin-secret"}, clear=False):
                    migration.apply_migration(
                        archive_path=archive, repo_root=base, runner=run, credential_verifier=verifier, service_dir=service_dir,
                        token_provider=lambda kind, token: "registration" if kind == "registration-token" else "removal",
                        registration_verifier=lambda token: self.assertEqual(token, "admin-secret"),
                    )
            finally:
                for item in reversed(patches):
                    item.stop()
            self.assertTrue((home / "actions-runner/.runner").is_file())
            self.assertEqual(stat.S_IMODE((home / "actions-runner/.credentials").stat().st_mode), 0o600)
            config_call = next(command for command in calls if any(str(arg).endswith("config.sh") for arg in command))
            self.assertIn("baci-release", config_call)
            self.assertNotIn("baci-deploy", config_call)
            self.assertTrue((old_runner / "keep.txt").is_file())
            self.assertFalse(any(str(old_runner) in str(arg) for call in calls for arg in call))


if __name__ == "__main__":
    unittest.main()
